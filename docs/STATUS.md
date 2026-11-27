# Implementation status

Updated: 2026-11-27

## Implemented

- [x] Repository bootstrap and dedicated feature branch.
- [x] Architecture, security, development, deployment and operations docs.
- [x] Shared typed operation contract.
- [x] MCP Streamable HTTP gateway and host root-agent adapters.
- [x] k3s deployment/service/ingress templates and host systemd unit.
- [x] CI and GHCR image-publish workflow.
- [x] Contract tests for namespace mutation boundary, systemd restart scope and bounded journal output.
- [x] Read-only VPS preflight and root-owned deployment checkout guards.
- [x] Immutable commit verification in the root deploy entrypoint.
- [x] GHCR credentials streamed over SSH stdin and stored only in a mode-0600 temporary file.
- [x] Multi-architecture image publication (linux/amd64 and linux/arm64).
- [x] Isolated checksum-verified Node.js 26 runtime for the Root Agent.
- [x] OAuth 2.1 resource-server integration: RFC 9728 protected-resource metadata, RFC 8414 metadata validation, PKCE S256 capability gate, JWKS-backed JWT validation, exact issuer/audience/scope checks and 15-minute maximum token lifetime.
- [x] Static bearer-token authentication removed from the MCP gateway.

## Production-only decision and remaining gates

- [ ] Select and configure an external OAuth authorization server; it must support Authorization Code + PKCE S256 for public clients, audience/resource binding, signed JWT access tokens, JWKS rotation and short token lifetimes.
- [ ] Add provider-backed revocation/introspection or an independently reviewed revocation design. Current gateway validation is stateless JWT verification; immediate token revocation is not implemented.
- [ ] Decide client registration strategy (pre-registration or Client ID Metadata Documents; DCR only if required for compatibility).
- [ ] Add automated auth tests and run CI/typecheck/build/security review.
- [ ] Verify ChatGPT MCP interoperability against the chosen provider.
- [ ] Only then authorize Root Agent installation and production deployment.

## Safety boundaries

- Gateway runs non-root, without a Kubernetes service-account token or Docker socket.
- Root Agent is a host UID 0 service with typed operations; no model-supplied arbitrary shell text.
- Autonomous service restart is limited to cron.
- Autonomous rollout restart is limited to ops-prod and tce-prod.
- stock-prod and media-prod are read-only for this controller until separate policy review.

No VPS command has been executed and no Kubernetes manifest has been applied. The Gateway is not production-ready until the remaining OAuth gates above have evidence.
