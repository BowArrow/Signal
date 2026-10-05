import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp, type App } from '../../src/core/app.js';
import { __setConfigForTests } from '../../src/core/config/load.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { fixedClock } from '../../src/core/lib/clock.js';
import { products, settings, studioLeads, growthTasks } from '../../src/core/db/schema.js';
import { initializeMarketing } from '../../src/core/marketing/store.js';
import { ConnectionService } from '../../src/core/connections/service.js';
import { OperationsService } from '../../src/core/operations/service.js';
import { assessAcquisition, acquisitionCycle, saveAcquisitionCycle } from '../../src/core/operations/acquisition.js';
import type { OperationState } from '../../src/shared/operations.js';
import type { ConnectedAccount } from '../../src/shared/connections.js';
import type { LlmClient } from '../../src/core/llm/client.js';
import { acquisitionChannel } from '../../src/core/operations/acquisition-channels.js';

let app: App, state: OperationState;
let clock: ReturnType<typeof fixedClock>;
const requestQuote = 'I need to compare two reports and produce an editable summary.';
const productQuote = 'Compare information across your documents and draft an editable Word document.';
const page = () => ({ url: 'https://siplemona.de/', title: 'Lemonade', body: productQuote, observedAt: clock.now(), trust: 'Untrusted evidence' });
let answer: { findingId: string; suitable: boolean; reason: string; productExcerptId: string }[];
let complete: ReturnType<typeof vi.fn<LlmClient['complete']>>;
let readPage: ReturnType<typeof vi.fn>;
const controller = () => new AbortController();
const run = (check = () => {}, signal = controller().signal) => assessAcquisition(app, state, { available: () => ({ ready: true }), complete }, 'fixture', signal, check, readPage);
function account(id: string, provider: 'x' | 'signal-blog' | 'bluesky', productId = state.productId) {
  const value: ConnectedAccount = { id, productId, provider, site: provider === 'signal-blog' ? 'https://siplemona.de' : '', label: id, username: '', identity: id, status: 'verified', detail: '', grantedScopes: provider === 'x' ? ['tweet.write'] : [], expiresAt: null, refreshable: false, createdAt: clock.now(), checkedAt: clock.now() };
  app.db.insert(settings).values({ key: 'connections.account.' + id, value }).run();
}
beforeEach(() => {
  vi.stubEnv('SIGNAL_OFFLINE', '0'); __setConfigForTests(null); clock = fixedClock(1790374000000);
  app = createApp({ databaseUrl: ':memory:', clock, logger: silentLogger }); initializeMarketing(app);
  const product = app.db.select().from(products).where(eq(products.key, 'lemonade')).get()!;
  app.connections = new ConnectionService(app, { available: () => false, get: () => undefined, set: () => { throw Error('No credentials in test'); }, delete: () => {} });
  app.operations = new OperationsService(app);
  state = { productId: product.id, mode: 'acquisition', ownedAudience: false, objective: 'Find actual small business document needs.', accountIds: ['social', 'website'], intervalHours: 1, dailyLimit: 1, running: true, revision: 1, authorizedAt: clock.now(), lastCycleAt: null, taskId: 'task', discovery: { enabled: true, queries: [{ kind: 'hn', query: 'document summary' }] }, demandEvidence: [{ id: 'request', title: 'Help with reports', excerpt: requestQuote, url: 'https://news.ycombinator.com/item?id=1', query: 'hn:document summary', requestLanguage: true, kind: 'hn', observedAt: clock.now(), postedAt: clock.now() - 1000 }] };
  account('social', 'x'); account('website', 'signal-blog');
  answer = [{ findingId: 'request', suitable: true, reason: 'The requested report comparison and editable draft are supported by the product source.', productExcerptId: 'product-1' }];
  complete = vi.fn(async () => ({ text: JSON.stringify({ assessments: answer }), model: 'fixture', inputTokens: 1, outputTokens: 1, stopReason: 'stop' }));
  readPage = vi.fn(async () => page());
});
afterEach(async () => { await app.operations?.stop(); app.close(); vi.unstubAllEnvs(); __setConfigForTests(null); });

