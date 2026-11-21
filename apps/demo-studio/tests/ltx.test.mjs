import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { ltxStatus,submitLtx,pollLtx } from '../ltx.mjs';
import { previewFingerprint } from '../ltx-runtime.mjs';
import { createHash } from 'node:crypto';
import { Studio } from '../studio.mjs';

test('LTX startup keeps an active demo window intact and explains the capture-first workflow',async()=>{
  const studio=new Studio();studio.child={exitCode:null};
  await assert.rejects(studio.command({action:'ltx.start'}),/Finish capturing and close the Lemonade demo window/);
  assert.equal(studio.child.exitCode,null);
});

test('LTX respects holds and supervision, submits once, and reports failed jobs without creative approval',async()=>{
  const root=await mkdtemp(join(tmpdir(),'studio-ltx-test-'));const before={LOCALAPPDATA:process.env.LOCALAPPDATA,DEMO_STUDIO_LTX_URL:process.env.DEMO_STUDIO_LTX_URL,DEMO_STUDIO_LTX_LIMITS:process.env.DEMO_STUDIO_LTX_LIMITS};
  let submissions=0, transient=false;
  const server=createServer(async(req,res)=>{for await(const _chunk of req){/* consume fixture input */}res.setHeader('Content-Type','application/json');
    if(req.url==='/system_stats')return res.end('{}');
    if(req.url==='/object_info')return res.end('{"SaveVideo":{}}');
    if(req.url==='/queue')return res.end('{"queue_running":[],"queue_pending":[]}');
    if(req.url==='/upload/image')return res.end(JSON.stringify({name:'reference.jpg',subfolder:''}));
    if(req.url==='/prompt'){submissions++;return res.end('{"prompt_id":"fixture-job"}');}
    if(req.url==='/history/fixture-job'){if(transient){req.socket.destroy();return;}return res.end('{"fixture-job":{"status":{"status_str":"error"}}}');}
    res.statusCode=404;res.end('{}');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{
    process.env.LOCALAPPDATA=root;process.env.DEMO_STUDIO_LTX_URL=`http://127.0.0.1:${server.address().port}`;
    process.env.DEMO_STUDIO_LTX_LIMITS=join(root,'limits.json');
    const runtime=join(root,'Signal/runtime');await mkdir(join(runtime,'ltx25-models'),{recursive:true});
    await writeFile(join(runtime,'ltx25-models/signal-model-receipt.json'),'{}');
    await writeFile(join(root,'limits.json'),JSON.stringify({enforced:true,state:'running',supervisorPid:process.pid}));
    await writeFile(join(runtime,'ltx25-diagnostic-hold.json'),JSON.stringify({reason:'Fixture production hold'}));
    const reference=join(root,'reference.jpg');await writeFile(reference,'fixture');
    const plan={id:'plan',status:'prepared',runtimeFingerprint:await previewFingerprint(),reference,image:'reference.jpg',graph:{17:{class_type:'SaveVideo',inputs:{}}}};
    const studio={session:{ltxPlans:[plan]},persist:async()=>{}};
    assert.equal((await ltxStatus()).held,true);
    await assert.rejects(submitLtx(studio,'plan'),/Fixture production hold/);assert.equal(submissions,0);
    const previewPath=join(runtime,'ltx25-studio-preview.json');
    const preview={decodeVerified:true,maxDuration:3,holdHash:createHash('sha256').update(JSON.stringify({reason:'Fixture production hold'})).digest('hex'),runtimeFingerprint:await previewFingerprint()};
    await writeFile(previewPath,JSON.stringify(preview));
    assert.equal((await ltxStatus()).ready,true);
    assert.equal((await ltxStatus()).productionHeld,true);
    plan.direction={duration:5};await assert.rejects(submitLtx(studio,'plan'),/up to 3 seconds/);delete plan.direction;
    await writeFile(previewPath,JSON.stringify({...preview,runtimeFingerprint:'outdated'}));
    assert.equal((await ltxStatus()).held,true);
    await writeFile(previewPath,JSON.stringify({...preview,holdHash:'different hold'}));
    assert.equal((await ltxStatus()).held,true);
    await rm(previewPath);
    await rm(join(runtime,'ltx25-diagnostic-hold.json'));
    await writeFile(join(root,'limits.json'),JSON.stringify({enforced:false,state:'running',supervisorPid:process.pid}));
    await assert.rejects(submitLtx(studio,'plan'),/status file/);assert.equal(submissions,0);
    await writeFile(join(root,'limits.json'),JSON.stringify({enforced:true,state:'running',supervisorPid:process.pid}));
    assert.equal((await submitLtx(studio,'plan')).status,'queued');assert.equal(submissions,1);
    await assert.rejects(submitLtx(studio,'plan'),/already been submitted/);assert.equal(submissions,1);
    transient=true;assert.equal((await pollLtx(studio,'plan')).status,'rendering');assert.equal(submissions,1);transient=false;
    assert.equal((await pollLtx(studio,'plan')).status,'failed');
  }finally{for(const[key,value]of Object.entries(before)){if(value===undefined)delete process.env[key];else process.env[key]=value;}await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
});
