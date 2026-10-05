import { ltxDecodeStage, ltxSamplingStage } from '../../src/core/video/ltx-quality.js';
import { ltxWorkflow, type VideoGraph } from '../../src/core/video/ltx.js';
import type { VideoJob } from '../../src/shared/video.js';

const job = { id: 'quality-test', duration: 3, ratio: '16:9', characters: [{}], shot: { description: '', openingAction: '', geometry: '', lighting: '', acting: '', beats: [], lensMm: 50 } } as unknown as VideoJob;
const source = () => ltxWorkflow(job, 'signal-video-' + 'a'.repeat(64) + '.jpg');

function dependencies(graph: VideoGraph, id: string, seen = new Set<string>()): Set<string> {
  if (seen.has(id)) return seen;
  const node = graph[id];
  if (!node) throw new Error('Missing node: ' + id);
  seen.add(id);
  for (const value of Object.values(node.inputs)) if (Array.isArray(value) && typeof value[0] === 'string') dependencies(graph, value[0], seen);
  return seen;
}

it('preserves sampling settings and removes VAE decoding from the sampling stage', () => {
  const original = source(), saved = structuredClone(original), graph = ltxSamplingStage(original);
  expect(original).toEqual(saved);
  const reachable = [...dependencies(graph, '32')].map(id => graph[id]!.class_type);
  expect(reachable).toContain('SamplerCustomAdvanced');
  expect(reachable).not.toContain('VAEDecodeTiled');
  for (const id of ['8', '9', '16', '19', '26', '27', '28']) expect(graph[id]).toEqual(original[id]);
});

it('isolates decoder comparisons from all text encoding and diffusion work', () => {
  const latent = 'samples-' + 'a'.repeat(64) + '.latent';
  const small = ltxDecodeStage(latent, 16), large = ltxDecodeStage(latent, 64);
  expect(small['1']).toEqual(large['1']);
  expect([...dependencies(large, '17')].map(id => large[id]!.class_type).sort()).toEqual(['CreateVideo', 'LoadLatent', 'SaveVideo', 'VAEDecodeTiled', 'VAELoader'].sort());
  expect(large['29']!.inputs.samples).toEqual(small['29']!.inputs.samples);
  expect(() => ltxDecodeStage('../other.latent', 64)).toThrow('hash-named');
});

it('changes only image and latent dimensions for the portrait comparison', () => {
  const original = ltxSamplingStage(source()), portrait = ltxSamplingStage(source(), true);
  expect(portrait['6']!.inputs).toMatchObject({ width: 384, height: 512 });
  expect(portrait['11']!.inputs).toMatchObject({ width: 192, height: 256, length: 73 });
  for (const id of Object.keys(original).filter(id => !['6', '11'].includes(id))) expect(portrait[id]).toEqual(original[id]);
});
