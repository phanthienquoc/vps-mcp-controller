import { createServer } from "node:http";
import { mkdir,chmod,chown,unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { operationSchema } from "@vps-mcp/contracts";
import { executeOperation } from "./operations.js";
const socketPath=process.env.ROOT_AGENT_SOCKET??"/run/vps-mcp/root-agent.sock";
const socketGid=Number(process.env.ROOT_AGENT_GID??"34001");
function audit(event:Record<string,unknown>):void{process.stdout.write(JSON.stringify({ts:new Date().toISOString(),component:"root-agent",...event})+"\n");}
function safeError(e:unknown):string{const m=e instanceof Error?e.message:"Unknown execution failure";return m.replace(/(token|password|secret|authorization)[=: ]+[^\s,;]+/gi,"$1=[REDACTED]").slice(0,500);}
const server=createServer(async(req,res)=>{
 const requestId=randomUUID();
 if(req.method!=="POST"||req.url!=="/v1/execute"){res.writeHead(404).end();return;}
 let body="";
 try{
  for await(const chunk of req){body+=chunk.toString();if(Buffer.byteLength(body)>16384)throw new Error("Request body too large");}
  const parsed=operationSchema.safeParse(JSON.parse(body));
  if(!parsed.success){res.writeHead(400,{"content-type":"application/json"}).end(JSON.stringify({error:"Invalid operation schema",requestId}));audit({requestId,outcome:"rejected",reason:"schema"});return;}
  const started=Date.now();const output=await executeOperation(parsed.data);const durationMs=Date.now()-started;
  audit({requestId,action:parsed.data.action,outcome:"success",durationMs});
  res.writeHead(200,{"content-type":"application/json"}).end(JSON.stringify({ok:true,action:parsed.data.action,output:output.slice(0,100000),durationMs,requestId}));
 }catch(e){const message=safeError(e);audit({requestId,outcome:"failure",error:message});res.writeHead(500,{"content-type":"application/json"}).end(JSON.stringify({ok:false,error:message,durationMs:0,requestId}));}
});
async function start():Promise<void>{
 await mkdir(dirname(socketPath),{recursive:true,mode:0o750});try{await unlink(socketPath);}catch{/* initial start */}
 server.listen(socketPath,async()=>{await chmod(socketPath,0o660);await chown(socketPath,0,socketGid);audit({outcome:"listening",socketPath,socketGid,uid:process.getuid?.()});});
}
async function shutdown(signal:string):Promise<void>{audit({outcome:"shutdown",signal});server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),5000).unref();}
process.on("SIGTERM",()=>void shutdown("SIGTERM"));process.on("SIGINT",()=>void shutdown("SIGINT"));
void start().catch(e=>{audit({outcome:"startup-failed",error:safeError(e)});process.exit(1);});
