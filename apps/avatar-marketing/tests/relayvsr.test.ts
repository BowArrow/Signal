import test from 'node:test';
import assert from 'node:assert/strict';
import {chunkPlan,relayGraph} from '../relayvsr.mjs';
import {planShots} from '../ltx-relay-video.mjs';
import {productionGraph} from '../ltx-production.ts';

test('long clips have bounded context, exact coverage and stable keyframe alignment',()=>{
  for(const count of [1,73,121,1440,14400]){
    const chunks=chunkPlan(count);let cursor=0;
    for(const c of chunks){assert.equal(c.start,cursor);assert.equal(c.inputStart%15,0);assert.ok(c.inputEnd-c.inputStart<=120);assert.ok(c.inputStart+c.trimStart===c.start);cursor=c.end;}
    assert.equal(cursor,count);assert.equal(chunks.reduce((s,c)=>s+c.frames,0),count);
  }
});
test('low-res LTX decodes the eight-step native pass; guided fallback retains guidance',()=>{
  const input={id:'test',image:'signal-video-'+('a'.repeat(64))+'.jpg',duration:3,prompt:'Approved reference performance',profile:'relay_fast' as const,audio:'signal-audio-'+('b'.repeat(64))+'.wav'};
  const graph=productionGraph(input);
  assert.equal(graph['11'].inputs.width,384);assert.equal(graph['11'].inputs.height,672);
  assert.deepEqual(graph['29'].inputs.samples,['21',0]);assert.equal(graph['22'],undefined);assert.equal(graph['27'],undefined);
  assert.equal(String(graph['19'].inputs.sigmas).split(',').length,9);assert.deepEqual(graph['30'].inputs.audio,['40',0]);
  const guided=productionGraph({...input,profile:'guided_speech_relay'});assert.equal(guided['19'].inputs.steps,30);assert.ok(guided['50']);assert.ok(guided['51']);
});
test('long-form plan has continuous audio offsets despite latent-frame rounding',()=>{
  const shot={frames:120,prompt:'Reference performance',imageSha256:'a'.repeat(64)};
  const shots=planShots(Array.from({length:12},()=>shot));assert.equal(shots.at(-1).end,1440);
  assert.equal(shots[1].start,120);assert.equal(shots[1].generatedFrames,121);
  assert.throws(()=>planShots([{...shot,frames:193}]),/24-192/);
});
test('Relay uses matched 2x weights and one-step sampling',()=>{
  const graph=relayGraph('relay-test.mp4','relay/test');
  assert.match(graph['1'].inputs.unet_name,/x2_lightx2v/);assert.match(graph['2'].inputs.vae_name,/x2_fp32/);
  assert.equal(graph['6'].inputs.steps,1);assert.equal(graph['6'].inputs.cfg,1);assert.equal(graph['7'].inputs.detail,.8);
  assert.throws(()=>relayGraph('../outside.mp4','relay/test'),/Invalid/);
});
