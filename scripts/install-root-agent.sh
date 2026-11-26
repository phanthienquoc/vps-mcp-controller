#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="/opt/vps-mcp-controller"
SOCKET_GROUP="vps-mcp"
if [[ "$(id -u)" -ne 0 ]]; then echo "Run with sudo." >&2; exit 1; fi
node_major="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
if [[ "$node_major" -lt 26 ]]; then echo "Node.js 26+ is required." >&2; exit 1; fi
getent group "$SOCKET_GROUP" >/dev/null || groupadd --system --gid 34001 "$SOCKET_GROUP"
install -d -o root -g root -m 0755 "$INSTALL_DIR"
cp -a "$ROOT_DIR/package.json" "$ROOT_DIR/tsconfig.base.json" "$ROOT_DIR/packages" "$ROOT_DIR/apps" "$INSTALL_DIR/"
cd "$INSTALL_DIR"
npm install --no-audit --no-fund
npm run build
install -d -o root -g "$SOCKET_GROUP" -m 0750 /run/vps-mcp
install -m 0644 "$ROOT_DIR/deploy/systemd/vps-root-agent.service" /etc/systemd/system/vps-root-agent.service
systemctl daemon-reload
systemctl enable --now vps-root-agent.service
systemctl --no-pager --full status vps-root-agent.service
