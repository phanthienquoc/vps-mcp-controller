# Security policy

1. Gateway runs as UID 10001, with read-only root filesystem, no added capabilities and no service-account token.
2. Root Agent runs as UID 0 on the host, exposed only through a Unix socket with owner root, group vps-mcp and mode 0660.
3. No model-supplied shell strings, executable paths, environment overrides, redirections or pipelines.
4. Agent uses execFile with fixed executable paths and validated argument arrays.
5. All operations are schema-validated, bounded by timeout and output limits, and audited.
6. Every mutation must have an observable postcondition.
7. Secrets never belong in Git or tool output.

## Trusted deployment source

- /opt and /opt/vps-mcp-controller, .git, scripts and deployment manifests must be owned by root:root; regular files and directories must not be group/world-writable.
- The SSH deploy user must not be able to write the checkout, .git metadata, deploy scripts or manifests.
- The root-owned deploy entrypoint fetches the fixed origin/master, verifies the requested full commit SHA exists and is an ancestor of refs/remotes/origin/master, and extracts only deploy/k3s from that commit.
- Kubernetes applies use the extracted manifests from the verified commit, not the SSH user's working tree or a mutable branch checkout.
- The GitHub Actions workflow verifies HEAD == GITHUB_SHA, builds the image with that immutable SHA tag, and passes the same SHA to the root entrypoint. Non-master workflow dispatches are rejected.

## Credential handling

- GHCR read credentials are streamed over SSH stdin; they are not interpolated into remote command arguments.
- The root entrypoint writes Docker auth JSON to a temporary file created with mode 0600 inside a mode-0700 temporary directory.
- The imagePullSecret is created from that file using --from-file; the file and directory are removed by cleanup on success or failure.
- Use a dedicated read:packages credential.

## Authentication policy — production only

- The gateway is an OAuth 2.1 protected resource. The authorization server is external and must be explicitly selected and configured before deployment.
- The gateway publishes RFC 9728 Protected Resource Metadata at `/.well-known/oauth-protected-resource`.
- At startup it fetches the configured RFC 8414 authorization-server metadata URL and fails closed unless issuer matching is exact, HTTPS endpoints are present, authorization-code flow is supported and PKCE S256 is advertised.
- MCP requests require signed JWT access tokens validated against the issuer's HTTPS JWKS endpoint, exact issuer and resource audience, allowed algorithms, required scopes, subject, issued-at and expiry claims.
- Access tokens are limited to 15 minutes maximum lifetime. The gateway does not accept static bearer secrets or unsigned/opaque tokens.
- Authorization codes, login, consent, client registration, signing-key rotation and revocation are responsibilities of the selected authorization server. Provider must support PKCE S256, public clients, resource/audience binding, short-lived JWT access tokens and key rotation.
- The gateway does not yet implement a local authorization server, dynamic client registration, token introspection or immediate per-token revocation. These remain production review gates; short token lifetime does not replace revocation.
- OAuth issuer, metadata URL, resource URL and required scopes are runtime configuration; no credentials belong in Git, manifests or ChatGPT. Provider credentials and signing keys remain exclusively in the provider's secret manager.
- Never expose the gateway publicly with the bootstrap static bearer verifier.

## Autonomous tiers

Read-only diagnostics are automatic. Only explicitly allowlisted systemd services and Kubernetes namespaces can be mutated. Deployment/apply/rollback, namespace deletion, volume deletion, destructive SQL, firewall lockout, SSH changes and admin credential rotation remain disabled by default.

## Scope

Read pods across namespaces for diagnosis. Autonomous deployment restart is initially restricted to ops-prod and tce-prod. stock-prod, media-prod, kube-system and default are excluded from autonomous mutation until separate policy review.
