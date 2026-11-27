import { randomUUID } from "node:crypto";
import express from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { callRootAgent } from "./root-client.js";
import { createOAuthMiddleware, loadOAuthConfig, protectedResourceMetadata, protectedResourceMetadataUri } from "./auth.js";
import { createLocalOAuthRouter } from "./oauth-server.js";
import type { Operation } from "@vps-mcp/contracts";

const port = Number(process.env.PORT ?? "3000");
const publicHost = process.env.MCP_ALLOWED_HOST ?? "mcp.mrcute.space";

function createRestartOperation(
  namespace: "ops-prod" | "tce-prod",
  deployment: "vps-mcp-gateway" | "tce-frontend" | "tce-service"
): Operation {
  if (namespace === "ops-prod" && deployment === "vps-mcp-gateway") {
    return { action: "k3s.rolloutRestart", namespace, deployment };
  }
  if (namespace === "tce-prod" && (deployment === "tce-frontend" || deployment === "tce-service")) {
    return { action: "k3s.rolloutRestart", namespace, deployment };
  }
  throw new Error("Deployment is not in the namespace allowlist");
}

function audit(e: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), component: "mcp-gateway", ...e }) + "\n");
}

const oauth = loadOAuthConfig();
const requireOAuth = createOAuthMiddleware(oauth);
const handler = createMcpHandler(() => {
  const server = new McpServer({ name: "vps-mcp-controller", version: "0.1.0" });
  server.registerTool("host_status", { description: "Read host CPU, memory, filesystem and uptime using fixed system commands.", inputSchema: z.object({}) }, async () => {
    const id = randomUUID();
    try {
      const r = await callRootAgent({ action: "host.status" });
      audit({ requestId: id, tool: "host_status", outcome: "success", durationMs: r.durationMs });
      return { content: [{ type: "text", text: r.output ?? "No output" }] };
    } catch (e) {
      const m = e instanceof Error ? e.message : "Host status failed";
      audit({ requestId: id, tool: "host_status", outcome: "failure", error: m });
      return { isError: true, content: [{ type: "text", text: m }] };
    }
  });
  server.registerTool("service_status", { description: "Inspect an allowlisted systemd unit; read-only.", inputSchema: z.object({ unit: z.enum(["k3s", "containerd", "docker", "ssh", "cron", "vps-root-agent"]) }) }, async ({ unit }) => {
    const r = await callRootAgent({ action: "systemd.status", unit });
    return { content: [{ type: "text", text: r.output ?? "No output" }] };
  });
  server.registerTool("service_logs", { description: "Read recent journal entries from an allowlisted systemd unit.", inputSchema: z.object({ unit: z.enum(["k3s", "containerd", "docker", "ssh", "cron", "vps-root-agent"]), lines: z.number().int().min(1).max(300).default(100) }) }, async ({ unit, lines }) => {
    const r = await callRootAgent({ action: "systemd.journal", unit, lines });
    return { content: [{ type: "text", text: r.output ?? "No output" }] };
  });
  server.registerTool("restart_service", { description: "Restart cron only. Restarting the Root Agent from inside its own request would interrupt the response and is intentionally disabled.", inputSchema: z.object({ unit: z.enum(["cron"]) }) }, async ({ unit }) => {
    const r = await callRootAgent({ action: "systemd.restart", unit });
    return { content: [{ type: "text", text: r.output ?? "No output" }] };
  });
  server.registerTool("containerd_status", { description: "Inspect containerd service state; read-only.", inputSchema: z.object({}) }, async () => {
    const r = await callRootAgent({ action: "containerd.status" });
    return { content: [{ type: "text", text: r.output ?? "No output" }] };
  });
  server.registerTool("k3s_list_pods", { description: "List pods in all namespaces; read-only.", inputSchema: z.object({}) }, async () => {
    const r = await callRootAgent({ action: "k3s.pods" });
    return { content: [{ type: "text", text: r.output ?? "No output" }] };
  });
  const restartInput = z.discriminatedUnion("namespace", [
    z.object({ namespace: z.literal("ops-prod"), deployment: z.literal("vps-mcp-gateway") }),
    z.object({ namespace: z.literal("tce-prod"), deployment: z.enum(["tce-frontend", "tce-service"]) })
  ]);
  server.registerTool("k3s_restart_deployment", { description: "Restart only vps-mcp-gateway in ops-prod or tce-frontend/tce-service in tce-prod. Stock and media namespaces and all other deployments are denied.", inputSchema: restartInput }, async ({ namespace, deployment }) => {
    const r = await callRootAgent(createRestartOperation(namespace, deployment));
    return { content: [{ type: "text", text: r.output ?? "No output" }] };
  });
  return server;
});

const app = createMcpExpressApp({ host: "0.0.0.0", allowedHosts: [publicHost] });
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: false, limit: "16kb" }));
app.use(await createLocalOAuthRouter());
app.get("/healthz", (_req, res) => res.status(200).json({ status: "ok", service: "vps-mcp-gateway" }));
const resourceMetadataPath = protectedResourceMetadataUri(oauth);
app.get([resourceMetadataPath, "/.well-known/oauth-protected-resource"], (_req, res) =>
  res.status(200).json(protectedResourceMetadata(oauth))
);
const nodeHandler = toNodeHandler(handler);
app.all("/mcp", requireOAuth, (req, res) => {
  void nodeHandler(req, res, req.body);
});
app.listen(port, "0.0.0.0", () => audit({
  outcome: "listening",
  port,
  publicHost,
  auth: "self-hosted-oauth2-pkce",
  issuer: oauth.issuer,
  resource: oauth.resource,
}));
