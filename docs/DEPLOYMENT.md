# Deployment runbook

Deployment has two privileged stages: install the host Root Agent and deploy the non-root MCP Gateway into k3s. GitHub Actions builds an immutable multi-architecture image and invokes one root-owned deploy entrypoint over SSH. No SSH credential is sent through ChatGPT.

**Do not install the Root Agent or dispatch the deployment workflow until the read-only VPS preflight has been reviewed and the user explicitly authorizes installation.** A merged code change is not deployment authorization.

## Required access and inputs

Before installation, have:

- A root-owned, non-group/world-writable /opt directory and trusted Git checkout at /opt/vps-mcp-controller.
- A dedicated SSH deploy user (not root) that has **no write access** to /opt/vps-mcp-controller, its .git directory, scripts or deployment manifests.
- **No system-wide Node.js or npm installation is required.** The Root Agent installer downloads the latest Node 26 patch runtime from the official Node.js distribution site, verifies it against that distribution's SHA-256 manifest, and stores it under the trusted checkout at runtime/node. The Gateway uses Node 26 inside its container.
- Working k3s admin access and at least 2 GB free on the filesystem hosting k3s/containerd.
- DNS record mcp.mrcute.space pointing to the VPS public ingress address.
- IngressClass traefik and a Ready cert-manager ClusterIssuer named letsencrypt-prod. The deployment applies a Certificate resource and waits for mcp-mrcute-space-tls to be issued.
- A strong gateway token stored only in Kubernetes Secret vps-mcp-secrets.
- A dedicated read-only GHCR credential with read:packages, stored as a GitHub Environment secret.
- A current VPS backup or recovery path before installing the root service.

The ChatGPT production MCP connection additionally requires OAuth 2.1/PKCE and MCP authorization metadata. The current static bearer verifier is for controlled staging smoke tests only; it is not production ChatGPT authentication.

## 1. Trusted checkout and read-only preflight

Create the checkout as root so the SSH deploy user cannot modify it:

~~~bash
sudo install -d -o root -g root -m 0755 /opt
sudo git clone --branch master https://github.com/phanthienquoc/vps-mcp-controller.git /opt/vps-mcp-controller
~~~

Then run this read-only preflight:

~~~bash
sudo bash /opt/vps-mcp-controller/scripts/preflight-vps.sh
~~~

The preflight checks repository and manifest ownership/write access, the isolated Node runtime if already installed, host architecture, k3s access, namespace/secrets, disk, DNS and GHCR reachability. A missing isolated runtime is a warning, not a blocker; host Node/npm are intentionally ignored. GHCR HTTP 401 from the unauthenticated v2 endpoint is considered reachable because it is the expected authentication challenge. The script does not install services, change permissions, create secrets or apply Kubernetes manifests. Resolve every FAIL and review all WARN output before proceeding.

## 2. Install Root Agent and restricted deploy entrypoint

Only after the preflight output has been reviewed and installation explicitly authorized:

~~~bash
sudo bash /opt/vps-mcp-controller/scripts/install-root-agent.sh
sudo bash /opt/vps-mcp-controller/scripts/install-deploy-entrypoint.sh <existing-ssh-deploy-user>
sudo systemctl is-active vps-root-agent
sudo stat -c '%U %G %a %n' /run/vps-mcp/root-agent.sock
~~~

The Root Agent installer downloads the latest Node 26 patch tarball for the host architecture (arm64 or amd64), verifies the archive against the official SHA-256 manifest, and installs the runtime only inside /opt/vps-mcp-controller/runtime/node. It uses that runtime to install dependencies with npm lifecycle scripts disabled and build the Root Agent. It does not use apt, modify /usr/bin/node, or require system-wide npm. The systemd unit invokes this isolated local runtime directly.

The installers refuse a checkout that is not root-owned and not group/world-writable. The deploy-entrypoint installer also verifies that the SSH deploy user cannot write the checkout, manifests or source deploy script. It installs /usr/local/sbin/vps-mcp-deploy as root-owned mode 0750 and grants passwordless sudo for that single command only. The SSH deploy user does not need write access to /opt/vps-mcp-controller.

