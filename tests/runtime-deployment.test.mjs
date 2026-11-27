import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("host Root Agent uses isolated Node runtime, not system Node", async () => {
  const service = await read("../deploy/systemd/vps-root-agent.service");
  const installer = await read("../scripts/install-root-agent.sh");
  const runtimeInstaller = await read("../scripts/install-node-runtime.sh");
  assert.match(service, /ExecStart=\/opt\/vps-mcp-controller\/runtime\/node\/bin\/node/);
  assert.doesNotMatch(service, /ExecStart=\/usr\/bin\/node/);
  assert.match(installer, /install-node-runtime\.sh/);
  assert.match(runtimeInstaller, /SHASUMS256\.txt/);
  assert.match(runtimeInstaller, /sha256sum --check/);
  assert.match(runtimeInstaller, /latest-v26\.x/);
});

test("VPS preflight documents isolated runtime and does not require system Node or npm", async () => {
  const preflight = await read("../scripts/preflight-vps.sh");
  assert.match(preflight, /host Node\/npm not required/);
  assert.match(preflight, /Isolated Node\.js/);
  assert.doesNotMatch(preflight, /FAIL  Node\.js not installed/);
  assert.doesNotMatch(preflight, /FAIL  npm not installed/);
});

test("GHCR preflight accepts the expected unauthenticated 401 challenge", async () => {
  const preflight = await read("../scripts/preflight-vps.sh");
  assert.match(preflight, /200\|401/);
  assert.match(preflight, /authentication may be required/);
});

test("publish and deploy workflows build both supported architectures", async () => {
  const publish = await read("../.github/workflows/publish.yml");
  const deploy = await read("../.github/workflows/deploy-vps.yml");
  for (const workflow of [publish, deploy]) {
    assert.match(workflow, /linux\/amd64,linux\/arm64/);
    assert.match(workflow, /setup-qemu-action/);
    assert.match(workflow, /setup-buildx-action/);
  }
});

test("deployment provisions TLS from the managed ClusterIssuer", async () => {
  const deploy = await read("../scripts/deploy-vps.sh");
  const certificate = await read("../deploy/k3s/certificate.yaml");
  assert.match(deploy, /certificate\.yaml/);
  assert.match(deploy, /wait --for=condition=Ready certificate\/mcp-mrcute-space/);
  assert.match(certificate, /kind: Certificate/);
  assert.match(certificate, /name: letsencrypt-prod/);
  assert.match(certificate, /secretName: mcp-mrcute-space-tls/);
});

test("production deploy validates Root Agent before cluster mutations", async () => {
  const deploy = await read("../scripts/deploy-vps.sh");
  const agentGuard = deploy.indexOf('systemctl is-active --quiet vps-root-agent');
  const socketGuard = deploy.indexOf('[[ ! -S "$SOCKET" ]]');
  const firstApply = deploy.indexOf('"$' + '{KUBECTL[@]}" apply -f "$MANIFEST_DIR/namespace.yaml"');
  assert.ok(agentGuard > 0, "Root Agent service gate must exist");
  assert.ok(socketGuard > agentGuard, "socket gate must follow service gate");
  assert.ok(firstApply > socketGuard, "Root Agent gates must run before any Kubernetes apply");
});

test("production deploy validates OAuth Secret before provisioning PVC and TLS", async () => {
  const deploy = await read("../scripts/deploy-vps.sh");
  const secretGuard = deploy.indexOf('get secret "$OAUTH_SECRET"');
  const pvcApply = deploy.indexOf('apply -f "$MANIFEST_DIR/oauth-pvc.yaml"');
  const certificateApply = deploy.indexOf('apply -f "$MANIFEST_DIR/certificate.yaml"');
  assert.ok(secretGuard > 0, "OAuth Secret gate must exist");
  assert.ok(pvcApply > secretGuard, "OAuth Secret gate must precede PVC provisioning");
  assert.ok(certificateApply > pvcApply, "PVC provisioning must precede TLS certificate request");
  assert.match(deploy, /MCP_BOOTSTRAP_EMAIL/);
  assert.match(deploy, /MCP_BOOTSTRAP_PASSWORD/);
  assert.match(deploy, /MCP_OAUTH_SIGNING_PRIVATE_KEY/);
  assert.match(deploy, /MCP_OAUTH_SIGNING_KID/);
});

test("production deployment docs do not create a static bearer credential", async () => {
  const docs = await read("../docs/DEPLOYMENT.md");
  assert.match(docs, /production-only/i);
  assert.doesNotMatch(docs, /openssl rand -hex|--from-file=mcp-bearer-token/);
});

test("production gateway manifest does not mount a static bearer token", async () => {
  const manifest = await read("../deploy/k3s/deployment.yaml");
  assert.doesNotMatch(manifest, /MCP_BEARER_TOKEN|mcp-bearer-token|vps-mcp-secrets/);
});
