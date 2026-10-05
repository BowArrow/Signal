import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createApp, type App } from '../../src/core/app.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { fixedClock } from '../../src/core/lib/clock.js';
import { __setConfigForTests } from '../../src/core/config/load.js';
import { settings } from '../../src/core/db/schema.js';
import { ConnectionService, type CredentialVault } from '../../src/core/connections/service.js';
import { VideoService, type VideoHost } from '../../src/core/video/service.js';
import { VideoPublishingService } from '../../src/core/video/publishing.js';
import { OperationsService } from '../../src/core/operations/service.js';
import { youtubeSession } from '../../src/core/video/youtube.js';
import { youtubeMetadataSchema, type YoutubeDelivery, type YoutubePolicyInput } from '../../src/shared/video-publishing.js';
import type { ConnectedAccount } from '../../src/shared/connections.js';
import type { VideoAsset, VideoJob } from '../../src/shared/video.js';

let app: App, clock: ReturnType<typeof fixedClock>, publisher: VideoPublishingService, vault: CredentialVault;
let product: string, other: string, account: ConnectedAccount, bytes: Buffer, asset: VideoAsset;
let secrets: Map<string, string>, calls: { url: string; method: string; range: string | null; bytes: number }[];
let metadata: YoutubeDelivery['metadata'], privacy: 'private' | 'public', offset: number, accepted: boolean, loseFinal: boolean, expire: boolean, wrongChannel: boolean, pauseBeforeChunk: boolean, failedProcessing: boolean, startLost: boolean, chunkCount: number;
const CHANNEL = 'UC' + 'a'.repeat(22), ID = 'abcDEF12_-3', SESSION = 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=secret-session';
const policy: YoutubePolicyInput = { enabled: true, accountId: 'youtube', privacy: 'public', dailyLimit: 1, autoQueue: false, madeForKids: false, containsSyntheticMedia: true };
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
function put(key: string, value: unknown) { app.db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run(); }
function restart() { publisher = new VideoPublishingService(app, vault, () => bytes); app.videoPublishing = publisher; }
function ad(id = 'ad', productId = product, output = asset) {
  const job: VideoJob = { id, productId, kind: 'ad', title: 'Find your answer', brief: 'Approved final ad', characters: [], duration: 7, ratio: '9:16', phase: 'ready', detail: 'Approved', createdAt: clock.now(), updatedAt: clock.now(), approvedAt: clock.now(), output, assembly: { title: 'Find your answer', ratio: '9:16', clips: [], headline: 'Less searching', callToAction: 'Try it today', destination: productId === product ? 'https://siplemona.de/get-started' : 'https://cinegenaimedia.com/get-started' } };
  put('video.job.' + id, job); return job;
}
async function ready() { await publisher.configure(product, policy); const source = ad(); const job = publisher.enqueue(product, source.id); app.operations!.run(product); return job; }
async function finish() { for (let i = 0; i < 8; i++) { await publisher.tick(); clock.advance(60001); } }
beforeEach(() => {
  vi.stubEnv('SIGNAL_OFFLINE', '0'); __setConfigForTests(null); clock = fixedClock(1789700000000); app = createApp({ databaseUrl: ':memory:', logger: silentLogger, clock });
  secrets = new Map(); calls = []; offset = 0; accepted = false; loseFinal = false; expire = false; wrongChannel = false; pauseBeforeChunk = false; failedProcessing = false; startLost = false; chunkCount = 0; privacy = 'public';
  vault = { available: () => true, get: key => secrets.get(key), set: (key, value) => { secrets.set(key, value); }, delete: key => { secrets.delete(key); } };
  const transport: typeof fetch = async (input, init) => {
    const url = String(input), method = init?.method ?? 'GET', headers = new Headers(init?.headers), range = headers.get('content-range');
    const size = init?.body instanceof Uint8Array ? init.body.byteLength : 0;
    calls.push({ url, method, range, bytes: size });
    expect(headers.get('authorization')).toBe('Bearer private-token'); expect(init?.redirect).toBe('manual');
    if (url.includes('/channels?')) return json({ items: [{ id: wrongChannel ? 'UC' + 'b'.repeat(22) : CHANNEL, snippet: { title: 'AIonX' } }] });
    if (url.includes('/youtube/v3/videos?part=')) return json({ items: [{ id: ID, snippet: { ...metadata, channelId: CHANNEL }, status: { privacyStatus: privacy, uploadStatus: failedProcessing ? 'rejected' : 'processed', selfDeclaredMadeForKids: false, containsSyntheticMedia: true }, processingDetails: { processingStatus: failedProcessing ? 'failed' : 'succeeded' } }] });
    if (method === 'POST') { metadata = (JSON.parse(String(init?.body)) as { snippet: YoutubeDelivery['metadata'] }).snippet; if (startLost) throw new Error('private-token'); return new Response(null, { status: 200, headers: { location: SESSION } }); }
    if (url === SESSION) {
      if (expire) return new Response(null, { status: 404 });
      if (!size) { if (pauseBeforeChunk) app.operations!.pause(product); return accepted ? json({ id: ID }) : new Response(null, { status: 308, headers: offset ? { range: `bytes=0-${offset - 1}` } : {} }); }
      chunkCount++; const expected = `bytes ${offset}-${offset + size - 1}/${bytes.length}`; expect(range).toBe(expected); offset += size;
      if (offset === bytes.length) { accepted = true; if (loseFinal) { loseFinal = false; throw new Error('private-token secret-session'); } return json({ id: ID }); }
      return new Response(null, { status: 308, headers: { range: `bytes=0-${offset - 1}` } });
    }
    throw new Error('Unexpected request');
  };
  app.connections = new ConnectionService(app, vault, undefined, transport);
  const products = app.connections.view().products; product = products[0]!.id; other = products[1]!.id;
  account = { id: 'youtube', provider: 'youtube', productId: product, label: 'AIonX YouTube', site: '', username: '', identity: 'AIonX', status: 'verified', detail: '', checkedAt: clock.now(), expiresAt: null, refreshable: false, grantedScopes: ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'], createdAt: clock.now() };
  put('connections.account.youtube', account); secrets.set('account.youtube', JSON.stringify({ accessToken: 'private-token' }));
  bytes = Buffer.alloc(5 * 1024 * 1024, 7); asset = { file: 'fixture.mp4', sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, mime: 'video/mp4' };
  const host: VideoHost = { toolReady: () => true, blockout: async () => asset, download: async () => asset, data: () => '', saveVideo: () => asset, saveImage: () => asset, frames: async () => [] };
  app.video = new VideoService(app, vault, host); app.operations = new OperationsService(app); restart();
});
afterEach(async () => { await publisher.stop(); app.close(); __setConfigForTests(null); vi.unstubAllEnvs(); });

it('uploads bounded chunks, verifies the receipt and keeps credentials/session out of persistent jobs', async () => {
  const job = await ready(); expect(app.operations!.readiness(product)).toMatchObject({ ready: true, needsAgents: false });
  await finish(); const result = publisher.jobs()[0]!;
  expect(result).toMatchObject({ status: 'delivered', bytesSent: bytes.length, videoId: ID, receipt: { privacy: 'public', id: ID } });
  expect(calls.filter(c => c.method === 'POST')).toHaveLength(1); expect(chunkCount).toBe(2);
  expect(result.metadata.description).toContain('utm_campaign=' + job.id);
  expect(JSON.stringify(publisher.view())).not.toMatch(/private-token|secret-session|upload_id/);
});
it('recovers a lost final response after restart without submitting a second video', async () => {
  await ready(); loseFinal = true; await publisher.tick(); await publisher.tick(); await publisher.tick();
  expect(accepted).toBe(true); restart(); clock.advance(120000); await finish();
  expect(publisher.jobs()[0]?.status).toBe('delivered'); expect(calls.filter(c => c.method === 'POST')).toHaveLength(1); expect(chunkCount).toBe(2);
});
it('stops payload transfer on Pause even when a status query was already in flight', async () => {
  await ready(); await publisher.tick(); pauseBeforeChunk = true; await publisher.tick();
  expect(chunkCount).toBe(0); expect(publisher.jobs()[0]?.status).toBe('uploading');
  pauseBeforeChunk = false; clock.advance(120000); await publisher.tick(); expect(chunkCount).toBe(0);
  app.operations!.run(product); await finish(); expect(publisher.jobs()[0]?.status).toBe('delivered');
});
it('retains the receipt but does not call private-only uploads public', async () => {
  await ready(); privacy = 'private'; await finish();
  expect(publisher.jobs()[0]).toMatchObject({ status: 'attention', receipt: { privacy: 'private' } });
  expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
});
it('holds expired sessions and ambiguous session creation instead of starting over', async () => {
  await ready(); startLost = true; await publisher.tick(); clock.advance(120000); await publisher.tick();
  expect(publisher.jobs()[0]?.status).toBe('attention'); expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
  expect(() => publisher.retry(product, publisher.jobs()[0]!.id)).toThrow('session');
});
it('does not restart an expired upload session', async () => {
  await ready(); await publisher.tick(); expire = true; await finish(); expect(publisher.jobs()[0]?.status).toBe('attention'); expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
});
it('rejects revoked approval, modified bytes and a changed channel before any upload', async () => {
  await ready(); const source = app.video!.job(product, 'ad'); put('video.job.ad', { ...source, approvedAt: source.approvedAt! + 1 }); await publisher.tick(); expect(calls.some(c => c.method === 'POST')).toBe(false);
  put('video.job.ad', source); publisher.retry(product, publisher.jobs()[0]!.id); bytes[0] = 8; await publisher.tick(); expect(calls.some(c => c.method === 'POST')).toBe(false);
  bytes[0] = 7; publisher.retry(product, publisher.jobs()[0]!.id); wrongChannel = true; await publisher.tick(); expect(calls.some(c => c.method === 'POST')).toBe(false);
});
it('enforces product scope and deduplicates identical ads across a shared channel', async () => {
  const job = await ready();
  expect(() => publisher.cancel(other, job.id, false)).toThrow('business');
  put('connections.account.shared', { ...account, id: 'shared', productId: other, credentialId: account.id });
  await publisher.configure(other, { ...policy, accountId: 'shared' }); ad('other-ad', other);
  expect(() => publisher.enqueue(other, 'other-ad')).toThrow('already');
});
it('counts attempted uploads against a shared channel daily cap', async () => {
  await ready(); await publisher.tick();
  put('connections.account.shared', { ...account, id: 'shared', productId: other, credentialId: account.id });
  await publisher.configure(other, { ...policy, accountId: 'shared', dailyLimit: 3 });
  const otherBytes = Buffer.alloc(5 * 1024 * 1024, 9), otherAsset = { ...asset, sha256: createHash('sha256').update(otherBytes).digest('hex') };
  bytes = otherBytes; ad('other-ad', other, otherAsset); publisher.enqueue(other, 'other-ad'); app.operations!.run(other);
  app.operations!.pause(product); await publisher.tick();
  expect(calls.filter(c => c.method === 'POST')).toHaveLength(1); expect(publisher.jobs().find(j => j.productId === other)?.detail).toContain('allowance');
});
it('only auto-queues ads approved after enablement and does no work while paused', async () => {
  ad('old'); clock.advance(1000); await publisher.configure(product, { ...policy, autoQueue: true }); clock.advance(1000); ad('new');
  await publisher.tick(); expect(publisher.jobs()).toHaveLength(0); app.operations!.run(product); await publisher.tick(); expect(publisher.jobs().map(j => j.sourceId)).toEqual(['new']);
});
it('requires uncertainty acknowledgement to stop an attempted upload and retains deduplication', async () => {
  const job = await ready(); await publisher.tick(); expect(() => publisher.cancel(product, job.id, false)).toThrow('Acknowledge');
  publisher.cancel(product, job.id, true); expect(() => publisher.enqueue(product, job.sourceId)).toThrow('already');
  await finish(); expect(chunkCount).toBe(0);
});
it('holds processing failures and can confirm accepted videos while the operation is paused', async () => {
  await ready(); await publisher.tick(); await publisher.tick(); await publisher.tick(); app.operations!.pause(product); failedProcessing = true; await publisher.tick(); expect(publisher.jobs()[0]?.status).toBe('attention');
  failedProcessing = false; publisher.retry(product, publisher.jobs()[0]!.id); await publisher.tick(); expect(publisher.jobs()[0]?.status).toBe('delivered');
});
it('rejects unsafe session redirects and measures descriptions in UTF-8 bytes', () => {
  for (const url of ['https://evil.example/upload?upload_id=x', 'http://www.googleapis.com/upload/youtube/v3/videos?upload_id=x', 'https://www.googleapis.com.evil.example/upload/youtube/v3/videos?upload_id=x', 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=x&upload_id=y']) expect(() => youtubeSession(url)).toThrow();
  expect(() => youtubeMetadataSchema.parse({ title: 'Title', description: '😀'.repeat(1300) })).toThrow();
});
it('reserves a channel slot while a competing worker has not yet opened its session', async () => {
  const job = await ready();
  put('video.youtube.job.competing', { ...job, id: 'competing', leaseId: 'other-worker', leaseUntil: clock.now() + 120000 });
  await publisher.tick(); expect(calls.some(c => c.method === 'POST')).toBe(false);
  expect(publisher.jobs().find(j => j.id === job.id)?.detail).toContain('allowance');
});
it('refuses missing upload permission, never contacts providers offline, and holds a session-save failure', async () => {
  put('connections.account.youtube', { ...account, grantedScopes: ['https://www.googleapis.com/auth/youtube.readonly'] });
  await expect(publisher.configure(product, policy)).rejects.toThrow(); expect(calls).toHaveLength(0);
  put('connections.account.youtube', account); await ready(); calls = []; app.env.SIGNAL_OFFLINE = '1'; await publisher.tick(); expect(calls).toHaveLength(0);
  app.env.SIGNAL_OFFLINE = '0'; const original = vault.set;
  vault.set = (key, value) => { if (key.startsWith('youtube.upload.')) throw new Error('private-token'); original(key, value); };
  await publisher.tick(); expect(publisher.jobs()[0]?.status).toBe('attention'); expect(chunkCount).toBe(0);
  expect(JSON.stringify(publisher.view())).not.toContain('private-token'); expect(() => publisher.retry(product, publisher.jobs()[0]!.id)).toThrow('session');
});
