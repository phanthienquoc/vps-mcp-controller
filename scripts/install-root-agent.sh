#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="/opt/vps-mcp-controller"
if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run with sudo from the trusted root-owned checkout." >&2
  exit 1
fi

DEPLOY_USER="${VPS_DEPLOY_USER:-}"
if [[ -z "$DEPLOY_USER" || "$DEPLOY_USER" == "root" || ! "$DEPLOY_USER" =~ ^[a-z_][a-z0-9_-]*[$]?$ ]]; then
  echo "Set VPS_DEPLOY_USER to an existing dedicated non-root deploy account." >&2
  exit 1
fi
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  echo "VPS_DEPLOY_USER does not exist; create the dedicated account through your approved host-access process." >&2
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
if sudo -u "$DEPLOY_USER" test -w /opt || sudo -u "$DEPLOY_USER" test -w "$INSTALL_DIR" || sudo -u "$DEPLOY_USER" test -w "$INSTALL_DIR/deploy/k3s"; then
  echo "The dedicated deploy user must not be able to write the trusted checkout or manifests" >&2
  exit 1
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
getent group vps-mcp >/dev/null || groupadd --system --gid 34001 vps-mcp
install -d -o root -g vps-mcp -m 0750 /run/vps-mcp
# Install the immutable root-owned deployment entrypoint and a command-scoped sudo rule.
if [[ -e /usr/local/sbin/vps-mcp-deploy || -L /usr/local/sbin/vps-mcp-deploy ]]; then
  [[ ! -L /usr/local/sbin/vps-mcp-deploy ]] || { echo "Refusing symlinked deploy entrypoint" >&2; exit 1; }
  [[ "$(stat -c '%U:%G' /usr/local/sbin/vps-mcp-deploy)" == "root:root" ]] || { echo "Existing deploy entrypoint is not root-owned" >&2; exit 1; }
fi
install -o root -g root -m 0750 "$INSTALL_DIR/scripts/deploy-vps.sh" /usr/local/sbin/vps-mcp-deploy

SUDOERS_PATH="/etc/sudoers.d/vps-mcp-deploy"
SUDOERS_TMP="$(mktemp)"
trap 'rm -f -- "$SUDOERS_TMP"' EXIT
printf '%s ALL=(root) NOPASSWD: /usr/local/sbin/vps-mcp-deploy *\n' "$DEPLOY_USER" > "$SUDOERS_TMP"
chmod 0440 "$SUDOERS_TMP"
visudo -cf "$SUDOERS_TMP"
if [[ -e "$SUDOERS_PATH" ]]; then
  cmp -s "$SUDOERS_TMP" "$SUDOERS_PATH" || { echo "Existing $SUDOERS_PATH differs; review it manually" >&2; exit 1; }
else
  install -o root -g root -m 0440 "$SUDOERS_TMP" "$SUDOERS_PATH"
fi
rm -f -- "$SUDOERS_TMP"
trap - EXIT
visudo -cf "$SUDOERS_PATH"

install -m 0644 "$ROOT_DIR/deploy/systemd/vps-root-agent.service" /etc/systemd/system/vps-root-agent.service
systemctl daemon-reload
systemctl enable --now vps-root-agent.service
systemctl --no-pager --full status vps-root-agent.service
