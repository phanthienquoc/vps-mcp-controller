import test from "node:test";
import assert from "node:assert/strict";
import { operationSchema, inspectableUnits, restartableUnits, managedNamespaces } from "../packages/contracts/dist/index.js";

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
