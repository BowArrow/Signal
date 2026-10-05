import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp, type App } from '../../src/core/app.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { __setConfigForTests } from '../../src/core/config/load.js';
import { growthTasks, marketingToolCalls, settings, studioLeads } from '../../src/core/db/schema.js';
import { OperationsService } from '../../src/core/operations/service.js';
import { ConnectionService } from '../../src/core/connections/service.js';
import { parseDiscoveryQueries, suggestedDiscoveryQueries } from '../../src/shared/discovery.js';
import type { NormalizedItem, PollResult } from '../../src/core/ingest/types.js';
import type { ConnectedAccount } from '../../src/shared/connections.js';
import { saveAcquisitionCycle } from '../../src/core/operations/acquisition.js';

let app: App; let operations: OperationsService; let productId: string; let otherId: string; let now: number;
let poll: ReturnType<typeof vi.fn<(source: unknown, signal?: AbortSignal) => Promise<PollResult>>>;
const put = (key: string, value: unknown) => app.db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
function item(overrides: Partial<NormalizedItem> = {}): NormalizedItem { return { externalId: '123', title: 'How can I compare my local documents?', body: 'Looking for an offline document assistant.', url: 'https://untrusted.example/not-a-permalink', author: 'not-a-lead@example.test', postedAt: now - 60000, community: null, commentCount: 0, platformScore: 0, truncated: false, raw: {}, ...overrides }; }
function configure(id = productId, queries = 'hn:local documents', publish = false) {
  if (publish) {
    const account: ConnectedAccount = { id: 'site-' + id, productId: id, provider: 'signal-blog', label: 'Test website', site: 'https://siplemona.de', username: '', identity: '', status: 'verified', detail: '', checkedAt: now, expiresAt: null, refreshable: false, grantedScopes: [], createdAt: now };
    put('connections.account.' + account.id, account);
  }
  operations.configure(id, { objective: 'Help buyers complete a useful task.', accountIds: publish ? ['site-' + id] : [], intervalHours: 24, dailyLimit: 1, discovery: { enabled: true, queries: parseDiscoveryQueries(queries) } });
  operations.run(id);
}
beforeEach(() => {
  now = Date.now(); vi.stubEnv('SIGNAL_OFFLINE', '0'); __setConfigForTests(null);
  app = createApp({ databaseUrl: ':memory:', logger: silentLogger, clock: { now: () => now } });
  app.connections = new ConnectionService(app, { available: () => true, get: () => undefined, set: () => {}, delete: () => {} });
  [productId, otherId] = app.connections.view().products.map(p => p.id) as [string, string];
  operations = new OperationsService(app); app.operations = operations;
  poll = vi.fn(async () => ({ items: [item()], skipped: [] }));
  app.pollers.splice(0, app.pollers.length, { kind: 'hn', available: () => ({ ready: true }), poll }, { kind: 'stackexchange', available: () => ({ ready: true }), poll });
});
afterEach(async () => { await operations.stop(); app.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); __setConfigForTests(null); });
it('repairs previously saved Bluesky source URLs without deleting or rewriting the observation', () => {
  configure();
  const key = 'operations.discovery.' + productId;
  const legacy = 'https://bsky.app/profile/did%3Aplc%3Abuyer/post/question';
  const finding = { id: 'saved-request', kind: 'bluesky', url: legacy, title: 'Document problem', excerpt: 'I need to compare my client reports.', postedAt: now, observedAt: now, query: 'bluesky:reports', requestLanguage: true };
  put(key, { productId, revision: operations.state(productId).revision, lastAttemptAt: now, nextAttemptAt: now, searches: [], findings: [finding] });
  expect(operations.discovery.snapshot(operations.state(productId)).findings[0]).toEqual({ ...finding, url: 'https://bsky.app/profile/did:plc:buyer/post/question' });
  const saved = app.db.select().from(settings).where(eq(settings.key, key)).get()!.value as { findings: { url: string }[] };
  expect(saved.findings[0]!.url).toBe(legacy);
  expect(poll).not.toHaveBeenCalled();
});
it('runs public research without a model and never creates a sales contact', async () => {
  configure(); operations.pause(productId); const runtime = vi.fn(async () => {}); await operations.start(productId, runtime); await operations.tick(false);
  expect(runtime).not.toHaveBeenCalled(); expect(poll).toHaveBeenCalledOnce(); expect(app.db.select().from(studioLeads).all()).toEqual([]);
  const finding = operations.discovery.snapshot(operations.state(productId)).findings[0]!;
  expect(finding.url).toBe('https://news.ycombinator.com/item?id=123'); expect(finding).not.toHaveProperty('author'); expect(finding.requestLanguage).toBe(true);
  expect(operations.view().discovery?.[0]?.findings).toHaveLength(1);
});
it('can refresh public research while paused without authorizing delivery or queueing an agent', async () => {
  configure(productId, 'hn:local documents', true); operations.pause(productId);
  const before = operations.state(productId);
  const snapshot = await operations.discovery.refresh(productId);
  expect(snapshot.findings).toHaveLength(1); expect(poll).toHaveBeenCalledOnce();
  expect(operations.state(productId)).toEqual(before); expect(before.running).toBe(false);
  operations.schedule(); expect(operations.deliveries()).toEqual([]); expect(app.db.select().from(growthTasks).all()).toEqual([]);
  expect(app.db.select().from(studioLeads).all()).toEqual([]);
  await operations.discovery.refresh(productId); expect(poll).toHaveBeenCalledOnce();
});
it('does not retain a paused research result after the owner changes its settings', async () => {
  configure(); operations.pause(productId);
  poll.mockImplementationOnce(async () => {
    operations.configure(productId, { objective: 'Use this revised buyer research goal.', accountIds: [], intervalHours: 24, dailyLimit: 1, discovery: { enabled: true, queries: parseDiscoveryQueries('hn:offline assistant') } });
    return { items: [item()], skipped: [] };
  });
  const snapshot = await operations.discovery.refresh(productId);
  expect(snapshot.findings).toEqual([]); expect(operations.state(productId).running).toBe(false);
});
it('waits for first research then records business-scoped evidence in a campaign and delivery', async () => {
  configure(productId, 'hn:local documents', true); operations.schedule(); expect(app.db.select().from(growthTasks).all()).toHaveLength(0);
  await operations.tick(false); operations.schedule();
  const state = operations.state(productId); expect(state.taskId).toBeTruthy(); expect(state.demandEvidence).toHaveLength(1); expect(operations.context(otherId).demandEvidence).toBeUndefined();
  app.db.update(growthTasks).set({ status: 'running' }).where(eq(growthTasks.id, state.taskId!)).run();
  app.db.insert(marketingToolCalls).values({ id: 'inspection', productId, taskId: state.taskId!, name: 'product.inspect', status: 'done', result: JSON.stringify({ url: 'https://siplemona.de/' }), createdAt: now }).run();
  expect(() => operations.enqueue(productId, state.taskId!, { accountId: 'site-' + productId, title: 'Example campaign', description: 'Explain a useful product task.', body: 'Read a source before relying on an answer.', evidence: ['https://siplemona.de/'], demand: { findingId: 'another-business-finding', reason: 'An invented source that was not supplied to this cycle.' } })).toThrow('Select a finding');
  const queued = operations.enqueue(productId, state.taskId!, { accountId: 'site-' + productId, title: 'Compare an answer with its source', description: 'A practical task for checking the source of a document answer.', body: 'Start with a document you recognize. Ask a question whose answer you can check, read the relevant passage, and compare it with the original before relying on it. Keep the example small so you can follow where the answer came from. '.repeat(4) + 'Try it at https://siplemona.de/', evidence: ['https://siplemona.de/'], demand: { findingId: state.demandEvidence![0]!.id, reason: 'The observation asks how to compare local document answers with their source.' } });
  expect(operations.deliveries().find(j => j.id === queued.id)?.demandEvidence).toEqual(state.demandEvidence);
  expect(operations.context(productId).demandEvidence?.[0]?.title).toContain('compare');
  operations.pause(productId); expect(operations.state(productId).demandEvidence).toEqual(state.demandEvidence);
});
it('keeps different businesses isolated while sharing the reader', async () => {
  configure(); configure(otherId, 'hn:video editing'); await operations.tick(false);
  poll.mockResolvedValueOnce({ items: [item({ externalId: '456', title: 'How do I storyboard a short film?', body: 'Looking for a video editing tool to storyboard a short film.' })], skipped: [] }); await operations.tick(false);
  expect(operations.discovery.context(operations.state(productId)).map(f => f.id)).not.toEqual(operations.discovery.context(operations.state(otherId)).map(f => f.id));
  expect(operations.discovery.context(operations.state(productId))[0]?.title).toContain('documents'); expect(operations.discovery.context(operations.state(otherId))[0]?.title).toContain('film');
});
it('deduplicates overlapping searches and rotates queries without rapid polling', async () => {
  configure(productId, 'hn:local documents\nhn:offline assistant'); await operations.tick(false); await operations.tick(false); expect(poll).toHaveBeenCalledTimes(1);
  now += 60001; await operations.tick(false); expect(poll).toHaveBeenCalledTimes(2); expect(operations.discovery.context(operations.state(productId))).toHaveLength(1);
  now += 60001; await operations.tick(false); expect(poll).toHaveBeenCalledTimes(2);
});

