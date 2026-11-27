# Production deployment runbook

Production-only. No Keycloak, no external identity provider and no static bearer-token mode.

## Self-hosted OAuth 2.1

The MCP Gateway hosts both the protected resource and a minimal authorization server at \`https://mcp.mrcute.space\`.

- OAuth authorization server metadata: \`/.well-known/oauth-authorization-server\`
- Protected resource metadata: \`/.well-known/oauth-protected-resource\`
- Authorization endpoint: \`/oauth/authorize\`
- Token endpoint: \`/oauth/token\`
- DCR endpoint: \`/oauth/register\`
- JWKS endpoint: \`/oauth/jwks.json\`
- Revocation endpoint: \`/oauth/revoke\`

Authorization Code + PKCE S256 is required. ChatGPT's DCR flow is supported; CIMD is deliberately not advertised in this first version. Public clients use token endpoint auth method \`none\`. The resource parameter must equal \`https://mcp.mrcute.space/mcp\` and is copied into JWT audience.

## Required Kubernetes Secret

Create the Secret \`mcp-oauth-secrets\` in namespace \`ops-prod\` through the approved secret-provisioning path (never commit it):

- \`MCP_BOOTSTRAP_EMAIL\`: initial admin login email.
- \`MCP_BOOTSTRAP_PASSWORD\`: strong initial password, at least 14 characters.
- \`MCP_OAUTH_SIGNING_PRIVATE_KEY\`: PEM-encoded RSA private key (PKCS#8, RSA 2048-bit minimum; 3072-bit recommended).
- \`MCP_OAUTH_SIGNING_KID\`: stable key identifier, e.g. \`mcp-rsa-2026-01\`.

The app hashes the bootstrap password with scrypt and stores the account in SQLite on persistent storage. The bootstrap user is created only if the email does not already exist; changing the environment password does not overwrite an existing account. Signing key rotation must retain the previous public key during the maximum token lifetime and is a separate reviewed operation.

## Persistent data

The deployment mounts a persistent volume claim \`mcp-auth-data\` at \`/var/lib/vps-mcp-auth\`. SQLite stores users, registered OAuth clients, sessions, authorization codes and refresh-token families. Do not run more than one gateway replica against this SQLite database. The deployment strategy is Recreate.

## Important implementation limitations / security gates

- Login uses a single bootstrap administrator account. User creation, password reset/change UI, multi-user administration and MFA are not implemented.
- Login attempts are throttled by IP/email in SQLite. Place the service behind the existing trusted HTTPS ingress and preserve a trustworthy client IP policy; do not blindly trust user-supplied forwarded headers.
- DCR accepts HTTPS redirect URIs only and stores exact URI matches. The initial ChatGPT integration must be verified against the actual callback URI.
- CIMD and \`private_key_jwt\` are not advertised or supported; the authorization server advertises DCR and public-client \`none\`.
- Access JWTs last five minutes. Revoking refresh tokens does not immediately invalidate already-issued access tokens; they expire within five minutes.
- Refresh tokens rotate on every use; reuse of a consumed token revokes its family.
- Signing private key and bootstrap password are runtime secrets only; never put them in Git, ConfigMaps, command history or chat.

## Before deployment

The PR must pass Node 26 typecheck/build/tests, an OAuth protocol/security review and an end-to-end ChatGPT MCP authorization test. Confirm persistent volume availability and provision the Kubernetes Secret out of band. Do not install the Root Agent or deploy until separately authorized.

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

\`\`\`bash
sudo bash /opt/vps-mcp-controller/scripts/preflight-vps.sh
\`\`\`

This command is read-only. No production workload changes are authorized by merging this PR.
