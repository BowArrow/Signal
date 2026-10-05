const fs=require('node:fs'), path=require('node:path'), {spawnSync}=require('node:child_process');
const {secret}=require('../../Lemonade/scripts/growth-cloud.cjs');
const folder=path.resolve('output/openart-ads/final');
const jobs=[
 {key:'lemonade',voice:'EXAVITQu4vr4xnSDxMaL',name:'Sarah',text:"Before you send that report. Ask Lemonade what doesn't add up. Check the answer against its sources. Keep working in an editable spreadsheet. Forty-nine dollars, once. Try it free for fourteen days."},
 {key:'cinegen',voice:'iP95p4xoKVk53GoZ742B',name:'Chris',text:'Your idea deserves a finished cut. Plan your shots in CineGen. Shape the moment in the editor. Bring video and audio into one timeline. Your next story starts here. Try CineGen free.'}
];
(async()=>{
 const config=JSON.parse(await secret('cinegen-12360','RUNTIME_CONFIG'));const key=config.elevenlabs?.key;if(!key)throw Error('Voice credential unavailable');
 const before=await fetch('https://api.elevenlabs.io/v1/user/subscription',{headers:{'xi-api-key':key}}).then(r=>r.json());
 if(before.character_limit-before.character_count<1500)throw Error('Insufficient included voice allowance');
 const ffmpeg=path.join(process.env.LOCALAPPDATA,'Signal/runtime/video-tools/ffmpeg/ffmpeg-9.0.1-essentials_build/bin/ffmpeg.exe');
 for(const job of jobs){
  const dir=path.join(folder,job.key);fs.mkdirSync(dir,{recursive:true});
  if(fs.existsSync(path.join(dir,'cloud-voice.json'))){const old=JSON.parse(fs.readFileSync(path.join(dir,'cloud-voice.json')));if(old.script===job.text&&fs.existsSync(path.join(dir,'narration.wav'))){console.log(job.key+': reusing saved cloud narration');continue;}throw Error('Existing narration differs; review before spending again');}
  const r=await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${job.voice}/with-timestamps?output_format=mp3_44100_128`,{method:'POST',headers:{'xi-api-key':key,'Content-Type':'application/json'},body:JSON.stringify({text:job.text,model_id:'eleven_multilingual_v2',voice_settings:{stability:0.48,similarity_boost:0.75,style:0.12,speed:1.08,use_speaker_boost:true}}),signal:AbortSignal.timeout(90000)});
  if(!r.ok)throw Error('Voice generation HTTP '+r.status);
  const d=await r.json();if(!d.audio_base64||!d.normalized_alignment)throw Error('Voice audio or timing missing');
  fs.writeFileSync(path.join(dir,'narration.mp3'),Buffer.from(d.audio_base64,'base64'));
  const a=d.normalized_alignment, text=a.characters.join(''), cues=[];
  for(const match of text.matchAll(/[^.!?]+[.!?]+/g)){const lead=match[0].length-match[0].trimStart().length;const start=match.index+lead,end=match.index+match[0].length-1;cues.push({text:match[0].trim(),start:a.character_start_times_seconds[start],end:a.character_end_times_seconds[end]});}
  if(cues.length!==6)throw Error('Cloud timing sentence count differs');
  const info={duration:Math.max(...a.character_end_times_seconds),sampleRate:24000,voice:'ElevenLabs '+job.name,provider:'ElevenLabs',model:'eleven_multilingual_v2',cues};
  const converted=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-nostdin','-threads','2','-i',path.join(dir,'narration.mp3'),'-ar','24000','-ac','1','-c:a','pcm_s16le',path.join(dir,'narration.wav')],{windowsHide:true,encoding:'utf8'});if(converted.status!==0)throw Error('Audio decode failed');
  fs.writeFileSync(path.join(dir,'narration.json'),JSON.stringify(info,null,2));fs.writeFileSync(path.join(dir,'cloud-voice.json'),JSON.stringify({script:job.text,voiceId:job.voice,...info},null,2));console.log(JSON.stringify({product:job.key,voice:info.voice,cues,characters:job.text.length}));
 }
 const after=await fetch('https://api.elevenlabs.io/v1/user/subscription',{headers:{'xi-api-key':key}}).then(r=>r.json());
 fs.writeFileSync(path.join(folder,'voice-usage.json'),JSON.stringify({provider:'ElevenLabs',tier:after.tier,beforeUsed:before.character_count,afterUsed:after.character_count,includedLimit:after.character_limit,includedBalance:after.character_limit-after.character_count,checkedAt:new Date().toISOString()},null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
