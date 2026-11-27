import test from "node:test";
import assert from "node:assert/strict";
import { operationSchema } from "@vps-mcp/contracts";

const parse = (namespace, deployment) => operationSchema.safeParse({
  action: "k3s.rolloutRestart",
  namespace,
  deployment
});

test("rollout restart accepts only the MCP gateway in ops-prod", () => {
  assert.equal(parse("ops-prod", "vps-mcp-gateway").success, true);
  assert.equal(parse("ops-prod", "unknown-deployment").success, false);
  assert.equal(parse("ops-prod", "tce-frontend").success, false);
});

test("rollout restart accepts only the two TCE deployments in tce-prod", () => {
  assert.equal(parse("tce-prod", "tce-frontend").success, true);
  assert.equal(parse("tce-prod", "tce-service").success, true);
  assert.equal(parse("tce-prod", "unknown-deployment").success, false);
  assert.equal(parse("tce-prod", "stock-backend").success, false);
});

test("rollout restart rejects all other namespaces", () => {
  assert.equal(parse("kube-system", "coredns").success, false);
  assert.equal(parse("stock-prod", "stock-backend").success, false);
  assert.equal(parse("media-prod", "media-generation").success, false);
});

test("systemd restart remains restricted to cron", () => {
  assert.equal(operationSchema.safeParse({ action: "systemd.restart", unit: "cron" }).success, true);
  assert.equal(operationSchema.safeParse({ action: "systemd.restart", unit: "ssh" }).success, false);
  assert.equal(operationSchema.safeParse({ action: "systemd.restart", unit: "vps-root-agent" }).success, false);
});
