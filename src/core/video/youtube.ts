import { z } from 'zod';
import { boundedJson } from '../connections/network.js';
import type { YoutubeDelivery } from '../../shared/video-publishing.js';

const ROOT = 'https://www.googleapis.com';
export const YOUTUBE_CHUNK = 4 * 1024 * 1024;
export class YoutubeError extends Error {
  constructor(message: string, readonly retryable = false, readonly retryAfterMs = 0) { super(message); }
}
export function youtubeSession(value: string) {
  let url: URL; try { url = new URL(value); } catch { throw new YoutubeError('YouTube returned an invalid upload session.'); }
  if (url.origin !== ROOT || url.username || url.password || url.hash || url.pathname !== '/upload/youtube/v3/videos' || url.searchParams.getAll('upload_id').length !== 1 || !url.searchParams.get('upload_id')) throw new YoutubeError('YouTube returned an invalid upload session.');
  return url.toString();
}
const videoId = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
const channelSchema = z.object({ items: z.array(z.object({ id: z.string().regex(/^UC[A-Za-z0-9_-]{22}$/), snippet: z.object({ title: z.string().max(300) }) })).length(1) });
const videoSchema = z.object({ id: videoId, snippet: z.object({ channelId: z.string(), title: z.string(), description: z.string() }), status: z.object({ privacyStatus: z.enum(['private', 'unlisted', 'public']), uploadStatus: z.string(), selfDeclaredMadeForKids: z.boolean().optional(), containsSyntheticMedia: z.boolean().optional() }), processingDetails: z.object({ processingStatus: z.string() }).optional() });
export type YoutubeRemote = z.infer<typeof videoSchema>;
export type YoutubeProgress = { bytes: number; retryAfterMs: number; videoId?: string };

/** All URLs are fixed or validated here; raw credentials, sessions and provider error text stay in the main process. */
export class YoutubeClient {
  constructor(private readonly request: (url: string, init: RequestInit, write: boolean) => Promise<Response>) {}
  private async send(url: string, init: RequestInit, write = false) {
    let response: Response;
    try { response = await this.request(url, { ...init, redirect: 'manual' }, write); }
    catch { throw new YoutubeError('YouTube request interrupted. The existing upload will be checked before sending more bytes.', true); }
    if (!response.ok && response.status !== 308) {
      const status = response.status; const delay = this.delay(response); await response.body?.cancel();
      throw new YoutubeError(status === 404 ? 'YouTube upload or video is unavailable. Check the channel before starting another upload.' : `YouTube returned HTTP ${status}. Check connection access and quota.`, [429, 500, 502, 503, 504].includes(status), delay);
    }
    return response;
  }
  private delay(response: Response) {
    const raw = response.headers.get('retry-after'); if (!raw) return 0;
    const delay = /^\d+$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - Date.now();
    return Number.isFinite(delay) ? Math.max(0, delay) : 0;
  }
  async channel() {
    const response = await this.send(ROOT + '/youtube/v3/channels?part=snippet&mine=true&maxResults=2', { method: 'GET' });
    try { return channelSchema.parse(await boundedJson(response)).items[0]!; }
    catch { throw new YoutubeError('Choose a Google login that identifies exactly one YouTube channel.'); }
  }
  async start(job: YoutubeDelivery) {
    const response = await this.send(ROOT + '/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(job.asset.bytes), 'X-Upload-Content-Type': 'video/mp4' },
      body: JSON.stringify({ snippet: { ...job.metadata, categoryId: '22' }, status: { privacyStatus: job.privacy, selfDeclaredMadeForKids: job.madeForKids, containsSyntheticMedia: job.containsSyntheticMedia } }),
    }, true);
    const location = response.headers.get('location'); await response.body?.cancel();
    return youtubeSession(location ?? '');
  }
  async progress(session: string, size: number): Promise<YoutubeProgress> {
    return this.parse(await this.send(youtubeSession(session), { method: 'PUT', headers: { 'Content-Length': '0', 'Content-Range': `bytes */${size}` } }), size);
  }
  async chunk(session: string, size: number, offset: number, bytes: Uint8Array): Promise<YoutubeProgress> {
    if (!Number.isSafeInteger(offset) || offset < 0 || bytes.length < 1 || offset + bytes.length > size || (offset + bytes.length < size && bytes.length % (256 * 1024) !== 0)) throw new YoutubeError('Invalid upload chunk.');
    return this.parse(await this.send(youtubeSession(session), { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(bytes.length), 'Content-Range': `bytes ${offset}-${offset + bytes.length - 1}/${size}` }, body: new Uint8Array(bytes) }, true), size);
  }
  private async parse(response: Response, size: number): Promise<YoutubeProgress> {
    if (response.status === 308) {
      const range = response.headers.get('range'), match = range?.match(/^bytes=0-(\d+)$/); await response.body?.cancel();
      const bytes = range === null ? 0 : match ? Number(match[1]) + 1 : NaN;
      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes >= size) throw new YoutubeError('YouTube returned inconsistent upload progress.');
      return { bytes, retryAfterMs: this.delay(response) };
    }
    try { return { bytes: size, videoId: videoId.parse((await boundedJson(response)).id), retryAfterMs: 0 }; }
    catch { throw new YoutubeError('Upload acknowledgement was incomplete. Check the existing session again.', true); }
  }
  async video(id: string): Promise<YoutubeRemote> {
    videoId.parse(id);
    const response = await this.send(ROOT + '/youtube/v3/videos?part=snippet,status,processingDetails&id=' + id, { method: 'GET' });
    try { return videoSchema.parse(z.array(z.unknown()).length(1).parse((await boundedJson(response)).items)[0]); }
    catch { throw new YoutubeError('YouTube has not returned the uploaded video details yet.', true); }
  }
}
