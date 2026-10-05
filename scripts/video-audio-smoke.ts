import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { assembleVideo, probeClip, videoTool } from '../src/core/video/assembly.js';
import { generateNarration } from '../src/core/video/narration.js';
import { videoConfigSchema, type VideoAssembly, type VideoAsset } from '../src/shared/video.js';
const root = join(process.env.LOCALAPPDATA!, 'Signal', 'runtime', 'narration');
const folder = resolve('data/video-audio-validation'); mkdirSync(folder, { recursive: true });
const config = videoConfigSchema.parse({ blenderPath: '', ffmpegPath: process.argv[2], dailyCloudLimit: 0 });
const signal = AbortSignal.timeout(180000); const paths = new Map<string, string>();
function asset(path: string, mime: VideoAsset['mime']): VideoAsset { const bytes = readFileSync(path); const sha256 = createHash('sha256').update(bytes).digest('hex'); paths.set(sha256, path); return { sha256, file: sha256 + (mime === 'audio/wav' ? '.wav' : '.mp4'), bytes: bytes.length, mime }; }
await videoTool(config.ffmpegPath, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=1:sample_rate=48000', '-c:a', 'pcm_s16le', join(folder, 'music.wav')], folder, signal);
const assembly: VideoAssembly = { title: 'Narration and music fixture', ratio: '9:16', clips: [{ jobId: 'test', start: 0, duration: 4, caption: 'Editorial overlay', asset: asset(resolve('data/video-ad-validation/sound.mp4'), 'video/mp4') }], headline: 'Less busywork. More done.', callToAction: 'Try it today', destination: 'https://siplemona.de/get-started', narration: { text: 'Find the answer in your own files. Try Lemonade today.', voice: 'af_heart', speed: 1, start: 2.5, captions: true }, music: { trackId: 'fixture-tone', gainDb: -22 }, musicAsset: asset(join(folder, 'music.wav'), 'audio/wav') };
const narration = await generateNarration(root, resolve('src/core/video'), folder, assembly, signal);
const output = await assembleVideo(assembly, config, folder, a => paths.get(a.sha256)!, signal, narration);
const info = await probeClip(output, config, signal);
for (const [name, at] of [['spoken-caption', 3.5], ['spoken-end-card', 5.2]] as const) await videoTool(config.ffmpegPath, ['-loglevel', 'error', '-y', '-ss', String(at), '-i', output, '-frames:v', '1', '-q:v', '2', join(folder, name + '.jpg')], folder, signal);
await videoTool(config.ffmpegPath, ['-loglevel', 'error', '-y', '-i', output, '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', join(folder, 'mixed.wav')], folder, signal);
const status = JSON.parse(readFileSync(join(folder, 'narration-limits.json'), 'utf8'));
if (status.exitCode !== 0 || status.gpuLimitBytes !== 0 || status.ramLimitBytes !== 4 * 1024 ** 3 || !status.enforced) throw new Error('Voice limits were not enforced');
if (!info.audio || Math.abs(info.duration - 7) > 0.15 || !narration || narration.duration > 4.5) throw new Error('Audio edit validation failed');
let oversizeRejected = false;
try { await generateNarration(root, resolve('src/core/video'), join(folder, 'too-long'), { ...assembly, clips: [{ ...assembly.clips[0]!, duration: 1 }], narration: { ...assembly.narration!, start: 2.9 } }, signal); } catch (error) { oversizeRejected = String(error).includes('longer than the edit'); }
if (!oversizeRejected) throw new Error('Long narration should stop without truncation');
const result = { fixtureOnly: true, output, ...info, narrationSeconds: narration.duration, cpuOnly: true, ramLimitGiB: 4, oversizedScriptRejected: oversizeRejected, listeningReview: 'pending' };
writeFileSync(join(folder, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
