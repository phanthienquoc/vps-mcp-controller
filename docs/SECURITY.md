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

- No staging environment or staging credentials are supported.
- Static bearer tokens are not accepted as production ChatGPT MCP authentication.
- The production Kubernetes manifest does not inject the legacy static bearer secret; direct manifest application therefore cannot enable the legacy bearer verifier.
- Public production access is blocked until OAuth 2.1 Authorization Code + PKCE (S256), protected-resource and authorization-server metadata, exact redirect URI validation, one-time authorization codes, short-lived audience- and scope-bound access tokens, JWKS/signing-key rotation, and revocation are implemented and tested.
- OAuth state, code, consent, client registration and refresh/session data must use durable protected storage; secrets must be provisioned outside chat and outside source control.
- Never expose the gateway publicly with the bootstrap static bearer verifier.

## Autonomous tiers

Read-only diagnostics are automatic. Only explicitly allowlisted systemd services and Kubernetes namespaces can be mutated. Deployment/apply/rollback, namespace deletion, volume deletion, destructive SQL, firewall lockout, SSH changes and admin credential rotation remain disabled by default.

## Scope

Read pods across namespaces for diagnosis. Autonomous deployment restart is initially restricted to ops-prod and tce-prod. stock-prod, media-prod, kube-system and default are excluded from autonomous mutation until separate policy review.
