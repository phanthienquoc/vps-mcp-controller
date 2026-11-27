# Implementation status

Updated: 2026-11-27

## Implemented

- [x] Repository bootstrap and dedicated feature branch.
- [x] Architecture, security, development, deployment and operations docs.
- [x] Shared typed operation contract.
- [x] MCP Streamable HTTP gateway with temporary static bearer integration auth.
- [x] Host root-agent with typed systemd/containerd/k3s adapters.
- [x] k3s deployment/service/ingress templates and host systemd unit.
- [x] CI and GHCR image-publish workflow.
- [x] Contract tests for namespace mutation boundary, systemd restart scope and bounded journal output.
- [x] Read-only VPS preflight.
- [x] Root-owned deployment checkout and installer ownership/write-access guards.
- [x] Root deploy entrypoint verifies immutable commit SHA reachability from origin/master and applies only manifests archived from that verified commit.
- [x] GHCR imagePullSecret creation uses a mode-0600 temporary Docker config; token is streamed on stdin and is not passed in process arguments.
- [x] Gateway image publication targets linux/amd64 and linux/arm64.
- [x] Host Root Agent uses a checksum-verified Node 26 runtime isolated under the trusted checkout; no system-wide Node/npm is required.
- [x] Preflight treats the expected unauthenticated GHCR HTTP 401 challenge as registry reachability.
- [x] Deployment provisions ingress TLS through cert-manager.

## Production-only decision

- [x] Explicitly document that there is no staging environment or staging credential path.
- [x] Remove instructions to generate or install a static gateway bearer secret.
- [ ] Implement OAuth 2.1 Authorization Code + PKCE and MCP authorization metadata.
- [ ] Implement durable protected storage for authorization codes, sessions/consent and client registrations.
- [ ] Implement audience/scope validation, short-lived tokens, JWKS/key rotation and revocation.
- [ ] Security review OAuth implementation and verify ChatGPT MCP interoperability.
- [ ] Only then authorize Root Agent installation and production deployment.

## Remaining work

- [ ] Test Root Agent in an isolated Linux VM.
- [ ] Verify DNS, IngressClass, TLS, GHCR permissions and available disk on the actual VPS.
- [ ] Implement GitHub Actions adapter with repo allowlist and least-privilege token.
- [ ] Implement Supabase read-only diagnostics adapter.
- [ ] Add durable audit storage, retention and alerts.
- [ ] Prove recovery/rollback behavior.

## Safety boundaries

- Gateway runs non-root, without a Kubernetes service-account token or Docker socket.
- Root Agent is a host UID 0 service with typed operations; no model-supplied arbitrary shell text.
- Autonomous service restart is limited to cron.
- Autonomous rollout restart is limited to ops-prod and tce-prod.
- stock-prod and media-prod are read-only for this controller until separate policy review.

No VPS command has been executed and no Kubernetes manifest has been applied. The Gateway is not production-ready until OAuth requirements above have evidence.
