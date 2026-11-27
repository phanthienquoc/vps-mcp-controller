# Security policy

## OAuth authorization

- Self-hosted OAuth 2.1 Authorization Server runs in the MCP Gateway; Keycloak and external identity providers are not used.
- Require Authorization Code + PKCE S256. No implicit or password grant.
- Advertise RFC 8414 authorization-server metadata, RFC 9728 protected-resource metadata and DCR. CIMD is not advertised in this initial implementation.
- Public OAuth clients use \`token_endpoint_auth_method=none\`; clients are bound to exact registered HTTPS redirect URIs.
- Echo and validate the exact MCP \`resource\` value; access-token audience must equal \`https://mcp.mrcute.space/mcp\`.
- Passwords are stored as scrypt hashes with per-user random salts. Login failures are throttled by IP/email.
- Sessions, one-time authorization codes, registered clients and refresh-token families are persisted in SQLite on a dedicated PVC. Keep exactly one gateway replica.
- Access tokens are RS256 JWTs with five-minute expiry and the required \`mcp:tools\` scope. Private signing key is supplied only through Kubernetes Secret; public key is served through JWKS.
- Refresh tokens are opaque, stored hashed, rotate on every use and revoke their family on reuse.
- Login and consent forms carry only a random, short-lived server-side authorization transaction handle; authorization parameters are never trusted from browser-submitted Base64 payloads.
- Authorization transactions are stored hashed, expire after ten minutes, and are atomically consumed once on successful login or consent. Consent revalidates client, exact redirect URI, response type, PKCE S256 challenge, resource and scope before issuing a code.
- Login and consent POSTs reject cross-site Fetch Metadata and mismatched Origin headers; the transaction handle is an additional CSRF defense.
- Revoking a refresh token does not invalidate an already-issued access JWT immediately; the remaining maximum exposure is five minutes.
- Bootstrap account is created once from runtime Secret values. This initial version has no user management, password reset/change UI or MFA; keep access restricted to one administrator until those controls exist.
- Never commit credentials, password hashes, signing keys or token material. Do not expose secrets in logs.

## Production workflow gates

- The only production workflow is manual dispatch on `master` in the `tce-k3s-01` GitHub Environment.
- Require `MCP_OAUTH_PRODUCTION_READY=true` only after OAuth protocol/security review and ChatGPT MCP authorization end-to-end verification.
- Require SSH port 22, a non-root deploy account, a pinned `known_hosts` entry, `StrictHostKeyChecking=yes`, and an immutable 40-character `GITHUB_SHA`.
- Validate all required Environment variables and secrets before building/publishing; do not print or pass secrets in process arguments.
- Run the read-only preflight before image publication. The workflow logs only its PASS/WARN/FAIL summary, not host inventory.
- GHCR read credentials travel over SSH stdin. The host creates the pull secret from a mode-0600 temporary Docker config and removes the temporary file.
- The root-owned entrypoint fetches `origin/master`, verifies the requested commit is an ancestor, and applies only the Kubernetes manifests archived from that trusted checkout.
- Verify Kubernetes node `tce-k3s-01` is Ready and pin the Gateway Pod to it so the hostPath Root Agent socket cannot resolve on another node.

## Deployment trust

- Gateway runs as UID 10001, with read-only root filesystem, no added capabilities and no service-account token.
- Root Agent runs as UID 0 on the host, exposed only through a Unix socket with owner root, group vps-mcp and mode 0660.
- Root Agent uses fixed executable paths and validated argument arrays; no model-supplied shell strings.
- Trusted checkout and deployment manifests are root-owned; deployment verifies an immutable commit.
- Autonomous mutations remain allowlisted; stock/media namespaces are read-only.
