# Security policy

## OAuth authorization

- Self-hosted OAuth 2.1 Authorization Server runs in the MCP Gateway; Keycloak and external identity providers are not used.
- Require Authorization Code + PKCE S256. No implicit or password grant.
- Advertise RFC 8414 authorization-server metadata, RFC 9728 protected-resource metadata and DCR. For a resource identifier with a path (`https://mcp.mrcute.space/mcp`), publish and advertise the path-specific metadata URI (`/.well-known/oauth-protected-resource/mcp`); retain the origin-level metadata route as a compatibility alias. CIMD is neither advertised nor resolved.
- Public OAuth clients use exactly `token_endpoint_auth_method=none`; DCR defaults omitted `grant_types` to `authorization_code`, accepts only `authorization_code` with optional `refresh_token`, and binds clients to exact registered HTTPS redirect URIs.
- Echo and validate the exact MCP `resource` value; access-token audience must equal `https://mcp.mrcute.space/mcp`.
- Passwords use scrypt hashes with random salts. Login failures are throttled by direct-peer IP/email. Express proxy trust remains disabled.
- Sessions, one-time authorization codes, registered clients and refresh-token families persist in SQLite on a dedicated PVC. Keep exactly one Gateway replica.
- Access tokens are RS256 JWTs with five-minute expiry and required `mcp:tools` scope. Signing keys are runtime Kubernetes Secrets only.
- Refresh tokens are opaque, hashed, rotated on every use and revoke their family on reuse.
- Login and consent use short-lived server-side authorization transaction handles; Origin and Fetch Metadata checks protect form POSTs.
- Browser sessions use a `__Host-` cookie with Secure, HttpOnly, SameSite=Lax, Path=/ and bounded lifetime.
- ChatGPT callback mode requires the exact callback-ID-specific redirect URI shown in the connector UI. Never guess, wildcard or normalize callback IDs.
- Rate limits use the direct socket peer, not caller-supplied `X-Forwarded-For`. Behind Traefik, callers may share a quota until proxy trust is independently reviewed.
- Bootstrap account is single-admin only; user management, password reset/change UI and MFA are not implemented.
- SQLite runs in WAL mode. Backups use `VACUUM INTO`; exports must be encrypted and stored off-host. Restore must be rehearsed against an isolated PVC.

## Restricted bootstrap mode

- `MCP_ROOT_AGENT_ENABLED` defaults to disabled unless exactly `true`.
- In the bootstrap Kubernetes manifest it is explicitly `false`.
- The bootstrap Pod does not mount the host's `/run/vps-mcp` directory or Root Agent Unix socket.
- With tools disabled, the MCP server exposes no VPS administration tools. OAuth login, DCR, authorization, token and metadata endpoints remain available for protocol verification.
- The GitHub Environment variable `MCP_OAUTH_BOOTSTRAP_APPROVED=true` authorizes only this restricted bootstrap deployment. It does not mark the service fully production-ready.
- Enabling VPS tools requires a separate reviewed release that both sets the explicit feature flag and mounts the Root Agent socket, after independent security review, ChatGPT E2E, trusted-proxy review, backup/restore rehearsal and signing-key rotation rehearsal.

## Production workflow gates

- Manual workflow dispatch on `master` in the `tce-k3s-01` GitHub Environment.
- Bootstrap requires `MCP_OAUTH_BOOTSTRAP_APPROVED=true`; full Root Agent production readiness requires the separate `MCP_OAUTH_PRODUCTION_READY=true` gate after review.
- Require an immutable 40-character master SHA and successful CI for that exact SHA before SSH or image publication.
- Require target `tce-k3s-01`, SSH port 22, a non-root deploy account, pinned `known_hosts` and strict host-key checking.
- Read-only VPS preflight must confirm the target node is Ready before publishing.
- Validate all Environment variables and secrets before build/publish; do not print secrets or pass them in process arguments.
- Root-owned deploy entrypoint verifies the SHA is reachable from `origin/master` and applies only manifests from that trusted checkout.

## Deployment trust

- Gateway runs as UID 10001, with read-only root filesystem, no added capabilities and no service-account token.
- Root Agent runs as UID 0 on the host and is exposed only through a Unix socket with owner root, group `vps-mcp` and mode 0660. The OAuth bootstrap Pod is not mounted to this socket.
- Root Agent uses fixed executable paths and validated argument arrays; no model-supplied shell strings.
- Trusted checkout and deployment manifests are root-owned; deployment verifies an immutable commit.
- Autonomous mutations remain allowlisted; stock/media namespaces and all other deployments are denied.
