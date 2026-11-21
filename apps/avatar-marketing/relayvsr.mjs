import {createReadStream} from 'node:fs';
import {readFile,writeFile,mkdir,open,unlink,stat,copyFile} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';

export const workspace=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export const runtime=join(workspace,'data/relayvsr-runtime');
export const python=join(process.env.APPDATA||'','signal/runtime/creative/comfy-owned-v1/python_embeded/python.exe');
export const ffmpeg=join(process.env.LOCALAPPDATA||'','Signal/runtime/video-tools/ffmpeg/ffmpeg-9.0.1-essentials_build/bin/ffmpeg.exe');
export const ffprobe=join(dirname(ffmpeg),'ffprobe.exe');
export const run=promisify(execFile);
export const json=async p=>JSON.parse((await readFile(p,'utf8')).replace(/^\uFEFF/,''));
export const save=async(p,value)=>{await mkdir(dirname(p),{recursive:true});await writeFile(p,JSON.stringify(value,null,2));};
export const exists=async p=>{try{await stat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
export async function sha256(path){const hash=createHash('sha256');for await(const block of createReadStream(path))hash.update(block);return hash.digest('hex');}
export async function probe(path){return JSON.parse((await run(ffprobe,['-v','error','-count_frames','-show_streams','-show_format','-of','json',path],{windowsHide:true,timeout:120000})).stdout);}
export async function encode(args){return run(ffmpeg,['-hide_banner','-v','error','-nostdin','-threads','2','-filter_threads','2',...args],{windowsHide:true,timeout:1800000,maxBuffer:1024*1024});}
export function chunkPlan(frames,core=90,context=15){
  if(!Number.isSafeInteger(frames)||frames<1||!Number.isInteger(core)||core<16||core>120||!Number.isInteger(context)||context<0||context>15)throw new Error('Invalid bounded frame plan.');
  const chunks=[];for(let start=0;start<frames;start+=core){const end=Math.min(frames,start+core),inputStart=Math.max(0,start-context),inputEnd=Math.min(frames,end+context);chunks.push({index:chunks.length,start,end,inputStart,inputEnd,trimStart:start-inputStart,frames:end-start});}return chunks;
}
export function relayGraph(file,prefix,{detail=0.8,seed=42}={}){
  if(!/^[-\w]+\.mp4$/.test(file)||!/^[-\w/]+$/.test(prefix)||!Number.isFinite(detail)||detail<0||detail>1)throw new Error('Invalid RelayVSR graph input.');
  return {
    '1':{class_type:'UNETLoader',inputs:{unet_name:'relayvsr_x2_lightx2v_int8_convrot.safetensors',weight_dtype:'default'}},
    '2':{class_type:'VAELoader',inputs:{vae_name:'relayvsr_flash_vae_x2_fp32.safetensors'}},
    '3':{class_type:'LoadVideo',inputs:{file}},
    '4':{class_type:'GetVideoComponents',inputs:{video:['3',0]}},
    '5':{class_type:'RelayVSRConditioning',inputs:{model:['1',0],images:['4',0]}},
    '6':{class_type:'KSampler',inputs:{model:['1',0],positive:['5',0],negative:['5',0],latent_image:['5',1],seed,steps:1,cfg:1,sampler_name:'euler',scheduler:'simple',denoise:1}},
    '7':{class_type:'VSRDecode',inputs:{vae:['2',0],samples:['6',0],images:['4',0],detail}},
    '8':{class_type:'CreateVideo',inputs:{images:['7',0],fps:['4',2]}},
    '9':{class_type:'SaveVideo',inputs:{video:['8',0],filename_prefix:prefix,format:'mp4','format.codec':'h264'}},
  };
}
const base='http://127.0.0.1:8199';
async function request(path,options={}){const response=await fetch(base+path,{...options,redirect:'error',signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error(`RelayVSR ${path}: ${response.status} ${await response.text()}`);return response;}
async function liveLimits(){const path=join(runtime,'limits.json'),limits=await json(path);if(!limits.enforced||limits.state!=='running'||Date.now()-(await stat(path)).mtimeMs>15000)throw new Error('Relay supervisor is not live: '+(limits.reason||limits.state));return limits;}
async function startServer(){
  try{await fetch(base+'/system_stats',{signal:AbortSignal.timeout(1000)});throw new Error('Port 8199 is occupied.');}catch(e){if(e.message.includes('occupied'))throw e;}
  const receipt=await json(join(runtime,'model-receipt.json'));if(!receipt.verified)throw new Error('Relay models are not verified.');
  for(const model of receipt.models)if((await stat(join(runtime,'models',model.file))).size!==model.bytes)throw new Error('Relay model file changed.');
  const output=join(runtime,'output'),input=join(runtime,'input'),profile=join(runtime,'profile');for(const p of [output,input,profile])await mkdir(p,{recursive:true});
  const yaml=join(runtime,'models.yaml');await writeFile(yaml,`relay:\n  base_path: ${JSON.stringify(join(runtime,'models').replaceAll('\\','/'))}\n  diffusion_models: diffusion_models\n  vae: vae\n`);
  const log=await open(join(runtime,'renderer.log'),'a');
  const child=spawn(python,['-s',join(workspace,'src/core/video/limited_runtime.py'),'--dynamic-vram','--ram-gb','10','--working-set-gb','2','--reserve-ram-gb','8','--reserve-commit-gb','10','--device-vram-gb','7','--owner-pid',String(process.pid),'--status',join(runtime,'limits.json'),'--',join(workspace,'apps/avatar-marketing/relayvsr-bootstrap.py'),runtime,'--disable-auto-launch','--disable-all-custom-nodes','--disable-api-nodes','--listen','127.0.0.1','--port','8199','--enable-dynamic-vram','--async-offload','1','--reserve-vram','5.5','--vram-headroom','5.5','--fast-disk','--cache-none','--input-directory',input,'--output-directory',output,'--user-directory',profile,'--database-url','sqlite:///'+join(profile,'comfy.db').replaceAll('\\','/'),'--extra-model-paths-config',yaml],{cwd:runtime,windowsHide:true,stdio:['ignore',log.fd,log.fd],env:{...process.env,HF_HUB_OFFLINE:'1',OMP_NUM_THREADS:'2',MKL_NUM_THREADS:'2',OPENBLAS_NUM_THREADS:'2'}});
  let failure;child.on('error',e=>{failure=e;});
  const stop=async()=>{if(child.exitCode===null&&child.signalCode===null){const closed=new Promise(r=>child.once('close',r));child.kill();await closed;}await log.close();};
  try{const deadline=Date.now()+180000;while(Date.now()<deadline){if(failure)throw failure;if(child.exitCode!==null)throw new Error('Relay runtime exited; inspect renderer.log.');try{await liveLimits();await request('/system_stats');return {stop};}catch{/* The supervised server is still starting. */}await new Promise(r=>setTimeout(r,1500));}throw new Error('Relay startup timed out.');}catch(e){await stop();throw e;}
}
export async function upscale(source,folder,{detail=0.8}={}){
  if(!Number.isFinite(detail)||detail<0||detail>1)throw new Error('Relay detail must be between 0 and 1.');
  source=resolve(source);folder=resolve(folder);
  await run(join(workspace,'data/avatar-runtime/qwen-env/Scripts/python.exe'),['-B',join(workspace,'apps/avatar-marketing/alex_generation_supervisor.py'),'--workspace',workspace,'--check-generation','--require-owned'],{windowsHide:true,timeout:10000});
  const info=await probe(source),video=info.streams.find(s=>s.codec_type==='video');
  const [n,d]=video.avg_frame_rate.split('/').map(Number),fps=n/d,frames=Number(video.nb_read_frames);
  if(video.width>576||video.height>1024||video.width*video.height>400000||fps!==24||video.r_frame_rate!==video.avg_frame_rate)throw new Error('Relay input must be a bounded low-resolution 24fps CFR render (max 400,000 pixels).');
  await mkdir(folder,{recursive:true});
  const inputSha256=await sha256(source),signature={inputSha256,detail,scale:2,fps,frames,width:video.width,height:video.height};
  const planPath=join(folder,'plan.json');if(await exists(planPath)){if(JSON.stringify((await json(planPath)).signature)!==JSON.stringify(signature))throw new Error('Resume inputs changed. Use a new output folder.');}else await save(planPath,{signature,chunks:chunkPlan(frames)});
  const completedPath=join(folder,'receipt.json');
  if(await exists(completedPath)){const completed=await json(completedPath);if(completed.sha256!==await sha256(completed.path))throw new Error('Completed Relay output changed.');return {...completed,resumed:true};}
  const lockPath=join(workspace,'output/alex-creator/renders/render.lock');await mkdir(dirname(lockPath),{recursive:true});const lock=await open(lockPath,'wx');await lock.writeFile(JSON.stringify({pid:process.pid,stage:'relayvsr',at:new Date().toISOString()}));
  let server;const began=Date.now(),parts=[];
  try{
    for(const chunk of chunkPlan(frames)){
      const part=join(folder,`part-${String(chunk.index).padStart(4,'0')}.mp4`),receiptPath=part+'.json';parts.push(part);
      if(await exists(receiptPath)){const r=await json(receiptPath);if(r.sha256!==await sha256(part))throw new Error('Completed Relay chunk changed.');continue;}
      if(await exists(part+'.submitted.json'))throw new Error('Inspect the interrupted submitted chunk before retrying; completed parts are retained.');
      const clip=join(folder,`input-${chunk.index}.mp4`);if(!await exists(clip))await encode(['-i',source,'-vf',`trim=start_frame=${chunk.inputStart}:end_frame=${chunk.inputEnd},setpts=PTS-STARTPTS`,'-an','-c:v','libx264','-threads','2','-crf','12','-pix_fmt','yuv420p',clip]);
      const clipName='relay-'+await sha256(clip)+'.mp4';await mkdir(join(runtime,'input'),{recursive:true});await copyFile(clip,join(runtime,'input',clipName));
      server??=await startServer();
      const graph=relayGraph(clipName,'relay/chunk-'+chunk.index,{detail});await save(part+'.graph.json',graph);
      const submitted=await (await request('/prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:graph,client_id:'signal-relayvsr'})})).json();
      if(!submitted.prompt_id||Object.keys(submitted.node_errors||{}).length)throw new Error(JSON.stringify(submitted));await save(part+'.submitted.json',submitted);
      const deadline=Date.now()+20*60000;let history;
      while(Date.now()<deadline){await liveLimits();history=(await(await request('/history/'+submitted.prompt_id)).json())[submitted.prompt_id];if(history?.status?.status_str==='error'){await save(part+'.history.json',history);throw new Error('Relay chunk failed; inspect history.');}if(history?.status?.completed)break;await new Promise(r=>setTimeout(r,2000));}
      if(!history?.status?.completed)throw new Error('Relay chunk exceeded 20 minutes.');
      await save(part+'.history.json',history);
      const out=history.outputs?.['9']?.images?.[0];if(!out||out.type!=='output'||out.subfolder!=='relay'||!/^chunk-\d+_\d+_\.mp4$/.test(out.filename))throw new Error('Unexpected Relay output.');
      const raw=join(runtime,'output',out.subfolder,out.filename),rawInfo=await probe(raw),rv=rawInfo.streams.find(s=>s.codec_type==='video');
      if(rv.width!==video.width*2||rv.height!==video.height*2||Number(rv.nb_read_frames)!==chunk.inputEnd-chunk.inputStart)throw new Error('Relay output frame count or dimensions changed.');
      await encode(['-i',raw,'-vf',`trim=start_frame=${chunk.trimStart}:end_frame=${chunk.trimStart+chunk.frames},setpts=PTS-STARTPTS`,'-an','-c:v','libx264','-threads','2','-crf','16','-pix_fmt','yuv420p',part]);
      await save(receiptPath,{...chunk,sha256:await sha256(part),limits:await liveLimits()});console.log(JSON.stringify({stage:'relay-chunk',completed:chunk.index+1,total:chunkPlan(frames).length}));
    }
    if(server){await server.stop();server=null;}
    const listing=join(folder,'parts.txt');await writeFile(listing,parts.map(p=>`file '${p.replaceAll('\\','/').replaceAll("'","'\\''")}'`).join('\n'));
    const output=join(folder,'video.mp4');
    if(!await exists(output))await encode(['-f','concat','-safe','0','-i',listing,'-i',source,'-map','0:v:0','-map','1:a?','-c','copy',output]);
    await encode(['-i',output,'-f','null','-']);const final=await probe(output),v=final.streams.find(s=>s.codec_type==='video');
    if(Number(v.nb_read_frames)!==frames||v.width!==video.width*2||v.height!==video.height*2||v.avg_frame_rate!==video.avg_frame_rate)throw new Error('Final Relay timing or dimensions mismatch.');
    let audioVerification=null;
    if(info.streams.some(s=>s.codec_type==='audio')) {
      if(!final.streams.some(s=>s.codec_type==='audio'))throw new Error('Audio was lost.');
      const decodedHash=async file=>(await encode(['-i',file,'-map','0:a:0','-c:a','pcm_s16le','-f','hash','-hash','sha256','-'])).stdout.trim();
      const sourceAudio=await decodedHash(source),outputAudio=await decodedHash(output);
      if(sourceAudio!==outputAudio)throw new Error('Decoded narration changed during remux.');
      audioVerification={decodedPcmHash:sourceAudio,exactMatch:true};
    }
    const receipt={path:output,sha256:await sha256(output),...signature,outputWidth:v.width,outputHeight:v.height,elapsedSeconds:(Date.now()-began)/1000,decodeVerified:true,audioPolicy:'Original audio stream copied without re-encoding',audioVerification,qualityApproved:false,info:final};await save(join(folder,'receipt.json'),receipt);return receipt;
  }finally{if(server)await server.stop();await lock.close();await unlink(lockPath);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))upscale(process.argv[2],process.argv[3],{detail:process.argv[4]===undefined?.8:Number(process.argv[4])}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e);process.exitCode=1;});