it('refreshes successful acquisition searches every 15 minutes only while capacity remains', async () => {
  configure(); const state = { ...operations.state(productId), mode: 'acquisition' as const };
  put('operations.policy.' + productId, state);
  await operations.tick(false); now += 14 * 60000; await operations.tick(false); expect(poll).toHaveBeenCalledTimes(1);
  now += 60001; await operations.tick(false); expect(poll).toHaveBeenCalledTimes(2);
  put('operations.delivery.reserved', { productId, status: 'attention', attempts: 1, createdAt: now });
  now += 16 * 60000; await operations.tick(false); expect(poll).toHaveBeenCalledTimes(2);
  now += 45 * 60000; await operations.tick(false); expect(poll).toHaveBeenCalledTimes(3);
});

it('backs off failed searches without starving successful queries in acquisition mode', async () => {
  configure(productId, 'hn:local documents\nhn:offline assistant');
  put('operations.policy.' + productId, { ...operations.state(productId), mode: 'acquisition' });
  poll.mockRejectedValueOnce(new Error('Rate limited')); await operations.tick(false);
  now += 10 * 60000 + 1; await operations.tick(false); expect(poll).toHaveBeenCalledTimes(2);
  now += 15 * 60000 + 1; await operations.tick(false); expect(poll).toHaveBeenCalledTimes(3);
  expect((poll.mock.calls[2]![0] as { identifier: string }).identifier).toBe('offline assistant');
});
it('does not starve another business when the first has exhausted its hourly searches', async () => {
  configure(); configure(otherId, 'hn:video editing\nhn:storyboard'); await operations.tick(false); await operations.tick(false); now += 60001; await operations.tick(false);
  expect(poll).toHaveBeenCalledTimes(3); expect(operations.discovery.snapshot(operations.state(otherId)).searches).toHaveLength(2);
});
it('rejects old, future, undated and malformed observations', async () => {
  configure(); poll.mockResolvedValueOnce({ items: [item({ postedAt: now - 15 * 86400000 }), item({ postedAt: now + 3600000 }), item({ postedAt: null }), item({ externalId: '../../bad' }), item({ title: '' })], skipped: [] }); await operations.tick(false);
  expect(operations.discovery.context(operations.state(productId))).toEqual([]);
});
it('rejects launches, inherited headline questions and requests unrelated to the search', async () => {
  configure(productId, 'hn:video editing');
  poll.mockResolvedValueOnce({ items: [
    item({ title: 'Show HN: A video editing app', body: 'Looking for a video editing app? I launched one.' }),
    item({ title: 're: Ask HN: How do you do video editing?', body: 'I launched my new project today.' }),
    item({ title: 're: World news', body: 'Looking for peace. The internet has many videos.' }),
    item({ title: 're: Broad philosophy', body: 'How do we decide our principles? https://example.test/video/editing/principles' }),
    item({ title: 'How can I edit?', body: 'How can I improve my video editing workflow?' }),
  ], skipped: [] }); await operations.tick(false);
  const findings = operations.discovery.context(operations.state(productId)); expect(findings).toHaveLength(1); expect(findings[0]?.title).toBe('How can I edit?');
});
it('uses canonical Stack Exchange permalinks and bounds saved excerpts', async () => {
  configure(productId, 'stackexchange:softwarerecs:offline assistant'); poll.mockResolvedValueOnce({ items: [item({ body: 'Looking for an offline assistant. ' + 'x'.repeat(20000) })], skipped: [] }); await operations.tick(false);
  const finding = operations.discovery.context(operations.state(productId))[0]!; expect(finding.url).toBe('https://softwarerecs.stackexchange.com/questions/123'); expect(finding.excerpt.length).toBe(1400);
});
it('makes provider failure visible and permits product-fact campaigns after the attempt', async () => {
  configure(productId, 'hn:local documents', true); poll.mockRejectedValueOnce(new Error('secret provider detail')); await operations.tick(false); operations.schedule();
  const snapshot = operations.discovery.snapshot(operations.state(productId)); expect(snapshot.searches[0]?.status).toBe('attention'); expect(JSON.stringify(snapshot)).not.toContain('secret'); expect(operations.state(productId).taskId).toBeTruthy();
});
it.each(['pause', 'configure', 'offline'])('discards an in-flight result after %s', async action => {
  configure(); let resolve!: (value: PollResult) => void; poll.mockImplementationOnce(async () => new Promise<PollResult>(r => { resolve = r; })); const pending = operations.tick(false);
  if (action === 'pause') operations.pause(productId); else if (action === 'offline') app.env.SIGNAL_OFFLINE = '1'; else operations.configure(productId, { ...operations.state(productId).discovery && { discovery: operations.state(productId).discovery! }, objective: 'Changed business objective.', accountIds: [], intervalHours: 24, dailyLimit: 1 });
  resolve({ items: [item()], skipped: [] }); await pending; expect(operations.discovery.snapshot(operations.state(productId)).findings).toEqual([]);
});
it('does not fetch paused or offline businesses and honors cancellation signals', async () => {
  configure(); operations.pause(productId); await operations.tick(false); expect(poll).not.toHaveBeenCalled(); operations.run(productId); app.env.SIGNAL_OFFLINE = '1'; await operations.tick(false); expect(poll).not.toHaveBeenCalled(); app.env.SIGNAL_OFFLINE = '0';
  poll.mockImplementationOnce(async (_source, signal) => new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }))); const pending = operations.tick(false); operations.pause(productId); await pending; expect(operations.discovery.context(operations.state(productId))).toEqual([]);
});
it('expires observations and excludes recently supplied evidence when fresh alternatives exist', async () => {
  configure(); poll.mockResolvedValueOnce({ items: [item(), item({ externalId: '456', title: 'How do I compare local documents another way?' })], skipped: [] }); await operations.tick(false);
  const old = operations.discovery.context(operations.state(productId))[0]!; put('operations.delivery.fixture', { productId, createdAt: now, demandEvidence: [old] }); expect(operations.discovery.context(operations.state(productId))[0]?.id).not.toBe(old.id);
  now += 15 * 86400000; expect(operations.discovery.context(operations.state(productId))).toEqual([]);
});
it('clearing discovery stops research and clears the previous campaign context', async () => {
  configure(); await operations.tick(false); operations.configure(productId, { objective: 'Only run the selected activities.', accountIds: [], intervalHours: 24, dailyLimit: 1 });
  expect(operations.state(productId).discovery).toBeUndefined(); expect(operations.discovery.context(operations.state(productId))).toEqual([]); expect(operations.view().discovery).toEqual([]);
});
it('persists hourly checkpoints across service restarts', async () => {
  configure(); await operations.tick(false); const restarted = new OperationsService(app); app.operations = restarted; await restarted.tick(false); expect(poll).toHaveBeenCalledOnce(); expect(restarted.discovery.context(restarted.state(productId))).toHaveLength(1);
});
it('assesses unseen requests behind a full batch of recent rejections', async () => {
  configure();
  poll.mockResolvedValueOnce({ items: Array.from({ length: 8 }, (_, i) => item({ externalId: String(100 + i), postedAt: now - (i + 1) * 60000 })), skipped: [] });
  await operations.tick(false);
  const state = { ...operations.state(productId), mode: 'acquisition' as const };
  const first = operations.discovery.context(state);
  expect(first).toHaveLength(6);
  saveAcquisitionCycle(app, { productId, taskId: 'assessment', revision: state.revision, checkedAt: now, sourceUrl: 'https://siplemona.de/', status: 'no-fit', detail: 'Not supported.', assessments: first.map(f => ({ findingId: f.id, suitable: false, reason: 'Unsupported buyer requirement.', requestQuote: f.excerpt, productQuote: '', assessedAt: now })) });
  const next = operations.discovery.context(state);
  expect(next).toHaveLength(2);
  expect(next.every(f => !first.some(old => old.id === f.id))).toBe(true);
  // Publishing mode still has its own topic rotation behavior.
  expect(operations.discovery.context({ ...state, mode: 'publishing' })).toHaveLength(6);
  // A changed policy can reconsider old rejections after its research refresh.
  saveAcquisitionCycle(app, { ...app.operations!.view().acquisition!.find(c => c.productId === productId)!, revision: state.revision - 1 });
  expect(operations.discovery.context(state)).toHaveLength(6);
});
it('validates editable presets and rejects arbitrary providers and sites', () => {
  expect(parseDiscoveryQueries(suggestedDiscoveryQueries('Lemonade'))).toHaveLength(4); expect(parseDiscoveryQueries(suggestedDiscoveryQueries('CineGen'))).toHaveLength(4);
  for (const value of ['', 'https://private.example/query', 'stackexchange:evil.example:local assistant', 'hn:x', Array(9).fill('hn:local assistant').join('\n')]) expect(() => parseDiscoveryQueries(value)).toThrow();
});
