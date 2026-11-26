# VPS MCP Controller

Autonomous, auditable infrastructure operations for the `tce-k3s-01` Ubuntu/k3s host.

> Status: bootstrap in progress. The production host is not changed by repository setup. See [docs/STATUS.md](docs/STATUS.md).

## Architecture

- **MCP Gateway**: unprivileged Node.js service exposing Streamable HTTP at `/mcp`.
- **Root Agent**: separate host systemd daemon running as UID 0. It accepts only versioned, typed operations over a Unix socket; it is not an arbitrary remote shell.
- **Adapters**: host diagnostics, systemd, Docker/containerd, Kubernetes, GitHub and database diagnostics.
- **Policy and audit**: default-deny tool registry, explicit operation allowlists, bounded execution, redacted audit events and recovery verification.

## Current implementation

This repository is being bootstrapped in small, verifiable increments. Read:
- [Architecture](docs/ARCHITECTURE.md)
- [Security policy](docs/SECURITY.md)
- [Development guide](docs/DEVELOPMENT.md)
- [Deployment runbook](docs/DEPLOYMENT.md)
- [Operations and recovery](docs/OPERATIONS.md)
- [Implementation status](docs/STATUS.md)

## Non-negotiable safety properties

1. The gateway never runs as root and never mounts the Docker socket.
2. The root agent runs on the host, bound to a private Unix socket with restrictive permissions.
3. No LLM-supplied string is interpolated into a shell command.
4. Tools are typed, allowlisted operations, not an unrestricted shell.
5. Destructive storage, database, namespace, firewall lockout and credential operations are denied by default.
6. Every mutation is audited and followed by health verification; rollback is attempted only from a known-good snapshot.
7. No secrets are committed to Git or emitted in tool output.

## Runtime

Node.js 26 Active LTS, TypeScript, pnpm, MCP TypeScript SDK v2, Zod 4 and k3s. Exact versions are pinned by the lockfile as implementation proceeds.

## License

Private operational code; license to be selected by repository owner.
