# Deployment runbook

This deployment has two stages: install the host Root Agent (UID 0) and deploy the non-root MCP Gateway into k3s. The repository and CI setup do not connect to or modify the VPS.

## Required access and inputs

Before deployment, have:

- SSH or console access to `tce-k3s-01` with a sudo-capable account. Root is needed only for installing the host systemd service, creating its socket directory and setting socket ownership.
- Node.js 26 Active LTS and npm on the host. Node 26 entered Active LTS on 2026-10-28.
- Working k3s admin access and at least 2 GB free on the filesystem hosting k3s/containerd.
- DNS record `mcp.mrcute.space` pointing to the VPS public ingress address.
- The actual IngressClass name (the manifest currently assumes `traefik`).
- A valid TLS secret in namespace `ops-prod` named `mcp-mrcute-space-tls`, or an agreed cert-manager issuer and certificate manifest.
- GHCR image pull access: either make the package public or create an imagePullSecret with `read:packages`.
- A strong random gateway token stored only in a Kubernetes Secret. Do not paste it into chat or commit it.
- A current VPS backup or a recovery path before installing a root service.

The ChatGPT production MCP connection additionally requires OAuth 2.1/PKCE and MCP authorization metadata. The current static bearer verifier is for controlled staging smoke tests only; it is not production ChatGPT authentication.

## 1. Read-only preflight

On the VPS, check out the feature branch and run:

```bash
git clone https://github.com/phanthienquoc/vps-mcp-controller.git
cd vps-mcp-controller
git checkout feat/vps-mcp-controller
sudo bash scripts/preflight-vps.sh
```

The script checks Node, k3s, disk, ingress classes, namespace, DNS, TLS/Secret presence, GHCR reachability and the socket group. It does not create or change resources.

Resolve every FAIL before proceeding. A missing namespace or TLS secret may be expected on a fresh install, but must be deliberately provisioned before the ingress is applied.

## 2. Install Root Agent

```bash
sudo bash scripts/install-root-agent.sh
sudo systemctl status vps-root-agent
sudo stat -c '%U %G %a %n' /run/vps-mcp/root-agent.sock
```

Expected socket owner/group/mode: `root:vps-mcp 660`. The group ID is 34001 and the gateway pod uses that supplemental group. The Root Agent is host-root but exposes only typed operations over a Unix socket; it does not expose a TCP shell.

## 3. Create gateway secret

Generate a token locally and keep it in your secret manager:

```bash
openssl rand -hex 32
k3s kubectl create namespace ops-prod --dry-run=client -o yaml | k3s kubectl apply -f -
k3s kubectl -n ops-prod create secret generic vps-mcp-secrets \
  --from-literal=mcp-bearer-token='PASTE_LOCALLY_GENERATED_VALUE' \
  --dry-run=client -o yaml | k3s kubectl apply -f -
```

Do not send the token to ChatGPT, add it to GitHub, or include it in terminal screenshots/logs.

## 4. Publish the image

CI and contract tests must pass first. The publish workflow currently publishes from `master`; merge the reviewed implementation before expecting the image tag to exist. Prefer an immutable commit SHA tag over `latest`.

For a private GHCR package, create an imagePullSecret in `ops-prod` with a dedicated read-only `read:packages` credential. Never use a broad personal access token with write permissions on the cluster.

## 5. Verify DNS, ingress and TLS

Confirm `mcp.mrcute.space` resolves to the VPS ingress IP, the IngressClass matches the cluster, and the TLS secret exists in `ops-prod`. The current ingress assumes Traefik and secret `mcp-mrcute-space-tls`. Do not apply it until those assumptions are verified.

## 6. Deploy gateway

Review the image tag in `deploy/k3s/deployment.yaml` and replace the placeholder with the immutable image tag published by GitHub Actions.

```bash
k3s kubectl apply -f deploy/k3s/namespace.yaml
k3s kubectl apply -f deploy/k3s/deployment.yaml
k3s kubectl apply -f deploy/k3s/service.yaml
k3s kubectl apply -f deploy/k3s/ingress.yaml
k3s kubectl -n ops-prod rollout status deployment/vps-mcp-gateway --timeout=120s
k3s kubectl -n ops-prod get pods,svc,ingress
```

## 7. Smoke test

```bash
curl -fsS https://mcp.mrcute.space/healthz
```

Then use an MCP client to authenticate and call `host_status`, `service_status` and `k3s_list_pods`. Verify the host agent logs and gateway logs. Production ChatGPT integration remains blocked until OAuth 2.1/PKCE and required metadata endpoints are implemented.

## Rollback

```bash
k3s kubectl -n ops-prod rollout undo deployment/vps-mcp-gateway
sudo systemctl stop vps-root-agent
```

Stopping Root Agent disables host operations without stopping other workloads. Do not remove its systemd unit or socket group until incident evidence has been collected.
