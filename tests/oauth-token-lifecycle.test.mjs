import assert from "node:assert/strict";
import { after, test } from "node:test";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { importJWK, jwtVerify } from "jose";

const dataDir = mkdtempSync(join(tmpdir(), "vps-mcp-oauth-lifecycle-"));
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.MCP_AUTH_DB_PATH = join(dataDir, "auth.sqlite");
process.env.MCP_BOOTSTRAP_EMAIL = "admin@example.test";
process.env.MCP_BOOTSTRAP_PASSWORD = "test-password-at-least-fourteen";
process.env.MCP_OAUTH_ISSUER = "https://mcp.mrcute.space";
process.env.MCP_RESOURCE_URL = "https://mcp.mrcute.space/mcp";
process.env.MCP_OAUTH_SIGNING_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
process.env.MCP_OAUTH_SIGNING_KID = "oauth-lifecycle-test-key";

const { createLocalOAuthRouter } = await import("../apps/mcp-gateway/dist/oauth-server.js");
const { pkceS256 } = await import("../apps/mcp-gateway/dist/oauth-helpers.js");
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
const issuer = "https://mcp.mrcute.space";
const resource = "https://mcp.mrcute.space/mcp";

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  rmSync(dataDir, { recursive: true, force: true });
});

async function postForm(path, values) {
  return fetch(baseUrl + path, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: issuer
    },
    body: new URLSearchParams(values)
  });
}

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

async function authorizeAndGetCode(clientId) {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = pkceS256(verifier);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: "https://client.example/callback",
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: challenge,
    resource,
    scope: "mcp:tools",
    state: "lifecycle-state"
  });
  const authorize = await fetch(baseUrl + "/oauth/authorize?" + params.toString(), { redirect: "manual" });
  assert.equal(authorize.status, 200);
  const loginHtml = await authorize.text();
  const loginTransaction = loginHtml.match(/name="transaction" value="([A-Za-z0-9_-]{43})"/)?.[1];
  assert.ok(loginTransaction, "login form must contain an opaque transaction handle");

  const login = await postForm("/oauth/login", {
    transaction: loginTransaction,
    email: "admin@example.test",
    password: "test-password-at-least-fourteen"
  });
  assert.equal(login.status, 303);
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  assert.match(cookie, /^mcp_session=/);
  const consentPage = await fetch(new URL(login.headers.get("location"), baseUrl), { headers: { cookie } });
  assert.equal(consentPage.status, 200);
  const consentHtml = await consentPage.text();
  const consentTransaction = consentHtml.match(/name="transaction" value="([A-Za-z0-9_-]{43})"/)?.[1];
  assert.ok(consentTransaction, "consent form must contain an opaque transaction handle");

  const consent = await fetch(baseUrl + "/oauth/consent", {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: issuer,
      cookie
    },
    body: new URLSearchParams({ transaction: consentTransaction })
  });
  assert.equal(consent.status, 303);
  const callback = new URL(consent.headers.get("location"));
  assert.equal(callback.origin, "https://client.example");
  assert.equal(callback.pathname, "/callback");
  assert.equal(callback.searchParams.get("state"), "lifecycle-state");
  assert.equal(callback.searchParams.get("iss"), issuer);
  return { code: callback.searchParams.get("code"), verifier };
}

async function exchangeCode(clientId, code, verifier) {
  return postForm("/oauth/token", {
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    redirect_uri: "https://client.example/callback",
    code_verifier: verifier,
    resource
  });
}

async function exchangeRefresh(clientId, refreshToken) {
  return postForm("/oauth/token", {
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: refreshToken
  });
}

