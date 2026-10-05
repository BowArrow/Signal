import { join, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { settings } from '../src/core/db/schema.js';
import { ConnectionService } from '../src/core/connections/service.js';
import { ProspectResearchService } from '../src/core/sales/prospect-research.js';
import { agentClient } from '../src/core/runtime/client.js';
const owner=createApp({databaseUrl:join(process.env['APPDATA']!,'signal','signal.db'),logger:silentLogger,migrate:false});
const folder=resolve('data/prospect-live-validation');mkdirSync(folder,{recursive:true});
const app=createApp({databaseUrl:join(folder,'research-'+Date.now()+'.db'),logger:silentLogger});
try {
 for(const key of ['runtime.provider.v1','growth.runtime.v1','marketing.operator.v1']) { const row=owner.db.select().from(settings).where(eq(settings.key,key)).get();if(row)app.db.insert(settings).values({key,value:row.value}).onConflictDoUpdate({target:settings.key,set:{value:row.value}}).run(); }
 const runtime=app.db.select().from(settings).where(eq(settings.key,'runtime.provider.v1')).get()?.value as {provider?:string,localDevice?:string};
 if(runtime?.provider!=='local'||runtime.localDevice!=='cpu') throw Error('Live validation requires the existing CPU local model.');
 app.connections=new ConnectionService(app,{available:()=>false,get:()=>undefined,set:()=>{},delete:()=>{}});
 const product=app.connections.view().products.find(p=>p.name==='Lemonade')!;
 const model=agentClient(app,AbortSignal.timeout(16*60000));
 const research=new ProspectResearchService(app,{available:()=>({ready:true}),complete:async input=>{const response=await model.complete(input);writeFileSync(join(folder,'model-'+input.task+'-'+Date.now()+'.json'),JSON.stringify({task:input.task,text:response.text},null,2));return response;}});app.prospectResearch=research;
 const urls=process.argv.slice(2);if(!urls.length)throw Error('Supply public source URLs to inspect.');
 for(const url of urls){research.request(product.id,url);await research.tick();console.log(JSON.stringify({url,status:research.state(product.id).status,detail:research.state(product.id).detail}));}
 const result={observedAt:new Date().toISOString(),mode:'real public pages and configured CPU model; isolated database; no sending services',state:research.state(product.id),drafts:research.drafts(product.id)};
 writeFileSync(join(folder,'results.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify({drafts:result.drafts.map(d=>({name:d.name,status:d.status,kind:d.kind,source:d.url,contactFound:!!d.contact})),artifact:join(folder,'results.json')}));
 await research.stop();
}finally{owner.close();app.close();}
