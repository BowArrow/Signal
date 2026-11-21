// Leave this isolated Studio open for licence activation and the real acceptance check.
import { startServer } from '../apps/demo-studio/server.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const folder=resolve('data/demo-studio/bridge-check',String(Date.now()));await mkdir(folder,{recursive:true});
const instance=await startServer({port:0,connectionFile:join(folder,'connection.json')});
const existing=process.argv.find(a=>a.startsWith('--session='))?.slice(10);
const result=await instance.studio.command(existing?{action:'product.resume',sessionId:existing}:{action:'launch',title:'Automation bridge acceptance: synthetic reports'});
await writeFile(join(folder,'session.json'),JSON.stringify({folder,sessionId:result.sessionId,product:result.product},null,2));
console.log(JSON.stringify({folder,sessionId:result.sessionId,product:result.product}));
if(!result.product?.licensing?.ready)await instance.studio.command({action:'product.setup',view:'license'});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{void instance.close().finally(()=>process.exit());});
