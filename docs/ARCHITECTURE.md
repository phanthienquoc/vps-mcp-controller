# Architecture

ChatGPT connects to a non-root Node.js 26 MCP Gateway over HTTPS Streamable HTTP. The Gateway runs in namespace ops-prod in a multi-architecture image. It calls a host Root Agent through a Unix-domain socket. The Root Agent runs as UID 0 under systemd on tce-k3s-01 using a checksum-verified, isolated Node.js 26 runtime stored under the trusted checkout; it does not require system-wide Node.js/npm. It validates the shared Zod operation contract and invokes fixed executables with fixed or validated argument arrays.

## Components

- MCP Gateway: authentication, MCP tools, input validation and request audit; Node.js is provided by its container image.
- Root Agent: host-level adapters for systemd, filesystem metrics, containerd and k3s; Node.js runtime is isolated under /opt/vps-mcp-controller/runtime/node.
- Contracts: one discriminated-union schema shared by gateway and root agent.
- Policy: autonomous allowlists with default deny.
- CI: typecheck, build, tests and multi-architecture GHCR image publication.

## Trust boundaries

The gateway has no Kubernetes service-account token, no Docker socket, no host PID namespace and no Linux capabilities. Its only host integration is a read-only-mounted socket directory. The socket is connectable only by its dedicated group. The root agent does not listen on TCP.

## Initial tool surface

host_status, service_status, service_logs, restart_service, containerd_status, k3s_list_pods and k3s_restart_deployment.

Stock/media namespaces remain inspectable but are excluded from autonomous mutation in the first policy.
