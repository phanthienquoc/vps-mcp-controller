import test from "node:test";
import assert from "node:assert/strict";
import { readBearerToken, tokenHasScopes, protectedResourceMetadata } from "../apps/mcp-gateway/dist/auth.js";

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
