# Security policy

1. Gateway runs as UID 10001, with read-only root filesystem, no added capabilities and no service-account token.
2. Root Agent runs as UID 0 on the host, exposed only through a Unix socket with owner root, group vps-mcp and mode 0660.
3. No model-supplied shell strings, executable paths, environment overrides, redirections or pipelines.
4. Agent uses execFile with fixed executable paths and validated argument arrays.
5. All operations are schema-validated, bounded by timeout and output limits, and audited.
6. Every mutation must have an observable postcondition.
7. Secrets never belong in Git or tool output.

## Autonomous tiers

Read-only diagnostics are automatic. Only explicitly allowlisted systemd services and Kubernetes namespaces can be mutated. Deployment/apply/rollback, namespace deletion, volume deletion, destructive SQL, firewall lockout, SSH changes and admin credential rotation remain disabled by default.

## Scope

Read pods across namespaces for diagnosis. Autonomous deployment restart is initially restricted to ops-prod and tce-prod. stock-prod, media-prod, kube-system and default are excluded from autonomous mutation until separate policy review.

## Production authentication blocker

The bootstrap gateway currently implements a static bearer-token verifier for controlled integration tests. It is not the final ChatGPT production authentication design. Before public ChatGPT custom MCP access, implement OAuth 2.1 authorization, PKCE, protected-resource and authorization-server metadata, audience validation, short-lived scoped access tokens and revocation. Do not paste a long-lived bearer token into prompts.
