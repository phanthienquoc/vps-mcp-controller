# Deployment runbook

This deployment has two stages: install the host Root Agent (UID 0) and deploy the non-root MCP Gateway into k3s. GitHub Actions performs repeatable image publication and deployment over SSH. No SSH credential is sent through ChatGPT.

## Required access and inputs

Before deployment, have:

- SSH or console access to `tce-k3s-01` with a sudo-capable account for the one-time bootstrap.
- A dedicated SSH deploy user (not root), with write access to `/opt/vps-mcp-controller`.
- Node.js 26 Active LTS and npm on the host. Node 26 entered Active LTS on 2026-10-28.
- Working k3s admin access and at least 2 GB free on the filesystem hosting k3s/containerd.
- DNS record `mcp.mrcute.space` pointing to the VPS public ingress address.
- IngressClass `traefik` and a valid TLS secret `mcp-mrcute-space-tls` in namespace `ops-prod`.
- A strong gateway token stored only in Kubernetes Secret `vps-mcp-secrets`.
- A dedicated read-only GHCR credential with `read:packages`, stored as a GitHub Environment secret.
- A current VPS backup or recovery path before installing the root service.

The ChatGPT production MCP connection additionally requires OAuth 2.1/PKCE and MCP authorization metadata. The current static bearer verifier is for controlled staging smoke tests only; it is not production ChatGPT authentication.

## 1. Read-only preflight

On the VPS:

```bash
git clone https://github.com/phanthienquoc/vps-mcp-controller.git /opt/vps-mcp-controller
cd /opt/vps-mcp-controller
git checkout feat/vps-mcp-controller
sudo bash scripts/preflight-vps.sh
```

Resolve every FAIL. Confirm DNS points to this VPS, the ingress controller and TLS secret exist, and the cluster has enough disk. This script is read-only.

## 2. Install Root Agent and deployment entrypoint

Install the root agent as documented below. Then create a dedicated SSH deploy account and install the restricted deployment entrypoint:

```bash
sudo bash scripts/install-root-agent.sh
sudo bash scripts/install-deploy-entrypoint.sh <deploy-user>
sudo systemctl is-active vps-root-agent
sudo stat -c '%U %G %a %n' /run/vps-mcp/root-agent.sock
```

The installer places a root-owned deployment script at `/usr/local/sbin/vps-mcp-deploy` and grants the selected SSH user passwordless sudo for that single command only. The command validates a full 40-character commit SHA and performs allowlisted Kubernetes deployment actions. It does not grant arbitrary root shell access.

Ensure the deploy user's SSH public key is installed in its `authorized_keys`, and that the account can fetch the public repository in `/opt/vps-mcp-controller`. Do not use the VPS root account for GitHub Actions.

## 3. Create Kubernetes secrets

Generate a strong gateway token locally; never paste it into chat or commit it:

```bash
k3s kubectl create namespace ops-prod --dry-run=client -o yaml | k3s kubectl apply -f -
k3s kubectl -n ops-prod create secret generic vps-mcp-secrets \
  --from-literal=mcp-bearer-token='GENERATE_AND_PASTE_LOCALLY' \
  --dry-run=client -o yaml | k3s kubectl apply -f -
```

The GitHub deployment workflow updates the `ghcr-pull` imagePullSecret from a dedicated read-only GHCR token. Do not use a PAT with write/delete scopes.

## 4. Configure GitHub Actions

Create a GitHub Environment named `tce-k3s-01` in repository Settings → Environments. Restrict deployments to the `master` branch. Add these **Environment variables**:

| Variable | Value |
|---|---|
| `VPS_HOST` | Public IP or DNS hostname of tce-k3s-01 |
| `VPS_USER` | Dedicated non-root SSH deploy user |
| `VPS_SSH_PORT` | `22` |

Add these **Environment secrets**:

| Secret | Value |
|---|---|
| `VPS_SSH_PRIVATE_KEY` | Dedicated deploy user's private key (OpenSSH format) |
| `VPS_KNOWN_HOSTS` | Pre-verified SSH host-key line for the VPS |
| `GHCR_READ_TOKEN` | Dedicated GitHub token with read-only `read:packages` |

Generate the SSH key on a trusted workstation or in your own secret manager, install only its **public key** on the VPS deploy user's `authorized_keys`, and save the private key directly in GitHub Environment secrets. Obtain the host key fingerprint through a trusted VPS console/provider channel; do not blindly trust an unauthenticated `ssh-keyscan` result. Neither private key nor password should be shared in chat.

The workflow is manual-only, rejects non-master refs, serializes deployments, builds and publishes the immutable SHA image, verifies the SSH host key strictly, fetches the exact source revision on the VPS, and invokes only the root-owned deploy entrypoint.

## 5. Run deployment

After the feature is reviewed and merged to `master`, open Actions → **Deploy VPS MCP Controller** → Run workflow and select `master`. The workflow builds and deploys the selected master commit SHA. It fails closed if required GitHub Environment variables/secrets or VPS prerequisites are missing.

The deploy script verifies the Root Agent, socket, k3s API, gateway secret and TLS secret; updates `ghcr-pull`; applies the SHA-pinned image and manifests; waits for rollout; and performs an HTTPS health check. On a failed rollout it attempts a Kubernetes rollback.

## 6. Smoke test and production gate

Confirm `https://mcp.mrcute.space/healthz` returns healthy, then test `host_status`, `service_status` and `k3s_list_pods` with an MCP client. Production ChatGPT integration remains blocked until OAuth 2.1/PKCE and required authorization metadata endpoints are implemented.

## Rollback

```bash
k3s kubectl -n ops-prod rollout undo deployment/vps-mcp-gateway
sudo systemctl stop vps-root-agent
```

Stopping Root Agent disables host operations without stopping other workloads. Preserve logs and evidence before removing its systemd unit or socket group.
