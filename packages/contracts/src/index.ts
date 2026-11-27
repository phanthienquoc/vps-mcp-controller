import { z } from "zod";
const unitName = z.string().regex(/^[a-zA-Z0-9_.@-]{1,80}$/);
export const operationSchema = z.union([
  z.object({ action: z.literal("host.status") }),
  z.object({ action: z.literal("systemd.status"), unit: unitName }),
  z.object({ action: z.literal("systemd.journal"), unit: unitName, lines: z.number().int().min(1).max(300).default(100) }),
  z.object({ action: z.literal("systemd.restart"), unit: z.literal("cron") }),
  z.object({ action: z.literal("containerd.status") }),
  z.object({ action: z.literal("k3s.pods") }),
  z.object({ action: z.literal("k3s.rolloutRestart"), namespace: z.literal("ops-prod"), deployment: z.literal("vps-mcp-gateway") }),
  z.object({ action: z.literal("k3s.rolloutRestart"), namespace: z.literal("tce-prod"), deployment: z.enum(["tce-frontend", "tce-service"]) })
]);
export type Operation = z.infer<typeof operationSchema>;
export type AgentResponse = { ok:boolean; action?:string; output?:string; error?:string; durationMs:number; requestId:string };
export const inspectableUnits = ["k3s","containerd","docker","ssh","cron","vps-root-agent"] as const;
export const restartableUnits = ["cron"] as const;
export const managedNamespaces = ["ops-prod","tce-prod"] as const;
export const managedDeployments = {
  "ops-prod": ["vps-mcp-gateway"],
  "tce-prod": ["tce-frontend", "tce-service"]
} as const;
