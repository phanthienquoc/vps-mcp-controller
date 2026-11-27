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
- [x] Manifests define a dedicated persistent volume and Kubernetes Secret references; actual target-cluster provisioning remains unverified.

## Not production-ready until verified

- [x] Node 26 CI: typecheck, build, unit tests and integration tests passed on code commit `8a993a5`; the latest documentation-only commit is being revalidated.
- [x] Add automated end-to-end PKCE/DCR/login/token/refresh/revocation tests, including code/refresh replay races and missing-Origin CSRF cases.
- [ ] Verify actual ChatGPT callback URI and DCR interoperability against the ChatGPT connector UI.
- [ ] Add user password reset/change, multi-user administration and MFA before broader access.
- [x] Review CSRF Origin/Fetch Metadata checks; missing Origin is rejected and tested.
- [x] Implement persistent SQLite fixed-window rate limits for DCR, authorization, token and revocation endpoints; rate-limit tests added.
- [x] Rate-limit tests cover DCR, authorization, token, revocation and spoofed `X-Forwarded-For`; the initial missing SQLite table was fixed and both CI workflows passed on code commit `8a993a5`.
- [ ] Validate the actual Traefik ingress peer and decide whether a narrowly scoped trusted-proxy configuration is needed; current limits intentionally use the direct socket peer.
- [ ] Review cookie policy, SQLite backup/restore and signing-key rotation behavior.
- [ ] Verify persistent volume and secret provisioning on the target cluster.
- [ ] Independent security review; do not treat automated tests as a substitute.

## Safety boundaries

No VPS command has been executed. No Kubernetes resource has been applied. No Root Agent or Gateway was installed. Merge is not deployment authorization.
