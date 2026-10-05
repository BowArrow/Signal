import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/core/app.js';
import { seed } from '../src/core/db/seed.js';
import { products } from '../src/core/db/schema.js';
import { executeMarketingTool } from '../src/core/marketing/agent.js';

const folder=mkdtempSync(join(tmpdir(),'signal-website-live-'));
const app=createApp({databaseUrl:join(folder,'verification.db'),migrate:true});
const signal=AbortSignal.timeout(180000);
const results: unknown[]=[];
try {
 seed(app.db,app.config,app.logger);
 for(const product of app.db.select().from(products).all().filter(p=>p.enabled)) {
  if(!['lemonade','cinegen'].includes(product.key))continue;
  const origin=product.key==='lemonade'?'https://siplemona.de':'https://cinegenaimedia.com';
  const slug=`deployment-verification-${Date.now()}`;
  const post={slug,title:`${product.name} publishing verification`,description:'Temporary deployment verification of the website publishing system, removed immediately after the checks finish.',author:product.name,body:'## Deployment verification\n\nThis temporary article verifies that Signal can save and publish a website article, that readers receive complete HTML, and that archived content is no longer publicly available. It is removed when the verification finishes.\n\n[Read our writing](/writing)',status:'draft',expectedVersion:0};
  const tool=async(name:'blog.read'|'blog.save',input:Record<string,unknown>)=>await executeMarketingTool(app,product.id,name,input,signal) as {version:number;status:string;url:string};
  let version=0;
  try{
   const draft=await tool('blog.save',post);version=draft.version;assert.equal(draft.status,'draft');
   assert.equal((await fetch(`${origin}/writing/${slug}`)).status,404);
   assert.equal((await fetch(`${origin}/api/content/posts?slug=${slug}`)).status,401);
   assert.equal((await fetch(`${origin}/api/content/posts`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(post)})).status,401);
   assert.equal((await tool('blog.read',{slug})).version,version);
   const published=await tool('blog.save',{...post,status:'published',expectedVersion:version});version=published.version;assert.equal(published.status,'published');
   const live=await fetch(published.url);assert.equal(live.status,200);const html=await live.text();assert.ok(html.includes(post.title)&&html.includes('BlogPosting')&&html.includes('rel="canonical"'));
   for(const route of ['/writing','/writing/feed.xml','/writing/sitemap.xml']){const response=await fetch(origin+route);assert.equal(response.status,200);assert.ok((await response.text()).includes(slug));}
   const duplicate=await tool('blog.save',{...post,status:'published',expectedVersion:1});assert.equal(duplicate.version,version);
   await assert.rejects(()=>tool('blog.save',{...post,title:'Conflicting stale edit',status:'published',expectedVersion:0}),/409/);
   results.push({product:product.key,agentPublishing:true,draftPrivate:true,unauthenticatedDenied:true,serverRendered:true,feed:true,sitemap:true,retryIdempotent:true,staleEditRejected:true});
  } finally {
   if(version){const current=await tool('blog.read',{slug});await tool('blog.save',{...post,status:'archived',expectedVersion:current.version});assert.equal((await fetch(`${origin}/writing/${slug}`)).status,404);}
  }
 }
 writeFileSync(join(folder,'result.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({ok:true,results,artifacts:folder}));
}finally{app.close();}
