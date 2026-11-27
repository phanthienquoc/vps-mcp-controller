# VPS MCP Controller

Autonomous, auditable infrastructure operations for tce-k3s-01.

## Architecture

- Non-root Node.js 26 MCP Gateway exposed over Streamable HTTP.
- Separate host systemd Root Agent running as UID 0, reachable only through a group-restricted Unix socket.
- Typed operations and fixed executable/argument allowlists. No model-generated shell interpolation.
- JSON audit logs, bounded calls and post-mutation verification.

## Documentation

- Architecture: docs/ARCHITECTURE.md
- Security policy: docs/SECURITY.md
- Development: docs/DEVELOPMENT.md
- Deployment runbook: docs/DEPLOYMENT.md
- Operations and recovery: docs/OPERATIONS.md
- Implementation status: docs/STATUS.md

## First implementation slice

Host status, systemd inspection/logs, cron-only service restart, containerd status, all-namespace pod listing and rollout restart limited to `vps-mcp-gateway` in `ops-prod` plus `tce-frontend` / `tce-service` in `tce-prod`. Stock/media workloads are excluded from autonomous mutations.

## Production constraint

The Gateway implements self-hosted OAuth 2.1 Authorization Code + PKCE, authorization-server/protected-resource metadata, DCR and JWT/JWKS verification. Production deployment remains gated on the documented OAuth security review, ChatGPT authorization E2E, root-owned deployment path and read-only VPS preflight; see docs/DEPLOYMENT.md and docs/SECURITY.md.

Runtime: Node.js 26 Active LTS, TypeScript, MCP SDK v2, Zod 4, k3s and systemd.
