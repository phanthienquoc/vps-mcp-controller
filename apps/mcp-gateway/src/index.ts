import { timingSafeEqual,randomUUID } from "node:crypto";
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler,McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { callRootAgent } from "./root-client.js";
const token=process.env.MCP_BEARER_TOKEN;
const port=Number(process.env.PORT??"3000");
const publicHost=process.env.MCP_ALLOWED_HOST??"mcp.mrcute.space";
function audit(e:Record<string,unknown>):void{process.stdout.write(JSON.stringify({ts:new Date().toISOString(),component:"mcp-gateway",...e})+"\n");}
function authorized(header:string|undefined):boolean{
 if(!token||!header?.startsWith("Bearer "))return false;
 const supplied=Buffer.from(header.slice(7));const expected=Buffer.from(token);
 return supplied.length===expected.length&&timingSafeEqual(supplied,expected);
}
const handler=createMcpHandler(()=>{
 const server=new McpServer({name:"vps-mcp-controller",version:"0.1.0"});
 server.registerTool("host_status",{description:"Read host CPU, memory, filesystem and uptime using fixed system commands.",inputSchema:z.object({})},async()=>{
  const id=randomUUID();try{const r=await callRootAgent({action:"host.status"});audit({requestId:id,tool:"host_status",outcome:"success",durationMs:r.durationMs});return{content:[{type:"text",text:r.output??"No output"}]};}
  catch(e){const m=e instanceof Error?e.message:"Host status failed";audit({requestId:id,tool:"host_status",outcome:"failure",error:m});return{isError:true,content:[{type:"text",text:m}]};}
 });
 server.registerTool("service_status",{description:"Inspect an allowlisted systemd unit; read-only.",inputSchema:z.object({unit:z.enum(["k3s","containerd","docker","ssh","cron","vps-root-agent"])})},async({unit})=>{
  const r=await callRootAgent({action:"systemd.status",unit});return{content:[{type:"text",text:r.output??"No output"}]};
 });
 server.registerTool("service_logs",{description:"Read recent journal entries from an allowlisted systemd unit.",inputSchema:z.object({unit:z.enum(["k3s","containerd","docker","ssh","cron","vps-root-agent"]),lines:z.number().int().min(1).max(300).default(100)})},async({unit,lines})=>{
  const r=await callRootAgent({action:"systemd.journal",unit,lines});return{content:[{type:"text",text:r.output??"No output"}]};
 });
 server.registerTool("restart_service",{description:"Restart only services in the root-agent restart allowlist: cron and vps-root-agent.",inputSchema:z.object({unit:z.enum(["cron","vps-root-agent"])})},async({unit})=>{
  const r=await callRootAgent({action:"systemd.restart",unit});return{content:[{type:"text",text:r.output??"No output"}]};
 });
 server.registerTool("containerd_status",{description:"Inspect containerd service state; read-only.",inputSchema:z.object({})},async()=>{
  const r=await callRootAgent({action:"containerd.status"});return{content:[{type:"text",text:r.output??"No output"}]};
 });
 server.registerTool("k3s_list_pods",{description:"List pods in all namespaces; read-only.",inputSchema:z.object({})},async()=>{
  const r=await callRootAgent({action:"k3s.pods"});return{content:[{type:"text",text:r.output??"No output"}]};
 });
 server.registerTool("k3s_restart_deployment",{description:"Restart and verify a deployment in ops-prod or tce-prod only. Stock and media namespaces are not enabled for autonomous mutation.",inputSchema:z.object({namespace:z.enum(["ops-prod","tce-prod"]),deployment:z.string().regex(/^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/).max(253)})},async({namespace,deployment})=>{
  const r=await callRootAgent({action:"k3s.rolloutRestart",namespace,deployment});return{content:[{type:"text",text:r.output??"No output"}]};
 });
 return server;
});
const app=createMcpExpressApp({host:"0.0.0.0",allowedHosts:[publicHost]});
app.get("/healthz",(_req,res)=>res.status(200).json({status:"ok",service:"vps-mcp-gateway"}));
const nodeHandler=toNodeHandler(handler);
app.all("/mcp",(req,res)=>{
 if(!authorized(req.header("authorization"))){res.setHeader("WWW-Authenticate",'Bearer realm="vps-mcp-controller"');res.status(401).json({error:"Unauthorized"});return;}
 void nodeHandler(req,res,req.body);
});
app.listen(port,"0.0.0.0",()=>audit({outcome:"listening",port,publicHost,auth:token?"bearer":"disabled"}));
