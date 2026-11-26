#!/usr/bin/env bash
set -euo pipefail

DEPLOY_USER="${1:-}"
if [[ -z "$DEPLOY_USER" ]] || ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  echo "Usage: sudo bash scripts/install-deploy-entrypoint.sh <existing-ssh-deploy-user>" >&2
  exit 2
fi

SOURCE="$(cd "$(dirname "$0")" && pwd)/deploy-vps.sh"
if [[ ! -f "$SOURCE" ]]; then
  echo "Missing $SOURCE" >&2
  exit 1
fi

install -o root -g root -m 0750 "$SOURCE" /usr/local/sbin/vps-mcp-deploy
printf '%s ALL=(root) NOPASSWD: /usr/local/sbin/vps-mcp-deploy\n' "$DEPLOY_USER" \
  > /etc/sudoers.d/vps-mcp-deploy
chmod 0440 /etc/sudoers.d/vps-mcp-deploy
visudo -cf /etc/sudoers.d/vps-mcp-deploy
echo "Installed root-owned deploy entrypoint for $DEPLOY_USER"
