import { readFileSync, writeFileSync } from 'node:fs';
import { ltxWorkflow } from '../../src/core/video/ltx.js';
import type { VideoJob } from '../../src/shared/video.js';
const input = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
const d = input.direction;
const graph = ltxWorkflow({ id: input.id, duration: d.duration, ratio: d.ratio, characters: [{}], shot: { description: d.subject, openingAction: d.firstFrame, geometry: d.geometry, lighting: d.lighting, acting: d.acting, lensMm: 50, beats: d.beats } } as VideoJob, input.image);
graph['8']!.inputs['text'] = input.prompt;
// Preserve the existing bounded graph; prompts cannot add arbitrary Comfy nodes.
writeFileSync(process.argv[3]!, JSON.stringify(graph, null, 2));
