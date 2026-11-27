# Implementation status

Updated: 2026-11-27

## Implemented in branch

- [x] MCP gateway and Root Agent architecture, immutable deploy workflow and read-only VPS preflight.
- [x] Self-hosted OAuth authorization server in the MCP Gateway; no Keycloak or external identity service.
- [x] Authorization Code + PKCE S256, OAuth authorization-server metadata and RFC 9728 path-specific protected-resource metadata discovery.
- [x] DCR for public clients with exact HTTPS redirect URI matching, RFC 7591 grant defaults and per-client grant enforcement.
- [x] Email/password bootstrap account with scrypt password hashing, per-account failure lockout and persistent per-peer login rate limiting.
- [x] SQLite persistence for users, clients, sessions, one-time authorization codes and refresh-token families.
- [x] RS256 JWT access tokens with resource audience, subject, scope, five-minute expiry and JWKS.
- [x] JWKS supports up to five validated public-only previous RSA keys for staged signing-key rotation; automated overlap test passes.
- [x] Refresh-token rotation and family revocation on reuse; refresh-token revocation endpoint.
- [x] Manifests define a dedicated persistent volume and Kubernetes Secret references; actual target-cluster provisioning remains unverified.

## Not production-ready until verified

- [x] Node 26 CI on PR #17 head `b4fd456`: shell validation, typecheck, build and all 62 tests passed.
- [x] Add automated end-to-end PKCE/DCR/login/token/refresh/revocation tests, including code/refresh replay races, missing-Origin CSRF, previous JWKS key overlap, hardened session-cookie attributes and RFC 9728 resource metadata discovery.
- [x] Implement callback-ID-specific redirect handling: DCR stores the concrete ChatGPT management-page URI exactly, consent redirects to that exact URI, and token exchange binds to the same exact URI; automated integration test covers `/connector/oauth/{callback_id}`.
- [ ] Verify the actual callback URI displayed by the ChatGPT connector UI and complete live DCR interoperability; keep stable callback mode disabled until every redirecting authorization response, including errors, carries and advertises RFC 9207 `iss`.
- [ ] Add user password reset/change, multi-user administration and MFA before broader access.
- [x] Review CSRF Origin/Fetch Metadata checks; missing Origin is rejected and tested.
- [x] Implement persistent SQLite fixed-window rate limits for DCR, authorization, login, consent, token and revocation endpoints; rate-limit tests added.
- [x] Rate-limit tests cover DCR, authorization, token, revocation and spoofed `X-Forwarded-For`; the initial missing SQLite table was fixed and both CI workflows passed on code commit `8a993a5`.
- [ ] Validate the actual Traefik ingress peer and decide whether a narrowly scoped trusted-proxy configuration is needed; current limits intentionally use the direct socket peer.
- [x] Review session cookie policy: `__Host-` prefix, Secure, HttpOnly, SameSite=Lax, Path=/, no Domain, bounded Max-Age and explicit logout expiry.
- [ ] Complete independent security review.
- [x] Document SQLite WAL-safe online backup using `VACUUM INTO` plus integrity check; isolated restore rehearsal remains pending.
- [x] Implement staged signing-key overlap via `MCP_OAUTH_PREVIOUS_PUBLIC_KEYS`; automated JWKS overlap coverage added, production rotation rehearsal remains pending.
- [ ] Verify persistent volume and secret provisioning on the target cluster.

## Safety boundaries

The user ran the read-only VPS preflight: Root Agent and its socket are installed and active; 35 checks passed, 2 expected warnings, 0 failures. No Gateway workload has been deployed and no production Kubernetes workload has been changed. Merge is not deployment authorization.
