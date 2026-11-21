import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { studioCommand as command } from '../apps/demo-studio/client.mjs';
const root='data/demo-studio/director-check';await mkdir(root,{recursive:true});
let session;
try{
  const status=await command({action:'status'});assert.equal(status.connected,false,'Close the current demo before this check.');
  session=await command({action:'launch',title:'Directed Lemonade demo'});
  await command({action:'format.set',format:'portrait',fps:24});
  await command({action:'record.start',title:'Portrait product capture with cursor'});
  await command({action:'cursor.move',x:.2,y:.2,durationMs:800});
  await command({action:'cursor.move',x:.7,y:.55,durationMs:1000});
  const view=await command({action:'observe'}),projects=view.controls.find(c=>c.name==='Projects');
  await command({action:'click',ref:projects.ref,revision:view.revision});
  await command({action:'wait',milliseconds:600});
  const clip=await command({action:'record.stop'});assert.equal(clip.asset.width,1080);assert.equal(clip.asset.height,1920);assert.ok(clip.asset.actualCaptureFps>0);
  const shot=await command({action:'screenshot',title:'Projects with a visible cursor'});
  const ffmpeg=process.env.DEMO_STUDIO_FFMPEG;assert.ok(ffmpeg,'Set DEMO_STUDIO_FFMPEG for this check.');
  const run=(exe,args)=>promisify(execFile)(exe,args,{windowsHide:true,timeout:180000,maxBuffer:1024*1024});
  const outputs=[];
  for(const format of ['landscape','portrait','square','feed']){
    const result=await command({action:'edit.render',edit:{title:`Directed edit ${format}`,format,clips:[{assetId:shot.asset.id,duration:1.5,zoom:{from:1,to:1.6,x:.5,y:.5}},{assetId:shot.asset.id,duration:1.5,fit:'cover',zoom:{from:1.6,to:1}}],titles:[{text:'Your work, together. 100% [demo]',start:0,end:3,position:'bottom',size:48}]}});
    const probe=JSON.parse((await run(join(dirname(ffmpeg),'ffprobe.exe'),['-v','error','-show_entries','stream=width,height,codec_name','-show_entries','format=duration','-of','json',result.asset.path])).stdout);
    await run(ffmpeg,['-v','error','-i',result.asset.path,'-f','null','-']);
    await run(ffmpeg,['-v','error','-y','-ss','0.7','-i',result.asset.path,'-frames:v','1',join(root,format+'.png')]);
    outputs.push({format,path:result.asset.path,probe});
  }
  // A neutral synthetic fixture tests reference preparation only; it is never submitted for inference.
  const reference=join(root,'reference.png');await run(ffmpeg,['-v','error','-y','-f','lavfi','-i','color=c=gray:s=512x320','-frames:v','1',reference]);
  const {resolve}=await import('node:path');const imported=await command({action:'asset.import',path:resolve(reference),role:'reference',title:'Synthetic preparation fixture, not creative footage'});
  const plan=await command({action:'ltx.prepare',direction:{title:'Preparation test only',referenceAssetId:imported.asset.id,duration:3,ratio:'16:9',subject:'Neutral grey reference fixture.',geometry:'Flat foreground plane; no subjects.',firstFrame:'Match the reference.',camera:'Locked tripod.',lighting:'Uniform reference exposure.',atmosphere:'Clean air.',physics:'No moving objects.',acting:'No people present.',locks:'Same composition and tone.',beats:[{start:0,end:3,action:'Hold the reference plane.'}]}});
  assert.equal(plan.saved,true);assert.match(plan.prompt,/GEOMETRY MAP/);
  if(plan.readiness.held)await assert.rejects(command({action:'ltx.submit',planId:plan.planId}),/preview|hold|held|unvalidated/i);
  await command({action:'export'});
  const receipt={passed:true,sessionId:session.sessionId,capture:clip.asset,outputs,ltxPlanSaved:true,ltxReadiness:plan.readiness,ltxGenerated:false,checkedAt:new Date().toISOString()};
  await writeFile(join(root,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify({passed:true,sessionId:session.sessionId,formats:outputs.map(o=>o.format),ltxHeld:plan.readiness.held,ltxGenerated:false},null,2));
}finally{if(session)await command({action:'close'});}
