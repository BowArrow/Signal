import {readFile, writeFile, mkdir, open, rename, unlink, realpath} from 'node:fs/promises';
import {resolve, join, dirname, relative, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import {z} from 'zod';
import {assessSource, sourceSchema} from './pipeline.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const readJson = async p => JSON.parse((await readFile(p, 'utf8')).replace(/^\uFEFF/, ''));
export const saveJson = async (p, value) => {await mkdir(dirname(p), {recursive:true}); await writeFile(p, JSON.stringify(value,null,2)+'\n');};
const id = z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/);
const text = z.string().trim().min(1).max(4000);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const iso = z.string().datetime({offset:true});
const intent = z.enum(['entertainment','practical-value','commercial']);
const normalized = s => s.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export const briefSchema = z.object({
  id, title:text, script:z.string().min(50).max(650), voiceDirection:text, caption:z.string().min(1).max(2200),
  productionBatch:id.optional(),
  intent, mode:z.enum(['modeled','original-test']), sourceIds:z.array(id), pattern:text, twist:text,
  changedElements:z.array(text).min(3), product:z.string().optional(),
  productEvidence:z.array(z.object({claim:text,evidencePath:text,sha256:sha,checkedAt:iso})).default([]),
  cutaway:z.object({image:text,sha256:sha,promptPath:text,location:text,distinctFromPresenter:z.literal(true)}).optional(),
  commercialDisclosure:z.enum(['none','own-product','paid-partnership']), aiLabel:z.literal(true),
}).strict();

export function dayAt(time, timezone='America/Los_Angeles') {
  return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time));
}
export function zonedTime(day, clock, timezone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(clock)) throw new Error('Use YYYY-MM-DD and HH:mm.');
  const target = Date.parse(`${day}T${clock}:00Z`);
  let time = target;
  const parts = t => Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(t).map(p=>[p.type,p.value]));
  for(let i=0;i<3;i++) {const p=parts(time);const seen=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);time += target-seen;}
  const p=parts(time);if(`${p.year}-${p.month}-${p.day}`!==day || `${p.hour}:${p.minute}`!==clock)throw new Error('Invalid or nonexistent local time.');
  return new Date(time).toISOString();
}
export function calendar(config, startDay, days=7, now=Date.now()) {
  if(!Number.isInteger(days)||days<1||days>30)throw new Error('Plan 1-30 days.');
  const slots=[];
  for(let d=0;d<days;d++) {
    const day=new Date(Date.parse(startDay+'T12:00:00Z')+d*86400000).toISOString().slice(0,10);
    const offset=Math.round((Date.parse(day)-Date.parse(config.cycleAnchor))/86400000)*config.postsPerDay;
    config.slots.forEach((clock,i)=>{const at=zonedTime(day,clock,config.timezone);if(Date.parse(at)>now)slots.push({id:`${day}-${clock.replace(':','')}`,day,clock,at,timezone:config.timezone,intent:config.cycle[((offset+i)%config.cycle.length+config.cycle.length)%config.cycle.length]});});
  }
  return slots;
}

export async function localAsset(path, workspace=root) {
  const resolved=await realpath(resolve(workspace,path)), rel=relative(await realpath(workspace),resolved);
  if(rel.startsWith('..')||isAbsolute(rel))throw new Error('Asset must stay within this workspace.');
  return resolved;
}
export async function checkAsset(path, expected, workspace=root) {
  const resolved=await localAsset(path,workspace);if(hash(await readFile(resolved))!==expected)throw new Error('Asset hash changed: '+path);return resolved;
}

