import assert from "node:assert/strict";
import { after, test } from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";

const dataDir = mkdtempSync(join(tmpdir(), "vps-mcp-oauth-limits-"));
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.MCP_AUTH_DB_PATH = join(dataDir, "auth.sqlite");
process.env.MCP_BOOTSTRAP_EMAIL = "admin@example.test";
process.env.MCP_BOOTSTRAP_PASSWORD = "test-password-at-least-fourteen";
process.env.MCP_OAUTH_ISSUER = "https://mcp.mrcute.space";
process.env.MCP_RESOURCE_URL = "https://mcp.mrcute.space/mcp";
process.env.MCP_OAUTH_SIGNING_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
process.env.MCP_OAUTH_DCR_LIMIT = "2";
process.env.MCP_OAUTH_AUTHORIZE_LIMIT = "2";
process.env.MCP_OAUTH_TOKEN_LIMIT = "2";
process.env.MCP_OAUTH_REVOKE_LIMIT = "2";
process.env.MCP_OAUTH_CONSENT_LIMIT = "2";

const { createLocalOAuthRouter } = await import("../apps/mcp-gateway/dist/oauth-server.js");
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(await createLocalOAuthRouter());
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.once("listening", resolve);
});
const address = server.address();
assert.ok(address && typeof address === "object");
const baseUrl = "http://127.0.0.1:" + address.port;
let registeredClientId;

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  rmSync(dataDir, { recursive: true, force: true });
});

async function post(path, body, spoofedIp) {
  return fetch(baseUrl + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": spoofedIp
    },
    body: JSON.stringify(body)
  });
}

test("DCR rate limit is persistent and cannot be bypassed with spoofed X-Forwarded-For", async () => {
  const body = { redirect_uris: ["https://client.example/callback"], token_endpoint_auth_method: "none" };
  const first = await post("/oauth/register", body, "198.51.100.1");
  assert.equal(first.status, 201);
  registeredClientId = (await first.json()).client_id;
  assert.ok(typeof registeredClientId === "string" && registeredClientId.length > 0);
  assert.equal((await post("/oauth/register", body, "198.51.100.2")).status, 201);
  const limited = await post("/oauth/register", body, "198.51.100.3");
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  assert.equal((await limited.json()).error, "rate_limited");

  // Keep registration and revocation in the same test: the revocation
  // fixture must be created before it is used, independent of test scheduling.
  const revokeBody = { client_id: registeredClientId, token: "unknown" };
  assert.equal((await post("/oauth/revoke", revokeBody, "192.0.2.1")).status, 200);
  assert.equal((await post("/oauth/revoke", revokeBody, "192.0.2.2")).status, 200);
  const revokeLimited = await post("/oauth/revoke", revokeBody, "192.0.2.3");
  assert.equal(revokeLimited.status, 429);
  assert.ok(Number(revokeLimited.headers.get("retry-after")) > 0);
});

test("authorization and token endpoints have independent request limits", async () => {
  const authorizeUrl = baseUrl + "/oauth/authorize?client_id=unknown";
  assert.equal((await fetch(authorizeUrl)).status, 400);
  assert.equal((await fetch(authorizeUrl)).status, 400);
  const authorizeLimited = await fetch(authorizeUrl);
  assert.equal(authorizeLimited.status, 429);

  const tokenBody = { grant_type: "authorization_code", client_id: "unknown" };
  assert.equal((await post("/oauth/token", tokenBody, "203.0.113.1")).status, 401);
  assert.equal((await post("/oauth/token", tokenBody, "203.0.113.2")).status, 401);
  const tokenLimited = await post("/oauth/token", tokenBody, "203.0.113.3");
  assert.equal(tokenLimited.status, 429);
});


test("consent endpoint has an independent persistent request limit", async () => {
  const body = { transaction: "x".repeat(43) };
  const first = await post("/oauth/consent", body, "198.51.100.11");
  assert.equal(first.status, 403);
  const second = await post("/oauth/consent", body, "198.51.100.12");
  assert.equal(second.status, 403);
  const limited = await post("/oauth/consent", body, "198.51.100.13");
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
});
