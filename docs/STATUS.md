# Implementation status

Updated: 2026-11-26

## Authored in the initial feature commit

- [x] Bootstrap empty repository and create dedicated feature branch.
- [x] Architecture, security, development, deployment and operations docs.
- [x] Shared typed operation contract.
- [x] MCP Streamable HTTP gateway with bootstrap bearer verifier.
- [x] Host root-agent with typed systemd/containerd/k3s adapters.
- [x] k3s deployment/service/ingress templates and host systemd unit.
- [x] CI and GHCR image-publish workflows.

## Must be verified before production

- [ ] npm install, typecheck and build pass in GitHub Actions.
- [ ] Test Root Agent in an isolated Linux VM.
- [ ] GHCR package published and pull access configured.
- [ ] Node.js 26 and Root Agent installed on actual VPS.
- [ ] Host socket group access tested from actual pod.
- [ ] DNS, actual IngressClass, TLS secret and HTTPS endpoint verified.
- [ ] OAuth 2.1 implemented for production ChatGPT custom MCP connection.
- [ ] GitHub Actions and Supabase adapters implemented.
- [ ] Durable audit storage, metrics, alerting and recovery test evidence.

No VPS command has been executed and no Kubernetes manifest has been applied by repository setup.
