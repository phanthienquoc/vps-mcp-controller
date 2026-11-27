# Implementation status

Updated: 2026-11-27

## Merged into master

- [x] MCP Gateway and Root Agent architecture, immutable deployment workflow and read-only VPS preflight.
- [x] Self-hosted OAuth authorization server; no Keycloak or external identity service.
- [x] Authorization Code + PKCE S256, OAuth authorization-server metadata and RFC 9728 path-specific protected-resource metadata discovery.
- [x] DCR for public clients with exact HTTPS redirect URI matching, RFC 7591 grant defaults and per-client grant enforcement.
- [x] Bootstrap administrator with scrypt password hashing, per-account failure lockout and persistent per-peer endpoint rate limiting.
- [x] SQLite persistence for users, clients, sessions, authorization codes and refresh-token families.
- [x] RS256 access tokens, five-minute expiry, resource audience, scope and JWKS.
- [x] Up to five validated public-only previous RSA keys for staged signing-key rotation.
- [x] Refresh-token rotation, family revocation on reuse and refresh-token revocation endpoint.
- [x] Callback-ID-specific redirect URI support: exact URI is retained across DCR, consent and token exchange.
- [x] Hardened `__Host-mcp_session` cookie, CSRF Origin/Fetch Metadata checks and OAuth endpoint no-store responses.
- [x] SQLite WAL-safe online backup instructions using `VACUUM INTO` and integrity check.

## CI verification

- [x] PR #16 rebase CI #244 passed; squash-merged as `8fa2db6`.
- [x] PR #17 rebase CI #247 passed; squash-merged as `98536bcc`.
- [x] Both post-merge push workflows for `98536bcc`: validation workflow passed; multi-architecture image publish workflow was still running at the last check. This does not deploy to Kubernetes.

## Production gates still open

- [ ] Verify the exact ChatGPT callback URI displayed by the connector management UI and complete live DCR/OAuth authorization end-to-end.
- [ ] Complete independent OAuth/security review.
- [ ] Verify the actual Traefik ingress peer and decide whether a narrowly scoped trusted-proxy configuration is needed. Current limits intentionally use the direct socket peer.
- [ ] Verify the target-cluster PVC is Bound and the OAuth Secret contains the required keys (values must never be displayed).
- [ ] Perform an isolated SQLite restore rehearsal and a signing-key rotation rehearsal.
- [ ] Verify Root Agent, socket group and root-owned deploy/preflight wrappers with the approved read-only preflight. Earlier user-provided diagnostics showed `/run/vps-mcp/` empty and `root-agent.service` absent; the exact `vps-root-agent` unit and full preflight have not been verified in this session.
- [ ] Only after all gates pass, explicitly authorize production deployment through `.github/workflows/deploy-vps.yml`.

## Safety boundaries

No Gateway workload has been deployed and no production Kubernetes workload has been changed by these merges. The production deployment workflow is manual and gated by `MCP_OAUTH_PRODUCTION_READY=true`; merging code is not deployment authorization.