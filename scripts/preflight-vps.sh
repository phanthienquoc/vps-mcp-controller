#!/usr/bin/env bash
set -uo pipefail

PASS=0
WARN=0
FAIL=0
ok(){ printf 'PASS  %s\n' "$1"; PASS=$((PASS+1)); }
warn(){ printf 'WARN  %s\n' "$1"; WARN=$((WARN+1)); }
fail(){ printf 'FAIL  %s\n' "$1"; FAIL=$((FAIL+1)); }
has(){ command -v "$1" >/dev/null 2>&1; }

printf 'VPS MCP Controller preflight (read-only)\n'
printf 'Host: %s | User: %s\n\n' "$(hostname)" "$(id -un)"

REPO_DIR="/opt/vps-mcp-controller"
CHECK_USER="${SUDO_USER:-$(id -un)}"
check_trusted_path() {
  local path="$1"
  if [[ ! -e "$path" || -L "$path" ]]; then
    fail "Trusted deployment path missing or symlinked: $path"
    return
  fi
  if [[ "$(stat -c '%U:%G' "$path")" != "root:root" ]]; then
    fail "Trusted deployment path is not root:root owned: $path"
    return
  fi
  if [[ "$CHECK_USER" != "root" ]]; then
    if [[ "$CHECK_USER" == "$(id -un)" ]]; then
      if [[ -w "$path" ]]; then
        fail "SSH user can write trusted deployment path: $path"
        return
      fi
    elif sudo -n -u "$CHECK_USER" test -w "$path"; then
      fail "SSH user can write trusted deployment path: $path"
      return
    fi
  fi
  ok "Root-owned and not writable by $CHECK_USER: $path"
}

if [[ -d "$REPO_DIR/.git" ]]; then
  if find "$REPO_DIR" -xdev \( -type d -o -type f \) \( ! -user root -o -perm /022 \) -print -quit | grep -q .; then
    fail "Checkout contains non-root-owned or group/world-writable files"
  else
    ok "Checkout files are root-owned and not group/world-writable"
  fi
  check_trusted_path "$REPO_DIR"
  check_trusted_path "$REPO_DIR/deploy/k3s"
  check_trusted_path "$REPO_DIR/deploy/k3s/deployment.yaml"
  check_trusted_path "$REPO_DIR/scripts/deploy-vps.sh"
else
  fail "Trusted root-owned checkout missing at $REPO_DIR"
fi

if [[ -x /usr/local/sbin/vps-mcp-deploy ]]; then
  check_trusted_path "/usr/local/sbin/vps-mcp-deploy"
else
  warn "Root deploy entrypoint is not installed yet (expected before deployment)"
fi

if has node; then
  NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
  if [[ "$NODE_MAJOR" -eq 26 ]]; then ok "Node.js $(node --version)"; else fail "Node.js 26 required; found $(node --version)"; fi
else fail "Node.js not installed"; fi

if has npm; then ok "npm $(npm --version)"; else fail "npm not installed"; fi

if has k3s; then
  ok "k3s binary found: $(command -v k3s)"
  if k3s kubectl get nodes -o wide >/dev/null 2>&1; then
    ok "k3s API reachable with current credentials"
    k3s kubectl get nodes -o wide
  else fail "Cannot query k3s nodes; check sudo/kubeconfig"; fi
  if k3s kubectl get ingressclass >/dev/null 2>&1; then
    ok "IngressClass inventory:"
    k3s kubectl get ingressclass
  else warn "Cannot inspect IngressClass"; fi
  if k3s kubectl get namespace ops-prod >/dev/null 2>&1; then ok "Namespace ops-prod exists"; else warn "Namespace ops-prod missing; create it during deployment"; fi
  if k3s kubectl -n ops-prod get secret mcp-mrcute-space-tls >/dev/null 2>&1; then ok "TLS secret exists in ops-prod"; else warn "TLS secret mcp-mrcute-space-tls missing"; fi
  if k3s kubectl -n ops-prod get secret vps-mcp-secrets >/dev/null 2>&1; then ok "Gateway secret exists"; else warn "Gateway secret vps-mcp-secrets missing"; fi
else fail "k3s binary not found"; fi

for target in / /var/lib/rancher/k3s; do
  if [[ -e "$target" ]]; then
    AVAIL_KB="$(df -Pk "$target" | awk 'NR==2 {print $4}')"
    if [[ -n "$AVAIL_KB" && "$AVAIL_KB" -ge 2097152 ]]; then ok "Free space on $target: $((AVAIL_KB/1024)) MiB"; else fail "Less than 2 GiB free on $target"; fi
  fi
done

if getent ahosts mcp.mrcute.space >/dev/null 2>&1; then
  ok "DNS resolves mcp.mrcute.space"
  getent ahosts mcp.mrcute.space | awk '!seen[$1]++ {print "      "$1}'
else warn "mcp.mrcute.space does not resolve from this host"; fi

if getent group vps-mcp >/dev/null 2>&1; then
  GROUP_GID="$(getent group vps-mcp | cut -d: -f3)"
  if [[ "$GROUP_GID" == "34001" ]]; then ok "Socket group vps-mcp has GID 34001"; else fail "vps-mcp group GID is $GROUP_GID, expected 34001"; fi
else warn "Socket group vps-mcp not installed yet"; fi

if curl -fsSI --max-time 8 https://ghcr.io/v2/ >/dev/null 2>&1; then ok "GHCR registry reachable"; else warn "Cannot reach GHCR registry"; fi

printf '\nSummary: %s PASS, %s WARN, %s FAIL\n' "$PASS" "$WARN" "$FAIL"
if [[ "$FAIL" -gt 0 ]]; then exit 1; fi
exit 0
