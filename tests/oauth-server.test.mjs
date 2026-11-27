import test from "node:test";
import assert from "node:assert/strict";
import { pkceS256, verifyPkceS256, isAllowedRedirectUri } from "../apps/mcp-gateway/dist/oauth-helpers.js";

test("accepts valid PKCE S256 verifier/challenge pairs", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = pkceS256(verifier);
  assert.equal(verifyPkceS256(verifier, challenge), true);
});

test("rejects mismatched and malformed PKCE values", () => {
  assert.equal(verifyPkceS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", "not-a-challenge"), false);
  assert.equal(verifyPkceS256("short", "a".repeat(43)), false);
});

test("only allows exact HTTPS redirect URI registrations", () => {
  assert.equal(isAllowedRedirectUri("https://chatgpt.com/connector_platform_oauth_redirect"), true);
  assert.equal(isAllowedRedirectUri("http://chatgpt.com/callback"), false);
  assert.equal(isAllowedRedirectUri("javascript:alert(1)"), false);
  assert.equal(isAllowedRedirectUri("https://user:pass@example.com/callback"), false);
  assert.equal(isAllowedRedirectUri("https://example.com/callback#fragment"), false);
});
