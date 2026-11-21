// Explicit supervised production qualification. Keeps legacy preview holds intact.
import {readFile,writeFile,mkdir,open,unlink,stat} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {productionGraph,productionProfiles,guidedModel} from './ltx-production.js';
import {startLtxRuntime,stopLtxRuntime,previewFingerprint,runtimeState} from '../demo-studio/ltx-runtime.mjs';

const run=promisify(execFile),root=resolve('.'),base='http://127.0.0.1:8198';
const runtime=join(process.env.LOCALAPPDATA!,'Signal/runtime');
const ffmpeg=join(runtime,'video-tools/ffmpeg/ffmpeg-9.0.1-essentials_build/bin/ffmpeg.exe');
const ffprobe=join(dirname(ffmpeg),'ffprobe.exe');
const hash=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const json=async(p:string)=>JSON.parse((await readFile(p,'utf8')).replace(/^\uFEFF/,''));
const request=async(path:string,options:RequestInit={})=>{
  const response=await fetch(base+path,{...options,redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`Local ComfyUI ${path}: HTTP ${response.status}`);
  return response;
};
async function supervised(){
  const file=join(runtime,'ltx25-limits.json');
  const limits=await json(file);
  if(!limits.enforced||limits.state!=='running'||Date.now()-(await stat(file)).mtimeMs>15000)throw new Error('The memory supervisor is not live: '+(limits.reason||limits.state));
  process.kill(limits.supervisorPid,0);
  return limits;
}
async function main(){
  const wallBegan=Date.now();
  await run(join(root,'data/avatar-runtime/qwen-env/Scripts/python.exe'),['-B','apps/avatar-marketing/alex_generation_supervisor.py','--workspace',root,'--check-generation','--require-owned'],{windowsHide:true,timeout:10000});
  if(!process.argv[2])throw new Error('Usage: node --import tsx apps/avatar-marketing/render-local.ts shot.json');
  const spec=await json(resolve(process.argv[2]));
  const profile=productionProfiles[spec.profile as keyof typeof productionProfiles];
  if(!profile||!Number.isFinite(spec.duration)||spec.duration<1||spec.duration>profile.maxSeconds)throw new Error('Use a defined production profile and supported duration.');
  if(spec.profile.startsWith('guided_')){
    const receipt=await json(join(runtime,'ltx25-models/alex-guided-model-receipt.json'));
    if(!receipt.verified||Object.entries(guidedModel).some(([key,value])=>receipt[key]!==value)||(await stat(join(runtime,'ltx25-models',guidedModel.file))).size!==guidedModel.bytes)throw new Error('The pinned development model has not finished installation and verification.');
  }
  const imageSource=resolve(spec.image);const source=await readFile(imageSource);
  if(hash(source)!==spec.imageSha256)throw new Error('Scene reference changed.');
  const outRoot=join(root,'output/alex-creator/renders');await mkdir(outRoot,{recursive:true});
  const lockPath=join(outRoot,'render.lock');
  const lock=await open(lockPath,'wx');await lock.writeFile(JSON.stringify({pid:process.pid,at:new Date().toISOString()}));
  const id='alex-'+randomUUID(),folder=join(outRoot,id);await mkdir(folder);
  let started=false;
  try{
    await writeFile(join(folder,'input.json'),JSON.stringify(spec,null,2));
    const still=join(folder,'reference.jpg');
    await run(ffmpeg,['-v','error','-i',imageSource,'-vf',`scale=${profile.width}:${profile.height}:force_original_aspect_ratio=increase,crop=${profile.width}:${profile.height}`,'-frames:v','1','-q:v','2',still],{windowsHide:true,timeout:60000});
    const imageBytes=await readFile(still),imageName='signal-video-'+hash(imageBytes)+'.jpg';
    let audioBytes:Buffer|undefined,audioName:string|undefined;
    const frames=8*Math.ceil((spec.duration*24-1)/8)+1;
    if(spec.audio){
      const inputAudio=resolve(spec.audio);
      if(hash(await readFile(inputAudio))!==spec.audioSha256)throw new Error('Source narration changed.');
      const audioInfo=JSON.parse((await run(ffprobe,['-v','error','-show_format','-of','json',inputAudio],{windowsHide:true})).stdout);
      const available=Number(audioInfo.format.duration);
      const offset=spec.audioStart??0;
      if(!Number.isFinite(offset)||offset<0||offset>=available)throw new Error('Invalid speech offset.');
      if(!spec.validationOnly&&available-offset>frames/24+.01)throw new Error('Shot would cut speech; use an explicitly segmented WAV.');
      const audioFile=join(folder,'input-audio.wav');
      await run(ffmpeg,['-v','error','-ss',String(offset),'-i',inputAudio,'-af','apad','-t',String(frames/24),'-ar','24000','-ac','1','-c:a','pcm_s16le',audioFile],{windowsHide:true,timeout:60000});
      audioBytes=await readFile(audioFile);audioName='signal-audio-'+hash(audioBytes)+'.wav';
    }
    const graph=productionGraph({id,image:imageName,audio:audioName,duration:spec.duration,prompt:spec.prompt,profile:spec.profile,seed:spec.seed??42});
    await writeFile(join(folder,'workflow-api.json'),JSON.stringify(graph,null,2));
    console.log(JSON.stringify({folder,stage:'starting',profile:spec.profile,duration:spec.duration,frames}));
    // The native high-resolution speech trial needs more pageable headroom
    // while other applications share this 32 GiB machine.
    const runtimeBegan=Date.now();
    const launch=await startLtxRuntime({workingSetGiB:spec.profile==='guided_speech_high'?1:2,conservativePreview:spec.profile.includes('relay')});started=true;
    const startupDeadline=Date.now()+180000;
    let ready=false;
    while(Date.now()<startupDeadline){
      if(!runtimeState().owned){
        const limits=await json(join(runtime,'ltx25-limits.json')).catch(()=>null);
        throw new Error(limits?.supervisorPid===launch.supervisorPid?limits.reason||'Renderer exited before startup.':runtimeState().error||'Renderer exited before startup.');
      }
      try{await supervised();await request('/system_stats');ready=true;break;}catch{/* Allow startup, then report precise reason. */}
      await pause(2000);
    }
    if(!ready){await supervised();throw new Error('Local renderer startup timed out.');}
    const runtimeReady=Date.now();
    const nodes=await (await request('/object_info')).json();
    for(const node of Object.values(graph))if(!nodes[node.class_type])throw new Error('Missing native node: '+node.class_type);
    const queue=await (await request('/queue')).json();
    if(queue.queue_running?.length||queue.queue_pending?.length)throw new Error('Another local render is queued.');
    for(const [name,bytes,type] of [[imageName,imageBytes,'image/jpeg'],...(audioBytes?[[audioName!,audioBytes,'audio/wav']]:[])] as [string,Buffer,string][]){
      const form=new FormData();form.set('image',new Blob([new Uint8Array(bytes)],{type}),name);form.set('type','input');form.set('overwrite','false');
      const upload=await (await request('/upload/image',{method:'POST',body:form})).json();
      if(upload.name!==name||upload.subfolder)throw new Error('Unexpected input upload path.');
    }
    const submitted=await (await request('/prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:graph,client_id:'alex-production-qualification'})})).json();
    if(!submitted.prompt_id||submitted.node_errors&&Object.keys(submitted.node_errors).length)throw new Error(JSON.stringify(submitted));
    await writeFile(join(folder,'submitted.json'),JSON.stringify(submitted,null,2));
    const began=Date.now(),deadline=began+2*60*60*1000;let logged=0,entry;
    while(Date.now()<deadline){
      const limits=await supervised();
      let history;
      try{history=await (await request('/history/'+submitted.prompt_id)).json();}
      catch(error){
        // A loaded renderer can briefly delay HTTP. Never resubmit the GPU job.
        await supervised();
        console.log(JSON.stringify({stage:'waiting-for-history',error:String(error)}));
        await pause(5000);continue;
      }
      entry=history[submitted.prompt_id];
      if(entry?.status?.status_str==='error'){await writeFile(join(folder,'history.json'),JSON.stringify(entry,null,2));throw new Error('Generation failed; see history.json and renderer.log.');}
      if(entry?.status?.completed)break;
      if(Date.now()-logged>30000){console.log(JSON.stringify({stage:'rendering',elapsedSeconds:Math.round((Date.now()-began)/1000),availableRamGiB:limits.availableRamBytes/2**30,usedGpuGiB:limits.usedGpuBytes/2**30}));logged=Date.now();}
      await pause(3000);
    }
    if(!entry?.status?.completed)throw new Error('Production qualification exceeded two hours.');
    await writeFile(join(folder,'history.json'),JSON.stringify(entry,null,2));
    const output=entry.outputs?.['17']?.images?.[0];
    if(!output||!/^[-\w.]+\.mp4$/.test(output.filename)||!/^Signal[\\/]video$/.test(output.subfolder)||output.type!=='output')throw new Error('Unexpected render output path.');
    const video=join(folder,'video.mp4');const response=await request('/view?'+new URLSearchParams(output));
    const stream=await open(video,'wx');let size=0;
    try{for await(const chunk of response.body!){size+=chunk.length;if(size>300*1024*1024)throw new Error('Video exceeded expected size.');await stream.write(chunk);}}finally{await stream.close();}
    await run(ffmpeg,['-v','error','-i',video,'-f','null','-'],{windowsHide:true,timeout:120000});
    const info=JSON.parse((await run(ffprobe,['-v','error','-show_format','-show_streams','-of','json',video],{windowsHide:true})).stdout);
    const v=info.streams.find((s:{codec_type:string})=>s.codec_type==='video');
    if(!v||v.width!==profile.width||v.height!==profile.height||Math.abs(Number(v.duration)-frames/24)>.1)throw new Error('Decoded dimensions or duration do not match the requested profile.');
    const a=info.streams.find((s:{codec_type:string})=>s.codec_type==='audio');
    if(audioBytes&&(!a||Math.abs(Number(a.duration)-frames/24)>.15))throw new Error('The output is missing the full narration track.');
    await run(ffmpeg,['-v','error','-i',video,'-vf',`fps=8/${frames/24},scale=216:-1,tile=4x2`,'-frames:v','1',join(folder,'contact.jpg')],{windowsHide:true,timeout:60000});
    const receipt={video,profile:spec.profile,elapsedSeconds:(Date.now()-began)/1000,decodeVerified:true,qualityApproved:false,validationOnly:!!spec.validationOnly,info,videoSha256:hash(await readFile(video)),sourceImageSha256:spec.imageSha256,sourceAudioSha256:spec.audioSha256,conditionedAudioSha256:audioBytes?hash(audioBytes):null,runtimeFingerprint:await previewFingerprint(),limits:await supervised(),published:false};
    const timings={preparationSeconds:(runtimeBegan-wallBegan)/1000,runtimeStartupSeconds:(runtimeReady-runtimeBegan)/1000,renderAndVerificationSeconds:receipt.elapsedSeconds,totalWallSeconds:(Date.now()-wallBegan)/1000,outputSeconds:frames/24,renderSecondsPerVideoSecond:receipt.elapsedSeconds/(frames/24),renderFramesPerSecond:frames/receipt.elapsedSeconds};
    await writeFile(join(folder,'receipt.json'),JSON.stringify({...receipt,timings},null,2));console.log(JSON.stringify({saved:true,video,receipt:join(folder,'receipt.json'),decodeVerified:true,qualityApproved:false,timings}));
  }catch(error){await writeFile(join(folder,'failure.json'),JSON.stringify({error:String(error),at:new Date().toISOString()},null,2));throw error;}
  finally{if(started)await stopLtxRuntime({shutdown:true});await lock.close();await unlink(lockPath);}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
