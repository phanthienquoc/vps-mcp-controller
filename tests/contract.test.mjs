import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { operationSchema, inspectableUnits, restartableUnits, managedNamespaces } from "../packages/contracts/dist/index.js";

const deployScript = readFileSync(new URL("../scripts/deploy-vps.sh", import.meta.url), "utf8");
const deployInstaller = readFileSync(new URL("../scripts/install-deploy-entrypoint.sh", import.meta.url), "utf8");
const rootInstaller = readFileSync(new URL("../scripts/install-root-agent.sh", import.meta.url), "utf8");
const preflightScript = readFileSync(new URL("../scripts/preflight-vps.sh", import.meta.url), "utf8");
const deployWorkflow = readFileSync(new URL("../.github/workflows/deploy-vps.yml", import.meta.url), "utf8");

test("host status is accepted", () => {
  assert.equal(operationSchema.safeParse({ action: "host.status" }).success, true);
});

test("read-only systemd inspection is constrained to known unit names", () => {
  assert.equal(operationSchema.safeParse({ action: "systemd.status", unit: "k3s" }).success, true);
  assert.equal(operationSchema.safeParse({ action: "systemd.status", unit: "attacker.service" }).success, true);
  assert.deepEqual(inspectableUnits.includes("attacker.service"), false);
});

test("systemd restart only permits cron", () => {
  assert.equal(operationSchema.safeParse({ action: "systemd.restart", unit: "cron" }).success, true);
  assert.equal(operationSchema.safeParse({ action: "systemd.restart", unit: "ssh" }).success, false);
  assert.deepEqual(restartableUnits, ["cron"]);
});

test("rollout restart is restricted to approved namespaces", () => {
  assert.equal(operationSchema.safeParse({ action: "k3s.rolloutRestart", namespace: "ops-prod", deployment: "vps-mcp-gateway" }).success, true);
  assert.equal(operationSchema.safeParse({ action: "k3s.rolloutRestart", namespace: "tce-prod", deployment: "tce-frontend" }).success, true);
  assert.equal(operationSchema.safeParse({ action: "k3s.rolloutRestart", namespace: "stock-prod", deployment: "stock-backend" }).success, false);
  assert.equal(operationSchema.safeParse({ action: "k3s.rolloutRestart", namespace: "media-prod", deployment: "media-generation" }).success, false);
  assert.deepEqual(managedNamespaces, ["ops-prod", "tce-prod"]);
});

test("journal line count is bounded", () => {
  assert.equal(operationSchema.safeParse({ action: "systemd.journal", unit: "k3s", lines: 300 }).success, true);
  assert.equal(operationSchema.safeParse({ action: "systemd.journal", unit: "k3s", lines: 301 }).success, false);
});

test("deploy entrypoint requires a root-owned checkout and a commit reachable from origin/master", () => {
  assert.ok(deployScript.includes('REPO_DIR="/opt/vps-mcp-controller"'));
  assert.ok(deployScript.includes("for trusted_path in /opt"));
  assert.ok(deployScript.includes('sudo -u "$DEPLOY_CALLER" test -w "$trusted_path"'));
  assert.ok(deployScript.includes('"$REPO_DIR/.git"'));
  assert.ok(deployScript.includes("Root deploy entrypoint must be a root-owned"));
  assert.ok(deployScript.includes("stat -c '%U:%G' \"$REPO_DIR\""));
  assert.ok(deployScript.includes('git -C "$REPO_DIR" fetch --no-tags --prune origin'));
  assert.ok(deployScript.includes('git -C "$REPO_DIR" merge-base --is-ancestor "$SHA" refs/remotes/origin/master'));
  assert.ok(deployScript.includes('git -C "$REPO_DIR" archive --format=tar "$SHA" deploy/k3s'));
});

test("GHCR pull secret is built from a private temporary config file, not a process argument", () => {
  assert.ok(deployScript.includes("os.open(sys.argv[1], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)"));
  assert.ok(deployScript.includes("--from-file=.dockerconfigjson="));
  assert.equal(deployScript.includes("--docker-password"), false);
  assert.equal(deployScript.includes("docker login"), false);
});

test("deploy workflow pins one SHA and streams GHCR credentials to the root entrypoint", () => {
  assert.ok(deployWorkflow.includes('test "$(git rev-parse HEAD)" = "$GITHUB_SHA"'));
  assert.ok(deployWorkflow.includes("vps-mcp-controller:" + "$" + "{GITHUB_SHA}"));
  assert.ok(deployWorkflow.includes('printf \'%s\' "$GHCR_READ_TOKEN" |'));
  assert.ok(deployWorkflow.includes("sudo -n /usr/local/sbin/vps-mcp-deploy '$GITHUB_SHA'"));
  assert.equal(deployWorkflow.includes("git -C /opt/vps-mcp-controller"), false);
});

test("privileged installers and preflight enforce root-owned deployment sources", () => {
  assert.ok(deployInstaller.includes('EXPECTED_REPO_DIR="/opt/vps-mcp-controller"'));
  assert.ok(deployInstaller.includes('for trusted_path in "/opt"'));
  assert.ok(deployInstaller.includes('sudo -u "$DEPLOY_USER" test -w "$trusted_path"'));
  assert.ok(deployInstaller.includes('"$REPO_DIR/.git"'));
  assert.ok(rootInstaller.includes("for trusted_path in /opt"));
  assert.ok(rootInstaller.includes('sudo -u "$SUDO_USER" test -w "$trusted_path"'));
  assert.ok(rootInstaller.includes('find "$INSTALL_DIR"'));
  assert.ok(preflightScript.includes("CHECK_USER="));
  assert.ok(preflightScript.includes('check_trusted_path "$REPO_DIR/deploy/k3s"'));
});
