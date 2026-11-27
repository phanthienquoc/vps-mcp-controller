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
- Revoking a refresh token does not invalidate an already-issued access JWT immediately; the remaining maximum exposure is five minutes.
- Bootstrap account is created once from runtime Secret values. This initial version has no user management, password reset/change UI or MFA; keep access restricted to one administrator until those controls exist.
- Never commit credentials, password hashes, signing keys or token material. Do not expose secrets in logs.

## Deployment trust

- Gateway runs as UID 10001, with read-only root filesystem, no added capabilities and no service-account token.
- Root Agent runs as UID 0 on the host, exposed only through a Unix socket with owner root, group vps-mcp and mode 0660.
- Root Agent uses fixed executable paths and validated argument arrays; no model-supplied shell strings.
- Trusted checkout and deployment manifests are root-owned; deployment verifies an immutable commit.
- Autonomous mutations remain allowlisted; stock/media namespaces are read-only.
