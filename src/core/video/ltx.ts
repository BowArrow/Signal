import type { VideoJob } from '../../shared/video.js';

// Native ComfyUI LTX-2.5 I2V, derived from the author's two-stage W4A8
// baseline. Keep audio latents for sampling; add narration during CPU editing.
// https://github.com/reventadirecta/LTX-2.5-I2V-8GB-VRAM
export const LTX_MODELS = {
  diffusion: 'ltx-2.5-22b-distilled-transformer-w4a8_convrot.safetensors',
  encoder: 'gemma4-12b-with-proj-ltx-2.5-w4a8_convrot.safetensors',
  videoVae: 'ltx-2.5-video-vae-bf16.safetensors',
  audioVae: 'ltx-2.5-audio-vae-bf16.safetensors',
  upscaler: 'ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors',
} as const;
export type VideoGraph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
export const LTX_LIMIT_ARGS = ['--dynamic-vram', '--ram-gb', '16', '--working-set-gb', '4'] as const;
export const LTX_RUNTIME_ARGS = ['--enable-dynamic-vram', '--async-offload', '2', '--bf16-vae', '--fast-disk', '--cache-none', '--reserve-vram', '3', '--vram-headroom', '3'] as const;
export function ltxWorkflow(job: VideoJob, image: string): VideoGraph {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(job.id) || !/^signal-video-[a-f0-9]{64}\.jpg$/.test(image)) throw new Error('Invalid local video input.');
  if (job.characters.length !== 1 || !job.shot) throw new Error('LTX image-to-video needs one approved starting reference and a shot plan.');
  if (job.duration < 3 || job.duration > 5) throw new Error('LTX previews are limited to three to five seconds.');
  const [width, height] = job.ratio === '9:16' ? [320, 512] : job.ratio === '1:1' ? [384, 384] : [512, 320];
  const length = Math.round(job.duration * 24 / 8) * 8 + 1;
  const shot = job.shot;
  const prompt = `Continue the supplied first frame, preserving the same person's face, wardrobe and surroundings. One continuous shot. ${shot.description} ${shot.openingAction} ${shot.geometry} ${shot.lighting} ${shot.acting} ${shot.beats.map(b => `${b.start}-${b.end}s: ${b.action}`).join(' ')}. ${shot.lensMm}mm lens. No readable text, logos, product interfaces, cuts or talking. Silent scene; narration is added in the edit.`;
  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: LTX_MODELS.diffusion, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: LTX_MODELS.encoder, type: 'ltxv', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: LTX_MODELS.videoVae } },
    '4': { class_type: 'VAELoader', inputs: { vae_name: LTX_MODELS.audioVae } },
    '5': { class_type: 'LoadImage', inputs: { image } },
    '6': { class_type: 'ImageScale', inputs: { image: ['5', 0], upscale_method: 'lanczos', width, height, crop: 'center' } },
    '7': { class_type: 'LTXVPreprocess', inputs: { image: ['6', 0], img_compression: 18 } },
    '8': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: prompt } },
    '9': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: 'cartoon, video game, text, watermark, subtitles, black frames' } },
    '10': { class_type: 'LTXVConditioning', inputs: { positive: ['8', 0], negative: ['9', 0], frame_rate: 24 } },
    '11': { class_type: 'EmptyLTXVLatentVideo', inputs: { width: width / 2, height: height / 2, length, batch_size: 1 } },
    '12': { class_type: 'LTXVImgToVideoInplace', inputs: { vae: ['3', 0], image: ['7', 0], latent: ['11', 0], strength: 0.7, bypass: false } },
    '13': { class_type: 'LTXVEmptyLatentAudio', inputs: { audio_vae: ['4', 0], frames_number: length, frame_rate: 24, batch_size: 1 } },
    '14': { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: ['12', 0], audio_latent: ['13', 0] } },
    '15': { class_type: 'LTXVDualCFGGuider', inputs: { model: ['1', 0], positive: ['10', 0], negative: ['10', 1], video_cfg: 1, audio_cfg: 1 } },
    '16': { class_type: 'RandomNoise', inputs: { noise_seed: 42 } },
    '18': { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler_ancestral' } },
    '19': { class_type: 'ManualSigmas', inputs: { sigmas: '1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0' } },
    '20': { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['16', 0], guider: ['15', 0], sampler: ['18', 0], sigmas: ['19', 0], latent_image: ['14', 0] } },
    '21': { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['20', 0] } },
    '22': { class_type: 'LatentUpscaleModelLoader', inputs: { model_name: LTX_MODELS.upscaler } },
    '23': { class_type: 'LTXVLatentUpsampler', inputs: { samples: ['21', 0], upscale_model: ['22', 0], vae: ['3', 0] } },
    '24': { class_type: 'LTXVImgToVideoInplace', inputs: { vae: ['3', 0], image: ['7', 0], latent: ['23', 0], strength: 1, bypass: false } },
    '25': { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: ['24', 0], audio_latent: ['21', 1] } },
    '26': { class_type: 'ManualSigmas', inputs: { sigmas: '0.85, 0.7250, 0.4219, 0.0' } },
    '27': { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['16', 0], guider: ['15', 0], sampler: ['18', 0], sigmas: ['26', 0], latent_image: ['25', 0] } },
    '28': { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['27', 0] } },
    '29': { class_type: 'VAEDecodeTiled', inputs: { samples: ['28', 0], vae: ['3', 0], tile_size: 256, overlap: 64, temporal_size: 16, temporal_overlap: 4 } },
    '30': { class_type: 'CreateVideo', inputs: { images: ['29', 0], fps: 24 } },
    '17': { class_type: 'SaveVideo', inputs: { video: ['30', 0], filename_prefix: 'Signal/video/' + job.id, format: 'mp4', 'format.codec': 'h264' } },
  };
}

export const LTX_MODEL_INPUTS = [
  ['UNETLoader', 'unet_name', LTX_MODELS.diffusion], ['CLIPLoader', 'clip_name', LTX_MODELS.encoder],
  ['VAELoader', 'vae_name', LTX_MODELS.videoVae], ['VAELoader', 'vae_name', LTX_MODELS.audioVae],
  ['LatentUpscaleModelLoader', 'model_name', LTX_MODELS.upscaler],
] as const;
