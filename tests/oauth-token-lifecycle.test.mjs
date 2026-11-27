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
const { publicKey: previousPublicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const previousJwk = { ...previousPublicKey.export({ format: "jwk" }), use: "sig", alg: "RS256", kid: "oauth-previous-test-key" };
process.env.MCP_AUTH_DB_PATH = join(dataDir, "auth.sqlite");
process.env.MCP_BOOTSTRAP_EMAIL = "admin@example.test";
process.env.MCP_BOOTSTRAP_PASSWORD = "test-password-at-least-fourteen";
process.env.MCP_OAUTH_ISSUER = "https://mcp.mrcute.space";
process.env.MCP_RESOURCE_URL = "https://mcp.mrcute.space/mcp";
process.env.MCP_OAUTH_SIGNING_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
process.env.MCP_OAUTH_SIGNING_KID = "oauth-lifecycle-test-key";
// Keep the shared lifecycle fixture independent of the production DCR throttle.
process.env.MCP_OAUTH_DCR_LIMIT = "1000";
process.env.MCP_OAUTH_PREVIOUS_PUBLIC_KEYS = JSON.stringify([previousJwk]);

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

async function registerClient(redirectUri = "https://client.example/callback") {
  const response = await fetch(baseUrl + "/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      token_endpoint_auth_method: "none"
    })
  });
  assert.equal(response.status, 201);
  return (await response.json()).client_id;
}

async function authorizeAndGetCode(clientId, redirectUri = "https://client.example/callback") {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = pkceS256(verifier);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
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
  assert.match(cookie, /^__Host-mcp_session=/);
  assert.match(login.headers.get("set-cookie") ?? "", /; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=28800$/);
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
  assert.equal(callback.origin, new URL(redirectUri).origin);
  assert.equal(callback.pathname, new URL(redirectUri).pathname);
  assert.equal(callback.searchParams.get("state"), "lifecycle-state");
  assert.equal(callback.searchParams.get("iss"), issuer);
  return { code: callback.searchParams.get("code"), verifier };
}

async function exchangeCode(clientId, code, verifier, redirectUri = "https://client.example/callback") {
  return postForm("/oauth/token", {
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
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
  assert.equal(metadata.authorization_response_iss_parameter_supported, false);

  const jwks = await (await fetch(baseUrl + "/oauth/jwks.json")).json();
  assert.equal(jwks.keys.length, 2);
  assert.equal(jwks.keys[0].kid, "oauth-lifecycle-test-key");
  assert.equal(jwks.keys[1].kid, "oauth-previous-test-key");
  assert.equal(jwks.keys[1].d, undefined);
  assert.ok(await importJWK(jwks.keys[1], "RS256"));
  assert.equal(jwks.keys[0].alg, "RS256");
  assert.equal(jwks.keys[0].use, "sig");
  assert.equal(jwks.keys[0].d, undefined);
});


test("preserves ChatGPT callback-ID redirect URI exactly through DCR and authorization", async () => {
  const redirectUri = "https://chatgpt.com/connector/oauth/callback_7f3a9";
  const clientId = await registerClient(redirectUri);
  const { code, verifier } = await authorizeAndGetCode(clientId, redirectUri);
  const callback = await exchangeCode(clientId, code, verifier, redirectUri);
  assert.equal(callback.status, 200);
  assert.ok((await callback.json()).access_token);
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

test("token exchange preserves a valid code after client, redirect URI or resource binding failures", async () => {
  const clientId = await registerClient();
  const otherClientId = await registerClient();
  const { code, verifier } = await authorizeAndGetCode(clientId);

  const invalidAttempts = [
    { client_id: otherClientId, redirect_uri: "https://client.example/callback", resource },
    { client_id: clientId, redirect_uri: "https://attacker.example/callback", resource },
    { client_id: clientId, redirect_uri: "https://client.example/callback", resource: "https://other.example/mcp" }
  ];
  for (const attempt of invalidAttempts) {
    const response = await postForm("/oauth/token", {
      grant_type: "authorization_code",
      client_id: attempt.client_id,
      code,
      redirect_uri: attempt.redirect_uri,
      code_verifier: verifier,
      resource: attempt.resource
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "invalid_grant");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("pragma"), "no-cache");
  }

  const valid = await exchangeCode(clientId, code, verifier);
  assert.equal(valid.status, 200);
  assert.ok((await valid.json()).access_token);
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

test("revocation is bound to its public client and removes the complete refresh-token family", async () => {
  const clientId = await registerClient();
  const otherClientId = await registerClient();
  const { code, verifier } = await authorizeAndGetCode(clientId);
  const initial = await exchangeCode(clientId, code, verifier);
  assert.equal(initial.status, 200);
  const tokens = await initial.json();
  const rotatedResponse = await exchangeRefresh(clientId, tokens.refresh_token);
  assert.equal(rotatedResponse.status, 200);
  const rotated = await rotatedResponse.json();

  const wrongClient = await postForm("/oauth/revoke", {
    client_id: otherClientId,
    token: rotated.refresh_token
  });
  assert.equal(wrongClient.status, 200);
  const stillValid = await exchangeRefresh(clientId, rotated.refresh_token);
  assert.equal(stillValid.status, 200);
  const latest = await stillValid.json();

  const revoke = await postForm("/oauth/revoke", {
    client_id: clientId,
    token: latest.refresh_token
  });
  assert.equal(revoke.status, 200);
  assert.equal(revoke.headers.get("cache-control"), "no-store");
  assert.equal(revoke.headers.get("pragma"), "no-cache");
  for (const token of [tokens.refresh_token, rotated.refresh_token, latest.refresh_token]) {
    const afterRevoke = await exchangeRefresh(clientId, token);
    assert.equal(afterRevoke.status, 400);
    assert.equal((await afterRevoke.json()).error, "invalid_grant");
  }
});

test("rejects browser login, consent and logout POSTs without an exact Origin", async () => {
  for (const route of ["/oauth/login", "/oauth/consent", "/oauth/logout"]) {
    const response = await fetch(baseUrl + route, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ transaction: "x".repeat(43) })
    });
    assert.equal(response.status, 403, route + " must reject missing Origin");
  }
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


test("rejects unsupported DCR grants, response types and public-client authentication methods", async () => {
  const base = { redirect_uris: ["https://client.example/callback"] };
  const invalidMetadata = [
    { ...base, grant_types: ["authorization_code", "password"] },
    { ...base, grant_types: ["client_credentials"] },
    { ...base, response_types: ["token"] },
    { ...base, response_types: ["code", "token"] },
    { ...base, token_endpoint_auth_method: "client_secret_post" },
    { ...base, token_endpoint_auth_method: "private_key_jwt" },
    { ...base, redirect_uris: ["https://client.example/callback", "https://client.example/callback"] }
  ];

  for (const metadata of invalidMetadata) {
    const response = await fetch(baseUrl + "/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(metadata)
    });
    assert.equal(response.status, 400, JSON.stringify(metadata));
    assert.equal((await response.json()).error, "invalid_client_metadata");
  }
});

test("accepts only the supported public authorization-code client profile", async () => {
  const response = await fetch(baseUrl + "/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      redirect_uris: ["https://client.example/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none"
    })
  });
  assert.equal(response.status, 201);
  const client = await response.json();
  assert.equal(client.token_endpoint_auth_method, "none");
  assert.deepEqual(client.grant_types, ["authorization_code", "refresh_token"]);
  assert.deepEqual(client.response_types, ["code"]);
});

