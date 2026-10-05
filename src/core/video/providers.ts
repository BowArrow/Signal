import { z } from 'zod';
import { boundedJson } from '../connections/network.js';
import { videoFrames, type VideoJob } from '../../shared/video.js';

export function higgsfieldStatusUrl(value: string) {
  const url = new URL(value);
  if (url.origin !== 'https://api.higgsfield.ai' || url.username || url.password || !/^\/requests\/[A-Za-z0-9_-]+\/status$/.test(url.pathname) || url.search || url.hash) throw new Error('Invalid Higgsfield status URL.');
  return url.href;
}
export function minimaxInput(job: VideoJob, images: string[], blockout: string) {
  if (!job.shot || images.length !== job.characters.length || !images.length) throw new Error('Character references and a planned shot are required.');
  const duration = videoFrames(job) / 24; const timeScale = duration / job.duration;
  const names = job.characters.map((c, i) => `<Picture ${i + 1}> controls the face, hair, body and wardrobe of subject ${i + 1}. Character notes: ${c.description}`).join('\n');
  const prompt = `[video editing + reference generation]\nOne continuous shot, ${duration.toFixed(3)} seconds, real-time movement, no speed changes. No background music, no spoken words, no captions or generated interface text.\nSTYLE: ${job.bible?.visualStyle ?? 'Natural photographic detail and grounded human performance.'}\nREFERENCE ROLES: ${names}\n<Video 1> controls motion, timing, camera and spatial layout only. Replace its proxy figures with the corresponding subjects from the image references; do not copy the proxy surface appearance.\nGEOMETRY: ${job.shot.geometry}\nOPENING: ${job.shot.openingAction}\nCAMERA: ${job.shot.lensMm}mm perspective held throughout, follow the supplied reference movement.\nLIGHT: ${job.shot.lighting}\nACTION TIMING: ${job.shot.beats.map(b => `${(b.start * timeScale).toFixed(3)}-${(b.end * timeScale).toFixed(3)}s: ${b.action}`).join('\n')}\nACTING: ${job.shot.acting}\nPHYSICS: Body weight stays supported; steps have contact and recovery, hands touch the intended object, hair and fabric trail body motion. No floating, foot sliding or teleporting.\nAUDIO: Quiet location ambience and sounds caused by visible actions only. No score, music, singing, dialogue or off-screen voices.\nSHOT: ${job.shot.description}\nLOCKS: Keep the same character identities, wardrobe and set layout throughout. No extra people, invented logos, text or UI. ${job.bible?.rules ?? ''}`;
  if (prompt.length > 7000) throw new Error('Director prompt exceeds MiniMax limits. Shorten the character notes or shot plan.');
  return { model: 'MiniMax-H3', resolution: '768P', duration: job.duration, ratio: job.ratio, content: [
    { type: 'text', text: prompt },
    ...images.map(url => ({ type: 'image_url', image_url: { url }, role: 'reference_image' })),
    { type: 'video_url', video_url: { url: blockout }, role: 'reference_video' },
  ] };
}
export class VideoProviders {
  constructor(private readonly secret: (provider: 'higgsfield' | 'minimax') => string | undefined, private readonly transport: typeof fetch = fetch) {}
  private async json(provider: 'higgsfield' | 'minimax', url: string, signal: AbortSignal, body?: unknown) {
    const key = this.secret(provider); if (!key) throw new Error(`Connect ${provider} in Video production.`);
    const response = await this.transport(url, { method: body ? 'POST' : 'GET', headers: { authorization: (provider === 'higgsfield' ? 'Key ' : 'Bearer ') + key, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]) });
    return boundedJson(response);
  }
  async character(prompt: string, signal: AbortSignal): Promise<NonNullable<VideoJob['remote']>> {
    const result = z.object({ request_id: z.string().min(1).max(200), status_url: z.string().url() }).parse(await this.json('higgsfield', 'https://api.higgsfield.ai/higgsfield-ai/soul/v2/standard', signal, { prompt }));
    return { provider: 'higgsfield', id: result.request_id, statusUrl: higgsfieldStatusUrl(result.status_url) };
  }
  async video(job: VideoJob, images: string[], guide: string, signal: AbortSignal): Promise<NonNullable<VideoJob['remote']>> {
    const payload = minimaxInput(job, images, guide);
    if (Buffer.byteLength(JSON.stringify(payload)) > 60 * 1024 * 1024) throw new Error('Reference media exceeds the MiniMax request limit.');
    const result = z.object({ task_id: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/) }).parse(await this.json('minimax', 'https://api.minimax.io/v2/video_generation', signal, payload));
    return { provider: 'minimax', id: result.task_id };
  }
  async poll(remote: NonNullable<VideoJob['remote']>, signal: AbortSignal): Promise<{ state: 'pending' | 'done' | 'failed'; url?: string }> {
    if (remote.provider === 'higgsfield') {
      const value = z.object({ request_id: z.string(), status: z.enum(['queued', 'in_progress', 'completed', 'failed', 'nsfw', 'canceled']), images: z.array(z.object({ url: z.string().url() })).optional() }).parse(await this.json('higgsfield', higgsfieldStatusUrl(remote.statusUrl ?? ''), signal));
      if (value.request_id !== remote.id) throw new Error('Higgsfield returned a different request.');
      if (value.status === 'completed') { const url = value.images?.[0]?.url; if (!url) throw new Error('Higgsfield returned no image.'); return { state: 'done', url }; }
      return { state: ['failed', 'nsfw', 'canceled'].includes(value.status) ? 'failed' : 'pending' };
    }
    if (remote.provider !== 'minimax') throw new Error('Use the local renderer to check this job.');
    const value = z.object({ task: z.object({ id: z.string(), status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']), content: z.object({ url: z.string().url().optional() }).optional() }) }).parse(await this.json('minimax', 'https://api.minimax.io/v2/query/video_generation/' + encodeURIComponent(remote.id), signal));
    if (value.task.id !== remote.id) throw new Error('MiniMax returned a different task.');
    if (value.task.status === 'succeeded') { const url = value.task.content?.url; if (!url) throw new Error('MiniMax returned no video.'); return { state: 'done', url }; }
    return { state: ['failed', 'cancelled'].includes(value.task.status) ? 'failed' : 'pending' };
  }
}