The root deploy entrypoint fetches origin/master, verifies that the requested full 40-character SHA is a commit reachable from origin/master, then extracts only deploy/k3s from that verified commit into a root-owned temporary directory. It applies the namespace, verifies the staging gateway secret and Let’s Encrypt ClusterIssuer, applies the Certificate resource, waits for the TLS secret, then applies Gateway/Service/Ingress. Kubernetes applies use those extracted manifests, never files modified by the SSH deploy user.

## 3. Create Kubernetes secrets

Generate a strong gateway token locally; never paste it into chat or commit it:

~~~bash
k3s kubectl create namespace ops-prod --dry-run=client -o yaml | k3s kubectl apply -f -
TOKEN_FILE="$(mktemp)"
chmod 600 "$TOKEN_FILE"
trap 'rm -f "$TOKEN_FILE"' EXIT
read -rsp "Enter a staging gateway token: " MCP_TOKEN
printf '\\n'
printf '%s' "$MCP_TOKEN" > "$TOKEN_FILE"
unset MCP_TOKEN
k3s kubectl -n ops-prod create secret generic vps-mcp-secrets \\
  --from-file=mcp-bearer-token="$TOKEN_FILE" \\
  --dry-run=client -o yaml | k3s kubectl apply -f -
rm -f "$TOKEN_FILE"
trap - EXIT
~~~

The deploy workflow streams the read-only GHCR credential to the root entrypoint over SSH stdin. The root script writes a temporary Docker config with mode 0600, creates the ghcr-pull imagePullSecret from that file, then removes the temporary config. The credential is never included in process arguments or printed to logs. Do not use a PAT with write/delete scopes.

## 4. Configure GitHub Actions

Create a GitHub Environment named tce-k3s-01 in repository Settings → Environments. Restrict deployments to the master branch. Add these **Environment variables**:

| Variable | Value |
|---|---|
| VPS_HOST | Public IP or DNS hostname of tce-k3s-01 |
| VPS_USER | Dedicated non-root SSH deploy user |
| VPS_SSH_PORT | 22 |

Add these **Environment secrets**:

| Secret | Value |
|---|---|
| VPS_SSH_PRIVATE_KEY | Dedicated deploy user's private key (OpenSSH format) |
| VPS_KNOWN_HOSTS | Pre-verified SSH host-key line for the VPS |
| GHCR_READ_TOKEN | Dedicated GitHub token with read-only read:packages |

Generate the SSH key on a trusted workstation or in your own secret manager, install only its public key on the VPS deploy user's authorized_keys, and save the private key directly in GitHub Environment secrets. Obtain the host key fingerprint through a trusted VPS console/provider channel; do not blindly trust an unauthenticated ssh-keyscan result. Neither private key nor password should be shared in chat.

## 5. Deployment gate

The workflow is manual-only and rejects non-master refs. It verifies that the checked-out commit equals GITHUB_SHA, builds and publishes both linux/amd64 and linux/arm64 variants tagged with that exact SHA, and passes the same SHA to the root deploy entrypoint. The SSH deploy user performs no git fetch, checkout, or manifest write. The root entrypoint independently verifies reachability from origin/master before using the trusted commit's manifests.

Do not dispatch Deploy VPS MCP Controller until the read-only preflight output has been reviewed, the Root Agent and deploy entrypoint have been installed, required secrets and TLS exist, and the user explicitly authorizes the deployment. This repository change does not deploy to tce-k3s-01.

## 6. Smoke test and production gate

After an authorized deployment, confirm https://mcp.mrcute.space/healthz returns healthy, then test host_status, service_status and k3s_list_pods with an MCP client. Production ChatGPT integration remains blocked until OAuth 2.1/PKCE and required authorization metadata endpoints are implemented.

## Rollback

~~~bash
k3s kubectl -n ops-prod rollout undo deployment/vps-mcp-gateway
sudo systemctl stop vps-root-agent
~~~

Stopping Root Agent disables host operations without stopping other workloads. Preserve logs and evidence before removing its systemd unit or socket group.
