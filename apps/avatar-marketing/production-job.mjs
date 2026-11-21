import {generationHold} from './generation-hold.mjs';
import {runtimeEnvironment} from './runtime-environment.mjs';
import {mkdir, open, unlink, access} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readJson, saveJson, checkAsset, dayAt} from './operator.mjs';
const run=promisify(execFile);
const exists=async p=>{try{await access(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
export function shotTiming(script, transcript, duration) {
  const exact=script.split(/\s+/),words=transcript.segments.flatMap(s=>s.words);
  if(exact.length!==words.length||transcript.wordSequenceSimilarity<.9)throw new Error('Speech alignment needs review; no guessed captions or cuts.');
  const ends=exact.map((w,i)=>/[.!?]$/.test(w)?i:-1).filter(i=>i>=0);
  if(ends.length<3)throw new Error('Use an opening sentence, middle observation and closing sentence.');
  const firstEnd=words[ends[0]].end, lastStart=words[ends.at(-2)+1].start;
  const nextStart=words[ends[0]+1].start,previousEnd=words[ends.at(-2)].end;
  const openingFrames=Math.min(8*Math.ceil(((firstEnd+.25)*24-1)/8)+1,8*Math.floor((nextStart*24-1)/8)+1);
  const totalFrames=Math.ceil(duration*24);
  const closingFrames=8*Math.ceil(((duration-(lastStart-.25))*24-1)/8)+1;
  const closingStartFrame=totalFrames-closingFrames;
  if(openingFrames/24<firstEnd||closingStartFrame/24<previousEnd||openingFrames/24>5.5||closingFrames/24>5.5||closingFrames<25||closingStartFrame-openingFrames<24)throw new Error('Keep opening and closing phrases below 5.5 seconds with short pauses and room for a distinct cutaway. Revise the script, not the guidance.');
  return {openingFrames,closingStartFrame,closingFrames,totalFrames,middleFrames:closingStartFrame-openingFrames};
}
export async function machineReady(workspace) {
  const hold=generationHold(); if(!hold.ready)return hold;
  const checked=JSON.parse((await run(join(workspace,'data/avatar-runtime/qwen-env/Scripts/python.exe'),['-B','apps/avatar-marketing/alex_generation_supervisor.py','--workspace',workspace,'--check-generation'],{cwd:workspace,windowsHide:true,timeout:10000})).stdout);
  if(await exists(join(workspace,'output/alex-creator/renders/render.lock')))return {ready:false,reason:'Another GPU job owns the renderer lock.'};
  return checked;
}
async function child(command,args,{cwd,log,onRecord}={}) {
  const environment=await runtimeEnvironment(cwd);
  return new Promise((resolvePromise,reject)=>{
    const supervisor=join(cwd,'data/avatar-runtime/qwen-env/Scripts/python.exe');
    const guardedArgs=['-B',join(cwd,'apps/avatar-marketing/alex_generation_supervisor.py'),'--workspace',cwd,'--',command,...args];
    const proc=spawn(supervisor,guardedArgs,{cwd,env:{...process.env,...environment,PYTHONDONTWRITEBYTECODE:'1'},windowsHide:true,stdio:['ignore','pipe','pipe']});let pending='',last,callback=Promise.resolve(),failed;
    const consume=chunk=>{pending+=chunk.toString();for(let at;(at=pending.indexOf('\n'))>=0;){const line=pending.slice(0,at).trim();pending=pending.slice(at+1);if(log)log.write(line+'\n');try{const record=JSON.parse(line);last=record;if(onRecord)callback=callback.then(()=>onRecord(record)).catch(e=>{failed=e;});}catch{/* Non-JSON model progress. */}}};
    proc.stdout.on('data',consume);proc.stderr.on('data',chunk=>{if(log)log.write(chunk);});proc.on('error',reject);
    proc.on('close',async code=>{if(pending)consume('\n');await callback;if(failed)return reject(failed);if(code!==0)return reject(new Error('Production stage failed; inspect the job log (exit '+code+').'));resolvePromise(last);});
  });
}
export function newJobAllowance(config,state,job,now) {
  if(job.startedAt)return {ready:true};
  const batch=config.production.authorizedBatch;
  if(job.brief.productionBatch) {
    if(!batch||job.brief.productionBatch!==batch.id||batch.maximumJobs!==12||job.brief.mode!==batch.mode)return {ready:false,reason:'Unknown authorized production batch.'};
    const members=state.jobs.filter(j=>j.brief.productionBatch===batch.id);
    return members.length<=12&&members.filter(j=>j.startedAt).length<12 ? {ready:true} : {ready:false,reason:'Authorized batch limit reached.'};
  }
  const today=dayAt(now,config.timezone);
  return state.jobs.filter(j=>j.startedAt&&dayAt(j.startedAt,config.timezone)===today).length<config.production.maximumNewJobsPerDay ? {ready:true} : {ready:false,reason:'Daily production allowance reached.'};
}
export async function buildJob(operator,jobId,{preflightOnly=false}={}) {
  const workspace=operator.workspace,readiness=await machineReady(workspace);if(preflightOnly||!readiness.ready)return readiness;
  const lockPath=join(workspace,'data/alex-operator/worker.lock');await mkdir(resolve(lockPath,'..'),{recursive:true});let lock;
  try{lock=await open(lockPath,'wx');}catch(e){if(e.code==='EEXIST')return {ready:false,reason:'A production worker already owns the queue.'};throw e;}
  let log;
  try {
    await lock.writeFile(JSON.stringify({pid:process.pid,jobId,startedAt:new Date().toISOString()}));
    const state=await operator.load();let job=state.jobs.find(j=>j.id===jobId);
    if(!job||!['queued','building'].includes(job.state))throw new Error('Select a queued job. Failed jobs need inspection before retry.');
    if(!job.brief.cutaway)throw new Error('Fredward must create and inspect an original, distinct-location cutaway before production.');
    const allowance=newJobAllowance(operator.config,state,job,operator.now());
    if(!allowance.ready)return allowance;
    const folder=join(workspace,'output/alex-creator/jobs',job.id);await mkdir(folder,{recursive:true});log=await open(join(folder,'production.log'),'a');
    job=await operator.stage(jobId,{state:'building',startedAt:job.startedAt||new Date().toISOString(),error:null});
    const stages={...job.stages};
    const checkpoint=async(name,value)=>{stages[name]=value;await operator.stage(jobId,{stages:{...stages}});};
    const briefPath=join(folder,'briefs.json');await saveJson(briefPath,[{...job.brief,commercialDisclosure:job.brief.commercialDisclosure!=='none'}]);
    const audio=join(workspace,'output/alex-creator/voice',jobId,'ryan-42.wav');
    const qwen=join(workspace,'data/avatar-runtime/qwen-env/Scripts/python.exe'),cpu=join(workspace,'data/avatar-runtime/ditto-env/Scripts/python.exe');
    if(!await exists(audio.replace(/\.wav$/,'.json'))) {
      if(await exists(audio))throw new Error('Incomplete voice output exists; inspect before retrying.');
      await child(qwen,['-u','src/core/video/limited_runtime.py','--status',join(folder,'voice-limits.json'),'--ram-gb','16','--working-set-gb','3','--gpu-gb','5','--','apps/avatar-marketing/qwen-audition.py',briefPath,'--id',jobId],{cwd:workspace,log});
    }
    const voice=await readJson(audio.replace(/\.wav$/,'.json'));await checkAsset(audio,voice.sha256,workspace);if(voice.text!==job.brief.script)throw new Error('Stored voice belongs to a different script.');await checkpoint('voice',audio);
    const transcriptPath=audio.replace(/\.wav$/,'-transcript.json');if(!await exists(transcriptPath))await child(qwen,['apps/avatar-marketing/check-speech.py',audio],{cwd:workspace,log});
    const transcript=await readJson(transcriptPath),timing=shotTiming(job.brief.script,transcript,voice.durationSeconds);await checkpoint('timing',timing);
    const reference=await readJson(join(workspace,'campaigns/alex-creator/speaking-tripod-high-check.json'));
    for(const [name,frames,start] of [['opening',timing.openingFrames,0],['closing',timing.closingFrames,timing.closingStartFrame/24]]) {
      const speechFrames=frames/24;
      const existing=stages[name]&&await exists(join(stages[name],'receipt.json'))?await readJson(join(stages[name],'receipt.json')):null;
      const profile=stages.renderProfile||existing?.profile||operator.config.production.profile||reference.profile;
      if(!stages.renderProfile)await checkpoint('renderProfile',profile);
      const spec={...reference,profile,duration:speechFrames-.00001,validationOnly:name==='opening',audio,audioSha256:voice.sha256,audioStart:start,prompt:'One continuous shot of the man in the reference speaking the supplied words directly to a friend. Fixed eye-level phone on a rigid tripod, stable face scale and background, no zoom, pan or reframing. Warm attentive facial expression, relaxed jaw, clearly defined pupils and eyelids, natural brief blinks. Exact articulation of the supplied audio, with one small relaxed open-palm gesture near the waist and a subtle friendly smile after speaking. Same face, hair, espresso suede jacket, yellow polo, room and window daylight. No text or graphics.'};
      const specPath=join(folder,name+'.json');await saveJson(specPath,spec);
      let renderFolder=stages[name];
      if(renderFolder&&!await exists(join(renderFolder,'receipt.json')))throw new Error('Prior '+name+' render has no completed receipt; inspect it before retrying.');
      if(!renderFolder) {
        await child(process.execPath,['--import','tsx','apps/avatar-marketing/render-local.ts',specPath],{cwd:workspace,log,onRecord:async record=>{if(record.stage==='starting'&&record.folder){renderFolder=record.folder;await checkpoint(name,renderFolder);}}});
      }
      const receipt=await readJson(join(renderFolder,'receipt.json'));if(!receipt.decodeVerified)throw new Error('Render did not decode.');
      if(receipt.profile!==profile)throw new Error('This job already has a different render profile. Preserve it and use a new job for the new profile.');
      if(profile.includes('relay')) {
        const finished=join(folder,name+'-relay');
        const result=await child(process.execPath,['apps/avatar-marketing/relay-render.mjs',renderFolder,finished],{cwd:workspace,log});
        await checkpoint(name+'Relay',result.folder);renderFolder=result.folder;
      }
      await child(cpu,['apps/avatar-marketing/diagnose-eyes-camera.py',renderFolder],{cwd:workspace,log});
    }
    const mix=join(folder,'room-audio');if(!await exists(join(mix,'receipt.json')))await child(qwen,['apps/avatar-marketing/room-audio.py',audio,mix,'--profile','campaigns/alex-creator/room-audio-v2.json','--source-sha256',voice.sha256],{cwd:workspace,log});
    const room=await readJson(join(mix,'receipt.json'));
    const edit={briefId:jobId,briefPath,fps:24,frames:timing.totalFrames,sourceAudio:audio,sourceAudioSha256:voice.sha256,roomReceipt:join(mix,'receipt.json'),roomAudioSha256:room.outputs.room.sha256,shots:[{kind:'video',receipt:join(stages.openingRelay||stages.opening,'receipt.json'),frames:timing.openingFrames,audioStart:0},{kind:'still',image:job.brief.cutaway.image,imageSha256:job.brief.cutaway.sha256,prompt:job.brief.cutaway.promptPath,frames:timing.middleFrames,description:job.brief.cutaway.location},{kind:'video',receipt:join(stages.closingRelay||stages.closing,'receipt.json'),frames:timing.closingFrames,audioStart:timing.closingStartFrame/24}]};
    const manifest=join(folder,'edit.json');await saveJson(manifest,edit);
    if(!stages.export){const result=await child(process.execPath,['apps/avatar-marketing/export-edited-review.mjs',manifest],{cwd:workspace,log});await checkpoint('export',result.receipt);}
    return await operator.attachExport(jobId,stages.export);
  }catch(e){if(jobId)await operator.stage(jobId,{state:'needs-attention',error:e.message});throw e;}
  finally{await log?.close();await lock.close();await unlink(lockPath);}
}