test("publishes OAuth metadata and JWKS with the configured issuer and key id", async () => {
  const metadata = await (await fetch(baseUrl + "/.well-known/oauth-authorization-server")).json();
  assert.equal(metadata.issuer, issuer);
  assert.equal(metadata.authorization_endpoint, issuer + "/oauth/authorize");
  assert.equal(metadata.token_endpoint, issuer + "/oauth/token");
  assert.equal(metadata.registration_endpoint, issuer + "/oauth/register");
  assert.equal(metadata.revocation_endpoint, issuer + "/oauth/revoke");
  assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
  assert.deepEqual(metadata.token_endpoint_auth_methods_supported, ["none"]);

  const jwks = await (await fetch(baseUrl + "/oauth/jwks.json")).json();
  assert.equal(jwks.keys.length, 1);
  assert.equal(jwks.keys[0].kid, "oauth-lifecycle-test-key");
  assert.equal(jwks.keys[0].alg, "RS256");
  assert.equal(jwks.keys[0].use, "sig");
  assert.equal(jwks.keys[0].d, undefined);
});

test("completes DCR, login, consent, PKCE token exchange and validates the signed access token", async () => {
  const clientId = await registerClient();
  const { code, verifier } = await authorizeAndGetCode(clientId);

  const wrongVerifier = await exchangeCode(clientId, code, "x".repeat(43));
  assert.equal(wrongVerifier.status, 400);
  assert.equal((await wrongVerifier.json()).error, "invalid_grant");

  const tokenResponse = await exchangeCode(clientId, code, verifier);
  assert.equal(tokenResponse.status, 200);
  assert.equal(tokenResponse.headers.get("cache-control"), "no-store");
  const tokens = await tokenResponse.json();
  assert.equal(tokens.token_type, "Bearer");
  assert.equal(tokens.expires_in, 300);
  assert.equal(tokens.scope, "mcp:tools");
  assert.ok(tokens.access_token);
  assert.ok(tokens.refresh_token);

  const jwks = await (await fetch(baseUrl + "/oauth/jwks.json")).json();
  const publicKey = await importJWK(jwks.keys[0], "RS256");
  const verified = await jwtVerify(tokens.access_token, publicKey, {
    issuer,
    audience: resource,
    algorithms: ["RS256"]
  });
  assert.equal(verified.payload.scope, "mcp:tools");
  assert.ok(verified.payload.sub);
  assert.ok(Number(verified.payload.exp) - Number(verified.payload.iat) <= 300);

  const replay = await exchangeCode(clientId, code, verifier);
  assert.equal(replay.status, 400);
  assert.equal((await replay.json()).error, "invalid_grant");
});

test("rotates refresh tokens and revokes the entire family when a consumed token is reused", async () => {
  const clientId = await registerClient();
  const { code, verifier } = await authorizeAndGetCode(clientId);
  const initial = await exchangeCode(clientId, code, verifier);
  assert.equal(initial.status, 200);
  const first = await initial.json();

  const rotatedResponse = await exchangeRefresh(clientId, first.refresh_token);
  assert.equal(rotatedResponse.status, 200);
  const rotated = await rotatedResponse.json();
  assert.notEqual(rotated.refresh_token, first.refresh_token);

  const reuse = await exchangeRefresh(clientId, first.refresh_token);
  assert.equal(reuse.status, 400);
  assert.equal((await reuse.json()).error, "invalid_grant");

  const familyRevoked = await exchangeRefresh(clientId, rotated.refresh_token);
  assert.equal(familyRevoked.status, 400);
  assert.equal((await familyRevoked.json()).error, "invalid_grant");
});

test("revokes a refresh token and rejects subsequent use", async () => {
  const clientId = await registerClient();
  const { code, verifier } = await authorizeAndGetCode(clientId);
  const initial = await exchangeCode(clientId, code, verifier);
  assert.equal(initial.status, 200);
  const tokens = await initial.json();

  const revoke = await postForm("/oauth/revoke", { token: tokens.refresh_token });
  assert.equal(revoke.status, 200);
  const afterRevoke = await exchangeRefresh(clientId, tokens.refresh_token);
  assert.equal(afterRevoke.status, 400);
  assert.equal((await afterRevoke.json()).error, "invalid_grant");
});

test("rejects DCR registrations with non-HTTPS or malformed redirect URIs", async () => {
  for (const redirectUri of ["http://client.example/callback", "javascript:alert(1)", "https://user:pass@client.example/callback"]) {
    const response = await fetch(baseUrl + "/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: [redirectUri], token_endpoint_auth_method: "none" })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "invalid_client_metadata");
  }
});
