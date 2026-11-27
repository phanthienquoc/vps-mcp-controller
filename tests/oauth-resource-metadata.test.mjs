import assert from "node:assert/strict";
import { after, test } from "node:test";
import express from "express";
import {
  createOAuthMiddleware,
  loadOAuthConfig,
  protectedResourceMetadata,
  protectedResourceMetadataUri
} from "../apps/mcp-gateway/dist/auth.js";

process.env.MCP_OAUTH_ISSUER = "https://mcp.mrcute.space";
process.env.MCP_RESOURCE_URL = "https://mcp.mrcute.space/mcp";

const config = loadOAuthConfig();
const app = express();
app.get("/mcp", createOAuthMiddleware(config), (_req, res) => res.status(204).end());
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.once("listening", resolve);
});
const address = server.address();
assert.ok(address && typeof address === "object");
const baseUrl = `http://127.0.0.1:${address.port}`;

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("uses the RFC 9728 path-specific metadata URI for a resource with a path", () => {
  assert.equal(
    protectedResourceMetadataUri(config),
    "https://mcp.mrcute.space/.well-known/oauth-protected-resource/mcp"
  );
});

test("uses the origin metadata URI when the resource identifier has no path", () => {
  assert.equal(
    protectedResourceMetadataUri({ resource: "https://resource.example/" }),
    "https://resource.example/.well-known/oauth-protected-resource"
  );
});

test("publishes metadata bound to the exact MCP resource and authorization server", () => {
  assert.deepEqual(protectedResourceMetadata(config), {
    resource: "https://mcp.mrcute.space/mcp",
    authorization_servers: ["https://mcp.mrcute.space"],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp:tools"]
  });
});

test("returns a Bearer challenge pointing to the path-specific metadata document", async () => {
  const response = await fetch(baseUrl + "/mcp");
  assert.equal(response.status, 401);
  assert.equal(
    response.headers.get("www-authenticate"),
    'Bearer resource_metadata="https://mcp.mrcute.space/.well-known/oauth-protected-resource/mcp", scope="mcp:tools"'
  );
  assert.deepEqual(await response.json(), { error: "unauthorized" });
});
