import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assessSource, prepareBrief, splitTimeline, shotDocument, zImageGraph, fingerprint, alexDirection, voiceGraph, audioOverlayGraph } from './pipeline.mjs';
import { ltxStatus } from '../demo-studio/ltx.mjs';
import { studioCommand } from '../demo-studio/client.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const campaign=join(root,'campaigns/lemonade-tiktok');
const output=join(root,'output/lemonade-tiktok');
const json=async file=>JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));
const save=async(file,value)=>{await mkdir(dirname(file),{recursive:true});await writeFile(file,JSON.stringify(value,null,2)+'\n');};
const run=promisify(execFile);
const command=process.argv[2]||'status';

async function prepare(){
  const config=await json(join(campaign,'campaign.json'));
  const creator=await json(join(root,config.accountProfile));
  const character=await json(join(campaign,'character.json'));
  const face=await readFile(join(root,character.facePath));
  if(fingerprint(face)!==character.faceSha256) throw new Error('Face reference changed; re-lock explicitly.');
  const sources=await json(join(campaign,'sources.json'));
  const briefs=await json(join(campaign,'briefs.json'));
  const voice=await json(join(campaign,'voice.json'));
  const prepared=briefs.map(b=>prepareBrief(b,sources,character));
  for(const b of prepared){
    const folder=join(output,'plans',b.id);
    await save(join(folder,'plan.json'),{...b,creatorAccountId:creator.id,accountProfile:config.accountProfile,contentIntent:'commercial',voiceProfile:voice,voiceProfileHash:fingerprint(voice),timeline:splitTimeline(b.durationSeconds),timing:'Provisional. Re-time from the approved narration WAV before rendering.'});
    await writeFile(join(folder,'script.txt'),b.script+'\n');
    await writeFile(join(folder,'direction.txt'),shotDocument('imported-reference-asset-id',character)+'\n');
    await save(join(folder,'voice-lines.json'),b.delivery.map((line,index)=>({index,text:line.text,instruct:line.direction,profileId:voice.id,model:voice.model,speaker:voice.speaker,seed:42})));
    for(const [index,line] of b.delivery.entries()) await save(join(folder,`voice-line-${index+1}-api.json`),voiceGraph(line,voice,index+1));
  }
  const ranking=sources.map(s=>assessSource(s)).sort((a,b)=>b.score-a.score);
  await save(join(output,'research-ranking.json'),ranking);
  const prompt=await readFile(join(campaign,'face-prompt.txt'),'utf8');
  await save(join(campaign,'workflows/z-image-face-api.json'),zImageGraph(prompt));
  await save(join(campaign,'workflows/z-image-identity-lora-api.json'),zImageGraph('alexpresenter_v1, '+prompt,'alex-presenter-v1.safetensors'));
  await save(join(campaign,'workflows/voice-overlay-api.json'),audioOverlayGraph());
  console.log(JSON.stringify({saved:true,plans:prepared.length,folder:output,verifiedBreakoutCandidates:ranking.filter(x=>x.classification==='verified-breakout-candidate').length,rendered:false}));
}

async function scout(){
  const config=await json(join(campaign,'campaign.json'));
  const creator=await json(join(root,config.accountProfile));
  const commercial=process.argv[3]==='campaign';
  const research=commercial?config.research:creator.research;
  const tasks=research.queries.map(query=>({query,url:'https://www.tiktok.com/search?q='+encodeURIComponent(query),state:'needs-source-review'}));
  const searx=process.env.SIGNAL_TREND_SEARX_URL;
  let results=[],detail='No SearXNG endpoint configured. Research task list saved for the connected browsing agent. Search results are candidates, not verified trends.';
  if(searx){
    const base=new URL(searx);
    if(base.protocol!=='http:'||!['127.0.0.1','localhost'].includes(base.hostname)||base.username||base.password) throw new Error('SearXNG must be a credential-free local endpoint.');
    for(const {query} of tasks){const url=new URL('/search',base);url.searchParams.set('q','site:tiktok.com '+query);url.searchParams.set('format','json');url.searchParams.set('time_range','week');
      const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw new Error('Search HTTP '+response.status);
      const data=await response.json();results.push({query,results:(data.results??[]).slice(0,8).map(r=>({title:String(r.title).slice(0,300),url:r.url,snippet:String(r.content??'').slice(0,700)}))});
    }detail='Search completed. Watch and verify source metrics before ranking as a breakout.';
  }
  const receipt={at:new Date().toISOString(),creatorAccountId:creator.id,scope:commercial?'product-campaign':'creator-editorial',accountProfile:config.accountProfile,modeling:research.modeling,detail,tasks,results,creativeCenter:config.research.creativeCenter};
  await save(join(output,'research-tasks.json'),receipt);console.log(JSON.stringify(receipt,null,2));
}

async function draftVoice(){
  const briefs=await json(join(campaign,'briefs.json'));
  const id=process.argv[3]||briefs[0].id;
  const brief=briefs.find(b=>b.id===id);if(!brief)throw new Error('Unknown brief.');
  const runtime=join(process.env.LOCALAPPDATA,'Signal/runtime/narration');
  const folder=join(output,'voice-auditions',id);await mkdir(folder,{recursive:true});
  const manifest=await json(join(runtime,'model-manifest.json'));
  for(const f of manifest.files)if(fingerprint(await readFile(join(runtime,f.name)))!==f.sha256)throw new Error('Narration model checksum mismatch.');
  const spec=join(folder,'input.json');
  await save(spec,{text:brief.script,voice:'am_michael',speed:1,maximumSeconds:60,runtime});
  await run(join(runtime,'venv/Scripts/python.exe'),['-s',join(root,'src/core/video/limited_runtime.py'),'--cpu-only','--ram-gb','4','--status',join(folder,'limits.json'),'--',join(root,'src/core/video/narrate.py'),spec],{windowsHide:true,timeout:180000,maxBuffer:1024*1024});
  const result=await json(join(folder,'narration.json'));
  await save(join(folder,'receipt.json'),{...result,backend:'kokoro',purpose:'Draft audition only. Not the approved Alex production voice.',qualityApproved:false,scriptSha256:fingerprint(brief.script),modelManifest:manifest});
  console.log(JSON.stringify({saved:true,audio:join(folder,'narration.wav'),duration:result.duration,qualityApproved:false}));
}

async function studioPrepare(){
  const character=await json(join(campaign,'character.json'));
  const imported=await studioCommand({action:'asset.import',path:join(root,character.outfitPath),title:'Alex active outfit',role:'reference'});
  const asset=imported.asset??imported;
  if(!asset.id)throw new Error('Studio returned no reference asset ID. Open a session first.');
  const plan=await studioCommand({action:'ltx.prepare',direction:alexDirection(asset.id,5,character)});
  await save(join(output,'studio-preview-plan.json'),plan);console.log(JSON.stringify(plan,null,2));
}

try {
  if(command==='prepare') await prepare();
  else if(command==='research') await scout();
  else if(command==='voice-draft') await draftVoice();
  else if(command==='studio-prepare') await studioPrepare();
  else if(command==='status'){
    const status={checkedAt:new Date().toISOString(),localProduction:await json(join(root,'campaigns/alex-creator/render-profile.json')),ltxLegacyPreview:await ltxStatus(),voice:await json(join(campaign,'voice.json')),publishingEnabled:false};
    await save(join(output,'status.json'),status);console.log(JSON.stringify(status,null,2));
  } else throw new Error('Commands: status, research, prepare, voice-draft [brief-id], studio-prepare');
}catch(error){console.error(error.message);process.exitCode=1;}
