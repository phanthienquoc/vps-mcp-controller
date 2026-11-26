#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SHA="${1:-}"
if [[ ! "$SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Usage: vps-mcp-deploy <40-character-commit-sha>" >&2
  exit 2
fi

KUBECTL=(k3s kubectl)
NAMESPACE="ops-prod"
DEPLOYMENT="vps-mcp-gateway"
IMAGE="ghcr.io/phanthienquoc/vps-mcp-controller:$SHA"
MANIFEST_DIR="/opt/vps-mcp-controller/deploy/k3s"
TMP="$(mktemp -d)"
HAD_DEPLOYMENT=0
cleanup(){ rm -rf "$TMP"; }
trap cleanup EXIT

if ! systemctl is-active --quiet vps-root-agent; then
  echo "vps-root-agent is not active; refusing deployment" >&2
  exit 1
fi
if [[ ! -S /run/vps-mcp/root-agent.sock ]]; then
  echo "Root Agent socket is missing" >&2
  exit 1
fi
if [[ ! -f "$MANIFEST_DIR/deployment.yaml" ]]; then
  echo "Deployment manifests not found at $MANIFEST_DIR" >&2
  exit 1
fi

"${KUBECTL[@]}" get nodes >/dev/null
"${KUBECTL[@]}" -n "$NAMESPACE" get secret vps-mcp-secrets >/dev/null
"${KUBECTL[@]}" -n "$NAMESPACE" get secret mcp-mrcute-space-tls >/dev/null

# The workflow streams the read-only GHCR credential over SSH stdin, never as an argument.
GHCR_TOKEN="$(cat)"
if [[ -n "$GHCR_TOKEN" ]]; then
  "${KUBECTL[@]}" -n "$NAMESPACE" create secret docker-registry ghcr-pull \
    --docker-server=ghcr.io \
    --docker-username=phanthienquoc \
    --docker-password="$GHCR_TOKEN" \
    --dry-run=client -o yaml | "${KUBECTL[@]}" apply -f -
  unset GHCR_TOKEN
else
  "${KUBECTL[@]}" -n "$NAMESPACE" get secret ghcr-pull >/dev/null
fi

if "${KUBECTL[@]}" -n "$NAMESPACE" get deployment "$DEPLOYMENT" >/dev/null 2>&1; then
  HAD_DEPLOYMENT=1
fi

sed "s|REPLACE_WITH_VERIFIED_SHA_TAG|$SHA|g" \
  "$MANIFEST_DIR/deployment.yaml" > "$TMP/deployment.yaml"
if grep -q 'REPLACE_WITH_VERIFIED_SHA_TAG' "$TMP/deployment.yaml"; then
  echo "Image placeholder replacement failed" >&2
  exit 1
fi

"${KUBECTL[@]}" apply -f "$MANIFEST_DIR/namespace.yaml"
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
