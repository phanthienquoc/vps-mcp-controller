import { z } from "zod";
const unitName = z.string().regex(/^[a-zA-Z0-9_.@-]{1,80}$/);
const resourceName = z.string().regex(/^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/).max(253);
export const operationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("host.status") }),
  z.object({ action: z.literal("systemd.status"), unit: unitName }),
  z.object({ action: z.literal("systemd.journal"), unit: unitName, lines: z.number().int().min(1).max(300).default(100) }),
  z.object({ action: z.literal("systemd.restart"), unit: z.literal("cron") }),
  z.object({ action: z.literal("containerd.status") }),
  z.object({ action: z.literal("k3s.pods") }),
  z.object({ action: z.literal("k3s.rolloutRestart"), namespace: z.enum(["ops-prod", "tce-prod"]), deployment: resourceName })
]);
export type Operation = z.infer<typeof operationSchema>;
export type AgentResponse = { ok:boolean; action?:string; output?:string; error?:string; durationMs:number; requestId:string };
export const inspectableUnits = ["k3s","containerd","docker","ssh","cron","vps-root-agent"] as const;
export const restartableUnits = ["cron"] as const;
export const managedNamespaces = ["ops-prod","tce-prod"] as const;
