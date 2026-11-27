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
