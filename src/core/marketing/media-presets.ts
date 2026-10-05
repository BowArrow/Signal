import { parseWorkflow } from './comfy.js';

export const MEDIA_RECIPES = [
  { id: 'flux-schnell', name: 'FLUX.1 Schnell · image', kind: 'image', guide: 'https://docs.comfy.org/tutorials/flux/flux-1-text-to-image', license: 'https://huggingface.co/black-forest-labs/FLUX.1-schnell', note: '4-step image generation. Uses separate diffusion, text encoder, and VAE files. Apache-2.0 model.' },
  { id: 'krea2', name: 'Krea 2 Turbo · image', kind: 'image', guide: 'https://docs.comfy.org/tutorials/image/krea/krea-2', license: 'https://github.com/krea-ai/krea-2/blob/main/docs/KREA-2-COMMUNITY-LICENSE', note: '8-step visual exploration. Large model; allow CPU offloading. Review the Krea community license for your use.' },
  { id: 'wan22', name: 'Wan 2.2 5B · video', kind: 'video', guide: 'https://docs.comfy.org/tutorials/video/wan/wan2_2', license: 'https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B', note: 'Short text-to-video clips, 49 frames at 24 fps. ComfyUI documents offloaded operation on 8 GB VRAM; speed varies.' },
] as const;
export interface NodeInfo { python_module?: string; api_node?: boolean; input?: { required?: Record<string, unknown[]> } }
const modelChoices = (info: Record<string, NodeInfo>, node: string, input: string): string[] => {
  const list = info[node]?.input?.required?.[input]?.[0];
  return Array.isArray(list) ? list.filter((value): value is string => typeof value === 'string') : [];
};
export function recipeWorkflow(id: string, info: Record<string, NodeInfo>) {
  const choose = (node: string, field: string, pattern: RegExp, fallback: string) => modelChoices(info, node, field).find(value => pattern.test(value)) ?? fallback;
  const krea = id === 'krea2'; const wan = id === 'wan22';
  if (!MEDIA_RECIPES.some(recipe => recipe.id === id)) throw new Error('Unknown media recipe');
  const model = choose('UNETLoader', 'unet_name', krea ? /krea2.*turbo.*fp8/i : wan ? /wan2[._]2.*5b/i : /flux.*schnell/i, krea ? 'krea2_turbo_fp8_scaled.safetensors' : wan ? 'wan2.2_ti2v_5B_fp16.safetensors' : 'flux1-schnell.safetensors');
  const encoder = choose('CLIPLoader', 'clip_name', krea ? /qwen3vl.*4b.*fp8/i : /umt5.*fp8/i, krea ? 'qwen3vl_4b_fp8_scaled.safetensors' : 'umt5_xxl_fp8_e4m3fn_scaled.safetensors');
  const vae = choose('VAELoader', 'vae_name', krea ? /qwen_image_vae|wan_2.1_vae/i : wan ? /wan2[._]2.*vae/i : /^ae\./i, krea ? 'qwen_image_vae.safetensors' : wan ? 'wan2.2_vae.safetensors' : 'ae.safetensors');
  const nodes: Record<string, { class_type: string; inputs: Record<string, unknown> }> = {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: model, weight_dtype: 'default' } },
    '2': krea || wan ? { class_type: 'CLIPLoader', inputs: { clip_name: encoder, type: krea ? 'krea2' : 'wan', device: 'default' } } : { class_type: 'DualCLIPLoader', inputs: { clip_name1: choose('DualCLIPLoader', 'clip_name1', /clip_l\./i, 'clip_l.safetensors'), clip_name2: choose('DualCLIPLoader', 'clip_name2', /t5xxl.*fp8/i, 't5xxl_fp8_e4m3fn.safetensors'), type: 'flux', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: vae } },
    '4': { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}', clip: ['2', 0] } },
    '5': { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['4', 0] } },
    '6': wan ? { class_type: 'Wan22ImageToVideoLatent', inputs: { vae: ['3', 0], width: 640, height: 352, length: 49, batch_size: 1 } } : { class_type: krea ? 'EmptyLatentImage' : 'EmptySD3LatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
    '7': { class_type: 'KSampler', inputs: { model: [krea || wan ? '11' : '1', 0], positive: ['4', 0], negative: ['5', 0], latent_image: ['6', 0], seed: 42, steps: wan ? 20 : krea ? 8 : 4, cfg: wan ? 5 : 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['3', 0] } },
    '9': wan ? { class_type: 'CreateVideo', inputs: { images: ['8', 0], fps: 24 } } : { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'Signal' } },
  };
  if (krea) nodes['11'] = { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['1', 0], shift: 3 } };
  if (wan) { nodes['11'] = { class_type: 'ModelSamplingSD3', inputs: { model: ['1', 0], shift: 8 } }; nodes['10'] = { class_type: 'SaveVideo', inputs: { video: ['9', 0], filename_prefix: 'Signal', format: 'auto', codec: 'auto' } }; }
  return parseWorkflow(nodes);
}
export function inspectRecipe(id: string, info: Record<string, NodeInfo>) {
  const workflow = recipeWorkflow(id, info); const missing: string[] = [];
  for (const node of Object.values(workflow)) {
    if (!info[node.class_type]) { missing.push(`Node: ${node.class_type}`); continue; }
    for (const [field, value] of Object.entries(node.inputs)) {
      const choices = info[node.class_type]?.input?.required?.[field]?.[0];
      if (typeof value === 'string' && Array.isArray(choices) && !choices.includes(value)) missing.push(`${node.class_type}.${field}: ${value}`);
    }
  }
  return { workflow, missing: [...new Set(missing)] };
}
