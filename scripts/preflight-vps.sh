#!/usr/bin/env bash
set -uo pipefail

PASS=0
WARN=0
FAIL=0
ok(){ printf 'PASS  %s\n' "$1"; PASS=$((PASS+1)); }
warn(){ printf 'WARN  %s\n' "$1"; WARN=$((WARN+1)); }
fail(){ printf 'FAIL  %s\n' "$1"; FAIL=$((FAIL+1)); }
has(){ command -v "$1" >/dev/null 2>&1; }

printf 'VPS MCP Controller production preflight (read-only)\n'
printf 'Host: %s | User: %s | Architecture: %s\n\n' "$(hostname)" "$(id -un)" "$(uname -m)"

REPO_DIR="/opt/vps-mcp-controller"
CHECK_USER="${SUDO_USER:-$(id -un)}"
RUNTIME_NODE="$REPO_DIR/runtime/node/bin/node"
RUNTIME_NPM="$REPO_DIR/runtime/node/bin/npm"
# host Node/npm not required: the Root Agent uses the checksum-verified isolated runtime.
check_trusted_path() {
  local path="$1"
  if [[ ! -e "$path" || -L "$path" ]]; then fail "Trusted deployment path missing or symlinked: $path"; return; fi
  if [[ "$(stat -c '%U:%G' "$path")" != "root:root" ]]; then fail "Trusted deployment path is not root:root owned: $path"; return; fi
  if [[ "$CHECK_USER" != "root" ]]; then
    if [[ "$CHECK_USER" == "$(id -un)" ]]; then
      if [[ -w "$path" ]]; then fail "SSH user can write trusted deployment path: $path"; return; fi
    elif sudo -n -u "$CHECK_USER" test -w "$path"; then fail "SSH user can write trusted deployment path: $path"; return; fi
  fi
  ok "Root-owned and not writable by $CHECK_USER: $path"
}

if [[ -d /opt ]]; then
  check_trusted_path "/opt"
  if find /opt -maxdepth 0 -perm /022 -print -quit | grep -q .; then fail "/opt is group/world-writable"; else ok "/opt is not group/world-writable"; fi
else fail "/opt directory is missing"; fi

if [[ -d "$REPO_DIR/.git" ]]; then
  if find "$REPO_DIR" -xdev \( -type d -o -type f \) \( ! -user root -o -perm /022 \) -print -quit | grep -q .; then fail "Checkout contains non-root-owned or group/world-writable files"; else ok "Checkout files are root-owned and not group/world-writable"; fi
  check_trusted_path "$REPO_DIR"
  check_trusted_path "$REPO_DIR/deploy/k3s"
  check_trusted_path "$REPO_DIR/deploy/k3s/deployment.yaml"
  check_trusted_path "$REPO_DIR/scripts/deploy-vps.sh"
else fail "Trusted root-owned checkout missing at $REPO_DIR"; fi

if [[ -x /usr/local/sbin/vps-mcp-deploy ]]; then check_trusted_path "/usr/local/sbin/vps-mcp-deploy"; else warn "Root deploy entrypoint is not installed yet (expected before deployment)"; fi

if [[ -x "$RUNTIME_NODE" && -x "$RUNTIME_NPM" ]]; then
  NODE_MAJOR="$("$RUNTIME_NODE" -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
  if [[ "$NODE_MAJOR" -eq 26 ]]; then ok "Isolated Node.js $("$RUNTIME_NODE" --version) and npm $("$RUNTIME_NPM" --version)"; else fail "Isolated runtime must be Node.js 26"; fi
else warn "Isolated Node.js 26 runtime not installed yet; installer downloads a checksum-verified runtime"; fi

case "$(uname -m)" in
  aarch64|arm64) ok "Host architecture arm64; workflow publishes linux/arm64" ;;
  x86_64|amd64) ok "Host architecture amd64; workflow publishes linux/amd64" ;;
  *) fail "Unsupported host architecture: $(uname -m)" ;;
esac

if has k3s; then
  ok "k3s binary found: $(command -v k3s)"
  if k3s kubectl get nodes -o wide >/dev/null 2>&1; then ok "k3s API reachable"; k3s kubectl get nodes -o wide; else fail "Cannot query k3s nodes; check sudo/kubeconfig"; fi
  if k3s kubectl get ingressclass >/dev/null 2>&1; then ok "IngressClass inventory:"; k3s kubectl get ingressclass; else warn "Cannot inspect IngressClass"; fi
  if k3s kubectl get namespace ops-prod >/dev/null 2>&1; then ok "Production namespace ops-prod exists"; else warn "Production namespace ops-prod missing"; fi
  if k3s kubectl -n ops-prod get secret mcp-mrcute-space-tls >/dev/null 2>&1; then ok "Production TLS secret exists"; else warn "Production TLS secret missing; no resources will be created by this preflight"; fi
  ISSUER_READY="$(k3s kubectl get clusterissuer letsencrypt-prod -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || true)"
  if [[ "$ISSUER_READY" == "True" ]]; then ok "letsencrypt-prod ClusterIssuer Ready"; else warn "letsencrypt-prod ClusterIssuer is not Ready"; fi
  if k3s kubectl -n ops-prod get secret vps-mcp-secrets >/dev/null 2>&1; then warn "Legacy static bearer secret exists; do not use it for production ChatGPT auth"; else ok "No legacy static bearer secret found"; fi
else fail "k3s binary not found"; fi

for target in / /var/lib/rancher/k3s; do
  if [[ -e "$target" ]]; then
    AVAIL_KB="$(df -Pk "$target" | awk 'NR==2 {print $4}')"
    if [[ -n "$AVAIL_KB" && "$AVAIL_KB" -ge 2097152 ]]; then ok "Free space on $target: $((AVAIL_KB/1024)) MiB"; else fail "Less than 2 GiB free on $target"; fi
  fi
done

if getent ahosts mcp.mrcute.space >/dev/null 2>&1; then ok "DNS resolves mcp.mrcute.space"; getent ahosts mcp.mrcute.space | awk '!seen[$1]++ {print "      "$1}'; else warn "mcp.mrcute.space does not resolve from this host"; fi

if getent group vps-mcp >/dev/null 2>&1; then
  GROUP_GID="$(getent group vps-mcp | cut -d: -f3)"
  if [[ "$GROUP_GID" == "34001" ]]; then ok "Socket group vps-mcp has GID 34001"; else fail "vps-mcp group GID is $GROUP_GID, expected 34001"; fi
else warn "Socket group vps-mcp not installed yet"; fi

GHCR_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 https://ghcr.io/v2/ 2>/dev/null || true)"
case "$GHCR_STATUS" in 200|401) ok "GHCR registry reachable (HTTP $GHCR_STATUS; authentication may be required)" ;; 403) warn "GHCR reachable but forbidden (HTTP 403)" ;; 000|"") warn "Cannot connect to GHCR" ;; *) warn "GHCR returned HTTP $GHCR_STATUS" ;; esac

printf '\nNOTE: This is a read-only preflight only. OAuth 2.1/PKCE is not implemented; do not install or deploy the gateway.\n'
printf 'Summary: %s PASS, %s WARN, %s FAIL\n' "$PASS" "$WARN" "$FAIL"
if [[ "$FAIL" -gt 0 ]]; then exit 1; fi
exit 0