it('does not promote a contextless summarize post into a document buyer', async () => {
  state.demandEvidence![0] = { ...state.demandEvidence![0]!, kind: 'bluesky', excerpt: "What's happening? Can someone summarize?" };
  expect((await run()).cycle.status).toBe('researching');
  expect(complete).not.toHaveBeenCalled();
  expect(readPage).not.toHaveBeenCalled();
  expect(app.db.select().from(studioLeads).all()).toHaveLength(0);
});

it('does no model work and queues no generic post when there are no requests', async () => {
  state.demandEvidence = []; expect((await run()).cycle.status).toBe('researching'); expect(complete).not.toHaveBeenCalled(); expect(readPage).not.toHaveBeenCalled(); expect(app.operations!.deliveries()).toEqual([]);
});
it('selects the website over empty social feeds and does not create a lead or delivery', async () => {
  const { cycle } = await run(); expect(cycle).toMatchObject({ status: 'ready', selectedFindingId: 'request', accountId: 'website' }); expect(app.db.select().from(studioLeads).all()).toHaveLength(0); expect(app.operations!.deliveries()).toHaveLength(0);
});
it('qualifies search intent for a website guide without turning a query into social outreach', async () => {
  state.demandEvidence![0] = { ...state.demandEvidence![0]!, kind: 'search-console', title: 'Search intent: compare client reports', excerpt: 'Observed Google query: compare client reports. Aggregate search observation, no author.', url: 'https://siplemona.de/' };
  state.testChannels = true; state.ownedAudience = true;
  expect((await run()).cycle).toMatchObject({ status: 'ready', accountId: 'website' });
  expect(complete.mock.calls[0]![0].prompt).toContain('aggregate queries without an author');
});
it('uses a relevant direct reply without needing an owned audience only when enabled', async () => {
  account('blue', 'bluesky'); state.accountIds.push('blue');
  state.demandEvidence![0] = { ...state.demandEvidence![0]!, kind: 'bluesky', reply: { uri: 'at://did:plc:buyer/app.bsky.feed.post/abcdef', cid: 'b' + 'a'.repeat(40), authorDid: 'did:plc:buyer' } };
  expect((await run()).cycle.accountId).toBe('website');
  state.replyToRequests = true;
  expect((await run()).cycle).toMatchObject({ accountId: 'blue', status: 'ready' });
  expect(app.db.select().from(studioLeads).all()).toHaveLength(0);
});
it('waits for audience access rather than treating a social connection as reach', async () => {
  state.accountIds = ['social']; expect((await run()).cycle.status).toBe('awaiting-access');
  state.ownedAudience = true; expect((await run()).cycle.accountId).toBe('social');
});
it('does not select an account from another business', async () => {
  state.accountIds = ['other']; account('other', 'signal-blog', 'other-business'); expect((await run()).cycle.status).toBe('awaiting-access');
});

it('tests selected channels without claiming an audience and rotates to an untested route', async () => {
  state.testChannels = true; state.dailyLimit = 2;
  const first = await run();
  expect(first.cycle).toMatchObject({ accountId: 'social', learning: { mode: 'explore', cycle: 1 } });
  expect(state.ownedAudience).toBe(false);
  state.learning = first.cycle.learning!;
  app.db.insert(settings).values({ key: 'operations.delivery.first', value: { id: 'first', productId: state.productId, accountId: 'social', status: 'published', createdAt: clock.now(), body: '', receipt: { confirmedAt: clock.now() } } }).run();
  const second = await run();
  expect(second.cycle).toMatchObject({ accountId: 'website', learning: { mode: 'explore', cycle: 2 } });
});

it('keeps unsupported and expired destinations out of acquisition tests', async () => {
  state.testChannels = true;
  const row = app.db.select().from(settings).where(eq(settings.key, 'connections.account.social')).get()!;
  app.db.update(settings).set({ value: { ...(row.value as object), expiresAt: clock.now() - 1, refreshable: false } }).where(eq(settings.key, row.key)).run();
  expect((await run()).cycle.accountId).toBe('website');
});

