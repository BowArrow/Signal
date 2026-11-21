// Frame-exact review edit. Publication approval is never inferred from source clips.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, join, dirname} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash, randomUUID} from 'node:crypto';
const run = promisify(execFile);
const json = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const verify = async (path, expected) => {
  if (sha(await readFile(path)) !== expected) throw new Error(`Asset changed: ${path}`);
};
const stamp = seconds => {
  const n = Math.round(seconds * 100);
  return `${Math.floor(n / 360000)}:${String(Math.floor(n / 6000) % 60).padStart(2, '0')}:${String(Math.floor(n / 100) % 60).padStart(2, '0')}.${String(n % 100).padStart(2, '0')}`;
};

async function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath) throw new Error('Usage: node apps/avatar-marketing/export-edited-review.mjs edit.json');
  const edit = await json(manifestPath);
  const brief = (await json(edit.briefPath || 'campaigns/alex-creator/launch-briefs.json')).find(b => b.id === edit.briefId);
  const voice = await json('campaigns/lemonade-tiktok/voice.json');
  const audio = resolve(edit.sourceAudio), audioMeta = await json(audio.replace(/\.wav$/i, '.json'));
  if (!brief || !voice.productionApproved || audioMeta.text !== brief.script || audioMeta.model !== voice.model || audioMeta.modelRevision !== voice.modelRevision || audioMeta.speaker !== voice.speaker) throw new Error('Narration is not the approved voice and exact script.');
  await verify(audio, edit.sourceAudioSha256);
  const room = await json(edit.roomReceipt), roomAudio = resolve(room.outputs.room.path);
  if (!room.sourceUnchanged || room.sourceSha256 !== edit.sourceAudioSha256 || room.alignmentLagSamples !== 0 || room.outputs.room.sha256 !== edit.roomAudioSha256) throw new Error('Room audio source or timing mismatch.');
  await verify(roomAudio, edit.roomAudioSha256);
  const duration = edit.frames / edit.fps;
  if (edit.fps !== 24 || edit.shots.some(s => !Number.isInteger(s.frames) || s.frames < 1) || edit.shots.reduce((n, s) => n + s.frames, 0) !== edit.frames || duration < audioMeta.durationSeconds || duration - audioMeta.durationSeconds > .15) throw new Error('Invalid edit length or incomplete narration.');
  const folder = resolve('output/alex-creator/exports', `${edit.briefId}-edited-${randomUUID()}`);
  await mkdir(folder, {recursive: true});
  await writeFile(join(folder, 'edit.json'), JSON.stringify(edit, null, 2));
  const ffmpegDir = join(process.env.LOCALAPPDATA, 'Signal/runtime/video-tools/ffmpeg/ffmpeg-9.0.1-essentials_build/bin');
  const ffmpeg = join(ffmpegDir, 'ffmpeg.exe'), ffprobe = join(ffmpegDir, 'ffprobe.exe');
  const ff = args => run(ffmpeg, ['-v', 'error', '-threads', '2', ...args], {cwd: folder, windowsHide: true, timeout: 600000, maxBuffer: 1024 * 1024});
  const probe = async path => JSON.parse((await run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], {windowsHide: true})).stdout);
  const timeline = [];
  let frame = 0;
  for (const [index, shot] of edit.shots.entries()) {
    let input, inputArgs, nativeResolution = null, sourceQualityApproved = false;
    if (shot.kind === 'video') {
      const receipt = await json(shot.receipt), spec = await json(join(dirname(shot.receipt), 'input.json'));
      input = resolve(receipt.video);
      if (!receipt.decodeVerified || receipt.sourceAudioSha256 !== edit.sourceAudioSha256 || Math.abs((spec.audioStart ?? 0) - shot.audioStart) > .0001 || Math.abs(shot.audioStart - frame / edit.fps) > .0001) throw new Error('Talking shot is not aligned to the continuous narration.');
      await verify(input, receipt.videoSha256);
      const stream = receipt.info.streams.find(s => s.codec_type === 'video');
      if (Number(stream.nb_frames) < shot.frames || stream.avg_frame_rate !== '24/1') throw new Error('Talking shot has insufficient frames or wrong rate.');
      nativeResolution = receipt.nativeResolution ? receipt.nativeResolution.join('x') : `${stream.width}x${stream.height}`;
      sourceQualityApproved = receipt.qualityApproved;
      inputArgs = ['-i', input];
    } else if (shot.kind === 'still') {
      input = resolve(shot.image); await verify(input, shot.imageSha256);
      inputArgs = ['-loop', '1', '-framerate', '24', '-i', input];
    } else throw new Error('Unknown shot kind.');
    const crop = shot.crop ? `crop=${shot.crop.width}:${shot.crop.height}:${shot.crop.x}:${shot.crop.y},` : '';
    const dest = `part-${index}.mp4`;
    await ff([...inputArgs, '-an', '-vf', `${crop}scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,setsar=1,fps=24`, '-frames:v', String(shot.frames), '-c:v', 'libx264', '-crf', '17', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-threads', '2', '-filter_threads', '1', dest]);
    const partInfo = await probe(join(folder, dest));
    if (Number(partInfo.streams[0].nb_frames) !== shot.frames) throw new Error('Segment frame count mismatch.');
    timeline.push({...shot, input, startFrame: frame, endFrameExclusive: frame + shot.frames, startSeconds: frame / 24, nativeResolution, sourceQualityApproved, encodedFile: dest});
    frame += shot.frames;
  }
  const transcript = await json(audio.replace(/\.wav$/i, '-transcript.json'));
  const words = transcript.segments.flatMap(s => s.words), exact = brief.script.split(/\s+/);
  if (words.length !== exact.length || transcript.wordSequenceSimilarity < .9) throw new Error('Caption alignment requires correction.');
  const cues = []; let start = 0;
  for (let i = 0; i < words.length; i++) {
    if (i - start >= 4 || /[.!?]$/.test(exact[i]) || i === words.length - 1 || words[i + 1].start - words[i].end > .35) {
      cues.push({start: words[start].start, end: Math.min(words[i].end + .12, words[i + 1]?.start ?? audioMeta.durationSeconds), text: exact.slice(start, i + 1).join(' ')}); start = i + 1;
    }
  }
  const ass = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,62,&H00FFFFFF,&H00FFFFFF,&H00171717,&H70000000,-1,0,0,0,100,100,0,0,1,3,1,2,110,110,390,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n` + cues.map(c => `Dialogue: 0,${stamp(c.start)},${stamp(c.end)},Default,,0,0,0,,${c.text.replace(/[{}\\]/g, '')}`).join('\n');
  await writeFile(join(folder, 'captions.ass'), ass);
  await writeFile(join(folder, 'caption-timings.json'), JSON.stringify(cues, null, 2));
  await writeFile(join(folder, 'concat.txt'), timeline.map(s => `file '${s.encodedFile}'`).join('\n'));
  await ff(['-f', 'concat', '-safe', '1', '-i', 'concat.txt', '-c', 'copy', 'picture.mp4']);
  await ff(['-i', 'picture.mp4', '-i', roomAudio, '-map', '0:v:0', '-map', '1:a:0', '-vf', 'subtitles=captions.ass', '-af', 'apad', '-t', String(duration), '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-threads', '2', '-filter_threads', '1', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', 'video.mp4']);
  const dest = join(folder, 'video.mp4'), info = await probe(dest);
  const v = info.streams.find(s => s.codec_type === 'video'), a = info.streams.find(s => s.codec_type === 'audio');
  if (!v || v.width !== 1080 || v.height !== 1920 || Number(v.nb_frames) !== edit.frames || Math.abs(Number(v.duration) - duration) > .001 || !a || Math.abs(Number(a.duration) - duration) > .05) throw new Error('Final streams failed duration, frame-count, or resolution validation.');
  await ff(['-i', dest, '-f', 'null', '-']);
  await ff(['-i', roomAudio, '-ac', '1', '-ar', '24000', '-f', 's16le', 'source-audio.pcm']);
  await ff(['-i', dest, '-vn', '-ac', '1', '-ar', '24000', '-f', 's16le', 'decoded-audio.pcm']);
  const sourcePcm = await readFile(join(folder, 'source-audio.pcm'));
  const decodedPcm = await readFile(join(folder, 'decoded-audio.pcm'));
  if (decodedPcm.length < sourcePcm.length) throw new Error('Encoded soundtrack cuts the approved narration.');
  const sampleCount = sourcePcm.length / 2;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, sumYY = 0;
  for (let i = 0; i < sampleCount; i++) {
    const x = sourcePcm.readInt16LE(i * 2), y = decodedPcm.readInt16LE(i * 2);
    sumX += x; sumY += y; sumXY += x * y; sumXX += x * x; sumYY += y * y;
  }
  const zeroLagCorrelation = (sumXY - sumX * sumY / sampleCount) / Math.sqrt((sumXX - sumX * sumX / sampleCount) * (sumYY - sumY * sumY / sampleCount));
  if (!Number.isFinite(zeroLagCorrelation) || zeroLagCorrelation < .995) throw new Error('Encoded soundtrack differs from the approved continuous room master.');
  const audioVerification = {sampleRate: 24000, comparedSamples: sampleCount, zeroLagCorrelation, completeSourceDurationPreserved: true, note: 'Encoding integrity and timing check, not a perceptual lip-sync or realism verdict.'};
  await ff(['-i', dest, '-vf', 'fps=1,scale=216:384,tile=5x3', '-frames:v', '1', 'contact.jpg']);
  const result = {path: dest, briefId: brief.id, createdAt: new Date().toISOString(), manifest: resolve(manifestPath), caption: brief.caption, aiLabel: brief.aiLabel, commercialDisclosure: brief.commercialDisclosure, frames: edit.frames, durationSeconds: duration, exportResolution: '1080x1920', nativeTalkingResolution: '768x1344', timeline, sourceAudioSha256: edit.sourceAudioSha256, roomAudioSha256: edit.roomAudioSha256, audioTiming: 'Continuous approved room-v2 master, no stretch, offset, or segment audio joins; final silence pad only.', captionAlignment: 'ASR word timings with exact approved script, including Too and worn.', decodeVerified: true, videoSha256: sha(await readFile(dest)), qualityApproved: false, published: false, info};
  result.audioVerification = audioVerification;
  await writeFile(join(folder, 'receipt.json'), JSON.stringify(result, null, 2));
  await writeFile(join(folder, 'publishing.txt'), `Account: @alexslightlybetter\nCaption: ${brief.caption}\nAI-generated label: ON\nCommercial disclosure: OFF (original entertainment; no product promotion)\nStatus: final playback review required; not posted\n`);
  console.log(JSON.stringify({path: dest, receipt: join(folder, 'receipt.json'), decodeVerified: true, frames: edit.frames, durationSeconds: duration, qualityApproved: false}));
}
main().catch(error => {console.error(error); process.exitCode = 1;});
