import { z } from 'zod';
import { createHash } from 'node:crypto';
import { directorPrompt } from '../demo-studio/director.mjs';

const text = z.string().trim().min(1).max(4000);
const date = z.string().datetime({ offset: true });
const count = z.number().int().nonnegative().nullable();
export const sourceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/), url: z.string().url().refine(v => new URL(v).protocol === 'https:'),
  title: text, creator: text, region: text, kind: z.enum(['organic', 'paid-ad', 'editorial']),
  publishedAt: date.nullable(), discoveredAt: date,
  observations: z.array(z.object({ at: date, views: count, likes: count, comments: count, shares: count,
    evidence: text, method: z.enum(['direct', 'search-index', 'owner-import']) }).strict()).min(1),
  baselineViews: z.array(z.number().int().nonnegative()).default([]),
  contentReviewed: z.boolean(), hook: text, structure: text, payoff: text,
  buyerFit: z.number().min(0).max(1), reproducibility: z.number().min(0).max(1),
  notes: text,
}).strict();

const median = values => { const a = [...values].sort((x,y) => x-y); const n=a.length; return n ? (a[Math.floor((n-1)/2)]+a[Math.floor(n/2)])/2 : null; };
export function assessSource(input, now = Date.now()) {
  const s=sourceSchema.parse(input);
  const observations=[...s.observations].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  const last=observations.at(-1), previous=observations.at(-2);
  const ageHours=(now-Date.parse(last.at))/3600000;
  const postAge=s.publishedAt ? (now-Date.parse(s.publishedAt))/86400000 : null;
  const baseline=s.baselineViews.length>=5 ? median(s.baselineViews) : null;
  const lift=baseline>0 && last.views!==null ? last.views/baseline : null;
  const deltaHours=previous ? (Date.parse(last.at)-Date.parse(previous.at))/3600000 : 0;
  const velocity=previous?.views!==null && last.views!==null && deltaHours>=1 && last.views>=previous.views ? (last.views-previous.views)/deltaHours : null;
  const problems=[];
  if(ageHours<0 || ageHours>48) problems.push('Performance snapshot must be within the last 48 hours.');
  if(postAge===null || postAge<0 || postAge>14) problems.push('Recent publication date is missing or outside the 14-day window.');
  if(s.kind!=='organic') problems.push('Paid/editorial inspiration is not organic viral evidence.');
  if(last.method==='search-index') problems.push('Search snippets require direct verification.');
  if(!s.contentReviewed) problems.push('Watch the source before modeling its timing.');
  if(last.views===null) problems.push('Views are unknown.');
  if(lift===null) problems.push('Need at least five comparable recent creator posts for baseline.');
  // An explicit campaign heuristic, not a platform definition or guarantee of virality.
  const breakout=problems.length===0 && lift>=3 && last.views>=10000;
  const score=Math.round(100*(.4*s.buyerFit+.2*s.reproducibility+.2*Math.min((lift??0)/5,1)+.1*Math.min((velocity??0)/5000,1)+.1*(ageHours>=0&&ageHours<=48?1:0)));
  return { id:s.id, score, classification:breakout?'verified-breakout-candidate':s.kind==='organic'?'unverified-candidate':'format-inspiration', baselineMedian:baseline, relativeLift:lift, viewsPerHour:velocity, problems };
}

export const briefSchema=z.object({
  id:z.string().regex(/^[a-z0-9-]+$/), title:text, sourceIds:z.array(text),
  mode:z.enum(['modeled','original-test']), pattern:text, twist:text,
  changedElements:z.array(text).min(3), script:text,
  delivery:z.array(z.object({text, direction:text}).strict()).min(1),
  proofNeeded:z.array(text).min(1), cta:text,
  durationSeconds:z.number().int().min(10).max(600),
}).strict();

export function prepareBrief(input, sources, character, now=Date.now()) {
  const b=briefSchema.parse(input);
  if(b.delivery.map(x=>x.text).join(' ')!==b.script) throw new Error('Delivery lines must match the spoken script exactly.');
  if(!character.faceApproved || !character.faceSha256) throw new Error('Approve and fingerprint the canonical face first.');
  const selected=b.sourceIds.map(id=>{const source=sources.find(s=>s.id===id);if(!source)throw new Error('Unknown source: '+id);return sourceSchema.parse(source);});
  if(b.mode==='modeled' && !selected.length) throw new Error('Modeled content requires source provenance.');
  if(b.mode==='modeled' && selected.some(s=>!s.contentReviewed)) throw new Error('Watch and deconstruct each source before modeling.');
  const evidence=selected.map(s=>assessSource(s,now));
  return {...b, evidence, viralClaim:evidence.some(s=>s.classification==='verified-breakout-candidate'),
    characterId:character.id, faceSha256:character.faceSha256,
    outfitPath:character.outfitPath, outfitSha256:character.outfitSha256, wardrobe:character.wardrobe,
    state:'prepared', qualityApproved:false,
    rights:'Original script, footage and sound. Model the mechanism; do not reuse another creator\'s footage, wording, identity or audio without rights.',
    voicePolicy:'Use a single approved voice profile. Delivery instructions are separate from spoken text. Never change backend automatically.',
    publishing:{enabled:false, aiLabel:true, commercialDisclosure:'Your brand / promotional content', destination:'TikTok US'},
    measurement:{campaign:b.id,checkpointsHours:[24,72,168],metrics:['views','2s hold','6s hold','average watch time','completion rate','shares','saves','profile visits','tracked website visits','trials','purchases']},
    trackedUrl:'https://siplemona.de/?'+new URLSearchParams({utm_source:'tiktok',utm_medium:'organic_social',utm_campaign:'alex_launch',utm_content:b.id}),
  };
}