export class Operator {
  constructor({workspace=root, statePath=join(root,'data/alex-operator/state.json'), config, now=()=>Date.now()}={}) {this.workspace=workspace;this.statePath=statePath;this.config=config;this.now=now;}
  async load() {try{return await readJson(this.statePath);}catch(e){if(e.code!=='ENOENT')throw e;return {version:1,sources:[],jobs:[],attempts:[],metrics:[],events:[]};}}
  async change(fn) {
    await mkdir(dirname(this.statePath),{recursive:true});
    const lockPath=this.statePath+'.lock';let lock;
    try{lock=await open(lockPath,'wx');}catch(e){if(e.code==='EEXIST')throw new Error('Operator is busy; retry after the current command.');throw e;}
    try {
      await lock.writeFile(JSON.stringify({pid:process.pid,at:new Date(this.now()).toISOString()}));
      const state=await this.load(), result=await fn(state);
      const temp=this.statePath+'.'+randomUUID()+'.tmp';await saveJson(temp,state);await rename(temp,this.statePath);return result;
    }finally{await lock.close();await unlink(lockPath);}
  }
  async addSource(input) {
    const {watchEvidence,baselineEvidence=[],...record}=input;
    const source=sourceSchema.parse(record),now=this.now();
    if(Date.parse(source.discoveredAt)>now||source.observations.some(o=>Date.parse(o.at)>now))throw new Error('Source evidence is dated in the future.');
    let evidence=null;
    if(source.contentReviewed) {
      const watched=await localAsset(z.string().min(1).parse(watchEvidence),this.workspace);
      const baselines=z.array(z.object({url:z.string().url(),views:z.number().int().nonnegative(),publishedAt:iso,observedAt:iso,evidencePath:text}).strict()).parse(baselineEvidence);
      if(baselines.length!==source.baselineViews.length||new Set(baselines.map(b=>new URL(b.url).pathname)).size!==baselines.length)throw new Error('Every baseline view count needs a distinct source post and evidence.');
      const candidate=new URL(source.url),creatorPath=candidate.pathname.split('/').slice(0,2).join('/');
      if(baselines.length&&(!['www.tiktok.com','tiktok.com'].includes(candidate.hostname)||!/^\/@[^/]+\/video\/\d+\/?$/.test(candidate.pathname)))throw new Error('Use the direct TikTok source video URL for baseline comparison.');
      for(const [i,b] of baselines.entries()) {
        const url=new URL(b.url);
        if(!['www.tiktok.com','tiktok.com'].includes(url.hostname)||!url.pathname.startsWith(creatorPath+'/video/')||url.pathname===candidate.pathname||b.views!==source.baselineViews[i]||Date.parse(b.observedAt)>now||now-Date.parse(b.observedAt)>48*3600000||Date.parse(b.publishedAt)>Date.parse(b.observedAt)||now-Date.parse(b.publishedAt)>30*86400000)throw new Error('Baseline must contain recent comparable posts from the same creator with fresh observed counts.');
        b.sha256=hash(await readFile(await localAsset(b.evidencePath,this.workspace)));
      }
      evidence={watchEvidence:watched,watchEvidenceSha256:hash(await readFile(watched)),baselineEvidence:baselines};
    }
    return this.change(s=>{const i=s.sources.findIndex(x=>x.id===source.id);if(i>=0)s.sources[i]=source;else s.sources.push(source);s.sourceEvidence??={};s.sourceEvidence[source.id]=evidence;return assessSource(source,now);});
  }
  async verifySourceEvidence(state,source) {
    const proof=state.sourceEvidence?.[source.id];if(!proof)throw new Error('Import saved watch and baseline evidence before modeling this source.');
    await checkAsset(proof.watchEvidence,proof.watchEvidenceSha256,this.workspace);
    for(const b of proof.baselineEvidence)await checkAsset(b.evidencePath,b.sha256,this.workspace);
  }
  async submit(input) {
    const brief=briefSchema.parse(input), now=this.now();
    if((brief.intent==='commercial')!==(brief.commercialDisclosure!=='none'))throw new Error('Commercial intent and disclosure must agree.');
    if(brief.intent==='commercial'&&(!brief.product||!brief.productEvidence.length))throw new Error('Commercial content requires a named product and verified evidence.');
    for(const p of brief.productEvidence){await checkAsset(p.evidencePath,p.sha256,this.workspace);if(Date.parse(p.checkedAt)>now||now-Date.parse(p.checkedAt)>7*86400000)throw new Error('Recheck product claims within seven days.');}
    if(brief.cutaway){await checkAsset(brief.cutaway.image,brief.cutaway.sha256,this.workspace);await localAsset(brief.cutaway.promptPath,this.workspace);}
    return this.change(async s=>{
      if(s.jobs.some(j=>j.id===brief.id||normalized(j.brief.script)===normalized(brief.script)))throw new Error('Duplicate brief ID or script.');
      if(brief.productionBatch) {
        const batch=this.config.production.authorizedBatch;
        if(!batch||brief.productionBatch!==batch.id||batch.maximumJobs!==12||brief.mode!==batch.mode)throw new Error('Unknown or invalid authorized production batch.');
        if(s.jobs.filter(j=>j.brief.productionBatch===batch.id).length>=batch.maximumJobs)throw new Error('The authorized twelve-video batch is full; failed jobs still count.');
      }
      const sources=brief.sourceIds.map(key=>{const found=s.sources.find(x=>x.id===key);if(!found)throw new Error('Unknown source: '+key);return found;});
      const evidence=sources.map(x=>assessSource(x,now));
      if(brief.mode==='modeled'&&(!sources.length||sources.some(x=>!x.contentReviewed)||!evidence.some(x=>x.classification==='verified-breakout-candidate')))throw new Error('Trend-modeled briefs require watched, fresh organic breakout evidence. Use original-test when evidence is unavailable.');
      if(brief.mode==='modeled')for(const source of sources)await this.verifySourceEvidence(s,source);
      const job={id:brief.id,brief,scriptHash:hash(normalized(brief.script)),evidence,state:'queued',createdAt:new Date(now).toISOString(),stages:{},review:null};s.jobs.push(job);return job;
    });
  }
  async stage(jobId, patch) {return this.change(s=>{const j=s.jobs.find(x=>x.id===jobId);if(!j)throw new Error('Unknown job');Object.assign(j,patch);return j;});}
  async attachExport(jobId, receiptPath) {
    const receipt=await readJson(await localAsset(receiptPath,this.workspace));
    if(receipt.briefId!==jobId||!receipt.decodeVerified||receipt.durationSeconds<8||receipt.durationSeconds>45||!receipt.audioVerification?.completeSourceDurationPreserved||receipt.audioVerification.zeroLagCorrelation<.995||receipt.aiLabel!==true)throw new Error('Export failed technical or identity checks.');
    await checkAsset(receipt.path,receipt.videoSha256,this.workspace);
    return this.change(s=>{const j=s.jobs.find(x=>x.id===jobId);if(!j)throw new Error('Unknown job');if(s.attempts.some(a=>a.jobId===jobId))throw new Error('Cannot replace a video with a publishing attempt.');j.export={receipt:receiptPath,path:receipt.path,sha256:receipt.videoSha256,durationSeconds:receipt.durationSeconds};j.review=null;j.state='needs-review';return j;});
  }
  async review(input) {
    const value=z.object({jobId:id,videoSha256:sha,reviewer:text,checks:z.record(z.boolean()),notes:text}).strict().parse(input);
    return this.change(async s=>{const j=s.jobs.find(x=>x.id===value.jobId);if(!j?.export)throw new Error('No completed export.');if(s.attempts.some(a=>a.jobId===j.id))throw new Error('Reconcile existing publishing attempt before changing review.');
      await checkAsset(j.export.path,value.videoSha256,this.workspace);if(value.videoSha256!==j.export.sha256)throw new Error('Review refers to a different video.');
      const passed=this.config.quality.required.every(k=>value.checks[k]===true);j.review={...value,passed,at:new Date(this.now()).toISOString()};j.state=passed?'ready':'needs-revision';return j;});
  }
  async claim(input) {
    const value=z.object({jobId:id,at:iso,account:z.literal('alexslightlybetter'),remotePreflight:text}).strict().parse(input);
    return this.change(async s=>{
      const j=s.jobs.find(x=>x.id===value.jobId),now=this.now(),day=dayAt(value.at,this.config.timezone);
      if(!this.config.authorization.publish||!j?.review?.passed||j.state!=='ready')throw new Error('Job is not reviewed and ready for authorized publication.');
      const receipt=await readJson(await localAsset(j.export.receipt,this.workspace));
      await checkAsset(j.export.path,j.export.sha256,this.workspace);await checkAsset(receipt.path,receipt.videoSha256,this.workspace);
      if(receipt.videoSha256!==j.review.videoSha256)throw new Error('Export changed after review.');
      if(!calendar(this.config,day,1,now+5*60000).some(slot=>Date.parse(slot.at)===Date.parse(value.at)))throw new Error('Choose an unexpired configured slot at least five minutes ahead.');
      if(j.brief.mode==='modeled'&&!j.brief.sourceIds.some(key=>{const source=s.sources.find(x=>x.id===key);return source&&assessSource(source,Date.parse(value.at)).classification==='verified-breakout-candidate';}))throw new Error('Trend evidence will be stale at publication; re-observe sources before scheduling.');
      if(j.brief.mode==='modeled')for(const key of j.brief.sourceIds)await this.verifySourceEvidence(s,s.sources.find(x=>x.id===key));
      if(s.attempts.some(a=>a.jobId===j.id||a.videoSha256===j.export.sha256))throw new Error('Existing attempt: reconcile it; do not submit again.');
      const used=s.attempts.filter(a=>dayAt(a.at,this.config.timezone)===day);
      if(used.length>=this.config.postsPerDay||used.some(a=>Date.parse(a.at)===Date.parse(value.at)))throw new Error('Daily cap or slot already reserved.');
      const preflight=z.object({account:text,brandId:text,uploadAvailable:z.boolean(),aiLabelSupported:z.boolean(),checkedAt:iso,existingTikTokPosts:z.array(z.object({at:iso,videoSha256:sha.optional()}).passthrough())}).passthrough().parse(await readJson(await localAsset(value.remotePreflight,this.workspace)));
      if(preflight.account!==this.config.account||preflight.brandId!==this.config.metricoolBrandId||!preflight.uploadAvailable||!preflight.aiLabelSupported||this.now()-Date.parse(preflight.checkedAt)>15*60000||Date.parse(preflight.checkedAt)>this.now()||!Array.isArray(preflight.existingTikTokPosts))throw new Error('Fresh verified account, upload, labeling and remote planner preflight required.');
      const remote=preflight.existingTikTokPosts.filter(p=>dayAt(p.at,this.config.timezone)===day);
      const union=new Set([...used.map(a=>Date.parse(a.at)),...remote.map(p=>Date.parse(p.at))]);
      if(remote.some(p=>Date.parse(p.at)===Date.parse(value.at)||p.videoSha256===j.export.sha256)||union.size>=this.config.postsPerDay)throw new Error('Remote TikTok planner already occupies this slot or day.');
      const attempt={id:randomUUID(),jobId:j.id,at:value.at,account:value.account,videoSha256:j.export.sha256,state:'attempt-recorded',createdAt:new Date(now).toISOString(),preflight:value.remotePreflight};s.attempts.push(attempt);j.state='publishing';
      return {attempt,uploadPath:j.export.path,caption:j.brief.caption,aiLabel:true,commercialDisclosure:j.brief.commercialDisclosure,brandId:this.config.metricoolBrandId,transport:this.config.publishing.transport,instruction:'Upload exact file, verify account, schedule once, and record the provider response. On uncertainty inspect the existing planner entry; never blindly retry.'};
    });
  }
  async record(input) {
    const value=z.object({attemptId:z.string().uuid(),state:z.enum(['scheduled','published','uncertain','failed']),providerReceipt:text,remoteId:z.string().optional(),plannerUrl:z.string().url().optional(),publicUrl:z.string().url().optional(),publishedAt:iso.optional()}).strict().parse(input);
    const providerPath=await localAsset(value.providerReceipt,this.workspace);const providerHash=hash(await readFile(providerPath));
    if(['scheduled','published'].includes(value.state)&&!value.remoteId)throw new Error('Provider post ID required.');
    if(value.state==='published'&&(!value.publicUrl||!value.publishedAt||new URL(value.publicUrl).hostname!=='www.tiktok.com'||!new URL(value.publicUrl).pathname.startsWith('/@'+this.config.account+'/video/')))throw new Error('Published requires a live URL on the correct TikTok account and actual publication time.');
    if(value.state==='published'&&Date.parse(value.publishedAt)>this.now())throw new Error('A future scheduled post is not yet published.');
    return this.change(s=>{const a=s.attempts.find(x=>x.id===value.attemptId);if(!a)throw new Error('Unknown attempt');if(a.state==='published')throw new Error('Already published; import metrics instead.');Object.assign(a,value,{providerReceiptSha256:providerHash,updatedAt:new Date(this.now()).toISOString()});const j=s.jobs.find(x=>x.id===a.jobId);j.state=value.state;return a;});
  }
  async metrics(input) {
    const metric=z.number().nonnegative().nullable();
    const value=z.object({jobId:id,observedAt:iso,source:text,views:metric,likes:metric,comments:metric,shares:metric,saves:metric,averageWatchSeconds:metric,completionRate:z.number().min(0).max(1).nullable(),follows:metric,trackedVisits:metric,trials:metric,purchases:metric,netRevenueUsd:z.number().nullable()}).strict().parse(input);
    await localAsset(value.source,this.workspace);
    return this.change(s=>{const a=s.attempts.find(x=>x.jobId===value.jobId&&x.state==='published');if(!a)throw new Error('Import metrics only for a confirmed published post.');const ageHours=(Date.parse(value.observedAt)-Date.parse(a.publishedAt))/3600000;if(ageHours<0||Date.parse(value.observedAt)>this.now())throw new Error('Invalid metric observation time.');if(s.metrics.some(m=>m.jobId===value.jobId&&m.observedAt===value.observedAt))throw new Error('Snapshot already imported.');s.metrics.push({...value,ageHours});return value;});
  }
  async status() {
    const s=await this.load(),now=this.now(),c=this.config;
    const slots=calendar(c,dayAt(now,c.timezone),7,now).map(slot=>({...slot,attempt:s.attempts.find(a=>Date.parse(a.at)===Date.parse(slot.at))??null}));
    const due=[];for(const a of s.attempts.filter(a=>a.state==='published'))for(const hours of c.measurement.checkpointsHours)if(Date.parse(a.publishedAt)+hours*3600000<=now&&!s.metrics.some(m=>m.jobId===a.jobId&&m.ageHours>=hours))due.push({jobId:a.jobId,hours,publicUrl:a.publicUrl});
    const ready=s.jobs.filter(j=>j.state==='ready'||j.state==='scheduled'&&s.attempts.some(a=>a.jobId===j.id&&Date.parse(a.at)>=now&&Date.parse(a.at)<=now+2*86400000)).length;
    return {owner:c.owner,account:c.account,timezone:c.timezone,authorization:c.authorization,scheduleStatus:c.scheduleStatus,localWorker:c.localWorker??null,readyBuffer:ready,bufferTarget:c.bufferPosts,bufferShortfall:Math.max(0,c.bufferPosts-ready),jobs:s.jobs.map(({id,state,export:asset,error})=>({id,state,export:asset,error})),nextSlots:slots,measurementDue:due,research:s.sources.map(x=>assessSource(x,now)).sort((a,b)=>b.score-a.score),publicationAttempts:s.attempts,automationLive:false,liveMeaning:'Local commands are available. Dots recurring schedule and real delivery must be independently confirmed.'};
  }
  async learning() {
    const s=await this.load(),c=this.config,rows=[];
    for(const j of s.jobs){const m=s.metrics.filter(m=>m.jobId===j.id&&m.ageHours>=c.measurement.compareAtHours&&m.ageHours<=c.measurement.compareMaximumAgeHours&&m.views>=c.measurement.minimumViewsForComparison).sort((a,b)=>a.ageHours-b.ageHours)[0];if(!m)continue;
      rows.push({jobId:j.id,pattern:j.brief.pattern,intent:j.brief.intent,ageHours:m.ageHours,views:m.views,watchFraction:m.averageWatchSeconds===null?null:m.averageWatchSeconds/j.export.durationSeconds,sharesPer1000:m.shares===null?null:1000*m.shares/m.views,followsPer1000:m.follows===null?null:1000*m.follows/m.views,completionRate:m.completionRate,purchases:m.purchases,netRevenueUsd:m.netRevenueUsd});}
    return {comparableWindowHours:[c.measurement.compareAtHours,c.measurement.compareMaximumAgeHours],rows,sufficientSample:rows.length>=c.measurement.minimumPostsForComparison,recommendation:rows.length<c.measurement.minimumPostsForComparison?'Collect at least five comparable posts before changing the content mix.':'Compare formats within intent and duration groups; repeat strong hooks with a new situation and payoff. Change one variable per experiment. Purchases and attributed visits, not views, assess product performance.'};
  }
}