test("authorization code can be consumed only once under concurrent token exchanges", async () => {
  const clientId = await registerClient();
  const { code, verifier } = await authorizeAndGetCode(clientId);
  const responses = await Promise.all([
    exchangeCode(clientId, code, verifier),
    exchangeCode(clientId, code, verifier)
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 400]);
});

test("concurrent refresh-token reuse revokes the token family", async () => {
  const clientId = await registerClient();
  const { code, verifier } = await authorizeAndGetCode(clientId);
  const initial = await exchangeCode(clientId, code, verifier);
  assert.equal(initial.status, 200);
  const tokens = await initial.json();

  const responses = await Promise.all([
    exchangeRefresh(clientId, tokens.refresh_token),
    exchangeRefresh(clientId, tokens.refresh_token)
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 400]);
  // The reused token invalidates the complete family, including the winning rotated token.
  const bodies = await Promise.all(responses.map(async (response) => response.status === 200 ? response.json() : null));
  const rotated = bodies.find(Boolean);
  assert.ok(rotated?.refresh_token);
  const familyRevoked = await exchangeRefresh(clientId, rotated.refresh_token);
  assert.equal(familyRevoked.status, 400);
});


test("DCR follows RFC 7591 default grant and enforces registered grant types", async () => {
  const registration = await fetch(baseUrl + "/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: ["https://client.example/callback"] })
  });
  assert.equal(registration.status, 201);
  const client = await registration.json();
  assert.deepEqual(client.grant_types, ["authorization_code"]);

  const { code, verifier } = await authorizeAndGetCode(client.client_id);
  const access = await exchangeCode(client.client_id, code, verifier);
  assert.equal(access.status, 200);
  const tokens = await access.json();
  assert.ok(tokens.access_token);
  assert.equal(tokens.refresh_token, undefined);

  const refresh = await postForm("/oauth/token", {
    grant_type: "refresh_token",
    client_id: client.client_id,
    refresh_token: "not-issued"
  });
  assert.equal(refresh.status, 400);
  assert.equal((await refresh.json()).error, "unauthorized_client");
});
