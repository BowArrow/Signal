import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { NarrationAudio, VideoAssembly } from '../../shared/video.js';
import { videoTool } from './assembly.js';

const files = [
  { name: 'kokoro-v1.0.onnx', bytes: 325505369, sha256: 'beb0d1848dee9a49da392cc3df26958d46cfa35d321edf434f52949153f0df3a' },
  { name: 'voices-v1.0.bin', bytes: 28214398, sha256: 'bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d' },
];
export const narrationPython = (root: string) => join(root, 'venv', 'Scripts', 'python.exe');
export function narrationReady(root: string) { return existsSync(narrationPython(root)) && existsSync(join(root, 'installed-requirements.txt')) && files.every(file => { const path = join(root, file.name); return existsSync(path) && statSync(path).size === file.bytes; }); }
async function sha256(path: string) { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex'); }
export async function installNarration(root: string, signal: AbortSignal) {
  if (process.platform !== 'win32') throw new Error('Managed local narration currently requires Windows and Python 3.11.');
  mkdirSync(root, { recursive: true });
  if (!existsSync(narrationPython(root))) await videoTool('py.exe', ['-3.11', '-m', 'venv', join(root, 'venv')], root, signal, 120000);
  await videoTool(narrationPython(root), ['-m', 'pip', 'install', '--disable-pip-version-check', '--quiet', 'kokoro-onnx==0.6.1'], root, signal, 300000);
  for (const file of files) {
    const path = join(root, file.name);
    if (existsSync(path) && await sha256(path) === file.sha256) continue;
    const response = await fetch('https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/' + file.name, { signal });
    if (!response.ok || !response.body) throw new Error('Local voice download failed. Try setup again.');
    let bytes = 0;
    const bound = new Transform({ transform(chunk: Buffer, _encoding, callback) { bytes += chunk.length; if (bytes > file.bytes) callback(new Error('Voice download exceeds the expected size.')); else callback(null, chunk); } });
    await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), bound, createWriteStream(path + '.part'), { signal });
    if (bytes !== file.bytes || await sha256(path + '.part') !== file.sha256) throw new Error('Local voice checksum verification failed.');
    renameSync(path + '.part', path);
  }
  writeFileSync(join(root, 'model-manifest.json'), JSON.stringify({ source: 'https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.1', files }, null, 2));
  const lock = await videoTool(narrationPython(root), ['-m', 'pip', 'freeze'], root, signal, 30000); writeFileSync(join(root, 'installed-requirements.txt'), lock);
}
export async function generateNarration(root: string, scripts: string, folder: string, assembly: VideoAssembly, signal: AbortSignal): Promise<NarrationAudio | undefined> {
  if (!assembly.narration) return undefined;
  if (!narrationReady(root)) throw new Error('Set up the local narration voice in Video production first.');
  const duration = assembly.clips.reduce((total, clip) => total + clip.duration, 3);
  if (assembly.narration.start >= duration - 1) throw new Error('Start narration earlier in the edit.');
  mkdirSync(folder, { recursive: true });
  const spec = join(folder, 'narration-input.json'); writeFileSync(spec, JSON.stringify({ ...assembly.narration, maximumSeconds: duration - assembly.narration.start, runtime: root }));
  await videoTool(narrationPython(root), ['-s', join(scripts, 'limited_runtime.py'), '--cpu-only', '--ram-gb', '4', '--status', join(folder, 'narration-limits.json'), '--', join(scripts, 'narrate.py'), spec], folder, signal, 180000);
  const result = JSON.parse(readFileSync(join(folder, 'narration.json'), 'utf8')) as Omit<NarrationAudio, 'path'>;
  if (!Number.isFinite(result.duration) || result.duration <= 0 || result.duration > duration - assembly.narration.start || !Array.isArray(result.cues) || result.cues.some(cue => !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end <= cue.start || cue.end > result.duration)) throw new Error('Narration timing validation failed.');
  return { ...result, path: join(folder, 'narration.wav') };
}
