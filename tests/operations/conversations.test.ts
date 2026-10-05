import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, type App } from '../../src/core/app.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { fixedClock } from '../../src/core/lib/clock.js';
import { initializeMarketing } from '../../src/core/marketing/store.js';
import { products } from '../../src/core/db/schema.js';
import { OperationsService } from '../../src/core/operations/service.js';
import { ConversationTracker } from '../../src/core/operations/conversations.js';
import type { Delivery } from '../../src/shared/operations.js';

let app: App, tracker: ConversationTracker, jobs: Delivery[], transport: ReturnType<typeof vi.fn<typeof fetch>>;
let clock: ReturnType<typeof fixedClock>, productId: string, other: string;
const uri = 'at://did:plc:ours/app.bsky.feed.post/sent';
const incomingUri = 'at://did:plc:buyer/app.bsky.feed.post/answer';
function node(postUri = uri, author = 'did:plc:ours', parent?: string) {
  return { post: { uri: postUri, author: { did: author, handle: author.split(':').at(-1) + '.bsky.social' },
    record: { text: 'Can I use this with my reports?', createdAt: new Date(clock.now() - 1000).toISOString(), ...(parent ? { reply: { parent: { uri: parent } } } : {}) } }, replies: [] as unknown[] };
}
function thread() {
  const root = node(), reply = node(incomingUri, 'did:plc:buyer', uri);
  reply.replies.push(node('at://did:plc:third/app.bsky.feed.post/next', 'did:plc:third', incomingUri));
  root.replies.push(reply, node('at://did:plc:ours/app.bsky.feed.post/own', 'did:plc:ours', uri));
  return { thread: root };
}
beforeEach(() => {
  vi.stubEnv('SIGNAL_OFFLINE', '0');
  clock = fixedClock(1790467000000); app = createApp({ databaseUrl: ':memory:', clock, logger: silentLogger }); initializeMarketing(app);
  app.env.SIGNAL_OFFLINE = '0';
  const businesses = app.db.select().from(products).all(); productId = businesses[0]!.id; other = businesses[1]!.id;
  app.operations = new OperationsService(app); const state = app.operations.state(productId); vi.spyOn(app.operations, 'state').mockReturnValue({ ...state, running: true });
  jobs = [{ id: 'sent', productId, accountId: 'blue', taskId: 'task', provider: 'bluesky', revision: 1, fingerprint: 'hash', recordKey: 'sent', slug: 'sent', author: 'team', status: 'published', title: 'A document question', description: 'A useful response about documents.', body: 'Check one report. (Lemonade team)', evidence: ['https://siplemona.de/'], createdAt: clock.now(), updatedAt: clock.now(), nextAttemptAt: 0, attempts: 1, leaseUntil: 0, leaseId: '', detail: 'Published', reply: { uri: 'at://did:plc:buyer/app.bsky.feed.post/question', cid: 'cid', authorDid: 'did:plc:buyer', text: 'I need to compare my reports.' }, receipt: { id: uri, url: 'https://bsky.app/profile/did:plc:ours/post/sent', confirmedAt: clock.now() } }];
  transport = vi.fn(async (url, init) => {
    expect(new URL(String(url)).origin).toBe('https://public.api.bsky.app');
    expect(init?.method).toBe('GET'); expect(init?.headers).toBeUndefined(); expect(init?.redirect).toBe('error');
    return Response.json(thread());
  });
  tracker = new ConversationTracker(app, () => jobs, transport);
});
afterEach(async () => { await tracker.stop(); app.close(); vi.unstubAllEnvs(); });
it('tracks only confirmed reply threads, captures relevant responses and deduplicates review state', async () => {
  expect(tracker.view()[0]!.status).toBe('not-checked');
  await tracker.tick();
  const snapshot = tracker.view()[0]!;
  expect(snapshot.status).toBe('current'); expect(snapshot.replies).toHaveLength(2);
  expect(snapshot.replies[0]).toMatchObject({ uri: incomingUri, originalAuthor: true });
  tracker.reviewed(productId, 'sent', [incomingUri, incomingUri]);
  expect(tracker.view()[0]!.reviewedUris).toEqual([incomingUri]);
  expect(() => tracker.reviewed(productId, 'sent', ['unknown'])).toThrow('observed');
  expect(() => tracker.refresh(other, 'sent')).toThrow('business');
  expect(() => tracker.reviewed(other, 'sent', [incomingUri])).toThrow('business');
});
it('respects the background interval, pause and offline mode', async () => {
  await tracker.tick(); await tracker.tick(); expect(transport).toHaveBeenCalledTimes(1);
  clock.advance(15 * 60000); await tracker.tick(); expect(transport).toHaveBeenCalledTimes(2);
  vi.mocked(app.operations!.state).mockReturnValue({ ...app.operations!.state(productId), running: false });
  clock.advance(15 * 60000); await tracker.tick(); expect(transport).toHaveBeenCalledTimes(2);
  app.env.SIGNAL_OFFLINE = '1';
  try { await tracker.tick(); await expect(tracker.refresh(productId, 'sent')).rejects.toThrow('offline'); }
  finally { app.env.SIGNAL_OFFLINE = '0'; }
});
it.each(['deleted', 'blocked', 'network', 'identity'])('keeps saved responses and honest status when the thread is %s', async variant => {
  await tracker.refresh(productId, 'sent'); clock.advance(60001);
  transport.mockImplementation(async () => {
    if (variant === 'deleted') return Response.json({ error: 'NotFound' }, { status: 400 });
    if (variant === 'blocked') return Response.json({ thread: { $type: 'app.bsky.feed.defs#blockedPost' } });
    if (variant === 'identity') return Response.json({ thread: node('at://did:plc:other/app.bsky.feed.post/sent') });
    throw new Error('Network failed');
  });
  await tracker.refresh(productId, 'sent');
  expect(tracker.view()[0]!.replies).toHaveLength(2);
  expect(tracker.view()[0]!.status).toBe(['deleted', 'blocked'].includes(variant) ? 'unavailable' : 'error');
  expect(jobs[0]!.status).toBe('published'); // Historical receipt, never resend.
});
it('rejects unrelated children, foreign links and repeated response URIs', async () => {
  const value = thread(), reply = value.thread.replies[0]!;
  value.thread.replies.push(reply, node('https://attacker.invalid', 'did:plc:attacker', uri), node('at://did:plc:other/app.bsky.feed.post/outside', 'did:plc:other', 'unrelated'));
  transport.mockResolvedValue(Response.json(value)); await tracker.tick();
  expect(tracker.view()[0]!.replies).toHaveLength(2);
});
it('does not poll unconfirmed, old or non-reply publications automatically', async () => {
  jobs[0]!.status = 'attention'; await tracker.tick(); expect(tracker.view()).toEqual([]);
  jobs[0]!.status = 'published'; clock.advance(31 * 86400000); await tracker.tick(); expect(transport).not.toHaveBeenCalled();
});
it.each(['http', 'thread'])('archives a missing post (%s), preserves the receipt and stops polling', async variant => {
  transport.mockImplementation(async () => variant === 'http' ? Response.json({ error: 'RecordNotFound' }, { status: 404 }) : Response.json({ thread: { $type: 'app.bsky.feed.defs#notFoundPost' } }));
  await tracker.tick();
  expect(tracker.view()[0]).toMatchObject({ archivedAt: clock.now(), archiveReason: 'not-found', status: 'unavailable' });
  const restarted = new ConversationTracker(app, () => jobs, transport);
  clock.advance(16 * 60000); await restarted.tick(); await restarted.refresh(productId, 'sent');
  expect(transport).toHaveBeenCalledTimes(1);
  expect(jobs[0]!.receipt?.id).toBe(uri);
});
it('does not treat blocked access or network failures as a deleted post', async () => {
  transport.mockResolvedValueOnce(Response.json({ thread: { $type: 'app.bsky.feed.defs#blockedPost' } }));
  await tracker.tick(); expect(tracker.view()[0]!.archivedAt).toBeUndefined();
  clock.advance(16 * 60000); await tracker.tick(); expect(transport).toHaveBeenCalledTimes(2);
});
it('lets the owner stop and resume tracking without changing publication history', async () => {
  expect(() => tracker.track(other, 'sent', false)).toThrow('business');
  tracker.track(productId, 'sent', false); await tracker.tick();
  expect(transport).not.toHaveBeenCalled();
  expect(tracker.view()[0]!.archiveReason).toBe('owner');
  tracker.track(productId, 'sent', true); await tracker.tick();
  expect(transport).toHaveBeenCalledTimes(1); expect(tracker.view()[0]!.archivedAt).toBeNull();
  expect(jobs[0]!.status).toBe('published');
});
it('an in-flight fetch cannot reactivate a conversation archived by its owner', async () => {
  let finish!: (response: Response) => void;
  transport.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const refreshing = tracker.refresh(productId, 'sent');
  tracker.track(productId, 'sent', false); finish(Response.json(thread())); await refreshing;
  expect(tracker.view()[0]).toMatchObject({ archiveReason: 'owner', archivedAt: clock.now() });
});
it('deduplicates concurrent reads and aborts when paused', async () => {
  transport.mockImplementation((_url, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('Stopped')), { once: true })));
  const first = tracker.refresh(productId, 'sent'), second = tracker.refresh(productId, 'sent');
  expect(first).toBe(second); tracker.pause(productId); await first;
  expect(transport).toHaveBeenCalledTimes(1); expect(tracker.view()[0]!.checkedAt).toBeNull();
});
