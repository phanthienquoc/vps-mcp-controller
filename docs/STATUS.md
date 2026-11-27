# Implementation status

Updated: 2026-11-27

## Implemented in branch

- [x] MCP gateway and Root Agent architecture, immutable deploy workflow and read-only VPS preflight.
- [x] Self-hosted OAuth authorization server in the MCP Gateway; no Keycloak or external identity service.
- [x] Authorization Code + PKCE S256, OAuth authorization-server metadata and protected-resource metadata.
- [x] DCR for public clients with exact HTTPS redirect URI matching.
- [x] Email/password bootstrap account with scrypt password hashing and login throttling.
- [x] SQLite persistence for users, clients, sessions, one-time authorization codes and refresh-token families.
- [x] RS256 JWT access tokens with resource audience, subject, scope, five-minute expiry and JWKS.
- [x] Refresh-token rotation and family revocation on reuse; refresh-token revocation endpoint.
- [x] Dedicated persistent volume and Kubernetes Secret references are being added.

## Not production-ready until verified

- [ ] Node 26 CI: typecheck, build, unit tests and integration tests.
- [ ] Add automated end-to-end PKCE/DCR/login/token/refresh/revocation tests.
- [ ] Verify actual ChatGPT callback URI and DCR interoperability.
- [ ] Add user password reset/change, multi-user administration and MFA before broader access.
- [ ] Review CSRF, cookie, rate-limit, proxy/IP, SQLite backup/restore and key rotation behavior.
- [ ] Verify persistent volume and secret provisioning on the target cluster.
- [ ] Independent security review.

## Safety boundaries

No VPS command has been executed. No Kubernetes resource has been applied. No Root Agent or Gateway was installed. Merge is not deployment authorization.
