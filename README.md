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

Host status, systemd inspection/logs, narrow service restart, containerd status, all-namespace pod listing and rollout restart limited to ops-prod and tce-prod. Stock/media workloads are inspectable but excluded from autonomous mutations.

## Production constraint

The bootstrap gateway uses a static bearer verifier for controlled integration tests. Production ChatGPT custom MCP access requires OAuth 2.1 and metadata endpoints; see docs/SECURITY.md.

Runtime: Node.js 26 Active LTS, TypeScript, MCP SDK v2, Zod 4, k3s and systemd.