export function splitTimeline(seconds, maximum=5) {
  if(!Number.isFinite(seconds)||seconds<=0||seconds>600||!Number.isInteger(maximum)||maximum<3||maximum>20) throw new Error('Invalid timeline bounds.');
  const n=Math.ceil(seconds/maximum), shots=[];
  for(let i=0;i<n;i++){const start=i*seconds/n,end=(i+1)*seconds/n;shots.push({index:i+1,start,end,duration:end-start});}
  return shots;
}

export function alexDirection(referenceAssetId, duration=5, character={}) {
  return {title:'Alex: attentive reaction',referenceAssetId,duration,ratio:'9:16',
    subject:'Alex, the fictional adult from the supplied reference. Match face, brown eyes and short dark wavy crop exactly. Wardrobe: '+(character.wardrobe || 'Match the supplied outfit reference exactly.'),
    geometry:'Alex centered, upper body foreground, neutral gray background behind him. Hands below the crop. Eye-level camera.',
    firstFrame:'Alex is already looking into the lens, lips closed, listening.',fov:'47',camera:'Locked tripod, no pan or zoom.',
    lighting:'Even soft frontal light; gray background, warm skin, restrained yellow clothing accent. Stable exposure.',
    atmosphere:'Clean air and full clarity. No haze or particles.',physics:'Small head movement, fabric follows breathing, shoulders retain weight.',
    acting:'Natural blink and one slight eyebrow lift, then a small knowing smile. Lips remain closed; this is a reaction shot under voiceover.',
    locks:'Same face, hair, body, wardrobe and geometry in every frame. One person. No interface or text. No speech.',
    beats:[{start:0,end:duration,action:'Alex blinks once, lifts one eyebrow slightly, then settles into a small closed-mouth smile. Shoulders breathe subtly; background stays still.'}],
  };
}

export function shotDocument(referenceAssetId, character={}) { return directorPrompt(alexDirection(referenceAssetId,5,character)); }
export const fingerprint = value => createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');

export function zImageGraph(prompt, lora=null) {
  const graph={
    '1':{class_type:'UNETLoader',inputs:{unet_name:'z_image_turbo_bf16.safetensors',weight_dtype:'default'}},
    '2':{class_type:'CLIPLoader',inputs:{clip_name:'qwen_3_4b.safetensors',type:'lumina2',device:'default'}},
    '3':{class_type:'VAELoader',inputs:{vae_name:'ae.safetensors'}},
    '4':{class_type:'CLIPTextEncode',inputs:{text:prompt,clip:['2',0]}},
    '5':{class_type:'ConditioningZeroOut',inputs:{conditioning:['4',0]}},
    '6':{class_type:'EmptySD3LatentImage',inputs:{width:768,height:1024,batch_size:1}},
    '7':{class_type:'ModelSamplingAuraFlow',inputs:{model:['1',0],shift:3}},
    '8':{class_type:'KSampler',inputs:{model:['7',0],positive:['4',0],negative:['5',0],latent_image:['6',0],seed:42,steps:8,cfg:1,sampler_name:'res_multistep',scheduler:'simple',denoise:1}},
    '9':{class_type:'VAEDecode',inputs:{samples:['8',0],vae:['3',0]}},
    '10':{class_type:'SaveImage',inputs:{images:['9',0],filename_prefix:'Signal/alex/candidate'}},
  };
  if(lora){if(!/^[\w.-]+\.safetensors$/.test(lora))throw new Error('Use a local LoRA filename.');graph['11']={class_type:'LoraLoaderModelOnly',inputs:{model:['1',0],lora_name:lora,strength_model:.8}};graph['7'].inputs.model=['11',0];}
  return graph;
}

export function voiceGraph(line, profile, index=0) {
  if(profile.model!=='Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice') throw new Error('This graph requires the expressive CustomVoice checkpoint.');
  return {
    '1':{class_type:'Qwen3Loader',inputs:{repo_id:profile.model,source:'HuggingFace',precision:'bf16',attention:'sdpa',local_model_path:''}},
    '2':{class_type:'Qwen3CustomVoice',inputs:{model:['1',0],text:line.text,language:profile.language,speaker:profile.speaker,seed:profile.seed,instruct:line.direction,custom_speaker_name:'',max_new_tokens:2048}},
    '3':{class_type:'SaveAudio',inputs:{audio:['2',0],filename_prefix:`Signal/alex/line-${index}`}},
  };
}

export function audioOverlayGraph(video='alex-cut.mp4', audio='alex-approved.wav') {
  return {
    '1':{class_type:'LoadVideo',inputs:{file:video}},
    '2':{class_type:'GetVideoComponents',inputs:{video:['1',0]}},
    '3':{class_type:'LoadAudio',inputs:{audio}},
    '4':{class_type:'CreateVideo',inputs:{images:['2',0],fps:['2',2],audio:['3',0]}},
    '5':{class_type:'SaveVideo',inputs:{video:['4',0],filename_prefix:'Signal/alex/voiceover',format:'mp4','format.codec':'h264'}},
  };
}
