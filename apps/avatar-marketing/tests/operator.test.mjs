import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Operator,readJson,saveJson,hash,calendar,zonedTime} from '../operator.mjs';
import {shotTiming} from '../production-job.mjs';
const config=await readJson('campaigns/alex-creator/automation.json');
const now=Date.parse('2026-10-24T15:00:00Z');
const brief=(id='test-brief')=>({id,title:'Everyday test',script:'Why does this happen in every house? Things collect in the same spot. Somehow it becomes the official storage system.',voiceDirection:'Warm conversational delivery.',caption:'An everyday observation.',intent:'entertainment',mode:'original-test',sourceIds:[],pattern:'Everyday observation',twist:'Storage gets a fictional official title',changedElements:['New script','New visual','New payoff'],commercialDisclosure:'none',aiLabel:true});
async function fixture(t){const workspace=await mkdtemp(join(tmpdir(),'alex-operator-'));t.after(()=>rm(workspace,{recursive:true,force:true}));return new Operator({workspace,statePath:join(workspace,'state.json'),config,now:()=>now});}
async function ready(op,id='test-brief',bytes='video fixture',input=brief(id)){
  await op.submit(input);const video=join(op.workspace,id+'.mp4');await writeFile(video,bytes);const sha=hash(bytes),receipt=join(op.workspace,id+'.json');
  await saveJson(receipt,{briefId:id,path:video,videoSha256:sha,decodeVerified:true,aiLabel:true,durationSeconds:15,audioVerification:{completeSourceDurationPreserved:true,zeroLagCorrelation:1}});await op.attachExport(id,receipt);
  await op.review({jobId:id,videoSha256:sha,reviewer:'Test fixture only',checks:Object.fromEntries(config.quality.required.map(k=>[k,true])),notes:'Synthetic state-machine fixture; not real video approval.'});return {video,sha};
}
async function preflight(op,posts=[]){const p=join(op.workspace,'preflight.json');await saveJson(p,{account:config.account,brandId:config.metricoolBrandId,uploadAvailable:true,aiLabelSupported:true,checkedAt:new Date(now).toISOString(),existingTikTokPosts:posts});return p;}
async function sourceFixture(op) {
  const evidencePath=join(op.workspace,'watch-evidence.txt');await writeFile(evidencePath,'Synthetic test observations only.');
  const at=new Date(now).toISOString(),publishedAt=new Date(now-86400000).toISOString();
  return {id:'test-source',url:'https://www.tiktok.com/@test/video/999',title:'Test source',creator:'@test',region:'US',kind:'organic',publishedAt,discoveredAt:at,observations:[{at,views:30000,likes:400,comments:20,shares:30,evidence:evidencePath,method:'direct'}],baselineViews:[1000,2000,3000,4000,5000],contentReviewed:true,hook:'Question',structure:'Setup and payoff',payoff:'Unexpected ending',buyerFit:.8,reproducibility:.8,notes:'Synthetic fixture; not live trend evidence.',watchEvidence:evidencePath,baselineEvidence:[1000,2000,3000,4000,5000].map((views,i)=>({url:`https://www.tiktok.com/@test/video/${i+1}`,views,publishedAt,observedAt:at,evidencePath}))};
}

test('modeled source requires traceable baselines and unmodified watch evidence',async t=>{
  const op=await fixture(t),source=await sourceFixture(op);
  await assert.rejects(op.addSource({...source,baselineEvidence:[]}),/distinct source/);
  await assert.rejects(op.addSource({...source,baselineEvidence:source.baselineEvidence.map((b,i)=>i===0?{...b,url:'https://www.tiktok.com/@other/video/123'}:b)}),/same creator/);
  assert.equal((await op.addSource(source)).classification,'verified-breakout-candidate');
  await writeFile(source.watchEvidence,'Modified evidence');
  await assert.rejects(op.submit({...brief(),mode:'modeled',sourceIds:[source.id]}),/hash changed/);
});

