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
if [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]]; then
  for trusted_path in /opt "$INSTALL_DIR" "$INSTALL_DIR/.git" "$SCRIPT_DIR" "${BASH_SOURCE[0]}" "$INSTALL_DIR/scripts" "$INSTALL_DIR/apps" "$INSTALL_DIR/apps/root-agent" "$INSTALL_DIR/packages" "$INSTALL_DIR/packages/contracts" "$INSTALL_DIR/deploy" "$INSTALL_DIR/deploy/systemd" "$INSTALL_DIR/deploy/systemd/vps-root-agent.service" "$INSTALL_DIR/package.json" "$INSTALL_DIR/package-lock.json"; do
    if [[ -e "$trusted_path" ]] && sudo -u "$SUDO_USER" test -w "$trusted_path"; then
      echo "The invoking SSH user can write trusted installation path: $trusted_path" >&2
      exit 1
    fi
  done
fi

# Install a checksum-verified Node 26 runtime inside this trusted checkout.
# This does not install or modify a system-wide Node.js/npm package.
bash "$INSTALL_DIR/scripts/install-node-runtime.sh"
NODE_BIN="$INSTALL_DIR/runtime/node/bin/node"
NPM_BIN="$INSTALL_DIR/runtime/node/bin/npm"
export PATH="$INSTALL_DIR/runtime/node/bin:$PATH"
cd "$INSTALL_DIR"
node_major="$("$NODE_BIN" -p 'Number(process.versions.node.split(".")[0])')"
if [[ "$node_major" -ne 26 ]]; then echo "Isolated Node.js 26 is required."; exit 1; fi
"$NPM_BIN" install --ignore-scripts --no-audit --no-fund
"$NPM_BIN" run build
if getent group vps-mcp >/dev/null; then
  GROUP_GID="$(getent group vps-mcp | cut -d: -f3)"
  if [[ "$GROUP_GID" != "34001" ]]; then
    echo "Existing vps-mcp group must use GID 34001 (found $GROUP_GID)" >&2
    exit 1
  fi
else
  groupadd --system --gid 34001 vps-mcp
fi
install -d -o root -g vps-mcp -m 0750 /run/vps-mcp
install -m 0644 "$ROOT_DIR/deploy/systemd/vps-root-agent.service" /etc/systemd/system/vps-root-agent.service
systemctl daemon-reload
systemctl enable --now vps-root-agent.service
systemctl --no-pager --full status vps-root-agent.service
