// Stream completed clips through FFmpeg. No diffusion model or Comfy frame tensor required.
import { readFile, writeFile, mkdir, readdir, access } from 'node:fs/promises';
import { resolve, join, dirname, extname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { fingerprint } from './pipeline.mjs';
const run=promisify(execFile);
const schema=z.object({
  title:z.string().min(1),voiceProfileId:z.string().min(1),voiceProfileHash:z.string().regex(/^[a-f0-9]{64}$/),
  audio:z.string().min(1),audioSha256:z.string().regex(/^[a-f0-9]{64}$/),
  clips:z.array(z.object({path:z.string().min(1),start:z.number().min(0).default(0),duration:z.number().min(.5).max(60),role:z.enum(['avatar','product','broll']),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).min(1).max(120),
  qualityApproved:z.literal(true),
}).strict();

async function findFfmpeg(){
  if(process.env.AVATAR_FFMPEG)return process.env.AVATAR_FFMPEG;
  const root=join(process.env.LOCALAPPDATA||'','Signal/runtime/video-tools/ffmpeg');
  const queue=[root];
  for(let i=0;i<queue.length && i<20;i++)for(const entry of await readdir(queue[i],{withFileTypes:true})){const p=join(queue[i],entry.name);if(entry.isDirectory())queue.push(p);else if(entry.name==='ffmpeg.exe')return p;}
  throw new Error('Set AVATAR_FFMPEG to the installed ffmpeg executable.');
}
async function main(){
  if(!process.argv[2])throw new Error('Usage: node apps/avatar-marketing/assemble.mjs manifest.json');
  const specPath=resolve(process.argv[2]),base=dirname(specPath),spec=schema.parse(JSON.parse(await readFile(specPath,'utf8')));
  const profilePath=resolve('campaigns/lemonade-tiktok/voice.json');
  const profile=JSON.parse(await readFile(profilePath,'utf8'));
  if(!profile.productionApproved||profile.id!==spec.voiceProfileId||fingerprint(profile)!==spec.voiceProfileHash)throw new Error('Voice profile is unapproved or changed since the audio was rendered.');
  const ffmpeg=await findFfmpeg(),ffprobe=join(dirname(ffmpeg),'ffprobe.exe');await access(ffprobe);
  const mediaInfo=async path=>JSON.parse((await run(ffprobe,['-v','error','-show_format','-show_streams','-of','json',path],{windowsHide:true,timeout:30000})).stdout);
  const audio=resolve(base,spec.audio);
  if(fingerprint(await readFile(audio))!==spec.audioSha256)throw new Error('Narration WAV changed after approval.');
  const ai=await mediaInfo(audio),duration=Number(ai.format.duration);
  const total=spec.clips.reduce((n,c)=>n+c.duration,0);
  if(!Number.isFinite(duration)||duration<=0||total>600||total<duration||total-duration>1)throw new Error('Retiming required: video must cover all speech and end within one second after it.');
  const folder=resolve('output/lemonade-tiktok/exports',randomUUID());await mkdir(folder,{recursive:true});
  const normalized=[];
  for(const [i,clip] of spec.clips.entries()){
    const path=resolve(base,clip.path);if(!['.mp4','.mov','.webm'].includes(extname(path).toLowerCase()))throw new Error('Use completed video clips, not still-image placeholders.');
    if(fingerprint(await readFile(path))!==clip.sha256)throw new Error('Clip changed after review: '+path);
    const info=await mediaInfo(path);if(!info.streams.some(s=>s.codec_type==='video')||Number(info.format.duration)+.05<clip.start+clip.duration)throw new Error('Source clip is shorter than the edit.');
    const dest=join(folder,`part-${i}.mp4`);
    await run(ffmpeg,['-hide_banner','-loglevel','error','-i',path,'-ss',String(clip.start),'-t',String(clip.duration),'-an','-vf','scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24','-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p','-threads','2',dest],{windowsHide:true,timeout:600000});
    normalized.push(dest);
  }
  const list=join(folder,'concat.txt');
  await writeFile(list,normalized.map(path=>`file '${path.replaceAll('\\','/').replaceAll("'","'\\''")}'`).join('\n'));
  const final=join(folder,'video.mp4');
  await run(ffmpeg,['-hide_banner','-loglevel','error','-f','concat','-safe','0','-i',list,'-i',audio,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-af','apad','-t',String(total),'-movflags','+faststart',final],{windowsHide:true,timeout:600000});
  await run(ffmpeg,['-v','error','-i',final,'-f','null','-'],{windowsHide:true,timeout:600000});
  const receipt={title:spec.title,path:final,decoded:true,info:await mediaInfo(final),audioSha256:spec.audioSha256,voiceProfileId:spec.voiceProfileId,voiceProfileHash:spec.voiceProfileHash,manifest:spec,finalPlaybackApproved:false,published:false};
  await writeFile(join(folder,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify({saved:true,path:final,decoded:true,finalPlaybackApproved:false}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
