import { readFile, writeFile, access, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { directorGuidance, directorPrompt } from './director.mjs';
import { runtimeState, previewFingerprint } from './ltx-runtime.mjs';

const exists=file=>access(file).then(()=>true,()=>false);
function endpoint(){const url=new URL(process.env.DEMO_STUDIO_LTX_URL||'http://127.0.0.1:8198');if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password)throw new Error('LTX must use the local capped runtime.');return url.origin;}
async function request(path,options={}){const response=await fetch(endpoint()+path,{...options,redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error(`LTX returned HTTP ${response.status}.`);return response;}
export async function ltxStatus(){
  const root=join(process.env.LOCALAPPDATA||'','Signal/runtime');const holdPath=join(root,'ltx25-diagnostic-hold.json');
  const hold=await exists(holdPath)?JSON.parse(await readFile(holdPath,'utf8')):null;
  let preview=null;
  try {
    const receipt=JSON.parse(await readFile(join(root,'ltx25-studio-preview.json'),'utf8'));
    const holdHash=createHash('sha256').update(JSON.stringify(hold)).digest('hex');
    if(receipt.decodeVerified===true&&receipt.holdHash===holdHash&&receipt.runtimeFingerprint===await previewFingerprint()&&[3,4,5].includes(receipt.maxDuration))preview=receipt;
  }catch{/* No matching local preview validation. The production hold still applies. */}
  const installed=await exists(join(root,'ltx25-models/signal-model-receipt.json'));
  let limits=null;try{limits=JSON.parse(await readFile(process.env.DEMO_STUDIO_LTX_LIMITS||join(root,'ltx25-limits.json'),'utf8'));}catch{/* Report missing supervision. */}
  // Status files must be refreshed by the managed watchdog, not merely left by an old run.
  let supervised=false;
  if(limits?.enforced&&limits.state==='running'&&limits.supervisorPid){try{const {stat}=await import('node:fs/promises');const info=await stat(process.env.DEMO_STUDIO_LTX_LIMITS||join(root,'ltx25-limits.json'));process.kill(limits.supervisorPid,0);supervised=Date.now()-info.mtimeMs<15000;}catch{/* Not live. */}}
  let connected=false;try{connected=(await request('/system_stats')).ok;}catch{/* Service may be stopped. */}
  const runtime=runtimeState();
  const held=!!hold&&!preview;
  return {engine:'LTX 2.5',installed,connected,supervised,held,productionHeld:!!hold,maxDuration:preview?.maxDuration||5,ready:installed&&connected&&supervised&&!held,runtime,reason:(!connected&&(limits?.reason||runtime.error))||(held&&hold.reason)||(!connected?(runtime.owned?'The local LTX runtime is starting. Check again in a moment.':'The local LTX runtime is stopped. Choose Start local LTX.'):!supervised?'A live capped-runtime status file is required in DEMO_STUDIO_LTX_LIMITS.':`Ready for local previews up to ${preview?.maxDuration||5} seconds. Review generated footage before use.`),guidance:directorGuidance};
}
export async function prepareLtx(studio,direction){
  const reference=studio.session.assets.find(a=>a.id===direction.referenceAssetId&&a.kind==='image'&&a.provenance==='reference');
  if(!reference)throw new Error('Import a scene reference first. Real product screenshots stay in the edit, outside generated footage.');
  const id=randomUUID(),folder=join(studio.folder,'ltx',id);await mkdir(folder,{recursive:true});
  const [width,height]=direction.ratio==='9:16'?[320,512]:direction.ratio==='1:1'?[384,384]:[512,320];
  const refPath=join(folder,'reference.jpg');
  await promisify(execFile)(studio.ffmpeg,['-hide_banner','-loglevel','error','-y','-i',reference.path,'-vf',`scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,'-frames:v','1',refPath],{windowsHide:true,timeout:30000});
  const bytes=await readFile(refPath),image='signal-video-'+createHash('sha256').update(bytes).digest('hex')+'.jpg';
  const prompt=directorPrompt(direction),input={id,direction,image,prompt};
  await writeFile(join(folder,'input.json'),JSON.stringify(input));
  const {fileURLToPath}=await import('node:url');
  await promisify(execFile)(process.execPath,['--import','tsx',fileURLToPath(new URL('./ltx-workflow.ts',import.meta.url)),join(folder,'input.json'),join(folder,'workflow.json')],{windowsHide:true,timeout:30000});
  const graph=JSON.parse(await readFile(join(folder,'workflow.json'),'utf8'));
  const plan={id,direction,prompt,image,reference:refPath,graph,status:'prepared',runtimeFingerprint:await previewFingerprint(),previewSize:{width,height},createdAt:new Date().toISOString(),qualityApproved:false};
  studio.session.ltxPlans??=[];studio.session.ltxPlans.push(plan);await studio.persist();
  await studio.asset(`direction-${id}.md`,Buffer.from(`# ${direction.title}\n\nAdapted from Joey cinema-director-v3 for LTX 2.5.\n\n${prompt}\n`),'script','Shot direction: '+direction.title);
  await studio.asset(`workflow-${id}.json`,Buffer.from(JSON.stringify(graph,null,2)),'manifest','LTX workflow: '+direction.title);
  return {saved:true,planId:id,status:'prepared',prompt,previewSize:{width,height},readiness:await ltxStatus()};
}
export async function submitLtx(studio,id){
  const readiness=await ltxStatus();if(!readiness.ready)throw new Error(readiness.reason);
  const plan=studio.session.ltxPlans?.find(p=>p.id===id);if(!plan)throw new Error('Prepare a shot plan first.');
  if(plan.direction?.duration>readiness.maxDuration)throw new Error(`This local runtime is validated for previews up to ${readiness.maxDuration} seconds.`);
  if(plan.status!=='prepared')throw new Error('This plan has already been submitted. Poll it instead of submitting it twice.');
  if(plan.runtimeFingerprint!==await previewFingerprint())throw new Error('Prepare this shot again with the updated local LTX workflow.');
  const nodes=await (await request('/object_info')).json();
  const missing=[...new Set(Object.values(plan.graph).map(n=>n.class_type))].filter(name=>!nodes[name]);if(missing.length)throw new Error('Missing LTX nodes: '+missing.join(', '));
  for(const node of Object.values(plan.graph))for(const [key,value] of Object.entries(node.inputs)){
    const choices=nodes[node.class_type]?.input?.required?.[key]?.[0];
    if(['unet_name','clip_name','vae_name','model_name'].includes(key)&&Array.isArray(choices)&&!choices.includes(value))throw new Error('The runtime is missing model '+value);
  }
  const queue=await (await request('/queue')).json();if(queue.queue_running?.length||queue.queue_pending?.length)throw new Error('Wait for the current local render to finish.');
  const form=new FormData();form.set('image',new Blob([await readFile(plan.reference)],{type:'image/jpeg'}),plan.image);form.set('overwrite','false');form.set('type','input');
  const upload=await (await request('/upload/image',{method:'POST',body:form})).json();if(upload.name!==plan.image||upload.subfolder)throw new Error('Unexpected LTX reference location.');
  plan.status='submitting';await studio.persist();
  try{
    const response=await (await request('/prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:plan.graph,client_id:'signal-demo-studio',extra_data:{studioPlanId:id}})})).json();
    if(!/^[a-zA-Z0-9_-]{1,200}$/.test(response.prompt_id))throw new Error('LTX did not return a valid job ID.');
    plan.promptId=response.prompt_id;plan.status='queued';await studio.persist();return {saved:true,planId:id,promptId:plan.promptId,status:plan.status};
  }catch(error){plan.status='attention';plan.error=error.message;await studio.persist();throw error;}
}
export async function pollLtx(studio,id){
  const plan=studio.session.ltxPlans?.find(p=>p.id===id);if(!plan?.promptId)throw new Error('No submitted LTX job exists for that plan.');
  if(plan.assetId)return {saved:true,status:'done',asset:studio.session.assets.find(a=>a.id===plan.assetId),qualityApproved:false};
  let history;
  try{history=await (await request('/history/'+plan.promptId)).json();}
  catch(error){
    const readiness=await ltxStatus();
    if(!readiness.connected&&!readiness.supervised){plan.status='failed';plan.error=readiness.reason;await studio.persist();return {status:'failed',planId:id,detail:readiness.reason};}
    if(readiness.supervised)return {status:'rendering',planId:id,detail:'The supervised renderer is still running. Its connection is temporarily unavailable; poll this same job again.'};
    throw error;
  }
  const entry=history[plan.promptId];
  if(!entry){const queue=await (await request('/queue')).json();if(![...(queue.queue_running||[]),...(queue.queue_pending||[])].some(row=>row[1]===plan.promptId)){plan.status='attention';await studio.persist();return {status:'attention',detail:'The render is absent from the queue and history. Inspect the local renderer before retrying.',planId:id};}}
  if(entry?.status?.status_str==='error'){plan.status='failed';await studio.persist();return {status:'failed',planId:id};}
  if(!entry?.status?.completed)return {status:'rendering',planId:id};
  const output=entry.outputs?.['17']?.images?.[0];
  if(!output||!/^[-\w.]+\.mp4$/.test(output.filename)||!/^Signal[\\/]video$/.test(output.subfolder)||output.type!=='output')throw new Error('Unexpected LTX output location.');
  const response=await request('/view?'+new URLSearchParams(output));let size=0;const chunks=[];
  for await(const chunk of response.body){size+=chunk.length;if(size>80*1024*1024)throw new Error('LTX output exceeds 80 MB.');chunks.push(chunk);}
  const outputFile=join(studio.folder,'ltx',id,'output.mp4');await writeFile(outputFile,Buffer.concat(chunks));
  const probe=join(dirname(studio.ffmpeg),process.platform==='win32'?'ffprobe.exe':'ffprobe');
  const metadata=JSON.parse((await promisify(execFile)(probe,['-v','error','-show_streams','-show_format','-of','json',outputFile],{windowsHide:true,timeout:30000})).stdout);
  const stream=metadata.streams?.find(s=>s.codec_type==='video');if(!stream)throw new Error('LTX output has no video stream.');
  await promisify(execFile)(studio.ffmpeg,['-v','error','-i',outputFile,'-f','null','-'],{windowsHide:true,timeout:60000});
  const receipt=await studio.asset(`ltx-${id}.mp4`,Buffer.concat(chunks),'video',plan.direction.title,{provenance:'generated-ltx',qualityApproved:false,durationSeconds:Number(metadata.format.duration),width:stream.width,height:stream.height,audio:metadata.streams.some(s=>s.codec_type==='audio'),planId:id,decodeVerified:true});
  plan.status='done';plan.assetId=receipt.asset.id;await studio.persist();return {...receipt,qualityApproved:false};
}
