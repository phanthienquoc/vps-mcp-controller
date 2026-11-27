import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import { generateKeyPair, exportJWK, SignJWT, createRemoteJWKSet } from "jose";
import { createOAuthMiddleware, readBearerToken, tokenHasScopes, protectedResourceMetadata } from "../apps/mcp-gateway/dist/auth.js";

const issuer = "https://identity.example.test";
const resource = "https://mcp.mrcute.space/mcp";
const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = await exportJWK(publicKey);
Object.assign(jwk, { kid: "middleware-test", alg: "RS256", use: "sig" });
const jwksServer = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "application/json", "cache-control": "public, max-age=60" });
  res.end(JSON.stringify({ keys: [jwk] }));
});
jwksServer.listen(0, "127.0.0.1");
await new Promise((resolve) => jwksServer.once("listening", resolve));
const jwksAddress = jwksServer.address();
const jwks = createRemoteJWKSet(new URL("http://127.0.0.1:" + jwksAddress.port));
const config = { issuer, resource, requiredScopes: ["mcp:tools"], jwks };
const app = express();
app.get("/mcp", createOAuthMiddleware(config), (_req, res) => res.json({ ok: true }));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const address = server.address();
const baseUrl = "http://127.0.0.1:" + address.port;

async function issueToken(claims = {}) {
  return new SignJWT({ scope: "mcp:tools", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "middleware-test", typ: "at+jwt" })
    .setIssuer(issuer).setSubject("user-123").setAudience(resource)
    .setIssuedAt().setExpirationTime("5m").sign(privateKey);
}
async function requestWithToken(token) {
  return fetch(baseUrl + "/mcp", { headers: { authorization: "Bearer " + token } });
}
test("OAuth middleware accepts a valid RS256 token for the exact resource and scope", async () => {
  const response = await requestWithToken(await issueToken());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});
test("OAuth middleware rejects wrong audience, missing scope, missing subject and expired tokens", async () => {
  const wrongAudience = await new SignJWT({ scope: "mcp:tools" }).setProtectedHeader({ alg: "RS256", kid: "middleware-test" })
    .setIssuer(issuer).setSubject("user-123").setAudience("https://other.example/mcp").setIssuedAt().setExpirationTime("5m").sign(privateKey);
  assert.equal((await requestWithToken(wrongAudience)).status, 401);
  assert.equal((await requestWithToken(await issueToken({ scope: "profile" }))).status, 401);
  const noSubject = await new SignJWT({ scope: "mcp:tools" }).setProtectedHeader({ alg: "RS256", kid: "middleware-test" })
    .setIssuer(issuer).setAudience(resource).setIssuedAt().setExpirationTime("5m").sign(privateKey);
  assert.equal((await requestWithToken(noSubject)).status, 401);
  const expired = await new SignJWT({ scope: "mcp:tools" }).setProtectedHeader({ alg: "RS256", kid: "middleware-test" })
    .setIssuer(issuer).setSubject("user-123").setAudience(resource).setIssuedAt().setExpirationTime("0s").sign(privateKey);
  assert.equal((await requestWithToken(expired)).status, 401);
});
test("OAuth middleware challenges missing credentials with protected-resource metadata", async () => {
  const response = await fetch(baseUrl + "/mcp");
  assert.equal(response.status, 401);
  assert.match(response.headers.get("www-authenticate") ?? "", /oauth-protected-resource/);
});

test("extracts a well-formed bearer token", () => {
  assert.equal(readBearerToken("Bearer abc.def-ghi_123"), "abc.def-ghi_123");
});

test("rejects malformed or missing bearer credentials", () => {
  assert.equal(readBearerToken(undefined), null);
  assert.equal(readBearerToken("Basic abc"), null);
  assert.equal(readBearerToken("Bearer token with spaces"), null);
});

test("requires every configured OAuth scope", () => {
  assert.equal(tokenHasScopes({ scope: "mcp:tools profile" }, ["mcp:tools"]), true);
  assert.equal(tokenHasScopes({ scope: "profile" }, ["mcp:tools"]), false);
  assert.equal(tokenHasScopes({ scp: ["mcp:tools", "profile"] }, ["mcp:tools"]), true);
});

test("does not accept partial scope matches", () => {
  assert.equal(tokenHasScopes({ scope: "mcp:tools-admin" }, ["mcp:tools"]), false);
});

test("publishes the protected resource and authorization server", () => {
  const metadata = protectedResourceMetadata({
    issuer: "https://identity.example.com",
    resource: "https://mcp.mrcute.space/mcp",
    requiredScopes: ["mcp:tools"],
    jwks: () => Promise.resolve({ keys: [] }),
  });
  assert.equal(metadata.resource, "https://mcp.mrcute.space/mcp");
  assert.deepEqual(metadata.authorization_servers, ["https://identity.example.com"]);
  assert.deepEqual(metadata.scopes_supported, ["mcp:tools"]);
});

test("cleanup middleware test servers", async () => {
  await Promise.all([new Promise((resolve) => server.close(resolve)), new Promise((resolve) => jwksServer.close(resolve))]);
});
