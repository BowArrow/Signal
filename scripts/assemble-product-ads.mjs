import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const folder = resolve('output/openart-ads/product-v2');
mkdirSync(folder, { recursive: true });
const bin = join(process.env.LOCALAPPDATA, 'Signal/runtime/video-tools/ffmpeg/ffmpeg-9.0.1-essentials_build/bin');
const ffmpeg = join(bin, 'ffmpeg.exe'), ffprobe = join(bin, 'ffprobe.exe');
for (const [source, target] of [['segoeui.ttf', 'regular.ttf'], ['segoeuib.ttf', 'bold.ttf']]) copyFileSync(join('C:/Windows/Fonts', source), join(folder, target));
const jobs = [
  { key: 'lemonade', brand: 'lemonade', accent: '0xE4ED72', bg: '0x101712', source: 'https://siplemona.de/',
    hook: ['Before you send', 'that report...'],
    shots: [
      { source: '../Lemonade/site/shots/file-citations.png', crop: [515, 62, 447, 97], y: 424, overviewY: 672, overviewW: 640, overviewX: 40,
        label: '01 / ASK', title: ["Ask what doesn't", 'add up.'], note: ['Compare the spreadsheet', 'with the report.'] },
      { source: '../Lemonade/site/shots/file-citations.png', crop: [985, 50, 285, 245], y: 365, overviewY: 981, overviewW: 300, overviewX: 380,
        label: '02 / CHECK', title: ['See where the', 'answer came from.'], note: ['Follow the source references.', 'Check the claim before sharing it.'] },
      { source: '../Lemonade/site/shots/spreadsheet.png', crop: [0, 0, 550, 240], y: 399, overviewY: 731, overviewW: 640, overviewX: 40,
        label: '03 / WORK', title: ['Keep working with', 'the numbers.'], note: ['An editable spreadsheet.', 'Formulas you can inspect.'] },
    ],
    endTitle: ['Less busywork.', 'One less subscription.'], offer: '$49 USD. Once.',
    details: ['Personal license on up to 3 computers', 'Windows 11 / Linux x86'],
    cta: 'Try 14 days. No credit card.', url: 'siplemona.de' },
  { key: 'cinegen', brand: 'CineGen', accent: '0x7CDCEC', bg: '0x0D1420', source: 'https://cinegenaimedia.com/',
    hook: ['Your idea deserves', 'a finished cut.'],
    shots: [
      { source: '../CineGen/pitch-site/screens/storyboarder.png', crop: [720, 135, 850, 870], y: 323, overviewY: 1000, overviewW: 300, overviewX: 380,
        label: '01 / PLAN', title: ['Give the story', 'a shot list.'], note: ['Shape scenes in the', 'AI Storyboarder.'] },
      { source: '../CineGen/pitch-site/screens/editor.png', crop: [680, 102, 1250, 730], y: 375, overviewY: 809, overviewW: 640, overviewX: 40,
        label: '02 / SHAPE', title: ['See the frame.', 'Shape the moment.'], note: ['Preview your footage', 'inside the editor.'] },
      { source: '../CineGen/pitch-site/screens/editor.png', crop: [684, 852, 1000, 370], y: 409, overviewY: 753, overviewW: 640, overviewX: 40,
        label: '03 / EDIT', title: ['Bring the pieces', 'into one timeline.'], note: ['Build your edit with', 'video and audio tracks.'] },
    ],
    endTitle: ['Your story.', 'Your next video.'], offer: 'Start a free project.',
    details: ['Free plan: watermarked 720p exports', 'No credit card required'],
    cta: 'Explore CineGen', url: 'cinegenaimedia.com' },
];
function run(tool, args) {
  const r = spawnSync(tool, args, { cwd: folder, windowsHide: true, encoding: 'utf8', timeout: 120000 });
  if (r.error || r.status !== 0) throw Error(r.error?.message ?? r.stderr?.slice(-3000));
  return r.stdout;
}
const base = ['-hide_banner', '-loglevel', 'error', '-y', '-nostdin'];
const encode = ['-an', '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
const reports = [];
for (const job of jobs) {
  let number = 0;
  const text = (value, y, size = 42, color = 'white', bold = false, x = 40) => {
    const file = `${job.key}-text-${number++}.txt`; writeFileSync(join(folder, file), value);
    return `drawtext=fontfile=${bold ? 'bold' : 'regular'}.ttf:textfile=${file}:expansion=none:fontsize=${size}:fontcolor=${color}:x=${x}:y=${y}`;
  };
  const segments = [];
  const opening = `${job.key}-00.mp4`;
  const hookFilters = ['scale=720:1280:force_original_aspect_ratio=increase', 'crop=720:1280', 'setsar=1', 'fps=24',
    'drawbox=x=0:y=877:w=iw:h=403:color=black@0.68:t=fill', text(job.brand, 919, 26, job.accent, true),
    text(job.hook[0], 982, 48, 'white', true), text(job.hook[1], 1042, 48, 'white', true), text('Illustrative AI-generated scene', 1178, 20, '0xCBD1DA')];
  run(ffmpeg, [...base, '-threads', '2', '-ss', '0.3', '-i', resolve(`output/openart-ads/${job.key}-source.mp4`), '-filter_threads', '2', '-vf', hookFilters.join(','), '-t', '2.5', ...encode, opening]);
  segments.push(opening);
  const sources = [];
  for (let i = 0; i < job.shots.length; i++) {
    const shot = job.shots[i], filename = `${job.key}-screen-${i}.png`;
    copyFileSync(resolve(shot.source), join(folder, filename));
    const hash = createHash('sha256').update(readFileSync(join(folder, filename))).digest('hex');
    sources.push({ source: shot.source, sha256: hash, crop: shot.crop });
    const cropH = Math.round(shot.crop[3] * 640 / shot.crop[2] / 2) * 2;
    const filter = [
      '[1:v]split=2[detail][overview]',
      `[detail]crop=${[shot.crop[2], shot.crop[3], shot.crop[0], shot.crop[1]].join(':')},scale=1280:${cropH * 2}:flags=lanczos,zoompan=z='1+0.025*min(on/95,1)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=640x${cropH}:fps=24,setsar=1[focus]`,
      `[overview]scale=${shot.overviewW}:-2:flags=lanczos,setsar=1[full]`,
      `[0:v][focus]overlay=40:${shot.y}:shortest=1[p1]`,
      `[p1][full]overlay=${shot.overviewX}:${shot.overviewY}:shortest=1[p2]`,
    ];
    const design = [text(job.brand, 51, 29, job.accent, true), text(shot.label, 119, 22, job.accent, true),
      text(shot.title[0], 176, 47, 'white', true), text(shot.title[1], 233, 47, 'white', true),
      `drawbox=x=38:y=${shot.y - 2}:w=644:h=${cropH + 4}:color=${job.accent}@0.7:t=2`,
      text('Product screenshot / example project', 1193, 20, '0xCBD1DA'),
      `drawbox=x=40:y=1240:w=640:h=3:color=white@0.15:t=fill`,
      `drawbox=x=40:y=1240:w=${Math.round(640 * (i + 1) / 3)}:h=3:color=${job.accent}:t=fill`];
    // Use the spare vertical space for the claim; never cover screenshot text.
    if (shot.y > 370) { design.push(text(shot.note[0], 313, 25, '0xCED6E0'), text(shot.note[1], 348, 25, '0xCED6E0')); }
    filter.push(`[p2]${design.join(',')}[out]`);
    const output = `${job.key}-0${i + 1}.mp4`;
    run(ffmpeg, [...base, '-f', 'lavfi', '-i', `color=c=${job.bg}:s=720x1280:r=24:d=4`, '-loop', '1', '-framerate', '24', '-i', filename,
      '-filter_complex_threads', '2', '-filter_complex', filter.join(';'), '-map', '[out]', '-t', '4', ...encode, output]);
    segments.push(output);
  }
  const end = `${job.key}-04.mp4`;
  const endFilters = [text(job.brand, 70, 38, job.accent, true), `drawbox=x=40:y=313:w=74:h=6:color=${job.accent}:t=fill`,
    text(job.endTitle[0], 367, 47, 'white', true), text(job.endTitle[1], 429, 47, 'white', true),
    text(job.offer, 571, 53, job.accent, true), text(job.details[0], 662, 27, '0xCED6E0'), text(job.details[1], 705, 27, '0xCED6E0'),
    `drawbox=x=40:y=848:w=640:h=99:color=${job.accent}:t=fill`, text(job.cta, 877, 33, job.bg, true, '(w-tw)/2'),
    text(job.url, 1040, 35, 'white', true), text('See the product. Try it with your own work.', 1120, 25, '0xCED6E0')];
  run(ffmpeg, [...base, '-f', 'lavfi', '-i', `color=c=${job.bg}:s=720x1280:r=24:d=5.5`, '-filter_threads', '2', '-vf', endFilters.join(','), '-t', '5.5', ...encode, end]);
  segments.push(end);
  const list = `${job.key}-concat.txt`; writeFileSync(join(folder, list), segments.map(s => `file '${s}'`).join('\n'));
  const output = `${job.key}-product-ad.mp4`;
  run(ffmpeg, [...base, '-f', 'concat', '-safe', '1', '-i', list, '-c', 'copy', '-movflags', '+faststart', output]);
  for (const [name, at] of [['hook', 1], ['ask', 4], ['proof', 8], ['work', 12], ['offer', 17]]) {
    run(ffmpeg, [...base, '-threads', '2', '-ss', String(at), '-i', output, '-frames:v', '1', '-threads', '2', `${job.key}-${name}.jpg`]);
  }
  run(ffmpeg, [...base, '-threads', '2', '-i', output, '-vf', 'fps=1/4,scale=216:384,tile=5x1', '-frames:v', '1', '-threads', '2', `${job.key}-review.jpg`]);
  const probe = JSON.parse(run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output]));
  reports.push({ business: job.key, file: output, duration: Number(probe.format.duration), width: 720, height: 1280,
    actualScreenshots: sources, productEvidence: job.source, checkedAt: new Date().toISOString(),
    structure: '2.5s fictional hook / three 4s actual screenshot examples / 5.5s offer',
    disclosure: 'Screenshot montage, not a live interaction or latency demonstration. Fictional opening is upscaled from 480p; product assets originate at 1280 or about 2500 pixels wide.',
    audio: 'Silent draft', newGenerationCredits: 0, published: false });
}
writeFileSync(join(folder, 'render-report.json'), JSON.stringify(reports, null, 2));
console.log(JSON.stringify(reports));
