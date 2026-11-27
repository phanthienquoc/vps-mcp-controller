# Security policy

## OAuth authorization

- Self-hosted OAuth 2.1 Authorization Server runs in the MCP Gateway; Keycloak and external identity providers are not used.
- Require Authorization Code + PKCE S256. No implicit or password grant.
- Advertise RFC 8414 authorization-server metadata, RFC 9728 protected-resource metadata and DCR. For a resource identifier with a path (`https://mcp.mrcute.space/mcp`), publish and advertise the path-specific metadata URI (`/.well-known/oauth-protected-resource/mcp`); retain the origin-level metadata route as a compatibility alias. CIMD is neither advertised nor resolved: clients must be registered through this server's DCR endpoint, and unregistered client identifiers never trigger outbound metadata fetches.
- Public OAuth clients use exactly `token_endpoint_auth_method=none`; DCR defaults omitted `grant_types` to `authorization_code` per RFC 7591, accepts only `authorization_code` with optional `refresh_token`, and rejects unsupported grants, response types, duplicate redirect URIs and confidential-client authentication methods. Refresh tokens are issued only when the client registered that grant. Clients are bound to exact registered HTTPS redirect URIs.
- Echo and validate the exact MCP `resource` value; access-token audience must equal `https://mcp.mrcute.space/mcp`.
- Passwords are stored as scrypt hashes with per-user random salts. Login failures are throttled by direct-peer IP/email. Express proxy trust remains disabled; do not trust caller-supplied forwarding headers.
- Sessions, one-time authorization codes, registered clients and refresh-token families are persisted in SQLite on a dedicated PVC. Keep exactly one gateway replica.
- Access tokens are RS256 JWTs with five-minute expiry and the required `mcp:tools` scope. Token endpoint responses, including errors, use `Cache-Control: no-store` and `Pragma: no-cache`. Private signing key is supplied only through Kubernetes Secret; public keys are served through JWKS. `MCP_OAUTH_PREVIOUS_PUBLIC_KEYS` accepts up to five public-only RSA-2048+ JWKs for a controlled rotation overlap; private JWK parameters are rejected.
- Refresh tokens are opaque, stored hashed, rotate on every use and revoke their family on reuse. The public-client revocation endpoint requires the registered `client_id`, never reveals whether a token exists, and revokes the full matching refresh-token family; revocation responses are non-cacheable.
- Login and consent forms carry only a random, short-lived server-side authorization transaction handle; authorization parameters are never trusted from browser-submitted Base64 payloads.
- Browser session cookies use the `__Host-` prefix with `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, no `Domain` attribute, a bounded eight-hour lifetime and explicit expiry on logout.
- Authorization transactions are stored hashed, expire after ten minutes, and are atomically consumed once on successful login or consent. Consent revalidates client, exact redirect URI, response type, PKCE S256 challenge, resource and scope before issuing a code.
- Login, consent and logout POSTs require an exact issuer-origin `Origin` header and reject cross-site Fetch Metadata; missing-Origin and cross-origin form submissions are tested. The transaction handle is an additional CSRF defense.
- ChatGPT callback mode: keep `authorization_response_iss_parameter_supported=false` until every authorization response that redirects to a validated client URI, including OAuth errors, carries `iss`. ChatGPT therefore uses the callback-ID-specific redirect URI shown for that connection in its MCP server management page (`https://chatgpt.com/connector/oauth/{callback_id}`), not the stable platform callback. DCR stores the concrete redirect URI exactly as supplied; authorization and token exchange require that exact value. Never hardcode, guess, wildcard, or normalize a callback ID. Successful consent redirects include `iss`; validation errors remain local JSON responses and do not redirect.
- DCR is limited to 20 requests per direct peer per hour; authorization to 120 per peer per 15 minutes; login to 30 and consent to 60 requests per peer per minute; token to 60 per peer per minute; revocation to 30 per peer per minute. Limits use persistent SQLite fixed windows and return `429` with `Retry-After`. Login also applies an eight-failure per-account/IP lockout window.
- Limits key on the direct socket peer, not `X-Forwarded-For`. Behind Traefik, callers may share one quota. Keep proxy trust disabled until the ingress proxy boundary and trusted address ranges are verified.
- Revoking a refresh token does not invalidate an already-issued access JWT immediately; the remaining maximum exposure is five minutes.
- Bootstrap account is created once from runtime Secret values. This initial version has no user management, password reset/change UI or MFA; keep access restricted to one administrator until those controls exist.
- SQLite runs in WAL mode. Backups must use SQLite's online snapshot mechanism (`VACUUM INTO`) rather than copying only the main database file while the Gateway is live. Exported backups must be encrypted, checksummed and stored off-host; restore must be rehearsed against an isolated PVC.
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
