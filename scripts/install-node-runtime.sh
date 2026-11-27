#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="/opt/vps-mcp-controller"
RUNTIME_DIR="$INSTALL_DIR/runtime/node"
BASE_URL="https://nodejs.org/dist/latest-v26.x"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run with sudo from the trusted root-owned checkout." >&2
  exit 1
fi
if [[ "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)" != "$INSTALL_DIR" ]]; then
  echo "Use the trusted checkout at $INSTALL_DIR" >&2
  exit 1
fi
if [[ "$(stat -c '%U:%G' "$INSTALL_DIR")" != "root:root" ]] || find "$INSTALL_DIR" -xdev \( -type f -o -type d \) \( ! -user root -o -perm /022 \) -print -quit | grep -q .; then
  echo "Trusted checkout must be root-owned and not group/world-writable." >&2
  exit 1
fi

case "$(uname -m)" in
  aarch64|arm64) NODE_ARCH="arm64" ;;
  x86_64|amd64) NODE_ARCH="x64" ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

TMP="$(mktemp -d)"
trap 'rm -rf -- "$TMP"' EXIT
curl --fail --location --silent --show-error "$BASE_URL/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
ARCHIVE="$(awk -v arch="$NODE_ARCH" '$2 ~ ("^node-v26\\.[0-9]+\\.[0-9]+-linux-" arch "\\.tar\\.xz$") {print $2; exit}' "$TMP/SHASUMS256.txt")"
if [[ -z "$ARCHIVE" ]]; then
  echo "Could not resolve an official Node 26 archive for linux-$NODE_ARCH." >&2
  exit 1
fi
EXPECTED_SHA="$(awk -v file="$ARCHIVE" '$2 == file {print $1; exit}' "$TMP/SHASUMS256.txt")"
if [[ ! "$EXPECTED_SHA" =~ ^[0-9a-f]{64}$ ]]; then
  echo "Official SHA-256 manifest did not contain a valid checksum for $ARCHIVE." >&2
  exit 1
fi

curl --fail --location --silent --show-error "$BASE_URL/$ARCHIVE" -o "$TMP/$ARCHIVE"
printf '%s  %s\n' "$EXPECTED_SHA" "$TMP/$ARCHIVE" | sha256sum --check --status

install -d -o root -g root -m 0755 "$RUNTIME_DIR"
tar -xJf "$TMP/$ARCHIVE" --strip-components=1 -C "$RUNTIME_DIR"
chown -R root:root "$RUNTIME_DIR"
chmod -R go-w "$RUNTIME_DIR"

NODE_VERSION="$("$RUNTIME_DIR/bin/node" -p 'process.versions.node')"
NODE_MAJOR="${NODE_VERSION%%.*}"
if [[ "$NODE_MAJOR" != "26" ]]; then
  echo "Downloaded runtime is not Node 26: $NODE_VERSION" >&2
  exit 1
fi
"$RUNTIME_DIR/bin/npm" --version >/dev/null
printf 'Installed isolated Node.js %s for linux-%s at %s\n' "$NODE_VERSION" "$NODE_ARCH" "$RUNTIME_DIR"
