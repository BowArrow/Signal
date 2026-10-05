import { z } from 'zod';
import { boundedJson } from '../connections/network.js';
import { localUrl } from '../../shared/marketing.js';
import type { VideoConfig, VideoJob } from '../../shared/video.js';
import { videoFrames } from '../../shared/video.js';
import { minimaxInput } from './providers.js';
import { LTX_MODEL_INPUTS } from './ltx.js';
import { inspectRecipe, type NodeInfo as RecipeNodeInfo } from '../marketing/media-presets.js';

// Native Ref2VA, with the quantized weights from Comfy-Org. These are NOT
// the similarly named paid MiniMax API nodes or the FL2VA checkpoint.
export const H3_MODELS = {
  diffusion: 'minimax_h3_ref2va_pruned_int8_convrot.safetensors',
  smaller: 'minimax_h3_ref2va_pruned_w4a8_mixed.safetensors',
  encoder: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
  videoVae: 'minimax_h3_video_vae_fp16.safetensors',
  audioVae: 'minimax_h3_audio_vae_fp32.safetensors',
  turbo: 'minimax_h3_fl2v_lightx2v_turbo_4step_v0.1_comfy_resized_avg_rank_21_bf16.safetensors',
  mickTurbo: 'minimax_h3_fl2va_4step_lora.safetensors',
} as const;
type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
type NodeInfo = { python_module?: string; input?: { required?: Record<string, unknown>; optional?: Record<string, unknown> } };
export interface LocalVideoCheck { ready: boolean; missing: string[]; detail: string; }
function inputName(value: string) { if (!/^signal-video-[a-f0-9]{64}\.(jpg|mp4)$/.test(value)) throw new Error('Invalid local video input name.'); return value; }

export function h3Workflow(job: VideoJob, imageNames: string[], guideName: string): Graph {
  if (imageNames.length !== job.characters.length || imageNames.length < 1 || imageNames.length > 3) throw new Error('Reference count does not match the cast.');
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(job.id)) throw new Error('Invalid video job ID.');
  const [width, height] = job.ratio === '9:16' ? [608, 1056] : job.ratio === '1:1' ? [768, 768] : [1056, 608];
  const length = videoFrames({ ...job, renderer: 'local' });
  const preview = job.localProfile !== 'quality20';
  const text = minimaxInput(job, imageNames, guideName).content[0]!;
  if (!('text' in text)) throw new Error('Missing director prompt.');
  const prompt = text.text;
  const graph: Graph = {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: job.localCheckpoint === 'w4a8' ? H3_MODELS.smaller : H3_MODELS.diffusion, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: H3_MODELS.encoder, type: 'minimax', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: H3_MODELS.videoVae } },
    '4': { class_type: 'VAELoader', inputs: { vae_name: H3_MODELS.audioVae } },
    '5': { class_type: 'MiniMaxH3SigmaShift', inputs: { model: ['1', 0], shift_video: 12, shift_audio: job.localProfile === 'mick4' ? 5 : 3 } },
    '6': { class_type: 'LoadVideo', inputs: { file: inputName(guideName) } },
    '7': { class_type: 'GetVideoComponents', inputs: { video: ['6', 0] } },
    '8': { class_type: 'MiniMaxH3ReferenceToVideo', inputs: { clip: ['2', 0], vae: ['3', 0], audio_vae: ['4', 0], prompt, width, height, length, ref_image_size: 'match', 'ref_videos.ref_video_0': ['7', 0] } },
    '9': { class_type: 'RandomNoise', inputs: { noise_seed: 42 } },
    '10': { class_type: 'BasicGuider', inputs: { model: ['5', 0], conditioning: ['8', 0] } },
    '11': { class_type: 'KSamplerSelect', inputs: { sampler_name: preview ? 'er_sde' : 'res_multistep' } },
    '12': { class_type: 'BasicScheduler', inputs: { model: ['5', 0], scheduler: 'simple', steps: preview ? 4 : 20, denoise: 1 } },
    '13': { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['9', 0], guider: ['10', 0], sampler: ['11', 0], sigmas: ['12', 0], latent_image: ['8', 1] } },
    '14': { class_type: 'VAEDecode', inputs: { samples: ['13', 0], vae: ['3', 0] } },
    '15': { class_type: 'VAEDecodeAudio', inputs: { samples: ['13', 0], vae: ['4', 0] } },
    '16': { class_type: 'CreateVideo', inputs: { images: ['14', 0], audio: ['15', 0], fps: 24 } },
    '17': { class_type: 'SaveVideo', inputs: { video: ['16', 0], filename_prefix: 'Signal/video/' + job.id, format: 'mp4', 'format.codec': 'h264' } },
  };
  let model = '5';
  if (job.localProfile === 'mick4') {
    graph['20'] = { class_type: 'AudioAdjustVolume', inputs: { audio: ['15', 0], volume: -12 } };
    graph['16']!.inputs['audio'] = ['20', 0];
  }
  if (preview) { graph['18'] = { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: job.localProfile === 'mick4' ? H3_MODELS.mickTurbo : H3_MODELS.turbo, strength_model: job.localProfile === 'mick4' ? 1 : 0.75 } }; graph['5']!.inputs['model'] = ['18', 0]; }
  if (job.sparseAttention) { graph['19'] = { class_type: 'H3SLAAttention', inputs: { model: [model, 0], sparsity_ratio: 0.9, block_size: '64', min_seq_len: 8192, dense_last_steps: 0, protect_audio: true, enabled: true } }; model = '19'; }
  graph['10']!.inputs['model'] = [model, 0]; graph['12']!.inputs['model'] = [model, 0];
  imageNames.forEach((name, i) => { const id = String(30 + i); graph[id] = { class_type: 'LoadImage', inputs: { image: inputName(name) } }; graph['8']!.inputs[`ref_images.ref_image_${i}`] = [id, 0]; });
  return graph;
}

