import test from 'node:test';
import assert from 'node:assert/strict';
import {productionGraph} from '../ltx-production.js';
const input={id:'alex-check',image:'signal-video-'+ 'a'.repeat(64)+'.jpg',audio:'signal-audio-'+ 'b'.repeat(64)+'.wav',duration:19.7,prompt:'The same person talks naturally in his room.',profile:'quality' as const};
test('production audio remains frozen in both stages and original waveform reaches the video',()=>{
  const g=productionGraph(input);
  assert.equal(g['42']!.inputs.value,0);
  assert.deepEqual(g['14']!.inputs.audio_latent,['43',0]);
  assert.deepEqual(g['25']!.inputs.audio_latent,['43',0]);
  assert.deepEqual(g['30']!.inputs.audio,['40',0]);
  const frames=Number(g['11']!.inputs.length);assert.equal((frames-1)%8,0);assert.ok(frames/24>=input.duration);
  assert.equal(g['6']!.inputs.width,576);assert.equal(g['11']!.inputs.width,288);
});
test('reject unsupported length and arbitrary audio names before inference',()=>{
  assert.throws(()=>productionGraph({...input,duration:NaN}));
  assert.throws(()=>productionGraph({...input,duration:21}));
  assert.throws(()=>productionGraph({...input,audio:'../outside.wav'}));
});
test('guided quality uses the dev model, native resolution and all guidance passes with frozen speech',()=>{
  const g=productionGraph({...input,profile:'guided_high',duration:3});
  assert.match(String(g['1']!.inputs.unet_name),/dev-transformer-comfy-int8/);
  assert.equal(g['11']!.inputs.width,768);assert.equal(g['11']!.inputs.height,1344);
  assert.equal(g['19']!.inputs.steps,30);
  assert.equal(g['19']!.inputs.latent,undefined);
  assert.equal(g['50']!.inputs.scale,1);assert.equal(g['51']!.inputs.modality_scale,3);
  assert.equal(g['15']!.inputs.video_cfg,3);
  assert.deepEqual(g['14']!.inputs.audio_latent,['43',0]);
  assert.deepEqual(g['30']!.inputs.audio,['40',0]);
  assert.deepEqual(g['29']!.inputs.samples,['21',0]);
  assert.equal(g['27'],undefined);
});
test('higher-resolution speech retains the speaking guidance and original audio path',()=>{
  const low=productionGraph({...input,profile:'guided_speech',duration:5});
  const high=productionGraph({...input,profile:'guided_speech_high',duration:5});
  for(const id of ['12','14','15','19','50','51','52','30'])assert.deepEqual(high[id],low[id]);
  assert.ok(Number(high['11']!.inputs.width)>Number(low['11']!.inputs.width));
  assert.ok(Number(high['29']!.inputs.temporal_size)>=Number(high['11']!.inputs.length));
  assert.equal(high['15']!.inputs.audio_cfg,high['15']!.inputs.video_cfg);
});
