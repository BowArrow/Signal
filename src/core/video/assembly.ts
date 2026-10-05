import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { NarrationAudio, VideoAsset, VideoAssembly, VideoConfig } from '../../shared/video.js';

// No shell, GPU, model runtime, network protocol or unbounded captured output.
export async function videoTool(executable: string, args: string[], cwd: string, signal: AbortSignal, timeout = 10 * 60000): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let expired = false;
    const stop = () => { child.kill(); }; const timer = setTimeout(() => { expired = true; stop(); }, timeout);
    const clean = () => { clearTimeout(timer); signal.removeEventListener('abort', stop); };
    signal.addEventListener('abort', stop, { once: true }); if (signal.aborted) stop();
    child.stdout.on('data', (data: Buffer) => { stdout = (stdout + data.toString()).slice(-65536); });
    child.stderr.on('data', (data: Buffer) => { stderr = (stderr + data.toString()).slice(-4096); });
    child.once('error', () => { clean(); reject(new Error('The selected video tool could not start.')); });
    child.once('close', code => { clean(); if (signal.aborted || expired) reject(new Error('Video editing stopped or timed out.')); else if (code !== 0) reject(new Error('Video tool failed: ' + stderr.slice(-800))); else resolve(stdout); });
  });
}
export async function probeClip(path: string, config: VideoConfig, signal: AbortSignal) {
  const probe = join(dirname(config.ffmpegPath), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
  if (!existsSync(probe)) throw new Error('Choose an FFmpeg installation that also includes FFprobe.');
  const result = JSON.parse(await videoTool(probe, ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-f', 'mov', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', path], dirname(path), signal, 30000)) as { format?: { duration?: string }; streams?: { codec_type: string; width?: number; height?: number }[] };
  const video = result.streams?.find(stream => stream.codec_type === 'video'); const duration = Number(result.format?.duration);
  if (!video?.width || !video.height || video.width > 4096 || video.height > 4096 || !Number.isFinite(duration) || duration < 1 || duration > 300) throw new Error('Use an MP4 between 1 second and 5 minutes, at most 4096 pixels per side.');
  return { duration, width: video.width, height: video.height, audio: Boolean(result.streams?.some(stream => stream.codec_type === 'audio')) };
}
export function wrapOverlay(text: string, columns: number) {
  const words = text.split(/\s+/); const lines: string[] = []; let line = '';
  for (const word of words) {
    if (line && Array.from(line + ' ' + word).length > columns) { lines.push(line); line = ''; }
    const chars = Array.from(word);
    while (chars.length > columns) { if (line) { lines.push(line); line = ''; } lines.push(chars.splice(0, columns).join('')); }
    if (chars.length) line += (line ? ' ' : '') + chars.join('');
  }
  if (line) lines.push(line); return lines.join('\n');
}
export async function probeAudio(path: string, config: VideoConfig, signal: AbortSignal) {
  const probe = join(dirname(config.ffmpegPath), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
  const result = JSON.parse(await videoTool(probe, ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', path], dirname(path), signal, 30000)) as { format?: { duration?: string }; streams?: { codec_type: string }[] };
  const duration = Number(result.format?.duration);
  if (!Number.isFinite(duration) || duration < 1 || duration > 300 || !result.streams?.some(stream => stream.codec_type === 'audio')) throw new Error('Choose audio between 1 second and 5 minutes.');
  return duration;
}
export async function assembleVideo(assembly: VideoAssembly, config: VideoConfig, folder: string, assetPath: (asset: VideoAsset) => string, signal: AbortSignal, narration?: NarrationAudio): Promise<string> {
  if (!['ffmpeg', 'ffmpeg.exe'].includes(basename(config.ffmpegPath).toLowerCase()) || !existsSync(config.ffmpegPath)) throw new Error('Choose the FFmpeg executable.');
  mkdirSync(folder, { recursive: true });
  const font = process.platform === 'win32' ? join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts', 'arial.ttf') : '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
  if (!existsSync(font)) throw new Error('The local video caption font is unavailable.');
  copyFileSync(font, join(folder, 'font.ttf'));
  const [width, height] = assembly.ratio === '16:9' ? [1280, 720] : assembly.ratio === '9:16' ? [720, 1280] : [720, 720];
  const fontSize = width === 1280 ? 38 : 30;
  const text = (name: string, value: string, size: number, y: string, columns: number, color = 'white') => {
    // Bound even wide uppercase runs, not just ordinary words. Keep captions
    // within the safe lower band and end-card fields clear of one another.
    const maxHeight = height * (name === 'headline' ? 0.22 : name === 'cta' ? 0.13 : 0.18);
    let wrapped = '';
    while (true) {
      wrapped = wrapOverlay(value, Math.min(columns, Math.floor(width * 0.84 / size)));
      if (wrapped.split('\n').length * (size + 8) <= maxHeight || size <= 16) break;
      size -= 2;
    }
    writeFileSync(join(folder, name + '.txt'), wrapped, 'utf8');
    return `drawtext=fontfile=font.ttf:textfile=${name}.txt:expansion=none:fontsize=${size}:fontcolor=${color}:line_spacing=8:x=(w-text_w)/2:y=${y}`;
  };
  const common = ['-hide_banner', '-loglevel', 'error', '-y', '-nostdin', '-filter_threads', '1', '-filter_complex_threads', '1'];
  const encode = ['-c:v', 'libx264', '-threads:v', '2', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart'];
  const names: string[] = [];
  if (Boolean(assembly.narration) !== Boolean(narration)) throw new Error('The requested narration is not ready.');
  for (const [index, clip] of assembly.clips.entries()) {
    signal.throwIfAborted(); const path = assetPath(clip.asset); const info = await probeClip(path, config, signal);
    if (clip.start + clip.duration > info.duration + 0.05) throw new Error('Source footage is shorter than the selected edit.');
    const name = `clip-${index}.mp4`; names.push(name);
    const filters = [`scale=${width}:${height}:force_original_aspect_ratio=decrease`, `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x111827`, 'setsar=1', 'fps=24', 'setpts=PTS-STARTPTS'];
    if (clip.caption) { const top = Boolean(assembly.narration?.captions); filters.push(text(`caption-${index}`, clip.caption, fontSize, top ? 'h*0.11' : 'h*0.70', width === 1280 ? 50 : 34) + ':box=1:boxcolor=black@0.65:boxborderw=14'); }
    await videoTool(config.ffmpegPath, [...common, '-threads', '2', '-protocol_whitelist', 'file,pipe', '-ss', String(clip.start), '-f', 'mov', '-i', path, ...(!info.audio ? ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo'] : []), '-map', '0:v:0', '-map', info.audio ? '0:a:0' : '1:a:0', '-vf', filters.join(','), '-af', 'asetpts=PTS-STARTPTS,aresample=48000:async=1:first_pts=0,apad', '-t', String(clip.duration), ...encode, join(folder, name)], folder, signal);
  }
  const destination = new URL(assembly.destination); const display = destination.host + (destination.pathname === '/' ? '' : destination.pathname);
  const card = [text('headline', assembly.headline, fontSize + 8, 'h*0.25', width === 1280 ? 42 : 26), text('cta', assembly.callToAction, fontSize, 'h*0.55', width === 1280 ? 48 : 30, '0x8DE8CE'), text('destination', display, Math.max(22, fontSize - 8), 'h*0.73', width === 1280 ? 58 : 40)].join(',');
  names.push('end-card.mp4');
  await videoTool(config.ffmpegPath, [...common, '-f', 'lavfi', '-i', `color=c=0x111827:s=${width}x${height}:r=24:d=3`, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-vf', card, '-t', '3', ...encode, join(folder, 'end-card.mp4')], folder, signal);
  writeFileSync(join(folder, 'clips.txt'), names.map(name => `file '${name}'`).join('\n'));
  const output = join(folder, 'finished-ad.mp4'); const duration = assembly.clips.reduce((sum, clip) => sum + clip.duration, 3);
  const inputs = [...common, '-f', 'concat', '-safe', '1', '-i', 'clips.txt'];
  const graph: string[] = []; const audio = ['[source]']; let index = 1;
  graph.push(`[0:a]volume=${assembly.keepSourceAudio === false ? 0 : narration ? 0.12 : 1}[source]`);
  if (assembly.music) {
    if (!assembly.musicAsset) throw new Error('The saved music asset is missing.');
    const path = assetPath(assembly.musicAsset); await probeAudio(path, config, signal);
    inputs.push('-stream_loop', '-1', '-protocol_whitelist', 'file,pipe', '-f', 'wav', '-i', path);
    graph.push(`[${index++}:a]atrim=duration=${duration},asetpts=PTS-STARTPTS,volume=${assembly.music.gainDb}dB,afade=t=out:st=${Math.max(0, duration - 1)}:d=1[music]`); audio.push('[music]');
  }
  if (narration && assembly.narration) {
    if (narration.duration + assembly.narration.start > duration) throw new Error('Narration is longer than this edit.');
    inputs.push('-protocol_whitelist', 'file,pipe', '-f', 'wav', '-i', narration.path);
    const delay = Math.round(assembly.narration.start * 1000);
    graph.push(`[${index++}:a]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,adelay=${delay}:all=1,apad[speech]`); audio.push('[speech]');
  }
  graph.push(`${audio.join('')}amix=inputs=${audio.length}:duration=first:normalize=0,alimiter=limit=0.95:level=0[mixed]`);
  const subtitles: string[] = [];
  if (narration && assembly.narration?.captions) {
    let number = 0;
    for (const cue of narration.cues) {
      // Short blocks share their sentence's measured span. These are generated
      // script captions, not word-aligned transcription of existing footage.
      const blocks = wrapOverlay(cue.text, 65).split('\n'); const count = blocks.reduce((sum, block) => sum + block.length, 0); let at = cue.start + assembly.narration.start;
      for (const block of blocks) {
        const end = at + (cue.end - cue.start) * block.length / count; const enable = `between(t,${at.toFixed(4)},${end.toFixed(4)})`;
        const id = number++; const size = Math.min(fontSize, 28); const columns = width === 1280 ? 50 : 34;
        subtitles.push(text(`speech-${id}`, block, size, 'h*0.70', columns) + `:box=1:boxcolor=black@0.65:boxborderw=14:enable='${enable}*lt(t,${duration - 3})'`);
        subtitles.push(text(`speech-card-${id}`, block, size, 'h*0.04', columns) + `:box=1:boxcolor=black@0.65:boxborderw=14:enable='${enable}*gte(t,${duration - 3})'`); at = end;
      }
    }
  }
  if (subtitles.length) graph.push('[0:v]' + subtitles.join(',') + '[captioned]');
  await videoTool(config.ffmpegPath, [...inputs, '-filter_complex', graph.join(';'), '-map', subtitles.length ? '[captioned]' : '0:v:0', '-map', '[mixed]', '-t', String(duration), ...encode, output], folder, signal);
  const result = await probeClip(output, config, signal);
  if (!result.audio || result.width !== width || result.height !== height || Math.abs(result.duration - duration) > 0.15 || statSync(output).size > 80 * 1024 * 1024) throw new Error('The finished edit failed its format, duration or size check.');
  writeFileSync(join(folder, 'edit.json'), JSON.stringify(assembly, null, 2)); return output;
}
