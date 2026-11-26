# Implementation status

Updated: 2026-11-26

## Implemented in feat/vps-mcp-controller

- [x] Repository bootstrap and dedicated feature branch.
- [x] Architecture, security, development, deployment and operations docs.
- [x] Shared typed operation contract.
- [x] MCP Streamable HTTP gateway with temporary bearer integration auth.
- [x] Host root-agent with typed systemd/containerd/k3s adapters.
- [x] k3s deployment/service/ingress templates and host systemd unit.
- [x] CI and GHCR image-publish workflow.
- [x] Contract tests for namespace mutation boundary, systemd restart scope and bounded journal output.
- [x] GitHub Actions CI install, typecheck and build succeeded at commit f2c261a4ee57bc0a0c416a75c51efc4cf294d54d.

## Remaining code and production gates

- [ ] Run CI including the newly added contract test suite and fix any failures.
- [ ] Implement standards-compliant OAuth 2.1 / PKCE and protected-resource metadata for ChatGPT custom MCP.
- [ ] Implement GitHub Actions adapter with repo allowlist and least-privilege token.
- [ ] Implement Supabase read-only diagnostics adapter.
- [ ] Add durable audit storage, retention and alerts.
- [ ] Test Root Agent in isolated Linux VM.
- [ ] Verify Node.js 26, DNS, IngressClass, TLS secret, GHCR permissions and available disk on actual VPS.
- [ ] Install host Root Agent and prove UDS permissions from the gateway pod.
- [ ] Deploy gateway and smoke-test every tool.
- [ ] Prove recovery/rollback behavior.

## Safety boundaries

- Gateway runs non-root, without a Kubernetes service-account token or Docker socket.
- Root Agent is a host UID 0 service with typed operations; no model-supplied arbitrary shell text.
- Autonomous service restart is limited to cron.
- Autonomous rollout restart is limited to ops-prod and tce-prod.
- stock-prod and media-prod are read-only for this controller until separate review.

No VPS command has been executed and no Kubernetes manifest has been applied by repository setup. Production completion must not be claimed until the gates above have evidence.
