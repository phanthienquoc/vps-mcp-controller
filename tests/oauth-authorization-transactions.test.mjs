import assert from "node:assert/strict";
import { after, test } from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";

const dataDir = mkdtempSync(join(tmpdir(), "vps-mcp-oauth-"));
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.MCP_AUTH_DB_PATH = join(dataDir, "auth.sqlite");
process.env.MCP_BOOTSTRAP_EMAIL = "admin@example.test";
process.env.MCP_BOOTSTRAP_PASSWORD = "test-password-at-least-fourteen";
process.env.MCP_OAUTH_SIGNING_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
process.env.MCP_OAUTH_SIGNING_KID = "oauth-test-key";

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
const issuerOrigin = "https://mcp.mrcute.space";

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  rmSync(dataDir, { recursive: true, force: true });
});

async function registerClient() {
  const response = await fetch(baseUrl + "/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      redirect_uris: ["https://client.example/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      token_endpoint_auth_method: "none"
    })
  });
  assert.equal(response.status, 201);
  return (await response.json()).client_id;
}

function authorizationParams(clientId) {
  return new URLSearchParams({
    client_id: clientId,
    redirect_uri: "https://client.example/callback",
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: "A".repeat(43),
    resource: "https://mcp.mrcute.space/mcp",
    scope: "mcp:tools",
    state: "state-from-client"
  });
}

function transactionFrom(html) {
  const match = html.match(/name="transaction" value="([A-Za-z0-9_-]{43})"/);
  assert.ok(match, "form must contain an opaque server-side transaction token");
  return match[1];
}

async function postForm(path, form, origin = issuerOrigin, cookie) {
  const headers = { "content-type": "application/x-www-form-urlencoded" };
  if (origin) headers.origin = origin;
  if (cookie) headers.cookie = cookie;
  return fetch(baseUrl + path, {
    method: "POST",
    redirect: "manual",
    headers,
    body: form.toString()
  });
}

test("OAuth login and consent use tamper-resistant, same-origin, one-time transactions", async () => {
  const clientId = await registerClient();
  const params = authorizationParams(clientId);
  const authorize = await fetch(baseUrl + "/oauth/authorize?" + params.toString(), { redirect: "manual" });
  assert.equal(authorize.status, 200);
  const loginHtml = await authorize.text();
  const loginTransaction = transactionFrom(loginHtml);

  const crossOriginLogin = await postForm("/oauth/login", new URLSearchParams({
    transaction: loginTransaction,
    email: "admin@example.test",
    password: "test-password-at-least-fourteen"
  }), "https://attacker.example");
  assert.equal(crossOriginLogin.status, 403);

  const tamperedRequest = new URLSearchParams(params);
  tamperedRequest.set("redirect_uri", "https://attacker.example/steal");
  const failedLogin = await postForm("/oauth/login", new URLSearchParams({
    transaction: loginTransaction,
    request: Buffer.from(tamperedRequest.toString()).toString("base64url"),
    email: "admin@example.test",
    password: "wrong-password"
  }));
  assert.equal(failedLogin.status, 401);
  assert.match(await failedLogin.text(), /name="transaction"/);

  const login = await postForm("/oauth/login", new URLSearchParams({
    transaction: loginTransaction,
    request: Buffer.from(tamperedRequest.toString()).toString("base64url"),
    email: "admin@example.test",
    password: "test-password-at-least-fourteen"
  }));
  assert.equal(login.status, 303);
  const loginRedirect = new URL(login.headers.get("location"), baseUrl);
  assert.equal(loginRedirect.searchParams.get("redirect_uri"), "https://client.example/callback");
  const setCookie = login.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0];
  assert.match(cookie, /^__Host-mcp_session=/);

  const consentPage = await fetch(loginRedirect, { headers: { cookie } });
  assert.equal(consentPage.status, 200);
  const consentTransaction = transactionFrom(await consentPage.text());

  const crossOriginConsent = await postForm("/oauth/consent", new URLSearchParams({
    transaction: consentTransaction
  }), "https://attacker.example", cookie);
  assert.equal(crossOriginConsent.status, 403);

  const consent = await postForm("/oauth/consent", new URLSearchParams({
    transaction: consentTransaction,
    request: Buffer.from(tamperedRequest.toString()).toString("base64url")
  }), issuerOrigin, cookie);
  assert.equal(consent.status, 303);
  const callback = new URL(consent.headers.get("location"));
  assert.equal(callback.origin, "https://client.example");
  assert.equal(callback.pathname, "/callback");
  assert.ok(callback.searchParams.get("code"));
  assert.equal(callback.searchParams.get("state"), "state-from-client");
  assert.equal(callback.searchParams.get("iss"), issuerOrigin);

  const replayConsent = await postForm("/oauth/consent", new URLSearchParams({
    transaction: consentTransaction
  }), issuerOrigin, cookie);
  assert.equal(replayConsent.status, 400);

  const replayLogin = await postForm("/oauth/login", new URLSearchParams({
    transaction: loginTransaction,
    email: "admin@example.test",
    password: "test-password-at-least-fourteen"
  }));
  assert.equal(replayLogin.status, 400);
});

test("OAuth authorization rejects invalid PKCE challenges and scopes before showing a login form", async () => {
  const clientId = await registerClient();
  const badChallenge = authorizationParams(clientId);
  badChallenge.set("code_challenge", "A".repeat(44));
  const challengeResponse = await fetch(baseUrl + "/oauth/authorize?" + badChallenge.toString());
  assert.equal(challengeResponse.status, 400);
  assert.equal((await challengeResponse.json()).error, "invalid_request");

  const badScope = authorizationParams(clientId);
  badScope.set("scope", "mcp:tools other:scope");
  const scopeResponse = await fetch(baseUrl + "/oauth/authorize?" + badScope.toString());
  assert.equal(scopeResponse.status, 400);
  assert.equal((await scopeResponse.json()).error, "invalid_scope");
});
