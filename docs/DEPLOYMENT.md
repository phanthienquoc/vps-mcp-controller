# Production deployment runbook

Production-only. No Keycloak, no external identity provider and no static bearer-token mode.

## Restricted OAuth bootstrap mode

The first production rollout is intentionally OAuth-only:

- HTTPS terminates at the existing Traefik ingress using the cert-manager Secret `mcp-mrcute-space-tls`.
- The Gateway runs the self-hosted OAuth authorization server and protected MCP resource.
- `MCP_ROOT_AGENT_ENABLED=false` is explicit in the Kubernetes Deployment. The MCP server registers no VPS administration tools in this mode.
- The Gateway Pod does not mount `/run/vps-mcp` and has no access to the Root Agent Unix socket.
- OAuth state remains on the `mcp-auth-data` PVC.

To authorize this restricted first rollout, set the GitHub Environment variable `MCP_OAUTH_BOOTSTRAP_APPROVED=true`. Do not set `MCP_OAUTH_PRODUCTION_READY=true` merely to pass the bootstrap gate. The workflow still requires successful CI for the exact master SHA, strict SSH host verification and the read-only VPS preflight.

After deployment, verify `/healthz`, OAuth metadata, login, DCR, Authorization Code + PKCE S256, token audience/scope, and the actual ChatGPT callback URI in the connector UI. Keep Root Agent tools disabled during all these tests.

Enabling VPS tools is a separate change requiring independent security review, proxy-peer/rate-limit review, restore and signing-key rotation rehearsals, and successful live ChatGPT authorization. That later change must explicitly enable `MCP_ROOT_AGENT_ENABLED` and add the Root Agent socket mount back to the Pod in a reviewed release. Do not toggle the flag alone: without the socket mount, the Root Agent client cannot connect.

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

The deployment mounts a persistent volume claim `mcp-auth-data` at `/var/lib/vps-mcp-auth`. SQLite stores users, registered OAuth clients, sessions, authorization codes and refresh-token families. Do not run more than one gateway replica against this SQLite database. The deployment strategy is Recreate. With local-path WaitForFirstConsumer storage, the PVC may remain Pending until the Gateway Pod is scheduled.

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

Encrypt the exported backup at rest, restrict access, store it outside the VPS/PVC, and retain its checksum and timestamp. Test restore periodically in an isolated namespace/PVC: stop the test Gateway, restore the snapshot as `auth.sqlite`, start the test Gateway with the matching Secret version, run `PRAGMA integrity_check`, and verify a test login plus existing client/session state. Never test restore against the production PVC.

## Remaining security review

- Login uses a single bootstrap administrator account. User creation, password reset/change UI, multi-user administration and MFA are not implemented.
- Login attempts are throttled by direct peer IP/email. Keep proxy trust disabled until the ingress proxy boundary and trusted address ranges are verified.
- The exact ChatGPT callback-ID-specific redirect URI must be taken from the connector management UI and tested; never guess or hardcode it.
- CIMD and `private_key_jwt` are not advertised or supported.
- Access JWTs last five minutes; refresh-token rotation and replay-family revocation are implemented.
- Signing private key and bootstrap password are runtime secrets only; never put them in Git, ConfigMaps, command history or chat.
- Root Agent tools remain disabled in bootstrap mode and must not be enabled until independent review and the documented operational rehearsals pass.

## Approved deployment workflow gates

The manual `.github/workflows/deploy-vps.yml` workflow on `master` uses the GitHub Environment `tce-k3s-01`.

Required Environment variables:
- `MCP_OAUTH_BOOTSTRAP_APPROVED=true` authorizes only the restricted OAuth bootstrap. Root Agent tools remain disabled and the socket is not mounted.
- `MCP_OAUTH_PRODUCTION_READY=true` is reserved for a later fully reviewed production release; do not set it for the bootstrap.
- `VPS_TARGET_ID=tce-k3s-01`, `VPS_HOST`, `VPS_USER` (non-root), and `VPS_SSH_PORT=22`.

Required Environment secrets: `VPS_SSH_PRIVATE_KEY`, `VPS_KNOWN_HOSTS`, and read-only `GHCR_READ_TOKEN`. The workflow requires successful CI for the exact immutable master SHA, SSH with `-o StrictHostKeyChecking=yes` and the pinned `VPS_KNOWN_HOSTS` file, plus a read-only VPS preflight before image publication. The root-owned entrypoint independently verifies the requested SHA is reachable from `origin/master` and applies manifests archived from that trusted checkout.

## Host bootstrap sequence

The first read-only preflight may report missing Root Agent, socket group, OAuth Secret or root-owned wrappers. Treat these as blockers; do not bypass them. After the output has been reviewed and host setup explicitly authorized, use only the reviewed installers:

- `sudo bash /opt/vps-mcp-controller/scripts/install-root-agent.sh`
- `sudo bash /opt/vps-mcp-controller/scripts/install-deploy-entrypoint.sh <existing-non-root-ssh-user>`

Re-run the read-only preflight after installation. The bootstrap Gateway does not mount the Root Agent socket, but the approved deployment entrypoint still validates the host's deployment trust boundary.
