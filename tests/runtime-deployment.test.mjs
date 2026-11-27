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




test("read-only preflight validates the target node and parses OAuth key names", async () => {
  const preflight = await read("../scripts/preflight-vps.sh");
  assert.match(preflight, /get node tce-k3s-01/);
  assert.match(preflight, /Expected node tce-k3s-01 is Ready/);
  assert.match(preflight, /Required local-path StorageClass is missing/);
  const oauthLine = preflight.split("\n").find((line) => line.includes("OAUTH_KEYS="));
  assert.ok(oauthLine, "OAuth Secret key extraction must be present");
  const newlineEscape = oauthLine.match(/%s(\\+)n/);
  assert.equal(newlineEscape?.[1].length, 1, "Go template must emit real newline-delimited keys");
  assert.match(preflight, /Root Agent service is not active/);
  assert.match(preflight, /vps-mcp-preflight/);
  assert.match(preflight, /Root Agent socket must be root:34001 mode 0660/);
});

test("deployment verifies the intended Ready node before any Kubernetes apply", async () => {
  const deploy = await read("../scripts/deploy-vps.sh");
  const manifest = await read("../deploy/k3s/deployment.yaml");
  const nodeGuard = deploy.indexOf('get node tce-k3s-01');
  const firstApply = deploy.indexOf('"$' + '{KUBECTL[@]}" apply -f "$MANIFEST_DIR/namespace.yaml"');
  assert.ok(nodeGuard > 0, "target node readiness guard must exist");
  assert.ok(firstApply > nodeGuard, "target node guard must precede all Kubernetes mutations");
  assert.match(manifest, /nodeSelector:\s+kubernetes\.io\/hostname:\s*tce-k3s-01/);
  assert.match(deploy, /Root Agent socket must be root-owned, group GID 34001 and mode 0660/);
});

test("deploy workflow requires OAuth approval, port 22, non-root SSH and pinned host keys", async () => {
  const workflow = await read("../.github/workflows/deploy-vps.yml");
  assert.match(workflow, /environment: tce-k3s-01/);
  assert.match(workflow, /MCP_OAUTH_PRODUCTION_READY/);
  assert.match(workflow, /test "\$VPS_SSH_PORT" = "22"/);
  assert.match(workflow, /test "\$VPS_USER" != "root"/);
  assert.match(workflow, /StrictHostKeyChecking=yes/);
  assert.match(workflow, /ssh-keygen -F "\$VPS_HOST"/);
  assert.match(workflow, /sudo -n \/usr\/local\/sbin\/vps-mcp-preflight/);
  assert.match(workflow, /sudo -n \/usr\/local\/sbin\/vps-mcp-deploy/);
  assert.match(workflow, /Run read-only VPS preflight before publishing/);
  assert.match(workflow, /printf '%s' "\$GHCR_READ_TOKEN" \|/);
});

test("deploy workflow gates the exact master CI commit and explicit tce-k3s-01 target before SSH", async () => {
  const workflow = await read("../.github/workflows/deploy-vps.yml");
  const ciGate = workflow.indexOf("CI_RUNS=");
  const ssh = workflow.indexOf("Configure strict SSH");
  const preflight = workflow.indexOf("Run read-only VPS preflight before publishing");
  const build = workflow.indexOf("Build and publish immutable multi-architecture gateway image");
  assert.ok(ciGate > 0 && ciGate < ssh, "exact-commit CI gate must run before SSH");
  assert.ok(preflight > ssh && preflight < build, "read-only target preflight must precede image publication");
  assert.ok(workflow.includes("actions: read"));
  assert.ok(workflow.includes("actions/workflows/ci.yml/runs"));
  assert.ok(workflow.includes("head_sha"));
  assert.ok(workflow.includes("conclusion"));
  assert.ok(workflow.includes('test "$VPS_TARGET_ID" = "tce-k3s-01"'));
  assert.ok(workflow.includes("Expected node ${VPS_TARGET_ID} is Ready"));
  assert.ok(workflow.includes("GH_TOKEN: ${{ github.token }}"));
});
test("deploy-entrypoint installer rejects root SSH users and installs only narrow sudo commands", async () => {
  const installer = await read("../scripts/install-deploy-entrypoint.sh");
  assert.match(installer, /DEPLOY_USER.*== "root"/);
  assert.match(installer, /install -o root -g root -m 0750 "\$PREFLIGHT_SOURCE" \/usr\/local\/sbin\/vps-mcp-preflight/);
  assert.match(installer, /NOPASSWD: \/usr\/local\/sbin\/vps-mcp-deploy, \/usr\/local\/sbin\/vps-mcp-preflight/);
});

test("production docs describe the explicit OAuth approval and immutable deployment gates", async () => {
  const deployment = await read("../docs/DEPLOYMENT.md");
  const security = await read("../docs/SECURITY.md");
  const readme = await read("../README.md");
  assert.match(deployment, /MCP_OAUTH_PRODUCTION_READY=true/);
  assert.match(deployment, /StrictHostKeyChecking/);
  assert.match(security, /immutable 40-character/);
  assert.match(readme, /self-hosted OAuth 2.1 Authorization Code \+ PKCE/);
});


test("root deploy completes all read-only prerequisite checks before namespace or PVC mutation", async () => {
  const deploy = await read("../scripts/deploy-vps.sh");
  const secretCheck = deploy.indexOf('get secret "$OAUTH_SECRET"');
  const storageCheck = deploy.indexOf('get storageclass local-path');
  const issuerCheck = deploy.indexOf('if [[ "$ISSUER_READY" != "True" ]]');
  const namespaceApply = deploy.indexOf('"$' + '{KUBECTL[@]}" apply -f "$MANIFEST_DIR/namespace.yaml"');
  const pvcApply = deploy.indexOf('apply -f "$MANIFEST_DIR/oauth-pvc.yaml"');
  assert.ok(secretCheck > 0 && storageCheck > 0 && issuerCheck > 0);
  assert.ok(namespaceApply > secretCheck && namespaceApply > storageCheck && namespaceApply > issuerCheck);
  assert.ok(pvcApply > namespaceApply);
});

test("deploy workflow runs read-only preflight before image publication", async () => {
  const workflow = await read("../.github/workflows/deploy-vps.yml");
  const gate = workflow.indexOf("Validate immutable source and deployment gates");
  const preflight = workflow.indexOf("Run read-only VPS preflight before publishing");
  const build = workflow.indexOf("Build and publish immutable multi-architecture gateway image");
  assert.ok(gate > 0 && preflight > gate && build > preflight);
});


test("privileged installers and root deploy entrypoint reject SSH-user writes to trusted inputs", async () => {
  const rootInstaller = await read("../scripts/install-root-agent.sh");
  const deployInstaller = await read("../scripts/install-deploy-entrypoint.sh");
  const deploy = await read("../scripts/deploy-vps.sh");
  assert.ok(rootInstaller.includes("for trusted_path in /opt"));
  assert.ok(rootInstaller.includes("Existing vps-mcp group must use GID 34001"));
  assert.ok(rootInstaller.includes('sudo -u "$SUDO_USER" test -w "$trusted_path"'));
  assert.ok(deployInstaller.includes('for trusted_path in "/opt"'));
  assert.ok(deployInstaller.includes('"$REPO_DIR/.git"'));
  assert.ok(deploy.includes("Root deploy entrypoint must be a root-owned"));
  assert.ok(deploy.includes("for trusted_path in /opt"));
  assert.ok(deploy.includes('"$REPO_DIR/.git"'));
});
