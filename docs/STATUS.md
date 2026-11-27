# Implementation status

Updated: 2026-11-27

## Implemented

- [x] Repository bootstrap and dedicated feature branch.
- [x] Architecture, security, development, deployment and operations docs.
- [x] Shared typed operation contract.
- [x] MCP Streamable HTTP gateway with temporary bearer integration auth.
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

## Hardening review and production gates

- [ ] Required CI checks pass and implementation PR is squash-merged.
- [ ] User runs the updated read-only VPS preflight after merge and reviews all output.
- [ ] Test Root Agent in an isolated Linux VM.
- [ ] Verify DNS, IngressClass, TLS secret, GHCR permissions and available disk on the actual VPS.
- [ ] Install host Root Agent only after preflight review and explicit authorization.
- [ ] Deploy gateway only after separate explicit authorization and verify all tools.
- [ ] Prove recovery/rollback behavior.
- [ ] Implement standards-compliant OAuth 2.1 / PKCE and protected-resource metadata for ChatGPT custom MCP.
- [ ] Implement GitHub Actions adapter with repo allowlist and least-privilege token.
- [ ] Implement Supabase read-only diagnostics adapter.
- [ ] Add durable audit storage, retention and alerts.

## Safety boundaries

- Gateway runs non-root, without a Kubernetes service-account token or Docker socket.
- Root Agent is a host UID 0 service with typed operations; no model-supplied arbitrary shell text.
- Autonomous service restart is limited to cron.
- Autonomous rollout restart is limited to ops-prod and tce-prod.
- stock-prod and media-prod are read-only for this controller until separate policy review.

No VPS command has been executed and no Kubernetes manifest has been applied by this implementation change. Production completion must not be claimed until the gates above have evidence.
