import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Small CPU-only preview edits; no model, browser or GPU process is started.
const folder = resolve('output/openart-ads');
const bin = join(process.env.LOCALAPPDATA, 'Signal/runtime/video-tools/ffmpeg/ffmpeg-9.0.1-essentials_build/bin');
const ffmpeg = join(bin, 'ffmpeg.exe'), ffprobe = join(bin, 'ffprobe.exe');
mkdirSync(folder, { recursive: true });
copyFileSync('C:/Windows/Fonts/segoeui.ttf', join(folder, 'regular.ttf'));
copyFileSync('C:/Windows/Fonts/segoeuib.ttf', join(folder, 'bold.ttf'));
const jobs = [
  { key: 'lemonade', brand: 'lemonade', accent: '0xE4ED72', background: '0x101712',
    hooks: [['The answer is in', 'here somewhere.'], ['Ask your files.', 'Start your draft.']],
    headline: ['One less subscription.', 'Less document busywork.'],
    offer: '$49 USD once', terms: 'Personal license | Up to 3 computers',
    cta: 'Try 14 days. No credit card.', url: 'siplemona.de', platform: 'Windows 11 / Linux x86',
    source: 'https://siplemona.de/' },
  { key: 'cinegen', brand: 'CineGen', accent: '0xB5A0FF', background: '0x121020',
    hooks: [['You have the scene.', 'Give it a plan.'], ['Shape the shots.', 'Build your story.']],
    headline: ['Your next story', 'starts with a plan.'],
    offer: 'Storyboard. Edit. Create.', terms: 'A workspace for your next video',
    cta: 'Explore CineGen', url: 'cinegenaimedia.com', platform: 'AI video production studio',
    source: 'https://cinegenaimedia.com/' },
];
function run(tool, args) {
  const r = spawnSync(tool, args, { cwd: folder, windowsHide: true, encoding: 'utf8', timeout: 120000 });
  if (r.error || r.status !== 0) throw Error(r.error?.message ?? r.stderr?.slice(-2000));
  return r.stdout;
}
const report = [];
for (const job of jobs) {
  const input = `${job.key}-source.mp4`;
  if (!existsSync(join(folder, input))) continue;
  const probe = JSON.parse(run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', input]));
  const stream = probe.streams.find(s => s.codec_type === 'video');
  if (!stream || Number(probe.format.duration) < 5.8) throw Error('Source clip is missing or shorter than expected.');
  const filters = ['scale=480:854:force_original_aspect_ratio=decrease', 'pad=480:854:(ow-iw)/2:(oh-ih)/2', 'setsar=1', 'fps=24', 'trim=duration=6', 'setpts=PTS-STARTPTS', `tpad=stop_mode=add:stop_duration=6:color=${job.background}`,
    "drawbox=x=0:y=590:w=iw:h=264:color=black@0.65:t=fill:enable='lt(t,6)'",
    `drawbox=x=36:y=223:w=52:h=5:color=${job.accent}:t=fill:enable='gte(t,6)'`];
  let i = 0;
  const text = (value, y, size, color = 'white', enable = 'gte(t,6)', bold = false, center = false) => {
    const name = `${job.key}-text-${i++}.txt`; writeFileSync(join(folder, name), value);
    filters.push(`drawtext=fontfile=${bold ? 'bold' : 'regular'}.ttf:textfile=${name}:expansion=none:fontsize=${size}:fontcolor=${color}:x=${center ? '(w-tw)/2' : 36}:y=${y}:enable='${enable}'`);
  };
  text(job.brand, 52, 25, job.accent, 'gte(t,6)', true);
  for (let k = 0; k < 2; k++) {
    const enabled = k === 0 ? 'lt(t,3)' : 'between(t,3,5.999)';
    text(job.hooks[k][0], 624, 32, 'white', enabled, true);
    text(job.hooks[k][1], 666, 32, 'white', enabled, true);
    text(job.brand, 745, 20, job.accent, enabled, true);
  }
  text(job.headline[0], 265, 32, 'white', 'gte(t,6)', true);
  text(job.headline[1], 308, 32, 'white', 'gte(t,6)', true);
  text(job.offer, 405, 32, job.accent, 'gte(t,6)', true);
  text(job.terms, 459, 18, '0xD2D3D6');
  filters.push(`drawbox=x=36:y=550:w=408:h=66:color=${job.accent}:t=fill:enable='gte(t,6)'`);
  text(job.cta, 570, 23, job.background, 'gte(t,6)', true, true);
  text(job.url, 657, 24, 'white', 'gte(t,6)', true);
  text(job.platform, 700, 18, '0xBFC2C9');
  text('Illustrative AI-generated actor', 796, 14, '0xBFC2C9');
  const filterFile = `${job.key}-filters.txt`; writeFileSync(join(folder, filterFile), filters.join(','));
  const output = `${job.key}-ad-preview.mp4`;
  run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-nostdin', '-threads', '2', '-i', input,
    '-filter_threads', '2', '-vf', filters.join(','), '-an', '-t', '12', '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output]);
  run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-threads', '2', '-ss', '8', '-i', output, '-frames:v', '1', '-threads', '2', `${job.key}-end-card.png`]);
  run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-threads', '2', '-i', output, '-vf', 'fps=1/2,scale=240:427,tile=3x2', '-frames:v', '1', '-threads', '2', `${job.key}-review.jpg`]);
  const result = JSON.parse(run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output]));
  const video = result.streams.find(s => s.codec_type === 'video');
  report.push({ business: job.key, output, duration: Number(result.format.duration), width: video.width, height: video.height, codec: video.codec_name,
    audio: 'Silent preview; generated source ambience retained in the separate source clip.', quality: '480p source, preview only; no claim of native HD.',
    content: '6-second illustrative character hook plus 6-second editorial offer card. Not a software demonstration or customer testimonial.',
    productEvidence: job.source, checkedAt: new Date().toISOString(), published: false });
}
if (!report.length) throw Error('Download completed source clips before assembling.');
writeFileSync(join(folder, 'edit-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
