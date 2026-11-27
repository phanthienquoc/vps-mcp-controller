# Production deployment runbook

Production-only. No Keycloak, no external identity provider and no static bearer-token mode.

## Self-hosted OAuth 2.1

The MCP Gateway hosts both the protected resource and a minimal authorization server at `https://mcp.mrcute.space`.

- OAuth authorization server metadata: `/.well-known/oauth-authorization-server`
- Protected resource metadata for the `/mcp` resource: `/.well-known/oauth-protected-resource/mcp` (RFC 9728 path-specific URI).
- Origin-level compatibility alias: `/.well-known/oauth-protected-resource`.
- Authorization endpoint: `/oauth/authorize`
- Token endpoint: `/oauth/token`
- DCR endpoint: `/oauth/register`
- JWKS endpoint: `/oauth/jwks.json`
- Revocation endpoint: `/oauth/revoke`

Authorization Code + PKCE S256 is required. ChatGPT's DCR flow is supported; CIMD is deliberately not advertised in this first version. Public clients use token endpoint auth method `none`. The resource parameter must equal `https://mcp.mrcute.space/mcp` and is copied into JWT audience. The MCP `401` Bearer challenge points to the path-specific metadata URI above. The Gateway serves both that path-specific URI and the origin-level compatibility alias.

## Required Kubernetes Secret

Create the Secret `mcp-oauth-secrets` in namespace `ops-prod` through the approved secret-provisioning path (never commit it):

