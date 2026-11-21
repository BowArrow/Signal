// Explicit local inference check. Requires a retained runtime-validation receipt.
// Does not remove holds, publish content, or start an agent task.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { studioCommand } from '../apps/demo-studio/client.mjs';

const sessionId=process.argv.find(a=>a.startsWith('--session='))?.slice(10);
const duration=Number(process.argv.find(a=>a.startsWith('--duration='))?.slice(11)||3);
if(![3,5].includes(duration))throw new Error('Use a 3- or 5-second validation.');
if(!sessionId)throw new Error('Pass --session=<saved demo session UUID>.');
const folder=resolve('data/demo-studio/ltx-check',String(Date.now()));await mkdir(folder,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let instance;
if(process.argv.includes('--isolated')){
  const { startServer }=await import('../apps/demo-studio/server.mjs');
  const connectionFile=join(folder,'connection.json');
  instance=await startServer({port:0,connectionFile});
  process.env.DEMO_STUDIO_CONNECTION=connectionFile;
}
try {
const db=new DatabaseSync(join(process.env.APPDATA,'signal/signal.db'),{readOnly:true});
const row=db.prepare("SELECT value FROM settings WHERE key = 'video.character.starter-lemonade-maya'").get();db.close();
if(!row)throw new Error('Missing retained fictional Maya reference.');
const character=JSON.parse(row.value), reference=join(process.env.APPDATA,'signal/video-assets',character.reference.file);
if(createHash('sha256').update(await readFile(reference)).digest('hex')!==character.reference.sha256)throw new Error('The retained reference changed.');
await studioCommand({action:'session.open',sessionId});
let status=await studioCommand({action:'ltx.status'});
if(!status.connected){console.log(await studioCommand({action:'ltx.start'}));}
const readyDeadline=Date.now()+180000;
while(Date.now()<readyDeadline){status=await studioCommand({action:'ltx.status'});if(status.ready)break;if(status.held||status.runtime?.error)throw new Error(status.reason);await sleep(2000);}
if(!status.ready)throw new Error(status.reason);
const asset=await studioCommand({action:'asset.import',path:reference,title:'Fictional Maya scene reference',role:'reference'});
const plan=await studioCommand({action:'ltx.prepare',direction:{
  title:'LTX setup check: a moment of focus',referenceAssetId:asset.asset.id,duration,ratio:'9:16',
  subject:'One fictional adult woman from the reference, with curly dark hair and the same dark green sweater.',
  geometry:'The subject is centered in front of the plain gray studio background. Preserve her complete head and shoulders.',
  firstFrame:'The supplied portrait composition, with the subject already breathing naturally.',
  camera:'Locked tripod. No pan, tilt, zoom or focal drift.',fov:'47',
  lighting:'Keep the soft light, exposure and neutral color of the reference.',
  atmosphere:'Clear studio air, no particles or effects.',physics:'Natural breathing and small facial movement; shoulders stay relaxed.',
  acting:'A restrained natural smile. No speech.',locks:'Same face, hair, wardrobe, background, light direction and screen direction.',
  beats:[{start:0,end:1,action:'Her eyes shift slightly to screen-right.'},{start:1,end:duration,action:'She looks back toward the camera and gives a subtle smile.'}],
}});
const submitted=await studioCommand({action:'ltx.submit',planId:plan.planId});
console.log(JSON.stringify(submitted));
await writeFile(join(folder,'submitted.json'),JSON.stringify(submitted,null,2));
try { await studioCommand({action:'ltx.stop'}); throw new Error('Studio unexpectedly stopped a busy renderer.'); }
catch(error) { if(!error.message.includes('current render')) throw error; }
const deadline=Date.now()+20*60000;
let done=false;
while(Date.now()<deadline){
  await sleep(3000);
  const result=await studioCommand({action:'ltx.poll',planId:plan.planId});
  if(result.status==='failed'||result.status==='attention')throw new Error('LTX job '+result.status+': '+(result.detail||''));
  if(result.saved&&result.asset){await writeFile(join(folder,'receipt.json'),JSON.stringify({sessionId,planId:plan.planId,...result,readiness:await studioCommand({action:'ltx.status'})},null,2));console.log(JSON.stringify({saved:true,receipt:join(folder,'receipt.json'),video:result.asset.path,decodeVerified:result.asset.decodeVerified,qualityApproved:false}));done=true;break;}
}
if(!done)throw new Error('Render timed out. Inspect the existing plan before retrying.');
} catch(error) { await writeFile(join(folder,'failure.json'),JSON.stringify({error:error.message,readiness:await studioCommand({action:'ltx.status'}).catch(()=>null)},null,2));throw error; }
finally { if(instance)await instance.close(); }
