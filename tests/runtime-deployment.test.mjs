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

test("VPS preflight does not require system-wide Node or npm", async () => {
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

test("production deploy is blocked before any privileged mutation until OAuth is ready", async () => {
  const deploy = await read("../scripts/deploy-vps.sh");
  const guard = deploy.indexOf("Production deployment blocked: OAuth 2.1/PKCE");
  const fetch = deploy.indexOf('git -C "$REPO_DIR" fetch');
  assert.ok(guard > 0, "explicit production OAuth gate must exist");
  assert.ok(fetch > guard, "OAuth gate must execute before fetching/applying deployment manifests");
  assert.match(deploy, /exit 78/);
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
