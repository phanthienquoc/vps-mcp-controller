#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ "$(id -u)" -ne 0 ]]; then
  echo "The deploy entrypoint must run as root" >&2
  exit 1
fi

if [[ "${1:-}" == "--preflight" ]]; then
  REPO_DIR="/opt/vps-mcp-controller"
  EXPECTED_ORIGIN="https://github.com/phanthienquoc/vps-mcp-controller.git"
  SELF_PATH="$(readlink -f -- "$0")"
  RUNTIME_NODE="$REPO_DIR/runtime/node/bin/node"
  RUNTIME_NPM="$REPO_DIR/runtime/node/bin/npm"
  KUBECTL=(k3s kubectl)

  fail_preflight() {
    echo "Preflight failed: $1" >&2
    exit 1
  }

  check_trusted_path() {
    local path="$1"
    local metadata owner group mode mode_value
    [[ -e "$path" && ! -L "$path" ]] || fail_preflight "Missing or symlinked trusted path: $path"
    metadata="$(stat -c '%U:%G:%a' "$path")"
    IFS=: read -r owner group mode <<< "$metadata"
    [[ "$owner:$group" == "root:root" && "$mode" =~ ^[0-7]{3,4}$ ]] || fail_preflight "Path is not root:root owned or has invalid mode: $path"
    mode_value=$((8#$mode))
    (( (mode_value & 0022) == 0 )) || fail_preflight "Path is group/world-writable: $path"
  }

  for path in \
    /opt \
    "$REPO_DIR" \
    "$REPO_DIR/.git" \
    "$REPO_DIR/deploy/k3s" \
    "$REPO_DIR/deploy/k3s/deployment.yaml" \
    "$REPO_DIR/scripts/deploy-vps.sh" \
    "$SELF_PATH"; do
    check_trusted_path "$path"
  done

  CHECKOUT_VIOLATION="$(find "$REPO_DIR" -xdev \( -type d -o -type f \) \( ! -user root -o -perm /022 \) -print -quit)"
  [[ -z "$CHECKOUT_VIOLATION" ]] || fail_preflight "Checkout contains non-root-owned or group/world-writable paths"

  DEPLOY_CALLER="${SUDO_USER:-}"
  if [[ -n "$DEPLOY_CALLER" && "$DEPLOY_CALLER" != "root" ]]; then
    if sudo -u "$DEPLOY_CALLER" test -w /opt \
      || sudo -u "$DEPLOY_CALLER" test -w "$REPO_DIR" \
      || sudo -u "$DEPLOY_CALLER" test -w "$REPO_DIR/deploy/k3s" \
      || sudo -u "$DEPLOY_CALLER" test -w "$SELF_PATH"; then
      fail_preflight "SSH deploy user can write a trusted deployment path"
    fi
  fi

  ORIGIN="$(git -C "$REPO_DIR" remote get-url origin)"
  [[ "$ORIGIN" == "$EXPECTED_ORIGIN" ]] || fail_preflight "Unexpected trusted checkout origin"

  [[ -x "$RUNTIME_NODE" && -x "$RUNTIME_NPM" ]] || fail_preflight "Isolated Node.js 26 runtime is missing"
  NODE_MAJOR="$("$RUNTIME_NODE" -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
  [[ "$NODE_MAJOR" -eq 26 ]] || fail_preflight "Isolated Node.js runtime must be major version 26"

  systemctl is-active --quiet vps-root-agent || fail_preflight "vps-root-agent is not active"
  [[ -S /run/vps-mcp/root-agent.sock ]] || fail_preflight "Root Agent socket is missing"

  NODE_READY="$("${KUBECTL[@]}" get node tce-k3s-01 -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || true)"
  [[ "$NODE_READY" == "True" ]] || fail_preflight "Expected Kubernetes node tce-k3s-01 is not Ready"
  "${KUBECTL[@]}" get namespace ops-prod >/dev/null 2>&1 || fail_preflight "Production namespace ops-prod is missing"

  ISSUER_READY="$("${KUBECTL[@]}" get clusterissuer letsencrypt-prod -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || true)"
  [[ "$ISSUER_READY" == "True" ]] || fail_preflight "ClusterIssuer letsencrypt-prod is not Ready"

  for target in / /var/lib/rancher/k3s; do
    if [[ -e "$target" ]]; then
      AVAILABLE_KB="$(df -Pk "$target" | awk 'NR==2 {print $4}')"
      [[ -n "$AVAILABLE_KB" && "$AVAILABLE_KB" -ge 2097152 ]] || fail_preflight "Less than 2 GiB free on $target"
    fi
  done

  GHCR_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 https://ghcr.io/v2/ 2>/dev/null || true)"
  case "$GHCR_STATUS" in
    200|401) ;;
    *) fail_preflight "GHCR registry is not reachable (HTTP ${GHCR_STATUS:-000})" ;;
  esac

  echo "Read-only deployment preflight passed for tce-k3s-01"
  exit 0