it('does not turn a capped reply route into an unsolicited broadcast on the same account', () => {
  account('blue', 'bluesky'); state.testChannels = true; state.replyToRequests = true; state.accountIds = ['blue', 'website'];
  const finding = { ...state.demandEvidence![0]!, kind: 'bluesky' as const, reply: { uri: 'at://did:plc:buyer/app.bsky.feed.post/post', cid: 'cid', authorDid: 'did:plc:buyer' } };
  for (let i = 0; i < 3; i++) app.db.insert(settings).values({ key: 'operations.delivery.reply-' + i, value: { id: 'reply-' + i, productId: 'another-business', accountId: 'blue', reply: { authorDid: 'person-' + i }, status: 'published', createdAt: clock.now() } }).run();
  expect(acquisitionChannel(app, state, [finding])?.route.account.id).toBe('website');
  state.accountIds = ['blue']; expect(acquisitionChannel(app, state, [finding])).toBeUndefined();
});

it.each(['done', 'failed'] as const)('continues after a %s task without consuming or bypassing daily capacity', status => {
  const operations = app.operations!;
  operations.configure(state.productId, { mode: 'acquisition', objective: state.objective, accountIds: ['website'], intervalHours: 24, dailyLimit: 2, discovery: state.discovery });
  operations.run(state.productId); const configured = operations.state(state.productId);
  const discoveryKey = 'operations.discovery.' + state.productId;
  app.db.insert(settings).values({ key: discoveryKey, value: { productId: state.productId, revision: configured.revision, lastAttemptAt: clock.now(), nextAttemptAt: clock.now(), searches: [], findings: state.demandEvidence } }).run();
  operations.schedule(); const firstId = operations.state(state.productId).taskId!;
  clock.advance(300000);
  app.db.update(growthTasks).set({ status, updatedAt: clock.now() }).where(eq(growthTasks.id, firstId)).run();
  saveAcquisitionCycle(app, { productId: state.productId, revision: configured.revision, taskId: firstId, checkedAt: clock.now(), sourceUrl: page().url, status: 'ready', detail: 'First qualification complete.', assessments: [] });
  operations.schedule(); expect(app.db.select().from(growthTasks).all()).toHaveLength(1);
  clock.advance(61000); operations.schedule();
  expect(app.db.select().from(growthTasks).all()).toHaveLength(status === 'done' ? 2 : 1);
  operations.schedule(); expect(app.db.select().from(growthTasks).all()).toHaveLength(status === 'done' ? 2 : 1);
});
it('keeps rejected observations from forcing a replacement promotion or repeated model work', async () => {
  answer[0] = { ...answer[0]!, suitable: false, reason: 'The actual question requires multi-user server hosting that the source does not support.', productExcerptId: '' };
  expect((await run()).cycle.status).toBe('no-fit'); expect((await run()).cycle.status).toBe('researching'); expect((await run()).cycle.assessments).toHaveLength(1); expect(complete).toHaveBeenCalledTimes(1);
  clock.advance(8 * 86400000); state.demandEvidence![0]!.observedAt = clock.now(); await run(); expect(complete).toHaveBeenCalledTimes(2);
});
it.each(['product-999', ''] as const)('defers unavailable evidence %s instead of saving a ready decision', async id => {
  answer[0]!.productExcerptId = id;
  expect((await run()).cycle).toMatchObject({ status: 'researching', assessments: [] });
  expect(complete).toHaveBeenCalledTimes(2);
});
it.each(['missing', 'duplicate', 'foreign'] as const)('retries and defers %s finding coverage without creating a rejection or delivery', async variant => {
  if (variant === 'missing') answer = []; if (variant === 'duplicate') answer.push(answer[0]!); if (variant === 'foreign') answer[0]!.findingId = 'foreign';
  const { cycle } = await run();
  expect(cycle).toMatchObject({ status: 'researching', assessments: [] });
  expect(cycle.detail).toContain('remain pending');
  expect(complete).toHaveBeenCalledTimes(2);
  expect(app.operations!.deliveries()).toEqual([]);
  expect(app.db.select().from(studioLeads).all()).toEqual([]);
});
it('repairs only missing requests and preserves verified decisions', async () => {
  state.demandEvidence!.push({ ...state.demandEvidence![0]!, id: 'second' });
  complete.mockResolvedValueOnce({ text: JSON.stringify({ assessments: answer }), model: 'fixture', inputTokens: 1, outputTokens: 1, stopReason: 'stop' });
  answer = [{ ...answer[0]!, findingId: 'second' }];
  const { cycle } = await run();
  expect(cycle.status).toBe('ready');
  expect(cycle.assessments.map(a => a.findingId)).toEqual(['request', 'second']);
  const repair = complete.mock.calls[1]![0];
  expect(repair.prompt).toContain('REPAIR:');
  const contract = repair.jsonSchema as { properties: { assessments: { minItems: number; items: { properties: { findingId: { enum: string[] } } } } } };
  expect(contract.properties.assessments.minItems).toBe(1);
  expect(contract.properties.assessments.items.properties.findingId.enum).toEqual(['second']);
});
it('keeps valid qualification when another row remains malformed after repair', async () => {
  state.demandEvidence!.push({ ...state.demandEvidence![0]!, id: 'second' });
  const { cycle } = await run();
  expect(cycle).toMatchObject({ status: 'ready', selectedFindingId: 'request' });
  expect(cycle.assessments).toHaveLength(1);
  expect(cycle.detail).toContain('1 request could not be assessed');
  expect(complete).toHaveBeenCalledTimes(2);
});
it('does not choose between conflicting duplicate rows', async () => {
  answer.push({ ...answer[0]!, suitable: false, productExcerptId: '' });
  expect((await run()).cycle).toMatchObject({ status: 'researching', assessments: [] });
});
it('repairs malformed JSON without weakening qualification', async () => {
  complete.mockResolvedValueOnce({ text: '{broken', model: 'fixture', inputTokens: 1, outputTokens: 1, stopReason: 'length' });
  expect((await run()).cycle.status).toBe('ready');
  expect(complete).toHaveBeenCalledTimes(2);
});
it('deduplicates supplied findings before building the assessment contract', async () => {
  state.demandEvidence!.push({ ...state.demandEvidence![0]! });
  expect((await run()).cycle.assessments).toHaveLength(1);
  expect(complete).toHaveBeenCalledTimes(1);
});
it('does not retry provider failures as if they were malformed model output', async () => {
  complete.mockRejectedValue(new Error('provider unavailable'));
  await expect(run()).rejects.toThrow('provider unavailable');
  expect(complete).toHaveBeenCalledTimes(1);
  expect(acquisitionCycle(app, state.productId)?.status).toBe('attention');
});
it('does not persist repaired decisions after cancellation', async () => {
  const abort = controller();
  complete.mockResolvedValueOnce({ text: '{broken', model: 'fixture', inputTokens: 1, outputTokens: 1, stopReason: 'length' });
  complete.mockImplementationOnce(async () => { abort.abort(); return { text: JSON.stringify({ assessments: answer }), model: 'fixture', inputTokens: 1, outputTokens: 1, stopReason: 'stop' }; });
  await expect(run(() => {}, abort.signal)).rejects.toThrow();
  expect(acquisitionCycle(app, state.productId)?.status).toBe('researching');
  expect(acquisitionCycle(app, state.productId)?.assessments).toEqual([]);
});
it('does not save a result after an asynchronous pause', async () => {
  let paused = false; complete.mockImplementation(async () => { paused = true; return { text: JSON.stringify({ assessments: answer }), model: 'fixture', inputTokens: 1, outputTokens: 1, stopReason: 'stop' }; });
  await expect(run(() => { if (paused) throw Error('paused'); })).rejects.toThrow('paused'); expect(acquisitionCycle(app, state.productId)?.status).toBe('researching');
});
it('does not assess stale or future requests', async () => {
  state.demandEvidence![0]!.postedAt = clock.now() - 31 * 86400000; await run(); state.demandEvidence![0]!.postedAt = clock.now() + 86400000; await run(); expect(complete).not.toHaveBeenCalled();
});
it('does not qualify an old Bluesky request merely because it was observed recently', async () => {
  state.demandEvidence![0] = { ...state.demandEvidence![0]!, kind: 'bluesky', postedAt: clock.now() - 8 * 86400000 };
  expect((await run()).cycle.status).toBe('researching'); expect(complete).not.toHaveBeenCalled();
});
it('waits for actual candidates and then schedules acquisition without a publishing destination', () => {
  app.operations!.configure(state.productId, { mode: 'acquisition', ownedAudience: false, objective: state.objective, accountIds: [], intervalHours: 1, dailyLimit: 1, discovery: state.discovery });
  const configured = app.operations!.state(state.productId);
  app.db.insert(settings).values({ key: 'operations.discovery.' + state.productId, value: { productId: state.productId, revision: configured.revision, lastAttemptAt: clock.now(), nextAttemptAt: clock.now(), searches: [], findings: [] } }).run();
  app.operations!.run(state.productId); app.operations!.schedule(); expect(app.db.select().from(growthTasks).all()).toHaveLength(0); expect(app.operations!.state(state.productId).lastCycleAt).toBeNull();
  app.db.update(settings).set({ value: { productId: state.productId, revision: configured.revision, lastAttemptAt: clock.now(), nextAttemptAt: clock.now(), searches: [], findings: state.demandEvidence } }).where(eq(settings.key, 'operations.discovery.' + state.productId)).run();
  app.operations!.schedule(); expect(app.operations!.state(state.productId).taskId).toBeTruthy(); expect(app.db.select().from(growthTasks).all()).toHaveLength(1); app.operations!.schedule(); expect(app.db.select().from(growthTasks).all()).toHaveLength(1);
});
it.each(['researching', 'no-fit', 'attention', 'ready'] as const)('handles new candidates after %s without bypassing failures or sending limits', status => {
  const operations = app.operations!;
  operations.configure(state.productId, { mode: 'acquisition', objective: state.objective, accountIds: ['website'], intervalHours: 1, dailyLimit: 1, discovery: state.discovery });
  operations.run(state.productId);
  const current = { ...operations.state(state.productId), lastCycleAt: clock.now(), taskId: 'prior' };
  app.db.update(settings).set({ value: current }).where(eq(settings.key, 'operations.policy.' + state.productId)).run();
  app.db.insert(settings).values({ key: 'operations.discovery.' + state.productId, value: { productId: state.productId, revision: current.revision, lastAttemptAt: clock.now(), nextAttemptAt: clock.now(), searches: [], findings: state.demandEvidence } }).run();
  saveAcquisitionCycle(app, { productId: state.productId, revision: current.revision, taskId: 'prior', checkedAt: clock.now(), sourceUrl: page().url, status, detail: 'Previous cycle finished.', assessments: [] });
  operations.schedule(); expect(app.db.select().from(growthTasks).all()).toHaveLength(0);
  clock.advance(61000); operations.schedule();
  const count = ['researching', 'no-fit'].includes(status) ? 1 : 0;
  expect(app.db.select().from(growthTasks).all()).toHaveLength(count);
  operations.schedule(); expect(app.db.select().from(growthTasks).all()).toHaveLength(count);
});
it('keeps the publication allowance reserved when new candidates arrive after no-fit', () => {
  const operations = app.operations!;
  operations.configure(state.productId, { mode: 'acquisition', objective: state.objective, accountIds: ['website'], intervalHours: 1, dailyLimit: 1, discovery: state.discovery });
  operations.run(state.productId); const current = operations.state(state.productId);
  app.db.insert(settings).values({ key: 'operations.discovery.' + state.productId, value: { productId: state.productId, revision: current.revision, lastAttemptAt: clock.now(), nextAttemptAt: clock.now(), searches: [], findings: state.demandEvidence } }).run();
  app.db.insert(settings).values({ key: 'operations.delivery.reserved', value: { productId: state.productId, status: 'attention', createdAt: clock.now(), updatedAt: clock.now(), attempts: 1 } }).run();
  operations.schedule(); expect(app.db.select().from(growthTasks).all()).toHaveLength(0);
});
