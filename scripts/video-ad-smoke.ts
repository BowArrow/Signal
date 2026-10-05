// Isolated CPU fixtures. No owner database, model runtime, publishing or network.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { assembleVideo, probeClip, videoTool } from '../src/core/video/assembly.js';
import { videoConfigSchema, type VideoAsset, type VideoAssembly } from '../src/shared/video.js';

const folder = resolve('data/video-ad-validation'); mkdirSync(folder, { recursive: true });
const config = videoConfigSchema.parse({ blenderPath: '', ffmpegPath: process.argv[2], dailyCloudLimit: 0 });
const signal = AbortSignal.timeout(3 * 60000);
await videoTool(config.ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x284c70:s=640x360:r=24:d=4', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4', '-threads', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', join(folder, 'sound.mp4')], folder, signal);
await videoTool(config.ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x275449:s=360x640:r=24:d=4', '-threads', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(folder, 'silent.mp4')], folder, signal);
const paths = new Map<string, string>();
function asset(name: string): VideoAsset { const path = join(folder, name); const bytes = readFileSync(path); const sha256 = createHash('sha256').update(bytes).digest('hex'); paths.set(sha256, path); return { file: sha256 + '.mp4', sha256, bytes: bytes.length, mime: 'video/mp4' }; }
const assembly: VideoAssembly = { title: 'Ad editing fixture', ratio: '9:16', clips: [{ jobId: 'sound', start: 0.5, duration: 2, caption: "Your team's next step: 100% clear.", asset: asset('sound.mp4') }, { jobId: 'silent', start: 1, duration: 2, caption: 'Literal text: %{frame_num}', asset: asset('silent.mp4') }], headline: 'Less busywork. More done.', callToAction: 'See how it works', destination: 'https://siplemona.de/get-started' };
const results = [];
for (const ratio of ['9:16', '16:9', '1:1'] as const) {
  const editFolder = join(folder, ratio.replace(':', '-'));
  const output = await assembleVideo({ ...assembly, ratio }, config, editFolder, a => paths.get(a.sha256)!, signal);
  const info = await probeClip(output, config, signal);
  if (!info.audio || Math.abs(info.duration - 7) > 0.15) throw new Error('Missing audio stream or wrong duration');
  for (const [name, at] of [['caption', 1], ['literal', 3], ['end-card', 5]] as const) await videoTool(config.ffmpegPath, ['-loglevel', 'error', '-y', '-threads', '2', '-ss', String(at), '-i', output, '-frames:v', '1', '-q:v', '2', join(editFolder, name + '.jpg')], editFolder, signal);
  // Verify source sound survives and silent footage/end card do not repeat it.
  for (const [name, at] of [['sound', 0.2], ['silence', 2.3], ['card-silence', 4.4]] as const) {
    await videoTool(config.ffmpegPath, ['-loglevel', 'error', '-y', '-ss', String(at), '-i', output, '-t', '0.5', '-vn', '-af', `astats=metadata=1:reset=0,ametadata=print:file=${name}.txt`, '-f', 'null', '-'], editFolder, signal);
    const values = [...readFileSync(join(editFolder, name + '.txt'), 'utf8').matchAll(/lavfi\.astats\.Overall\.RMS_level=([^\r\n]+)/g)].map(match => Number(match[1] === '-inf' ? '-Infinity' : match[1]));
    if (!values.length || values.some(value => Number.isNaN(value)) || (name === 'sound' ? !values.some(value => value > -40) : values.some(value => value > -60))) throw new Error('Unexpected sound level in ' + name);
  }
  results.push({ ratio, output, ...info, soundAndSilence: true });
}
writeFileSync(join(folder, 'result.json'), JSON.stringify({ fixtureOnly: true, results }, null, 2)); console.log(JSON.stringify({ ok: true, fixtureOnly: true, results }));
