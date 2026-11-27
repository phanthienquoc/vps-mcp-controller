#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="/opt/vps-mcp-controller"
if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run with sudo from the trusted root-owned checkout." >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
if [[ "$ROOT_DIR" != "$INSTALL_DIR" || ! -d "$INSTALL_DIR/.git" ]]; then
  echo "Use the trusted Git checkout at $INSTALL_DIR" >&2
  exit 1
fi
if [[ "$(stat -c '%U:%G' /opt)" != "root:root" ]] || find /opt -maxdepth 0 -perm /022 -print -quit | grep -q .; then
  echo "/opt must be root-owned and not group/world-writable" >&2
  exit 1
fi
if [[ "$(stat -c '%U:%G' "$INSTALL_DIR")" != "root:root" ]]; then
  echo "Repository checkout must be owned by root:root" >&2
  exit 1
fi
if find "$INSTALL_DIR" -xdev \( -type d -o -type f \) \( ! -user root -o -perm /022 \) -print -quit | grep -q .; then
  echo "Checkout contains non-root-owned or group/world-writable files" >&2
  exit 1
fi
if [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]] \
  && { sudo -u "$SUDO_USER" test -w /opt || sudo -u "$SUDO_USER" test -w "$INSTALL_DIR"; }; then
  echo "The invoking SSH user must not be able to write the trusted checkout" >&2
  exit 1
fi

node_major="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
if [[ "$node_major" -lt 26 ]]; then echo "Node.js 26+ is required."; exit 1; fi
getent group vps-mcp >/dev/null || groupadd --system --gid 34001 vps-mcp
cd "$INSTALL_DIR"
npm install --no-audit --no-fund
npm run build
install -d -o root -g vps-mcp -m 0750 /run/vps-mcp
install -m 0644 "$ROOT_DIR/deploy/systemd/vps-root-agent.service" /etc/systemd/system/vps-root-agent.service
systemctl daemon-reload
systemctl enable --now vps-root-agent.service
systemctl --no-pager --full status vps-root-agent.service