fi

SHA="${1:-}"
if [[ ! "$SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Usage: vps-mcp-deploy <40-character-commit-sha>" >&2
  exit 2
fi

# Fail closed: the gateway still uses a static bearer verifier and is not production ChatGPT OAuth.
echo "Production deployment blocked: OAuth 2.1/PKCE and MCP authorization metadata are not implemented." >&2
exit 78

REPO_DIR="/opt/vps-mcp-controller"
if [[ "$(stat -c '%U:%G' /opt)" != "root:root" ]] || find /opt -maxdepth 0 -perm /022 -print -quit | grep -q .; then
  echo "/opt must be root-owned and not group/world-writable" >&2
  exit 1
fi
EXPECTED_ORIGIN="https://github.com/phanthienquoc/vps-mcp-controller.git"
if [[ ! -d "$REPO_DIR/.git" ]]; then
  echo "Trusted root-owned checkout missing at $REPO_DIR" >&2
  exit 1
fi
if [[ "$(stat -c '%U:%G' "$REPO_DIR")" != "root:root" ]]; then
  echo "Repository checkout must be owned by root:root" >&2
  exit 1
fi
if find "$REPO_DIR" -xdev \( -type d -o -type f \) \( ! -user root -o -perm /022 \) -print -quit | grep -q .; then
  echo "Repository contains non-root-owned or group/world-writable files" >&2
  exit 1
fi

DEPLOY_CALLER="${SUDO_USER:-}"
if [[ -n "$DEPLOY_CALLER" && "$DEPLOY_CALLER" != "root" ]]; then
  if ! id "$DEPLOY_CALLER" >/dev/null 2>&1; then
    echo "Unable to resolve the SSH deploy caller" >&2
    exit 1
  fi
  if sudo -u "$DEPLOY_CALLER" test -w /opt || sudo -u "$DEPLOY_CALLER" test -w "$REPO_DIR" || sudo -u "$DEPLOY_CALLER" test -w "$REPO_DIR/deploy/k3s"; then
    echo "SSH deploy user must not be able to write the trusted checkout or manifests" >&2
    exit 1
  fi
fi

ORIGIN="$(git -C "$REPO_DIR" remote get-url origin)"
if [[ "$ORIGIN" != "$EXPECTED_ORIGIN" ]]; then
  echo "Unexpected origin for trusted deployment checkout" >&2
  exit 1
fi

git -C "$REPO_DIR" fetch --no-tags --prune origin +refs/heads/master:refs/remotes/origin/master
if ! git -C "$REPO_DIR" cat-file -e "${SHA}^{commit}" 2>/dev/null; then
  echo "Requested revision is not present in the trusted checkout" >&2
  exit 1
fi
if ! git -C "$REPO_DIR" merge-base --is-ancestor "$SHA" refs/remotes/origin/master; then
  echo "Requested revision is not reachable from origin/master" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf -- "$TMP"' EXIT
git -C "$REPO_DIR" archive --format=tar "$SHA" deploy/k3s | tar -xf - -C "$TMP"
MANIFEST_DIR="$TMP/deploy/k3s"
for manifest in namespace.yaml certificate.yaml deployment.yaml service.yaml ingress.yaml; do
  if [[ ! -f "$MANIFEST_DIR/$manifest" || -L "$MANIFEST_DIR/$manifest" ]]; then
    echo "Trusted revision is missing a regular deploy/k3s/$manifest manifest" >&2
    exit 1
  fi
done

KUBECTL=(k3s kubectl)
NAMESPACE="ops-prod"
DEPLOYMENT="vps-mcp-gateway"
IMAGE="ghcr.io/phanthienquoc/vps-mcp-controller:$SHA"

if ! systemctl is-active --quiet vps-root-agent; then
  echo "vps-root-agent is not active; refusing deployment" >&2
  exit 1
fi

TARGET_NODE_READY="$("${KUBECTL[@]}" get node tce-k3s-01 -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || true)"
if [[ "$TARGET_NODE_READY" != "True" ]]; then
  echo "Expected Kubernetes node tce-k3s-01 is not Ready; refusing deployment" >&2
  exit 1
fi
if [[ ! -S /run/vps-mcp/root-agent.sock ]]; then
  echo "Root Agent socket is missing" >&2
  exit 1
fi

"${KUBECTL[@]}" get nodes >/dev/null
"${KUBECTL[@]}" apply -f "$MANIFEST_DIR/namespace.yaml"
"${KUBECTL[@]}" -n "$NAMESPACE" get secret vps-mcp-secrets >/dev/null
ISSUER_READY="$("${KUBECTL[@]}" get clusterissuer letsencrypt-prod -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || true)"
if [[ "$ISSUER_READY" != "True" ]]; then
  echo "cert-manager ClusterIssuer letsencrypt-prod is not Ready" >&2
  exit 1
fi
"${KUBECTL[@]}" apply -f "$MANIFEST_DIR/certificate.yaml"
"${KUBECTL[@]}" -n "$NAMESPACE" wait --for=condition=Ready certificate/mcp-mrcute-space --timeout=300s
"${KUBECTL[@]}" -n "$NAMESPACE" get secret mcp-mrcute-space-tls >/dev/null

# The workflow streams the read-only GHCR credential over SSH stdin, never as an argument.
GHCR_TOKEN="$(cat)"
if [[ -n "$GHCR_TOKEN" ]]; then
  DOCKER_CONFIG_DIR="$TMP/docker-config"
  install -d -m 0700 "$DOCKER_CONFIG_DIR"
  GHCR_TOKEN="$GHCR_TOKEN" python3 - "$DOCKER_CONFIG_DIR/config.json" <<'PY'
import base64
import json
import os
import sys

token = os.environ.get("GHCR_TOKEN", "")
if not token:
    raise SystemExit("GHCR token was not supplied")

auth = base64.b64encode(f"phanthienquoc:{token}".encode("utf-8")).decode("ascii")
fd = os.open(sys.argv[1], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w", encoding="utf-8") as handle:
    json.dump({"auths": {"ghcr.io": {"auth": auth}}}, handle)
    handle.write("\n")
PY
  unset GHCR_TOKEN
  if [[ "$(stat -c '%a' "$DOCKER_CONFIG_DIR/config.json")" != "600" ]]; then
    echo "Temporary Docker config permissions are not mode 0600" >&2
    exit 1
  fi
  "${KUBECTL[@]}" -n "$NAMESPACE" create secret generic ghcr-pull \
    --type=kubernetes.io/dockerconfigjson \
    --from-file=.dockerconfigjson="$DOCKER_CONFIG_DIR/config.json" \
    --dry-run=client -o yaml | "${KUBECTL[@]}" apply -f -
  rm -rf -- "$DOCKER_CONFIG_DIR"
else
  "${KUBECTL[@]}" -n "$NAMESPACE" get secret ghcr-pull >/dev/null
fi

HAD_DEPLOYMENT=0
if "${KUBECTL[@]}" -n "$NAMESPACE" get deployment "$DEPLOYMENT" >/dev/null 2>&1; then
  HAD_DEPLOYMENT=1
fi

sed "s|REPLACE_WITH_VERIFIED_SHA_TAG|$SHA|g" \
  "$MANIFEST_DIR/deployment.yaml" > "$TMP/deployment.yaml"
if grep -q 'REPLACE_WITH_VERIFIED_SHA_TAG' "$TMP/deployment.yaml"; then
  echo "Image placeholder replacement failed" >&2
  exit 1
fi

"${KUBECTL[@]}" apply -f "$TMP/deployment.yaml"
"${KUBECTL[@]}" apply -f "$MANIFEST_DIR/service.yaml"
"${KUBECTL[@]}" apply -f "$MANIFEST_DIR/ingress.yaml"

if ! "${KUBECTL[@]}" -n "$NAMESPACE" rollout status "deployment/$DEPLOYMENT" --timeout=180s; then
  echo "Deployment rollout failed; attempting rollback" >&2
  if [[ "$HAD_DEPLOYMENT" -eq 1 ]]; then
    "${KUBECTL[@]}" -n "$NAMESPACE" rollout undo "deployment/$DEPLOYMENT" || true
    "${KUBECTL[@]}" -n "$NAMESPACE" rollout status "deployment/$DEPLOYMENT" --timeout=120s || true
  fi
  exit 1
fi

"${KUBECTL[@]}" -n "$NAMESPACE" get deployment,pods,svc,ingress
curl --fail --silent --show-error --max-time 15 https://mcp.mrcute.space/healthz
printf '\nDeployed %s\n' "$IMAGE"
