import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Operation } from "@vps-mcp/contracts";
import { inspectableUnits, managedDeployments, restartableUnits } from "@vps-mcp/contracts";
const execFileAsync = promisify(execFile);
const env = { ...process.env, PATH:"/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", KUBECONFIG:"/etc/rancher/k3s/k3s.yaml" };
async function run(file:string,args:string[],timeout=12000):Promise<string>{
 const r=await execFileAsync(file,args,{timeout,maxBuffer:1048576,encoding:"utf8",env,windowsHide:true});
 return [r.stdout.trim(),r.stderr.trim()].filter(Boolean).join("\n");
}
function assertUnit(unit:string):void{
 if(!(inspectableUnits as readonly string[]).includes(unit)) throw new Error("Unit is not in inspection allowlist");
}
function assertDeployment(namespace:string,deployment:string):void{
 const allowed = managedDeployments[namespace as keyof typeof managedDeployments] as readonly string[] | undefined;
 if(!allowed?.includes(deployment)) throw new Error("Deployment is not in the namespace allowlist");
}
export async function executeOperation(op:Operation):Promise<string>{
 switch(op.action){
 case "host.status":{
  const v=await Promise.all([run("/usr/bin/uname",["-a"]),run("/usr/bin/uptime",["-p"]),run("/usr/bin/free",["-b"]),run("/usr/bin/df",["-P","-x","tmpfs","-x","devtmpfs"])]);
  return ["HOST",v[0],"UPTIME",v[1],"MEMORY",v[2],"FILESYSTEMS",v[3]].join("\n");
 }
 case "systemd.status": assertUnit(op.unit); return run("/usr/bin/systemctl",["show",op.unit,"--no-pager","--property=Id,ActiveState,SubState,LoadState,UnitFileState"]);
 case "systemd.journal": assertUnit(op.unit); return run("/usr/bin/journalctl",["-u",op.unit,"--no-pager","-n",String(op.lines),"--output=short-iso"]);
 case "systemd.restart":
  if(!(restartableUnits as readonly string[]).includes(op.unit)) throw new Error("Restart denied by policy");
  await run("/usr/bin/systemctl",["restart",op.unit],30000);
  return run("/usr/bin/systemctl",["show",op.unit,"--no-pager","--property=Id,ActiveState,SubState"]);
 case "containerd.status": return run("/usr/bin/systemctl",["show","containerd","--no-pager","--property=Id,ActiveState,SubState"]);
 case "k3s.pods": return run("/usr/local/bin/k3s",["kubectl","get","pods","--all-namespaces","-o","wide"],20000);
 case "k3s.rolloutRestart":
  assertDeployment(op.namespace,op.deployment);
  await run("/usr/local/bin/k3s",["kubectl","rollout","restart","deployment/"+op.deployment,"-n",op.namespace],30000);
  return run("/usr/local/bin/k3s",["kubectl","rollout","status","deployment/"+op.deployment,"-n",op.namespace,"--timeout=120s"],130000);
 }
 throw new Error("Unsupported operation");
}