test('modeled source must remain fresh at scheduled publication',async t=>{
  const op=await fixture(t),source=await sourceFixture(op);await op.addSource(source);
  await ready(op,'modeled-test','video fixture',{...brief('modeled-test'),mode:'modeled',sourceIds:[source.id]});
  await assert.rejects(op.claim({jobId:'modeled-test',at:zonedTime('2026-10-27','10:00',config.timezone),account:config.account,remotePreflight:await preflight(op)}),/stale at publication/);
});
test('Pacific slots survive DST without changing local publication hour',()=>{
  assert.equal(zonedTime('2026-10-31','10:00',config.timezone),'2026-10-31T17:00:00.000Z');
  assert.equal(zonedTime('2026-11-01','10:00',config.timezone),'2026-11-01T18:00:00.000Z');
  const slots=calendar(config,'2026-10-24',7,now);assert.equal(slots.length,21);assert.equal(slots.filter(s=>s.intent==='commercial').length,2);assert.equal(slots.filter(s=>s.intent==='practical-value').length,4);
});
test('rejects unverified trend modeling and duplicate scripts',async t=>{
  const op=await fixture(t);await assert.rejects(op.submit({...brief(),mode:'modeled'}),/breakout/);await op.submit(brief());await assert.rejects(op.submit(brief('another-id')),/Duplicate/);
});
test('commercial content requires evidence and correct disclosure',async t=>{
  const op=await fixture(t);await assert.rejects(op.submit({...brief(),intent:'commercial'}),/disclosure/);await assert.rejects(op.submit({...brief(),intent:'commercial',commercialDisclosure:'own-product'}),/evidence/);
});
test('persisted attempt prevents duplicate scheduling even after restart',async t=>{
  const op=await fixture(t);await ready(op);const remotePreflight=await preflight(op);
  const input={jobId:'test-brief',at:'2026-10-24T17:00:00Z',account:config.account,remotePreflight};const packet=await op.claim(input);assert.equal(packet.aiLabel,true);
  const restarted=new Operator({workspace:op.workspace,statePath:op.statePath,config,now:()=>now});await assert.rejects(restarted.claim(input),/ready|attempt/);assert.equal((await restarted.load()).attempts.length,1);
});
test('modified bytes and occupied remote slots are blocked before side effects',async t=>{
  const op=await fixture(t);const {video}=await ready(op);let remotePreflight=await preflight(op,[{at:'2026-10-24T17:00:00Z'}]);const input={jobId:'test-brief',at:'2026-10-24T17:00:00Z',account:config.account,remotePreflight};await assert.rejects(op.claim(input),/Remote/);
  remotePreflight=await preflight(op);await writeFile(video,'changed');await assert.rejects(op.claim({...input,remotePreflight}),/hash/);assert.equal((await op.load()).attempts.length,0);
});
test('three remote posts consume the daily allowance',async t=>{
  const op=await fixture(t);await ready(op);const remotePreflight=await preflight(op,['16:00','18:00','20:00'].map(time=>({at:`2026-10-24T${time}:00Z`})));await assert.rejects(op.claim({jobId:'test-brief',at:'2026-10-24T21:00:00Z',account:config.account,remotePreflight}),/Remote/);
});
test('published state requires actual account URL and receipt',async t=>{
  const op=await fixture(t);await ready(op);const remotePreflight=await preflight(op),packet=await op.claim({jobId:'test-brief',at:'2026-10-24T17:00:00Z',account:config.account,remotePreflight});const providerReceipt=join(op.workspace,'provider.json');await saveJson(providerReceipt,{testFixture:true});
  await assert.rejects(op.record({attemptId:packet.attempt.id,state:'published',providerReceipt,remoteId:'fixture',publicUrl:'https://www.tiktok.com/@wrong/video/1',publishedAt:'2026-10-24T17:00:00Z'}),/correct TikTok/);
});
test('timeline uses phrase timing and preserves complete closing audio',()=>{
  const script='An opening question? Some middle words. A final thought.';const exact=script.split(' ');const starts=[0,.3,.8,3,3.3,3.6,6,6.2,6.5];const transcript={wordSequenceSimilarity:1,segments:[{words:exact.map((word,i)=>({word,start:starts[i],end:starts[i]+.25}))}]};const t=shotTiming(script,transcript,7);assert.ok(t.totalFrames/24>=7);assert.equal(t.openingFrames%8,1);assert.equal(t.closingFrames%8,1);assert.ok(t.middleFrames>24);
});
test('rounding closing latent frames does not add excessive silence',()=>{
  const script='First opening sentence? Middle sentence here. Final closing thought.';
  const exact=script.split(' '),starts=[0,1,3.94,5.68,8,10.84,11.66,12.58,14.1],ends=[.38,1.48,4.26,6.72,9.18,11.12,11.98,13.58,14.32];
  const t=shotTiming(script,{wordSequenceSimilarity:1,segments:[{words:exact.map((word,i)=>({word,start:starts[i],end:ends[i]}))}]},14.56);
  assert.ok(t.totalFrames/24>=14.56);assert.ok(t.totalFrames/24-14.56<1/24);assert.ok(t.closingStartFrame/24>=11.12);
});
