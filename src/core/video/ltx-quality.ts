import { LTX_MODELS, type VideoGraph } from './ltx.js';

// Split sampling and decoding so the text encoder and transformer cannot stay
// resident during VAE comparisons. Every decoder receives the same saved tensor.
export function ltxSamplingStage(source: VideoGraph, portrait = false): VideoGraph {
  const graph = structuredClone(source);
  if (graph['28']?.class_type !== 'LTXVSeparateAVLatent' || graph['1']?.inputs.unet_name !== LTX_MODELS.diffusion) {
    throw new Error('Expected the retained LTX 2.5 two-stage workflow.');
  }
  for (const key of ['17', '29', '30', '31']) delete graph[key];
  if (portrait) {
    if (!graph['6'] || !graph['11']) throw new Error('Missing LTX image or latent dimensions.');
    Object.assign(graph['6'].inputs, { width: 384, height: 512 });
    Object.assign(graph['11'].inputs, { width: 192, height: 256 });
  }
  graph['32'] = { class_type: 'SaveLatent', inputs: { samples: ['28', 0], filename_prefix: 'quality/samples' } };
  return graph;
}

export function ltxDecodeStage(latent: string, temporalSize: 16 | 64 | 96): VideoGraph {
  if (!/^samples-[a-f0-9]{64}\.latent$/.test(latent)) throw new Error('Expected a hash-named local latent.');
  if (![16, 64, 96].includes(temporalSize)) throw new Error('Unsupported decoder comparison.');
  return {
    '1': { class_type: 'LoadLatent', inputs: { latent } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: LTX_MODELS.videoVae } },
    '29': { class_type: 'VAEDecodeTiled', inputs: { samples: ['1', 0], vae: ['3', 0], tile_size: 256, overlap: 64, temporal_size: temporalSize, temporal_overlap: temporalSize === 16 ? 4 : 16 } },
    '30': { class_type: 'CreateVideo', inputs: { images: ['29', 0], fps: 24 } },
    '17': { class_type: 'SaveVideo', inputs: { video: ['30', 0], filename_prefix: `quality/decode-${temporalSize}`, format: 'mp4', 'format.codec': 'h264' } },
  };
}
