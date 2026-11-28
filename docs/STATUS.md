# Implementation status

Updated: 2026-11-28

## Merged into master

- [x] MCP Gateway and Root Agent architecture, immutable deployment workflow and read-only VPS preflight.
- [x] Self-hosted OAuth authorization server; no Keycloak or external identity service.
- [x] Authorization Code + PKCE S256, OAuth authorization-server metadata and RFC 9728 path-specific protected-resource metadata discovery.
- [x] DCR for public clients with exact HTTPS redirect URI matching and per-client grant enforcement.
- [x] Bootstrap administrator with scrypt password hashing and persistent OAuth state.
- [x] RS256 access tokens, five-minute expiry, resource audience, scope and JWKS.
- [x] Refresh-token rotation, family revocation on reuse and revocation endpoint.
- [x] Callback-ID-specific redirect URI support and hardened session/CSRF handling.
- [x] SQLite WAL-safe online backup instructions.
- [x] OAuth-only production bootstrap implementation prepared on `feat/production-oauth-bootstrap`: Root Agent tools fail closed, bootstrap Pod has no Root Agent socket mount, and deployment workflow has a separate bootstrap approval gate.

## Production bootstrap checks

- [x] Let's Encrypt Certificate `mcp-mrcute-space` is Ready and TLS Secret `mcp-mrcute-space-tls` exists (user-provided VPS output, 2026-11-28).
- [ ] Merge and pass CI for `feat/production-oauth-bootstrap`.
- [ ] Set GitHub Environment variable `MCP_OAUTH_BOOTSTRAP_APPROVED=true`.
- [ ] Dispatch the manual production workflow on `master`.
- [ ] Verify Gateway rollout and HTTPS health.
- [ ] Verify OAuth metadata, login, DCR, PKCE, token audience/scope and exact ChatGPT callback end-to-end.
- [ ] Keep Root Agent tools disabled until independent security review, trusted-proxy review, SQLite restore rehearsal and signing-key rotation rehearsal pass.

## Safety boundaries

The restricted bootstrap release intentionally has no Root Agent socket mount and registers no VPS tools. Merging the PR does not deploy; production rollout remains a separate manual action.
