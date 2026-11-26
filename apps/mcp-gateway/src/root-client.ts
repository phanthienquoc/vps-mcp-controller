import { request } from "node:http";
import type { Operation,AgentResponse } from "@vps-mcp/contracts";
const socketPath=process.env.ROOT_AGENT_SOCKET??"/run/vps-mcp/root-agent.sock";
export function callRootAgent(operation:Operation):Promise<AgentResponse>{
 return new Promise((resolve,reject)=>{
  const payload=JSON.stringify(operation);
  const req=request({socketPath,path:"/v1/execute",method:"POST",headers:{"content-type":"application/json","content-length":Buffer.byteLength(payload)},timeout:140000},res=>{
   let body="";res.setEncoding("utf8");res.on("data",(chunk:string)=>{body+=chunk;});
   res.on("end",()=>{
    try{const parsed=JSON.parse(body) as AgentResponse;if(res.statusCode&&res.statusCode>=400)reject(new Error(parsed.error??"Root agent request failed"));else if(!parsed.ok)reject(new Error(parsed.error??"Root agent operation failed"));else resolve(parsed);}
    catch(e){reject(e);}
   });
  });
  req.on("timeout",()=>req.destroy(new Error("Root agent request timed out")));req.on("error",reject);req.end(payload);
 });
}
