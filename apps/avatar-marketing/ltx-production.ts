import { ltxWorkflow, type VideoGraph } from '../../src/core/video/ltx.js';
import type { VideoJob } from '../../src/shared/video.js';

// A separate production experiment keeps the older preview profile intact.
// Maximum duration is a request bound, not a claim of validated hardware quality.
export const productionProfiles = {
  relay_fast: {width:384,height:672,maxSeconds:8,temporalSize:64,temporalOverlap:16},
  guided_speech_relay: {width:384,height:672,maxSeconds:8,temporalSize:64,temporalOverlap:16},
  balanced: {width:384,height:640,maxSeconds:20,temporalSize:32,temporalOverlap:8},
  quality: {width:576,height:1024,maxSeconds:20,temporalSize:32,temporalOverlap:8},
  quality_temporal: {width:576,height:1024,maxSeconds:20,temporalSize:64,temporalOverlap:16},
  guided_native: {width:576,height:1024,maxSeconds:20,temporalSize:64,temporalOverlap:16},
  guided_high: {width:768,height:1344,maxSeconds:20,temporalSize:64,temporalOverlap:16},
  guided_speech: {width:576,height:1024,maxSeconds:20,temporalSize:64,temporalOverlap:16},
  guided_speech_high: {width:768,height:1344,maxSeconds:20,temporalSize:128,temporalOverlap:32},
} as const;
export const guidedModel={file:'diffusion_models/ltx-2.5-22b-dev-transformer-comfy-int8-convrot.safetensors',bytes:21504034224,sha256:'2edbdb4465cd6c3b532cd67a31ddb38a63e97dcad20be3729675e2a4e8caf92b',revision:'49b093a39c19169a8a81721dcc541e07e945232f'} as const;

export function productionGraph(input:{id:string;image:string;audio?:string;duration:number;prompt:string;profile:keyof typeof productionProfiles;seed?:number}):VideoGraph {
  const profile=productionProfiles[input.profile];
  if(!profile || !Number.isFinite(input.duration) || input.duration<1 || input.duration>profile.maxSeconds)throw new Error('Production shots must be between 1 and 20 seconds.');
  if(!input.prompt.trim() || input.prompt.length>6000)throw new Error('Supply a concise shot prompt.');
  if(input.audio&&!/^signal-audio-[a-f0-9]{64}\.wav$/.test(input.audio))throw new Error('Invalid owned audio input.');
  const graph=ltxWorkflow({id:input.id,duration:3,ratio:'9:16',characters:[{}],shot:{description:'',openingAction:'',geometry:'',lighting:'',acting:'',lensMm:50,beats:[]}} as unknown as VideoJob,input.image);
  const frames=8*Math.ceil((input.duration*24-1)/8)+1;
  graph['6']!.inputs.width=profile.width;graph['6']!.inputs.height=profile.height;
  graph['11']!.inputs.width=profile.width/2;graph['11']!.inputs.height=profile.height/2;
  graph['11']!.inputs.length=frames;graph['13']!.inputs.frames_number=frames;
  graph['8']!.inputs.text=input.prompt;
  graph['16']!.inputs.noise_seed=input.seed??42;
  graph['29']!.inputs.temporal_size=profile.temporalSize;
  graph['29']!.inputs.temporal_overlap=profile.temporalOverlap;
  if(input.profile==='relay_fast') {
    // Decode the eight-step distilled pass at its actual native size.
    // RelayVSR is a separate sequential stage; no second LTX refinement pass.
    graph['11']!.inputs.width=profile.width;graph['11']!.inputs.height=profile.height;
    graph['29']!.inputs.samples=['21',0];
    for(const id of ['22','23','24','25','26','27','28'])delete graph[id];
  }
  if(input.profile.startsWith('guided_')){
    const speech=input.profile.startsWith('guided_speech');
    // Development model: actual native-resolution denoising, not a larger export.
    // ComfyUI's native guidance nodes add the extra prediction passes each step.
    graph['1']!.inputs.unet_name=guidedModel.file.split('/').at(-1)!;
    graph['11']!.inputs.width=profile.width;graph['11']!.inputs.height=profile.height;
    graph['12']!.inputs.strength=speech?0.7:1;
    graph['9']!.inputs.text='blurred eyes, unstable pupils, doubled eyelids, melting facial features, warped teeth, rubbery mouth, exaggerated facial expressions, plastic skin, ghosting, temporal flicker, motion smearing, cartoon, text, watermark';
    graph['50']={class_type:'LTXVSpatioTemporalGuidance',inputs:{model:['1',0],scale:1,blocks:'28',start_percent:0,end_percent:1}};
    graph['51']={class_type:'LTXVModalityGuidance',inputs:{model:['50',0],modality_scale:speech?4:3,start_percent:0,end_percent:1}};
    graph['52']={class_type:'RescaleCFG',inputs:{model:['51',0],multiplier:0.7}};
    graph['15']!.inputs.model=['52',0];graph['15']!.inputs.video_cfg=speech?2.3:3;graph['15']!.inputs.audio_cfg=speech?2.3:3;
    graph['18']!.inputs.sampler_name='euler';
    // Official A2V uses the scheduler's default token anchor, not the full
    // native clip size (which can collapse float32 sigmas on long HD clips).
    graph['19']={class_type:'LTXVScheduler',inputs:{steps:30,max_shift:2.05,base_shift:0.95,stretch:true,terminal:0.1}};
    graph['29']!.inputs.samples=['21',0];
    // Qualify the dev model directly; do not blur the comparison with a distilled pass.
    for(const id of ['22','23','24','25','26','27','28'])delete graph[id];
  }
  if(input.audio){
    graph['40']={class_type:'LoadAudio',inputs:{audio:input.audio}};
    graph['41']={class_type:'LTXVAudioVAEEncode',inputs:{audio:['40',0],audio_vae:['4',0]}};
    graph['42']={class_type:'SolidMask',inputs:{value:0,width:64,height:64}};
    graph['43']={class_type:'SetLatentNoiseMask',inputs:{samples:['41',0],mask:['42',0]}};
    // Hold the original encoded audio fixed in BOTH sampling stages.
    graph['14']!.inputs.audio_latent=['43',0];
    if(graph['25'])graph['25'].inputs.audio_latent=['43',0];
    graph['30']!.inputs.audio=['40',0];
    delete graph['13'];
  }
  return graph;
}
