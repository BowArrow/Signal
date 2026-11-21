import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Studio } from '../studio.mjs';
import { startServer } from '../server.mjs';
import { commandSchema } from '../protocol.mjs';
import { request as httpRequest } from 'node:http';

test('commands reject arbitrary execution, unknown fields and out-of-range input',()=>{
  for(const value of [{action:'eval',code:'process.exit()'},{action:'launch',executable:'cmd.exe'},{action:'click',ref:'e0'},{action:'scroll',delta:100000},{action:'fill',ref:'[onclick]',revision:'x',text:'x'}]) assert.equal(commandSchema.safeParse(value).success,false);
});

test('HTTP control and artifacts require authentication and same-origin requests',async()=>{
  const root=await mkdtemp(join(tmpdir(),'demo-studio-test-'));
  const studio={root,initialize:async()=>{},status:async()=>({connected:false}),command:async c=>({received:c.action})};
  const app=await startServer({studio,port:0});
  const headers={Authorization:`Bearer ${app.token}`,'Content-Type':'application/json'};
  try{
    assert.equal((await fetch(app.origin+'/api/status')).status,401);
    assert.equal((await fetch(app.origin+'/api/status',{headers:{...headers,Origin:'https://example.com'}})).status,403);
    const badHost=await new Promise((resolve,reject)=>{const req=httpRequest(app.origin+'/api/status',{headers:{...headers,Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});
    assert.equal(badHost,403);
    assert.equal((await fetch(app.origin+'/api/status',{headers})).status,200);
    const paired=await fetch(app.origin+'/connect',{method:'POST',headers});
    assert.match(paired.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
    const cookie=paired.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(app.origin+'/api/status',{headers:{Cookie:cookie}})).status,200);
    const id='11111111-1111-1111-1111-111111111111';
    await mkdir(join(root,'sessions',id,'assets'),{recursive:true});
    await writeFile(join(root,'sessions',id,'assets','clip-test.mp4'),'0123456789');
    const range=await fetch(`${app.origin}/assets/${id}/clip-test.mp4`,{headers:{...headers,Range:'bytes=2-5'}});
    assert.equal(range.status,206);assert.equal(await range.text(),'2345');
    assert.equal((await fetch(`${app.origin}/assets/${id}/clip-test.mp4`,{headers:{...headers,Range:'bytes=999-'}})).status,416);
    assert.equal((await fetch(app.origin+'/assets/../../connection.json',{headers})).status,404);
  }finally{await app.close();await rm(root,{recursive:true,force:true});}
});

test('saved assets and export survive restart with hashes and observations',async()=>{
  const root=await mkdtemp(join(tmpdir(),'demo-studio-storage-'));const studio=new Studio({root});
  const id='11111111-1111-1111-1111-111111111111';
  studio.folder=join(root,'sessions',id);await mkdir(join(studio.folder,'assets'),{recursive:true});
  studio.session={id,title:'Fixture',product:'Lemonade',createdAt:new Date().toISOString(),status:'open',assets:[],events:[],notes:[]};
  try{
    const asset=await studio.asset('shot-test.png',Buffer.from('fixture'),'image','Example');
    assert.equal(asset.saved,true);assert.equal(asset.asset.sha256.length,64);
    await studio.command({action:'note',text:'Draft observation'});
    const exported=await studio.command({action:'export'});assert.equal(exported.saved,true);
    const script=await readFile(exported.script.path,'utf8');assert.match(script,/Draft observation/);assert.match(script,/shot-test.png/);
    const reopened=new Studio({root});const state=await reopened.status();assert.equal(state.sessions[0].assets.length,3);
    const resumed=await reopened.command({action:'session.open',sessionId:id});assert.equal(resumed.editing,true);
    await reopened.command({action:'note',text:'Continued after restart'});assert.equal(reopened.session.notes.length,2);
    assert.equal(JSON.parse(await readFile(exported.manifest.path,'utf8')).publicationStatus,'not-published');
  }finally{await rm(root,{recursive:true,force:true});}
});

test('commands serialize mutations and recover after failure',async()=>{
  const studio=new Studio();const order=[];
  studio.execute=async c=>{order.push(c.action);await new Promise(r=>setTimeout(r,10));if(c.action==='observe')throw Error('closed');return c.action;};
  const bad=studio.command({action:'observe'});const good=studio.command({action:'status'});
  await assert.rejects(bad,/closed/);assert.equal(await good,'status');assert.deepEqual(order,['observe','status']);
});
