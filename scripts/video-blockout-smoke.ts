import { app } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DesktopVideoHost } from '../electron/main/video-host.js';
import { videoConfigSchema, type VideoJob } from '../src/shared/video.js';

const folder = resolve('data/video-blockout-validation'); mkdirSync(folder, { recursive: true });
app.setPath('userData', join(folder, 'electron-profile')); app.disableHardwareAcceleration();
void app.whenReady().then(async () => {
  const config = videoConfigSchema.parse({ blenderPath: process.argv[2], ffmpegPath: process.argv[3], dailyCloudLimit: 0 });
  const host = new DesktopVideoHost(folder, resolve('src/core/video/blockout.py'));
  const job: VideoJob = { id: 'blockout-check', productId: 'fixture', kind: 'shot', title: 'Cross the office', brief: 'A fictional character walks across the office as the camera follows.', characters: [], renderer: 'local', duration: 5, ratio: '16:9', phase: 'blockout', detail: '', createdAt: Date.now(), updatedAt: Date.now(), shot: { description: 'A character walks across a plain office toward the desk.', openingAction: 'The character is already walking.', geometry: 'Character foreground left, desks in the background.', lensMm: 35, lighting: 'Broad soft daylight from the front left.', acting: 'Purposeful walk toward the desk.', beats: [{ start: 0, end: 2, action: 'Walk from the left toward the center.' }, { start: 2, end: 5, action: 'Continue toward the right-hand desk.' }], environment: 'office', cameraStart: [0, -5, 2], cameraEnd: [1, -5, 2], lookAt: [0, 0, 1], actors: [{ characterId: 'actor-one', start: [-1, 0, 0], end: [1, 0.5, 0] }] } };
  const output = await host.blockout(job, config, new AbortController().signal);
  const frames = await host.frames(output, config, new AbortController().signal, 5);
  if (frames.length !== 6) throw new Error('Expected six sampled frames.');
  writeFileSync(join(folder, 'preview.jpg'), Buffer.from(frames[2]!.split(',')[1]!, 'base64'));
  writeFileSync(join(folder, 'result.json'), JSON.stringify({ output, frames: frames.length, config }, null, 2));
  console.log(JSON.stringify({ ok: true, video: host.assetPath(output), frames: frames.length })); app.exit(0);
}).catch(error => { console.error(String(error)); app.exit(1); });