export class LocalVideoRenderer {
  constructor(private readonly transport: typeof fetch = fetch) {}
  private base(value: string) { return localUrl.parse(value).replace(/\/$/, ''); }
  private async request(base: string, path: string, signal: AbortSignal, init?: RequestInit) {
    return this.transport(this.base(base) + path, { ...init, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]) });
  }
  async characterGraph(base: string, job: VideoJob, signal: AbortSignal): Promise<Graph> {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(job.id)) throw new Error('Invalid character job ID.');
    const nodes = await boundedJson(await this.request(base, '/object_info', signal)) as Record<string, RecipeNodeInfo>;
    const recipe = inspectRecipe('krea2', nodes);
    if (recipe.missing.length) throw new Error('Install the Krea 2 image recipe before generating a local character.');
    for (const node of Object.values(recipe.workflow)) if (nodes[node.class_type]?.api_node || (nodes[node.class_type]?.python_module !== 'nodes' && !nodes[node.class_type]?.python_module?.startsWith('comfy_extras.'))) throw new Error('Character generation requires native local image nodes.');
    const graph = recipe.workflow;
    graph['4']!.inputs['text'] = `Casting reference photograph, one fictional adult, full body centered facing the camera, face clearly visible, head and shoes entirely inside the frame, both hands visible, natural proportions. Soft even studio light against a plain light gray seamless background. Clean unmarked clothing. Identity and wardrobe: ${job.brief}`;
    graph['6']!.inputs['width'] = 768; graph['6']!.inputs['height'] = 1024;
    graph['9']!.inputs['filename_prefix'] = 'Signal/video/' + job.id;
    return graph;
  }
  async check(config: Pick<VideoConfig, 'comfyUrl' | 'localProfile' | 'sparseAttention' | 'localCheckpoint'> & { localModel?: 'h3' | 'ltx25' }, signal: AbortSignal): Promise<LocalVideoCheck> {
    try {
      const nodes = await boundedJson(await this.request(config.comfyUrl, '/object_info', signal)) as Record<string, NodeInfo>;
      const missing: string[] = [];
      if (config.localModel === 'ltx25') {
        for (const type of ['UNETLoader', 'CLIPLoader', 'VAELoader', 'LoadImage', 'ImageScale', 'LTXVPreprocess', 'CLIPTextEncode', 'LTXVConditioning', 'EmptyLTXVLatentVideo', 'LTXVImgToVideoInplace', 'LTXVEmptyLatentAudio', 'LTXVConcatAVLatent', 'LTXVDualCFGGuider', 'RandomNoise', 'KSamplerSelect', 'ManualSigmas', 'SamplerCustomAdvanced', 'LTXVSeparateAVLatent', 'LatentUpscaleModelLoader', 'LTXVLatentUpsampler', 'VAEDecodeTiled', 'CreateVideo', 'SaveVideo']) {
          const node = nodes[type];
          if (!node || (node.python_module !== 'nodes' && !node.python_module?.startsWith('comfy_extras.'))) missing.push('Native ComfyUI node: ' + type);
        }
        for (const [type, input, file] of LTX_MODEL_INPUTS) {
          const values = nodes[type]?.input?.required?.[input];
            const options = Array.isArray(values) ? (Array.isArray(values[0]) ? values[0] : (values[1] as { options?: unknown } | undefined)?.options) : undefined;
            if (!Array.isArray(options) || !options.includes(file)) missing.push('Model: ' + file);
        }
        return { ready: !missing.length, missing, detail: missing.length ? 'Install the listed LTX 2.5 files in Signal’s creative engine. Official components require Hugging Face access.' : 'LTX 2.5 files and native nodes are present. Low-memory output still needs a real render and full playback check. Preview clips are silent; the ad editor adds narration.' };
      }
      const types = ['UNETLoader', 'CLIPLoader', 'VAELoader', 'MiniMaxH3SigmaShift', 'LoadVideo', 'GetVideoComponents', 'MiniMaxH3ReferenceToVideo', 'RandomNoise', 'BasicGuider', 'KSamplerSelect', 'BasicScheduler', 'SamplerCustomAdvanced', 'VAEDecode', 'VAEDecodeAudio', 'CreateVideo', 'SaveVideo', 'LoadImage', ...(config.localProfile !== 'quality20' ? ['LoraLoaderModelOnly'] : []), ...(config.sparseAttention ? ['H3SLAAttention'] : [])];
      for (const type of types) {
        const node = nodes[type];
        if (!node) missing.push('Node: ' + type);
        else if (type !== 'H3SLAAttention' && node.python_module !== 'nodes' && !node.python_module?.startsWith('comfy_extras.')) missing.push('Native ComfyUI node required: ' + type);
      }
      if (config.localProfile === 'mick4' && nodes['AudioAdjustVolume']?.python_module !== 'comfy_extras.nodes_audio') missing.push('Native ComfyUI node required: AudioAdjustVolume');
      for (const [type, input, file] of [['UNETLoader', 'unet_name', config.localCheckpoint === 'w4a8' ? H3_MODELS.smaller : H3_MODELS.diffusion], ['CLIPLoader', 'clip_name', H3_MODELS.encoder], ['VAELoader', 'vae_name', H3_MODELS.videoVae], ['VAELoader', 'vae_name', H3_MODELS.audioVae], ...(config.localProfile !== 'quality20' ? [['LoraLoaderModelOnly', 'lora_name', config.localProfile === 'mick4' ? H3_MODELS.mickTurbo : H3_MODELS.turbo]] : [])]) {
        const values = nodes[type!]?.input?.required?.[input!];
        if (!Array.isArray(values) || !Array.isArray(values[0]) || !values[0].includes(file)) missing.push('Model: ' + file);
      }
      return { ready: !missing.length, missing, detail: missing.length ? 'Install the listed MiniMax H3 components before rendering.' : 'H3 files and nodes are installed. A real render is still needed to verify GPU compatibility and output quality.' };
    } catch { return { ready: false, missing: ['Start ComfyUI and check the local URL.'], detail: `Cannot inspect the local ${config.localModel === 'ltx25' ? 'LTX 2.5' : 'H3'} renderer.` }; }
  }
  async upload(base: string, data: string, name: string, signal: AbortSignal) {
    inputName(name); const match = /^data:(image\/jpeg|video\/mp4);base64,([A-Za-z0-9+/=]+)$/.exec(data); if (!match) throw new Error('Invalid reference data.');
    const bytes = Buffer.from(match[2]!, 'base64'); if (bytes.length > 25 * 1024 * 1024) throw new Error('Reference too large.');
    const body = new FormData(); body.set('image', new Blob([bytes], { type: match[1]! }), name); body.set('type', 'input'); body.set('overwrite', 'false');
    const result = z.object({ name: z.string(), subfolder: z.string(), type: z.literal('input') }).parse(await boundedJson(await this.request(base, '/upload/image', signal, { method: 'POST', body })));
    if (result.name !== name || result.subfolder !== '') throw new Error('Unexpected ComfyUI upload location.');
    return name;
  }
  async submit(base: string, job: VideoJob, graph: Graph, signal: AbortSignal): Promise<NonNullable<VideoJob['remote']>> {
    const result = z.object({ prompt_id: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/) }).parse(await boundedJson(await this.request(base, '/prompt', signal, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: graph, client_id: 'signal-video', extra_data: { signal_video_job: job.id } }) })));
    return { provider: 'comfy', id: result.prompt_id, statusUrl: this.base(base) };
  }
  async free(base: string, signal: AbortSignal) {
    const queue = z.object({ queue_running: z.array(z.unknown()), queue_pending: z.array(z.unknown()) }).parse(await boundedJson(await this.request(base, '/queue', signal)));
    if (queue.queue_running.length || queue.queue_pending.length) throw new Error('Wait for the other ComfyUI jobs before video review.');
    const result = await this.request(base, '/free', signal, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unload_models: true, free_memory: true }) });
    if (!result.ok) throw new Error('ComfyUI could not release video model memory.');
    await new Promise(resolve => setTimeout(resolve, 1500)); signal.throwIfAborted();
  }
  async poll(remote: NonNullable<VideoJob['remote']>, signal: AbortSignal, image = false): Promise<{ state: 'pending' | 'failed' } | { state: 'done'; bytes: Buffer }> {
    if (remote.provider !== 'comfy' || !remote.statusUrl) throw new Error('Local task required.');
    const value = await boundedJson(await this.request(remote.statusUrl, '/history/' + encodeURIComponent(remote.id), signal)) as Record<string, { status?: { completed?: boolean; status_str?: string }; outputs?: Record<string, unknown> }>;
    const entry = value[remote.id];
    if (!entry) {
      const queue = z.object({ queue_running: z.array(z.array(z.unknown())), queue_pending: z.array(z.array(z.unknown())) }).parse(await boundedJson(await this.request(remote.statusUrl, '/queue', signal)));
      return { state: [...queue.queue_running, ...queue.queue_pending].some(row => row[1] === remote.id) ? 'pending' : 'failed' };
    }
    if (entry.status?.status_str === 'error') return { state: 'failed' };
    if (!entry.status?.completed) return { state: 'pending' };
    const output = z.object({ images: z.array(z.object({ filename: z.string().regex(image ? /^[A-Za-z0-9_.-]+\.png$/ : /^[A-Za-z0-9_.-]+\.mp4$/), subfolder: z.string().regex(/^Signal[\\/]video$/), type: z.literal('output') })).min(1) }).parse(entry.outputs?.[image ? '9' : '17']).images[0]!;
    const query = new URLSearchParams(output); const response = await this.request(remote.statusUrl, '/view?' + query, signal);
    if (!response.ok || !response.body) throw new Error('ComfyUI video unavailable.');
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    const limit = image ? 25 : 80;
    try { while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > limit * 1024 * 1024) throw new Error(`Media download exceeds ${limit} MB.`); chunks.push(chunk.value); } } finally { await reader.cancel(); }
    return { state: 'done', bytes: Buffer.concat(chunks) };
  }
}
