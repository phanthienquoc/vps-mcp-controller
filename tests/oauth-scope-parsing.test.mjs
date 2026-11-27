import test from "node:test";
import assert from "node:assert/strict";
import { parseOAuthScopes } from "../apps/mcp-gateway/dist/oauth-helpers.js";

test("OAuth scopes are split on one or more whitespace characters", () => {
  assert.deepEqual(parseOAuthScopes("mcp:tools"), ["mcp:tools"]);
  assert.deepEqual(parseOAuthScopes("mcp:tools  "), ["mcp:tools"]);
  assert.deepEqual(parseOAuthScopes("mcp:tools\tother:scope"), ["mcp:tools", "other:scope"]);
  assert.deepEqual(parseOAuthScopes("  mcp:tools\nother:scope  "), ["mcp:tools", "other:scope"]);
  assert.deepEqual(parseOAuthScopes("   "), []);
});