- `MCP_BOOTSTRAP_EMAIL`: initial admin login email.
- `MCP_BOOTSTRAP_PASSWORD`: strong initial password, at least 14 characters.
- `MCP_OAUTH_SIGNING_PRIVATE_KEY`: PEM-encoded RSA private key (PKCS#8, RSA 2048-bit minimum; 3072-bit recommended).
- `MCP_OAUTH_SIGNING_KID`: stable key identifier, e.g. `mcp-rsa-2026-01`.

The app hashes the bootstrap password with scrypt and stores the account in SQLite on persistent storage. The bootstrap user is created only if the email does not already exist; changing the environment password does not overwrite an existing account. `MCP_OAUTH_PREVIOUS_PUBLIC_KEYS` is an optional JSON array of public RSA JWKs used only for verification/JWKS overlap during rotation. Never put private JWK members in this value. The app rejects malformed keys, duplicate `kid` values and RSA moduli below 2048 bits.

## Persistent data

The deployment mounts a persistent volume claim `mcp-auth-data` at `/var/lib/vps-mcp-auth`. SQLite stores users, registered OAuth clients, sessions, authorization codes and refresh-token families. Do not run more than one gateway replica against this SQLite database. The deployment strategy is Recreate.

## Signing-key rotation procedure

The active private key is always `MCP_OAUTH_SIGNING_PRIVATE_KEY`; `MCP_OAUTH_SIGNING_KID` identifies it. `MCP_OAUTH_PREVIOUS_PUBLIC_KEYS` accepts up to five public-only RSA JWKs (`kty`, `use`, `alg`, `kid`, `n`, `e`). The JWKS endpoint publishes the active public key plus these previous public keys; signing always uses the active private key.

1. Generate a new RSA private key and a unique `kid` in the approved secret-management environment. Do not paste key material into chat, Git, shell history or logs.
2. Export the current active public key as a public-only JWK. Add it to `MCP_OAUTH_PREVIOUS_PUBLIC_KEYS` while leaving the current private key and current `kid` unchanged. Apply the Secret update and restart the Gateway through the approved deployment workflow. Verify the JWKS contains both the current and previous `kid`.
3. Update `MCP_OAUTH_SIGNING_PRIVATE_KEY` and `MCP_OAUTH_SIGNING_KID` to the new key, keeping the old public JWK in `MCP_OAUTH_PREVIOUS_PUBLIC_KEYS`. Restart the Gateway. Verify newly issued tokens use the new `kid`, while a previously issued test token still validates against JWKS.
4. Keep the old public key published for at least 10 minutes after the last token signed by it (five-minute maximum access-token lifetime plus clock tolerance and JWKS cache margin). Then remove that old public JWK and verify the new key remains published.
5. Preserve a securely stored rollback copy of the prior Secret version. If validation fails, restore the previous active private key and `kid` while retaining any public keys needed for still-live tokens.

Do not rotate keys by changing only the private key or `kid`: removing the old public key too early invalidates unexpired access tokens. The procedure is documented but has not yet been exercised against a running production Gateway.

## SQLite backup and restore

SQLite is configured in WAL mode. Never copy only `auth.sqlite` while the Gateway is running; committed transactions may still reside in `auth.sqlite-wal`.

For a consistent online backup, use SQLite's `VACUUM INTO` through the Node.js 26 runtime in the running Gateway container. This produces a standalone database snapshot without copying the live WAL files:

```bash
set -euo pipefail
NS=ops-prod
POD="$(kubectl -n "$NS" get pod -l app=vps-mcp-gateway -o jsonpath='{.items[0].metadata.name}')"
test -n "$POD"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="/tmp/mcp-auth-$STAMP.sqlite"
kubectl exec -n "$NS" "$POD" -- node --input-type=module -e '
  import { DatabaseSync } from "node:sqlite";
  const source = new DatabaseSync("/var/lib/vps-mcp-auth/auth.sqlite", { readOnly: true });
  const target = process.argv[1];
  if (!/^\/tmp\/mcp-auth-[0-9]{8}T[0-9]{6}Z\.sqlite$/.test(target)) throw new Error("Unexpected backup path");
  source.exec("VACUUM INTO '" + target + "'");
  source.close();
' "$BACKUP"
kubectl exec -n "$NS" "$POD" -- node --input-type=module -e '
  import { DatabaseSync } from "node:sqlite";
  const db = new DatabaseSync(process.argv[1], { readOnly: true });
  const result = db.prepare("PRAGMA integrity_check").get();
  db.close();
  if (result.integrity_check !== "ok") throw new Error("SQLite integrity_check failed");
' "$BACKUP"
kubectl cp "$NS/$POD:$BACKUP" "./mcp-auth-$STAMP.sqlite"
sha256sum "./mcp-auth-$STAMP.sqlite"
```

Encrypt the exported backup at rest, restrict access, store it outside the VPS/PVC, and retain its checksum and timestamp. Test restore periodically in an isolated namespace/PVC: stop the test Gateway, restore the snapshot as `auth.sqlite`, start the test Gateway with the matching Secret version, run `PRAGMA integrity_check`, and verify a test login plus existing client/session state. Never test restore against the production PVC. The backup command and integrity check are documented; a full restore rehearsal is still a production gate.

## Important implementation limitations / security gates

- Login uses a single bootstrap administrator account. User creation, password reset/change UI, multi-user administration and MFA are not implemented.
- Login attempts are throttled by IP/email in SQLite. Place the service behind the existing trusted HTTPS ingress and preserve a trustworthy client IP policy; do not blindly trust user-supplied forwarded headers.
- DCR accepts HTTPS redirect URIs only and stores exact URI matches. The ChatGPT callback-ID-specific URI is supported when supplied by the connector management UI; the exact concrete URI is preserved through DCR, consent redirect and token exchange. Do not guess or hardcode a callback ID. The actual ChatGPT integration must still be verified against the URI shown by the connector UI.
- CIMD and `private_key_jwt` are not advertised or supported; the authorization server advertises DCR and public-client `none`.
- Access JWTs last five minutes. Revoking refresh tokens does not immediately invalidate already-issued access tokens; they expire within five minutes.
- Refresh tokens rotate on every use; reuse of a consumed token revokes its family.
- Signing private key and bootstrap password are runtime secrets only; never put them in Git, ConfigMaps, command history or chat.

## Before deployment

The merged `master` revision has passed Node 26 CI (shell validation, typecheck, build and test suite). Production still requires an OAuth protocol/security review and an end-to-end ChatGPT MCP authorization test. Confirm persistent volume availability and provision the Kubernetes Secret out of band. Do not install the Root Agent or deploy until separately authorized.

## Approved deployment workflow gates

The only approved production path is the manual `.github/workflows/deploy-vps.yml` workflow on `master`, using the GitHub Environment `tce-k3s-01`. The workflow validates the immutable `GITHUB_SHA` before publishing and rechecks the read-only VPS preflight before any image build/publish step.

Required Environment variables (values are configured in GitHub, never committed):
- `MCP_OAUTH_PRODUCTION_READY=true`: set only after the OAuth protocol/security review and ChatGPT MCP authorization end-to-end test pass.
- `VPS_HOST`: the SSH host covered by the pinned known-hosts entry.
- `VPS_USER`: an existing non-root SSH deploy user.
- `VPS_SSH_PORT=22`: other ports are rejected.

Required Environment secrets:
- `VPS_SSH_PRIVATE_KEY`
- `VPS_KNOWN_HOSTS`
- `GHCR_READ_TOKEN` with read-only package access.

The workflow checks that all required variables/secrets are present before building or publishing, requires `StrictHostKeyChecking=yes` with a pinned `known_hosts` entry, and runs `sudo -n /usr/local/sbin/vps-mcp-preflight` without logging host details. The root-owned entrypoint then verifies the requested SHA is reachable from `origin/master`, checks that Kubernetes node `tce-k3s-01` is Ready, and applies only manifests archived from that trusted checkout. The Gateway is pinned to that node because the Root Agent socket is a hostPath.

Install the Root Agent and the root-owned deploy/preflight wrappers only through their reviewed installers and only after the user-run preflight has been inspected. Do not use ad-hoc SSH shell commands or direct `kubectl apply` for production deployment.

## Host bootstrap sequence

The first read-only preflight may report that the Root Agent, socket group, OAuth Secret or root-owned wrappers are not installed yet. Treat those as blockers; do not bypass them. After the output has been reviewed and the user explicitly authorizes host setup, the reviewed installers are:

- `sudo bash /opt/vps-mcp-controller/scripts/install-root-agent.sh`
- `sudo bash /opt/vps-mcp-controller/scripts/install-deploy-entrypoint.sh <existing-non-root-ssh-user>`

The second installer creates root-owned `vps-mcp-deploy` and `vps-mcp-preflight` wrappers plus a command-scoped sudoers rule. Re-run it after changing either trusted script. These commands change the host and must not be run as part of the read-only preflight.

## Existing VPS preflight

```bash
sudo bash /opt/vps-mcp-controller/scripts/preflight-vps.sh
```

This command is read-only. No production workload changes are authorized by merging this PR.
