// Prepare a captioned review copy from a completed local talking shot.
// Quality review and publication are deliberately represented separately.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
const run=promisify(execFile);
const json=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const stamp=seconds=>{const n=Math.round(seconds*100);return `${Math.floor(n/360000)}:${String(Math.floor(n/6000)%60).padStart(2,'0')}:${String(Math.floor(n/100)%60).padStart(2,'0')}.${String(n%100).padStart(2,'0')}`;};
async function main(){
  const [receiptPath,briefId]=process.argv.slice(2);
  if(!receiptPath||!briefId)throw new Error('Usage: node apps/avatar-marketing/export-review.mjs render/receipt.json brief-id');
  const receipt=await json(receiptPath),voice=await json('campaigns/lemonade-tiktok/voice.json');
  const brief=(await json('campaigns/alex-creator/launch-briefs.json')).find(b=>b.id===briefId);
  if(!brief||!voice.productionApproved||!receipt.decodeVerified||receipt.validationOnly)throw new Error('Use an approved voice and a complete decoded production take.');
  const input=await json(join(dirname(receiptPath),'input.json'));
  const audio=resolve(input.audio),video=resolve(receipt.video);
  if(sha(await readFile(video))!==receipt.videoSha256||sha(await readFile(audio))!==receipt.sourceAudioSha256)throw new Error('The rendered media changed.');
  const audioReceipt=await json(audio.replace(/\.wav$/i,'.json'));
  if(audioReceipt.model!==voice.model||audioReceipt.modelRevision!==voice.modelRevision||audioReceipt.speaker!==voice.speaker||audioReceipt.text!==brief.script)throw new Error('Narration does not match this brief or the approved voice identity.');
  const transcript=await json(audio.replace(/\.wav$/i,'-transcript.json'));
  const words=transcript.segments.flatMap(s=>s.words),exact=brief.script.split(/\s+/);
  // Preserve the written script (including homophones); refuse guessed alignment.
  if(words.length!==exact.length||transcript.wordSequenceSimilarity<.9)throw new Error('Caption alignment needs manual correction.');
  const cues=[];let start=0;
  for(let i=0;i<words.length;i++){
    if(i-start>=4||/[.!?]$/.test(exact[i])||i===words.length-1||words[i+1].start-words[i].end>.35){
      const end=Math.min(words[i].end+.12,words[i+1]?.start??audioReceipt.durationSeconds);
      cues.push({start:words[start].start,end,text:exact.slice(start,i+1).join(' ')});start=i+1;
    }
  }
  const folder=resolve('output/alex-creator/exports',briefId+'-'+randomUUID());await mkdir(folder,{recursive:true});
  let exportAudio=audio,roomAudio=null;
  if(input.roomAudioProfile){
    const roomProfile=await json(resolve(input.roomAudioProfile));
    if(roomProfile.status?.startsWith('user-rejected'))throw new Error('This room-audio treatment was rejected; select a revised profile before export.');
    const mixFolder=join(folder,'room-audio');
    await run(resolve('data/avatar-runtime/qwen-env/Scripts/python.exe'),[
      resolve('apps/avatar-marketing/room-audio.py'),audio,mixFolder,'--profile',resolve(input.roomAudioProfile),
      '--source-sha256',receipt.sourceAudioSha256,
    ],{windowsHide:true,timeout:120000});
    roomAudio=await json(join(mixFolder,'receipt.json'));
    exportAudio=roomAudio.outputs.room.path;
    if(!roomAudio.sourceUnchanged||Math.abs(roomAudio.alignmentLagSamples)>2||sha(await readFile(exportAudio))!==roomAudio.outputs.room.sha256)throw new Error('Room mix failed integrity or timing validation.');
  }
  const ass=`[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,62,&H00FFFFFF,&H00FFFFFF,&H00171717,&H70000000,-1,0,0,0,100,100,0,0,1,3,1,2,110,110,390,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`+cues.map(c=>`Dialogue: 0,${stamp(c.start)},${stamp(c.end)},Default,,0,0,0,,${c.text.replace(/[{}\\]/g,'')}`).join('\n');
  await writeFile(join(folder,'captions.ass'),ass);await writeFile(join(folder,'caption-timings.json'),JSON.stringify(cues,null,2));
  const ffmpeg=join(process.env.LOCALAPPDATA,'Signal/runtime/video-tools/ffmpeg/ffmpeg-9.0.1-essentials_build/bin/ffmpeg.exe');
  const dest=join(folder,'video.mp4');
  const native=receipt.info.streams.find(s=>s.codec_type==='video');
  await run(ffmpeg,['-v','error','-i',video,'-i',exportAudio,'-map','0:v:0','-map','1:a:0','-vf','scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,setsar=1,subtitles=captions.ass','-af','apad','-t',String(Number(native.duration)),'-c:v','libx264','-crf','18','-preset','medium','-pix_fmt','yuv420p','-threads','2','-c:a','aac','-b:a','192k','-movflags','+faststart',dest],{cwd:folder,windowsHide:true,timeout:600000});
  await run(ffmpeg,['-v','error','-i',dest,'-f','null','-'],{windowsHide:true,timeout:120000});
  await run(ffmpeg,['-v','error','-ss','2.3','-i',dest,'-frames:v','1','review-frame.jpg'],{cwd:folder,windowsHide:true,timeout:60000});
  const result={path:dest,briefId,caption:brief.caption,aiLabel:true,commercialDisclosure:brief.commercialDisclosure,renderReceipt:resolve(receiptPath),sourceAudioSha256:receipt.sourceAudioSha256,roomAudio,videoSha256:sha(await readFile(dest)),decodeVerified:true,nativeResolution:`${native.width}x${native.height}`,exportResolution:'1080x1920',qualityApproved:false,published:false,captionAlignment:'ASR timings with exact script words; visual review required'};
  await writeFile(join(folder,'receipt.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
