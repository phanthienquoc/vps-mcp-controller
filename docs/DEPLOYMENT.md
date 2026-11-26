# Deployment runbook

Repository setup does not connect to or modify the VPS. Verify host identity, current ingress controller, DNS, TLS issuer, image visibility and backup status before applying manifests.

## 1. Verify prerequisites on tce-k3s-01

```bash
node --version
k3s --version
k3s kubectl get nodes -o wide
k3s kubectl get ingressclass
df -h
```

Install Node.js 26 Active LTS and confirm a current backup/recovery path.

## 2. Install Root Agent

Clone this repository and check out feat/vps-mcp-controller. Then:

```bash
sudo bash scripts/install-root-agent.sh
sudo systemctl status vps-root-agent
sudo stat -c '%U %G %a %n' /run/vps-mcp/root-agent.sock
```

Expected socket owner/group/mode: root:vps-mcp 660. The gateway pod uses GID 34001.

## 3. Create the gateway secret

```bash
openssl rand -hex 32
k3s kubectl apply -f deploy/k3s/namespace.yaml
k3s kubectl -n ops-prod create secret generic vps-mcp-secrets --from-literal=mcp-bearer-token='REPLACE_WITH_RANDOM_VALUE'
```

Use a secret manager for production. Never put the token in repository files.

## 4. Publish the image

Enable GitHub Actions package write access and run Publish gateway image after CI. Configure GHCR as public or create an imagePullSecret with read:packages.

## 5. Verify DNS, ingress and TLS

The provided ingress assumes Traefik, DNS mcp.mrcute.space and an existing TLS secret mcp-mrcute-space-tls. Verify these against the actual cluster. Do not apply ingress until TLS is provisioned.

## 6. Deploy the gateway

```bash
k3s kubectl apply -f deploy/k3s/namespace.yaml
k3s kubectl apply -f deploy/k3s/deployment.yaml
k3s kubectl apply -f deploy/k3s/service.yaml
k3s kubectl apply -f deploy/k3s/ingress.yaml
k3s kubectl -n ops-prod rollout status deployment/vps-mcp-gateway --timeout=120s
k3s kubectl -n ops-prod get pods,svc,ingress
```

## 7. Verify

```bash
curl -fsS https://mcp.mrcute.space/healthz
```

Use an MCP client to list tools and call host_status. Production ChatGPT integration is blocked until OAuth 2.1 is implemented; see SECURITY.md.

## Rollback

```bash
k3s kubectl -n ops-prod rollout undo deployment/vps-mcp-gateway
sudo systemctl stop vps-root-agent
```

Stopping Root Agent disables host mutations without stopping other workloads.
