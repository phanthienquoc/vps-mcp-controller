#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this installer with sudo from the trusted root-owned checkout." >&2
  exit 1
fi

DEPLOY_USER="${1:-}"
if [[ -z "$DEPLOY_USER" ]] || [[ "$DEPLOY_USER" == "root" ]] || ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  echo "Usage: sudo bash /opt/vps-mcp-controller/scripts/install-deploy-entrypoint.sh <existing-ssh-deploy-user>" >&2
  exit 2
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
EXPECTED_REPO_DIR="/opt/vps-mcp-controller"
SOURCE="$REPO_DIR/scripts/deploy-vps.sh"
MANIFEST_DIR="$REPO_DIR/deploy/k3s"
PREFLIGHT_SOURCE="$REPO_DIR/scripts/preflight-vps.sh"

if [[ "$REPO_DIR" != "$EXPECTED_REPO_DIR" ]]; then
  echo "Trusted checkout must be installed at $EXPECTED_REPO_DIR" >&2
  exit 1
fi
for path in "/opt" "$REPO_DIR" "$REPO_DIR/.git" "$SCRIPT_DIR" "${BASH_SOURCE[0]}" "$REPO_DIR/scripts" "$SOURCE" "$PREFLIGHT_SOURCE" "$REPO_DIR/deploy" "$MANIFEST_DIR" "$MANIFEST_DIR/namespace.yaml" "$MANIFEST_DIR/certificate.yaml" "$MANIFEST_DIR/deployment.yaml" "$MANIFEST_DIR/oauth-pvc.yaml" "$MANIFEST_DIR/service.yaml" "$MANIFEST_DIR/ingress.yaml"; do
  if [[ ! -e "$path" || -L "$path" ]]; then
    echo "Missing trusted path: $path" >&2
    exit 1
  fi
  if [[ "$(stat -c '%U:%G' "$path")" != "root:root" ]]; then
    echo "Trusted path must be owned by root:root: $path" >&2
    exit 1
  fi
done
if find /opt -maxdepth 0 -perm /022 -print -quit | grep -q .; then
  echo "/opt must not be group/world-writable" >&2
  exit 1
fi
if find "$REPO_DIR" -xdev \( -type d -o -type f \) \( ! -user root -o -perm /022 \) -print -quit | grep -q .; then
  echo "Checkout contains non-root-owned or group/world-writable files" >&2
  exit 1
fi
for trusted_path in "/opt" "$REPO_DIR" "$REPO_DIR/.git" "$SCRIPT_DIR" "${BASH_SOURCE[0]}" "$REPO_DIR/scripts" "$REPO_DIR/deploy" "$MANIFEST_DIR" "$SOURCE" "$PREFLIGHT_SOURCE" "$MANIFEST_DIR/namespace.yaml" "$MANIFEST_DIR/certificate.yaml" "$MANIFEST_DIR/deployment.yaml" "$MANIFEST_DIR/oauth-pvc.yaml" "$MANIFEST_DIR/service.yaml" "$MANIFEST_DIR/ingress.yaml"; do
  if sudo -u "$DEPLOY_USER" test -w "$trusted_path"; then
    echo "SSH deploy user can write trusted path: $trusted_path" >&2
    exit 1
  fi
done

install -o root -g root -m 0750 "$SOURCE" /usr/local/sbin/vps-mcp-deploy
install -o root -g root -m 0750 "$PREFLIGHT_SOURCE" /usr/local/sbin/vps-mcp-preflight
printf '%s ALL=(root) NOPASSWD: /usr/local/sbin/vps-mcp-deploy, /usr/local/sbin/vps-mcp-preflight\n' "$DEPLOY_USER" \
  > /etc/sudoers.d/vps-mcp-deploy
chmod 0440 /etc/sudoers.d/vps-mcp-deploy
visudo -cf /etc/sudoers.d/vps-mcp-deploy
echo "Installed root-owned deploy entrypoint for $DEPLOY_USER"
