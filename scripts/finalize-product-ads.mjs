import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const folder = resolve('output/openart-ads/final');
const runtime = join(process.env.LOCALAPPDATA, 'Signal/runtime/narration');
const bin = join(process.env.LOCALAPPDATA, 'Signal/runtime/video-tools/ffmpeg/ffmpeg-9.0.1-essentials_build/bin');
const ffmpeg = join(bin, 'ffmpeg.exe'), ffprobe = join(bin, 'ffprobe.exe');
mkdirSync(folder, { recursive: true });
const jobs = [
  { key: 'lemonade', voice: 'af_heart', script: "Before you send that report. Ask Lemonade what doesn't add up. Check the answer against its sources. Keep working in an editable spreadsheet. Forty-nine dollars, once. Try it free for fourteen days." },
  { key: 'cinegen', voice: 'am_michael', script: 'Your idea deserves a finished cut. Plan your shots in CineGen. Shape the moment in the editor. Bring video and audio into one timeline. Your next story starts here. Try CineGen free.' },
];
function run(tool, args, cwd = folder, timeout = 180000) {
  const r = spawnSync(tool, args, { cwd, windowsHide: true, encoding: 'utf8', timeout });
  if (r.error || r.status !== 0) throw Error(r.error?.message ?? r.stderr?.slice(-3500) ?? 'Process failed');
  return r.stdout;
}
const base = ['-hide_banner', '-loglevel', 'error', '-y', '-nostdin'];
const sampleRate = 48000, seconds = 20;
// Original soft mallet/pad composition and transitions. No sampled third-party music.
const pcm = new Float32Array(sampleRate * seconds);
const chords = [[130.813,164.814,195.998,246.942],[110,130.813,164.814,195.998],[87.307,130.813,164.814,195.998],[97.999,146.832,195.998,220]];
for (let n = 0; n < pcm.length; n++) {
  const t = n / sampleRate, chord = chords[Math.min(3, Math.floor(t / 5))], local = t % 5;
  const env = Math.min(1, local / 0.65) * Math.min(1, (5 - local) / 0.8) * Math.min(1, t / 0.5) * Math.min(1, (seconds - t) / 1.2);
  let value = 0;
  for (let k = 0; k < chord.length; k++) value += 0.011 * env * (Math.sin(2 * Math.PI * chord[k] * t) + 0.13 * Math.sin(2 * Math.PI * chord[k] * 2 * t));
  const beat = t % 0.625, note = chord[Math.floor(t / 0.625) % chord.length] * 2;
  value += 0.018 * Math.exp(-beat * 14) * Math.min(1, beat / 0.009) * Math.sin(2 * Math.PI * note * t) * env;
  for (const at of [2.5, 6.5, 10.5, 14.5]) {
    const age = t - at;
    if (age >= 0 && age < 0.12) value += 0.009 * Math.sin(2 * Math.PI * (1050 - 1800 * age) * age) * Math.exp(-age * 45);
  }
  pcm[n] = value;
}
const buffer = Buffer.alloc(44 + pcm.length * 2);
buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(pcm.length * 2, 40);
for (let i = 0; i < pcm.length; i++) buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, pcm[i])) * 32767), 44 + i * 2);
writeFileSync(join(folder, 'original-music.wav'), buffer);
const stamp = seconds => { const ms = Math.round(seconds * 1000); return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
const reports = [];
for (const job of jobs) {
  const narrationFolder = join(folder, job.key); mkdirSync(narrationFolder, { recursive: true });
  const spec = join(narrationFolder, 'narration-input.json');
  writeFileSync(spec, JSON.stringify({ text: job.script, voice: job.voice, speed: 1.08, maximumSeconds: 30, runtime }));
  if (!existsSync(join(narrationFolder, 'narration.json'))) throw Error('Prepare cloud narration before mixing; local memory safeguard stays intact.');
  const info = JSON.parse(readFileSync(join(narrationFolder, 'narration.json'), 'utf8'));
  if (info.cues.length !== 6) throw Error('Expected six narration cues');
  const starts = [0.08, 2.65, 6.65, 10.65, 14.65];
  starts.push(starts[4] + info.cues[4].end - info.cues[4].start + 0.15);
  const timed = info.cues.map((cue, i) => ({ text: cue.text, start: starts[i], end: starts[i] + cue.end - cue.start }));
  if (timed.some((cue, i) => cue.end > (starts[i + 1] ?? 19.75) - 0.04)) throw Error(job.key + ': narration exceeds its scene; shorten it before mixing');
  writeFileSync(join(folder, `${job.key}-captions.srt`), timed.map((cue, i) => `${i + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text}\n`).join('\n'));
  const graph = ['[1:a]asplit=6' + info.cues.map((_, i) => `[c${i}]`).join('')];
  info.cues.forEach((cue, i) => graph.push(`[c${i}]atrim=start=${cue.start}:end=${cue.end},asetpts=PTS-STARTPTS,adelay=${Math.round(starts[i] * 1000)}:all=1[v${i}]`));
  graph.push(info.cues.map((_, i) => `[v${i}]`).join('') + 'amix=inputs=6:normalize=0,apad,atrim=duration=20,loudnorm=I=-17:TP=-3:LRA=7,asplit=2[voice][side]');
  graph.push('[2:a]volume=0.55[bed]', '[bed][side]sidechaincompress=threshold=0.025:ratio=5:attack=10:release=220[ducked]', '[voice][ducked]amix=inputs=2:normalize=0,alimiter=limit=0.89:level=0,aresample=48000[out]');
  const input = resolve(`output/openart-ads/product-v2/${job.key}-product-ad.mp4`), output = `${job.key}-final.mp4`;
  run(ffmpeg, [...base, '-threads', '2', '-i', input, '-i', join(narrationFolder, 'narration.wav'), '-i', 'original-music.wav', '-filter_complex_threads', '2', '-filter_complex', graph.join(';'), '-map', '0:v:0', '-map', '[out]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-t', '19.958333', '-movflags', '+faststart', output]);
  run(ffmpeg, [...base, '-threads', '2', '-i', output, '-vn', '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', `${job.key}-mix.wav`]);
  const probe = JSON.parse(run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output]));
  if (!probe.streams.some(s => s.codec_type === 'audio') || Math.abs(Number(probe.format.duration) - 20) > 0.1) throw Error('Final stream validation failed');
  const analysis = spawnSync(ffmpeg, ['-hide_banner', '-nostdin', '-threads', '2', '-i', output, '-vn', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], { cwd: folder, windowsHide: true, encoding: 'utf8', timeout: 30000 });
  const measurement = JSON.parse(analysis.stderr.slice(analysis.stderr.lastIndexOf('{'), analysis.stderr.lastIndexOf('}') + 1));
  if (Number(measurement.input_tp) > -0.1 || !Number.isFinite(Number(measurement.input_i))) throw Error('Invalid or clipping mix');
  copyFileSync(resolve(`output/openart-ads/product-v2/${job.key}-ask.jpg`), join(folder, `${job.key}-poster.jpg`));
  reports.push({ product: job.key, output, duration: Number(probe.format.duration), width: 720, height: 1280, narrationVoice: info.voice,
    narrationCues: timed, audio: measurement, music: 'Original generated PCM composition; no external recording or samples', captionFile: `${job.key}-captions.srt`,
    additionalOpenArtCreditsSpent: 0, voiceUsage: 'Existing ElevenLabs allowance; see voice-usage.json', screenshotMontage: true, checkedAt: new Date().toISOString(), publicationStatus: 'See output/ltd-rollout/hosting-release.json for Lemonade deployment' });
  console.log(job.key + ': final video and captions validated');
}
writeFileSync(join(folder, 'final-report.json'), JSON.stringify(reports, null, 2));
