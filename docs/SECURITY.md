# Security policy

1. Gateway runs as UID 10001, with read-only root filesystem, no added capabilities and no service-account token.
2. Root Agent runs as UID 0 on the host, exposed only through a Unix socket with owner root, group vps-mcp and mode 0660.
3. No model-supplied shell strings, executable paths, environment overrides, redirections or pipelines.
4. Agent uses execFile with fixed executable paths and validated argument arrays.
5. Operations are schema-validated, bounded by timeout and output limits, and audited.
6. Every mutation must have an observable postcondition.
7. Secrets never belong in Git or tool output.

## Authentication policy — production only

- The selected authorization server is the existing self-hosted Keycloak deployment; reuse it rather than adding another identity provider/database.
- The gateway publishes RFC 9728 Protected Resource Metadata at `/.well-known/oauth-protected-resource`.
- Gateway loads the realm's OIDC discovery document and fails closed unless issuer matching is exact, HTTPS authorization/token/JWKS endpoints are present, authorization-code flow is supported and PKCE S256 is advertised.
- MCP requests require signed JWT access tokens validated against Keycloak's HTTPS JWKS endpoint, exact issuer and resource audience, allowed algorithms, required `mcp:tools` scope, subject, issued-at and expiry claims.
- Gateway enforces a maximum token lifetime of 15 minutes; configure Keycloak to issue five-minute access tokens.
- Use a dedicated public client, Standard Flow on, Direct Access Grants off, PKCE S256 required, exact redirect URIs only and no wildcard web origins.
- Configure an Audience mapper for exact `https://mcp.mrcute.space/mcp` and grant only the `mcp:tools` scope.
- JWT validation is stateless. Keycloak logout/session revocation does not immediately invalidate already-issued JWTs; keep access-token lifetime at five minutes. Immediate revocation requires a separately reviewed online introspection or signing-key rotation design.
- No Keycloak admin password, client secret, signing key or token belongs in Git, manifests or ChatGPT.
- Never expose the gateway publicly with a static bearer verifier.

## Trusted deployment source

- Trusted checkout, .git metadata, scripts and deployment manifests must be root-owned and not writable by the SSH deploy user.
- Deployment verifies an immutable commit from origin/master and applies only manifests from that commit.
- GHCR read credentials are streamed over SSH stdin and stored only in a mode-0600 temporary file.

## Autonomous tiers

Read-only diagnostics are automatic. Only explicitly allowlisted systemd services and Kubernetes namespaces can be mutated. Deployment/apply/rollback, namespace deletion, volume deletion, destructive SQL, firewall lockout, SSH changes and admin credential rotation remain disabled by default.

## Scope

Read pods across namespaces for diagnosis. Autonomous rollout restart is initially restricted to ops-prod and tce-prod. stock-prod, media-prod, kube-system and default are excluded from autonomous mutation until separate policy review.
