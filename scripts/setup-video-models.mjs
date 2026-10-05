/* global fetch */
import { createHash } from 'node:crypto';
import { createWriteStream, createReadStream, existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// Owner-invoked local setup; downloads weights only, never remote executable code.
const root = join(process.env.LOCALAPPDATA, 'Signal', 'runtime', 'h3-models');
mkdirSync(root, { recursive: true });
const lowMemory = process.argv.includes('--low-memory');
const projectionOnly = process.argv.includes('--small-projection');
const entries = projectionOnly ? [
  ['NicoLab28/ClipProj-MiniMax-H3', 'mmh3-4b-ClipProj-v3.1.safetensors', 'clip_projections'],
] : lowMemory ? [
  ['Kijai/MiniMax-H3-experimental', 'minimax_h3_video_vae_int8_convrot.safetensors', 'vae'],
  ['Stick9190/qwen3vl_4b_int8_convrot', 'qwen3vl_4b_int8_convrot.safetensors', 'text_encoders'],
  ['NicoLab28/ClipProj-MiniMax-H3', 'mmh3-4b-ClipProj-v3.1-mlp.safetensors', 'clip_projections'],
] : [
  ['Kijai/MiniMax-H3-experimental', 'minimax_h3_ref2va_pruned_w4a8_mixed.safetensors', 'diffusion_models'],
  ['Comfy-Org/MiniMax-H3', 'text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors', 'text_encoders'],
  ['Comfy-Org/MiniMax-H3', 'vae/minimax_h3_video_vae_fp16.safetensors', 'vae'],
  ['Comfy-Org/MiniMax-H3', 'vae/minimax_h3_audio_vae_fp32.safetensors', 'vae'],
  ['joyfox/MiniMax-H3-Turbo', 'minimax_h3_fl2va_4step_lora.safetensors', 'loras'],
];
const manifest = [];
for (const [repo, source, category] of entries) {
  const metadataResponse = await fetch(`https://huggingface.co/api/models/${repo}/tree/main?recursive=true&expand=false`);
  if (!metadataResponse.ok) throw new Error('Cannot read published model checksums.');
  const metadata = (await metadataResponse.json()).find(row => row.path === source);
  if (!metadata?.lfs?.oid || !/^[a-f0-9]{64}$/.test(metadata.lfs.oid) || metadata.size > 22e9) throw new Error('Unexpected model metadata.');
  const filename = source.split('/').at(-1); const directory = join(root, category); mkdirSync(directory, { recursive: true });
  const target = join(directory, filename); const hashFile = async path => { const h = createHash('sha256'); for await (const chunk of createReadStream(path)) h.update(chunk); return h.digest('hex'); };
  if (existsSync(target)) {
    if (statSync(target).size !== metadata.size || await hashFile(target) !== metadata.lfs.oid) throw new Error('Existing model checksum mismatch: ' + filename);
  } else {
    const partial = target + '.part'; const start = existsSync(partial) ? statSync(partial).size : 0;
    if (start > metadata.size) throw new Error('Partial download exceeds expected size.');
    console.log(JSON.stringify({ file: filename, startingBytes: start, totalBytes: metadata.size }));
    if (start < metadata.size) {
      const response = await fetch(`https://huggingface.co/${repo}/resolve/main/${source}`, { headers: start ? { range: `bytes=${start}-` } : {} });
      if (response.status !== (start ? 206 : 200) || !response.body) throw new Error('Model download unavailable: ' + response.status);
      let bytes = start; let reported = start;
      await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, _encoding, done) { bytes += chunk.length; if (bytes > metadata.size) return done(new Error('Download exceeds expected model size.')); if (bytes - reported >= 1024 ** 3) { reported = bytes; console.log(JSON.stringify({ file: filename, downloadedGB: +(bytes / 1e9).toFixed(1) })); } done(null, chunk); } }), createWriteStream(partial, { flags: start ? 'a' : 'w' }));
    }
    if (statSync(partial).size !== metadata.size || await hashFile(partial) !== metadata.lfs.oid) throw new Error('Model checksum mismatch: ' + filename);
    renameSync(partial, target);
  }
  manifest.push({ repo, source, filename, category, bytes: metadata.size, sha256: metadata.lfs.oid });
  writeFileSync(join(root, projectionOnly ? 'manifest-small-projection.json' : lowMemory ? 'manifest-low-memory.json' : 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ verified: filename }));
}
console.log(JSON.stringify({ complete: true, root, files: manifest.length }));
