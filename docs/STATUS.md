# Implementation status

Updated: 2026-11-27

## Implemented

- [x] Repository bootstrap and dedicated feature branch.
- [x] Architecture, security, development, deployment and operations docs.
- [x] Shared typed operation contract and MCP gateway/root-agent bootstrap.
- [x] k3s deployment templates, CI, GHCR image workflow and immutable deploy entrypoint.
- [x] Read-only VPS preflight and root-owned deployment checkout guards.
- [x] Isolated checksum-verified Node.js 26 runtime for Root Agent.
- [x] OAuth resource-server integration: protected-resource metadata, OIDC discovery validation, PKCE S256 capability gate, JWKS-backed JWT verification, exact issuer/audience/scope checks and 15-minute maximum token lifetime.
- [x] Removed static bearer-token authentication from the gateway.
- [x] Selected existing self-hosted Keycloak as authorization server; no new identity platform/database required.

## Production gates

- [ ] Recover existing Keycloak database connectivity; previous diagnostics showed connection-pool checkout timeouts.
- [ ] Create dedicated `mcp` realm and public client; require Standard Flow and PKCE S256; disable Direct Access Grants.
- [ ] Add exact MCP resource audience mapper and `mcp:tools` scope; verify actual JWT claims.
- [ ] Set Keycloak access-token lifespan to five minutes.
- [ ] Add automated Keycloak-backed tests and run CI/typecheck/build/security review.
- [ ] Review short-lived JWT revocation behavior; logout alone does not immediately invalidate issued JWTs.
- [ ] Verify ChatGPT MCP interoperability and exact redirect URI.
- [ ] Only then authorize Root Agent installation and production deployment.

## Safety boundaries

- Gateway runs non-root, without a Kubernetes service-account token or Docker socket.
- Root Agent uses fixed typed operations; no model-supplied arbitrary shell text.
- Autonomous service restart is limited to cron.
- Autonomous rollout restart is limited to ops-prod and tce-prod.
- stock-prod and media-prod remain read-only.

No VPS command has been executed and no Kubernetes manifest has been applied. Production deployment remains blocked until all gates have evidence.
