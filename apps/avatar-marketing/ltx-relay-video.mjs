import {open,readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {workspace,upscale,sha256,json,save,exists,probe,encode,run} from './relayvsr.mjs';

export function planShots(shots){
  if(!Array.isArray(shots)||!shots.length||shots.length>500)throw new Error('Supply 1-500 explicit shots.');
  let start=0;return shots.map((shot,index)=>{if(!Number.isInteger(shot.frames)||shot.frames<24||shot.frames>192||typeof shot.prompt!=='string'||!shot.prompt.trim()||!/^([a-f0-9]{64})$/.test(shot.imageSha256))throw new Error('Each shot needs 24-192 frames, a prompt and a hashed reference.');const result={...shot,index,start,end:start+shot.frames,generatedFrames:8*Math.ceil((shot.frames-1)/8)+1};start=result.end;return result;});
}
async function render(manifest,logPath){
  const log=await open(logPath,'wx');
  try{await new Promise((resolvePromise,reject)=>{const child=spawn(process.execPath,['--import','tsx','apps/avatar-marketing/render-local.ts',manifest],{cwd:workspace,windowsHide:true,stdio:['ignore',log.fd,log.fd],env:process.env});child.once('error',reject);child.once('close',code=>code===0?resolvePromise():reject(new Error('LTX shot failed; see '+logPath)));});}finally{await log.close();}
}
async function renderReceipt(logPath){
  const records=(await readFile(logPath,'utf8')).split(/\r?\n/).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
  const completed=records.findLast(r=>r.saved&&r.receipt);if(completed)return completed.receipt;
  const started=records.find(r=>r.stage==='starting'&&r.folder);if(started&&await exists(join(started.folder,'receipt.json')))return join(started.folder,'receipt.json');
  throw new Error('An earlier render did not complete. Inspect its log and failure receipt before explicitly retrying.');
}
export async function produce(manifestPath,folder){
  const spec=await json(resolve(manifestPath));folder=resolve(folder);const shots=planShots(spec.shots),frames=shots.at(-1).end;
  const profile=spec.profile||'relay_fast';if(!['relay_fast','guided_speech_relay'].includes(profile))throw new Error('Use a Relay low-resolution profile.');
  const audio=resolve(spec.audio);if(await sha256(audio)!==spec.audioSha256)throw new Error('Narration changed.');
  const duration=Number((await probe(audio)).format.duration);
  if(!spec.excerpt&&Math.abs(frames/24-duration)>.15)throw new Error('Shot coverage must preserve the complete narration (within frame rounding). Set excerpt:true only for an intentional preview.');
  if(frames/24>duration+.15)throw new Error('Narration is shorter than the shot plan.');
  for(const shot of shots)if(await sha256(resolve(shot.image))!==shot.imageSha256)throw new Error('Shot reference changed.');
  const signature=createHash('sha256').update(JSON.stringify(spec)).digest('hex');await mkdir(folder,{recursive:true});
  const statePath=join(folder,'plan.json');if(await exists(statePath)){if((await json(statePath)).signature!==signature)throw new Error('Resume manifest changed. Use a new folder.');}else await save(statePath,{signature,shots,frames,profile,qualityApproved:false});
  const outputs=[],measurements=[],began=Date.now();
  for(const shot of shots){
    const shotFolder=join(folder,`shot-${String(shot.index).padStart(3,'0')}`);await mkdir(shotFolder,{recursive:true});
    const shotFile=join(shotFolder,'input.json'),log=join(shotFolder,'ltx.log');
    const reusedLtx=await exists(log);
    if(!reusedLtx){
      await save(shotFile,{profile,image:resolve(shot.image),imageSha256:shot.imageSha256,prompt:shot.prompt,seed:shot.seed??42,duration:shot.frames/24,audio,audioSha256:spec.audioSha256,audioStart:shot.start/24,validationOnly:true});
      await render(shotFile,log);
    }
    const ltxReceipt=await json(await renderReceipt(log));if(!ltxReceipt.decodeVerified||ltxReceipt.videoSha256!==await sha256(ltxReceipt.video))throw new Error('LTX shot receipt changed.');
    const relayFolder=join(shotFolder,'relay'),relayReceipt=join(relayFolder,'receipt.json');
    const reusedRelay=await exists(relayReceipt);
    const sr=reusedRelay?await json(relayReceipt):await upscale(ltxReceipt.video,relayFolder,{detail:spec.detail??.8});
    if(sr.sha256!==await sha256(sr.path))throw new Error('Upscaled shot changed.');
    const trimmed=join(shotFolder,'trimmed.mp4');if(!await exists(trimmed))await encode(['-i',sr.path,'-vf',`trim=end_frame=${shot.frames},setpts=PTS-STARTPTS`,'-an','-c:v','libx264','-threads','2','-crf','16','-pix_fmt','yuv420p',trimmed]);
    outputs.push(trimmed);measurements.push({shot:shot.index,ltxSeconds:ltxReceipt.elapsedSeconds,ltxWallSeconds:ltxReceipt.timings?.totalWallSeconds??null,relaySeconds:sr.elapsedSeconds,frames:shot.frames,reusedLtx,reusedRelay});
    await save(join(shotFolder,'receipt.json'),{output:trimmed,sha256:await sha256(trimmed),ltxReceipt,relayReceipt:sr,frames:shot.frames,qualityApproved:false});
    console.log(JSON.stringify({stage:'shot-complete',shot:shot.index+1,total:shots.length}));
  }
  const list=join(folder,'shots.txt');await writeFile(list,outputs.map(p=>`file '${p.replaceAll('\\','/').replaceAll("'","'\\''")}'`).join('\n'));
  const video=join(folder,'video.mp4');if(!await exists(video))await encode(['-f','concat','-safe','0','-i',list,'-i',audio,'-map','0:v:0','-map','1:a:0','-c:v','copy','-af','apad','-c:a','aac','-b:a','192k','-t',String(frames/24),'-movflags','+faststart',video]);
  await encode(['-i',video,'-f','null','-']);const info=await probe(video),v=info.streams.find(s=>s.codec_type==='video'),a=info.streams.find(s=>s.codec_type==='audio');
  if(Number(v.nb_read_frames)!==frames||v.width!==768||v.height!==1344||v.avg_frame_rate!=='24/1'||!a||Math.abs(Number(a.duration)-frames/24)>.1)throw new Error('Final video did not retain the expected picture and narration timing.');
  const invocationSeconds=(Date.now()-began)/1000;
  const fullyFresh=measurements.every(m=>!m.reusedLtx&&!m.reusedRelay);
  const receipt={path:video,sha256:await sha256(video),profile,sourceAudioSha256:spec.audioSha256,frames,durationSeconds:frames/24,nativeResolution:[384,672],outputResolution:[768,1344],decodeVerified:true,qualityApproved:false,excerpt:!!spec.excerpt,measurements,invocationSeconds,totalFreshWallSeconds:fullyFresh?invocationSeconds:null,wallSecondsPerVideoSecond:fullyFresh?invocationSeconds/(frames/24):null,info};await save(join(folder,'receipt.json'),receipt);return receipt;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!process.argv[2]||!process.argv[3])throw new Error('Usage: node ltx-relay-video.mjs manifest.json output-folder (inside alex_generation_supervisor).');
  await run(join(workspace,'data/avatar-runtime/qwen-env/Scripts/python.exe'),['-B','apps/avatar-marketing/alex_generation_supervisor.py','--workspace',workspace,'--check-generation','--require-owned'],{cwd:workspace,windowsHide:true,timeout:10000});
  produce(process.argv[2],process.argv[3]).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e);process.exitCode=1;});
}
