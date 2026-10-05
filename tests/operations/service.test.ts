import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp, type App } from '../../src/core/app.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { fixedClock } from '../../src/core/lib/clock.js';
import { __setConfigForTests } from '../../src/core/config/load.js';
import { ConnectionService, type CredentialVault } from '../../src/core/connections/service.js';
import { OperationsService } from '../../src/core/operations/service.js';
import { growthTasks, marketingToolCalls, settings } from '../../src/core/db/schema.js';
import { newId } from '../../src/core/lib/id.js';
import { GrowthEngine } from '../../src/core/growth/engine.js';
import type { LlmClient } from '../../src/core/llm/client.js';
import type { Delivery, DeliveryInput } from '../../src/shared/operations.js';
import { reviewOperationCopy } from '../../src/core/operations/review.js';
import { reviewFixture } from './review-fixture.js';

it.each(['plain', 'help-only', 'generic', 'missing'])('requires an explicit conversation-voice verdict for public replies: %s', async mode => {
  start(); const id = task(); observed();
  vi.spyOn(accounts, 'accounts').mockReturnValue(accounts.accounts().map(account => ({ ...account, provider: 'bluesky' as const })));
  const state = operations.state(product);
  const finding = { id: 'request-voice', kind: 'bluesky', title: 'How do I check a document answer?', excerpt: 'I want to see the original passage behind each answer.', requestLanguage: true, postedAt: clock.now(), observedAt: clock.now(), reply: { uri: 'at://did:plc:buyer/app.bsky.feed.post/abcdef', cid: 'b' + 'a'.repeat(40), authorDid: 'did:plc:buyer' } };
  app.db.update(settings).set({ value: { ...state, replyToRequests: true, demandEvidence: [finding] } }).where(eq(settings.key, 'operations.policy.' + product)).run();
  const input = { ...copy(), body: 'Start with one document and check the cited passage before using the answer.', demand: { findingId: finding.id, reason: 'The request asks to verify the source of a document answer.' } };
  const llm: LlmClient = { available: () => ({ ready: true }), complete: async request => {
    expect(request.prompt).toContain('Assess the voice separately');
    expect(request.prompt).toContain('do not force a product claim');
    const verdict = reviewFixture(request);
    if (mode === 'help-only') verdict.checks.forEach(check => { check.verdict = 'nonfactual'; check.quoteIds = []; });
    return { text: JSON.stringify({ ...verdict, demandFit: { concreteRequest: true, copyAddressesRequest: true, productCanHelp: true, explanation: 'The source describes cited document answers.' }, ...(mode === 'missing' ? {} : { voice: { fitsConversation: mode === 'plain' || mode === 'help-only', plainLanguage: true, explanation: mode === 'plain' ? 'The reply gives a specific relevant next step.' : 'The wording is generic and does not address the requested task.' } }) }), model: 'fixture', inputTokens: 0, outputTokens: 0, stopReason: 'stop' };
  } };
  if (mode === 'plain' || mode === 'help-only') expect((await reviewOperationCopy(app, product, id, input, llm, 'fixture')).approved).toBe(true);
  else await expect(reviewOperationCopy(app, product, id, input, llm, 'fixture')).rejects.toThrow('Reply voice needs revision');
  expect(operations.deliveries()).toHaveLength(0);
});

vi.mock('../../src/core/marketing/web.js', () => ({ publicPage: async (app: App, url: string) => ({ url: new URL(url).toString(), title: 'Product facts', body: 'Work with local documents and check the cited source.', observedAt: app.clock.now() }), searchWeb: async () => ({ results: [] }) }));
class Vault implements CredentialVault {
  data = new Map<string, string>(); available() { return true; } get(key: string) { return this.data.get(key); } set(key: string, value: string) { this.data.set(key, value); } delete(key: string) { this.data.delete(key); }
}
let app: App; let operations: OperationsService; let accounts: ConnectionService; let vault: Vault;
let clock: ReturnType<typeof fixedClock>; let transport: ReturnType<typeof vi.fn<typeof fetch>>;
let remote: Record<string, unknown> | null; let writes: number; let product: string; let accountId: string;
const missing = () => Response.json({ error: 'Post not found' }, { status: 404 });
const copy = (): DeliveryInput => ({ accountId, title: 'Find the source behind your answer', description: 'A practical way to check a local document answer against the original source.', body: 'Our product helps you work with documents. Start with a folder you recognize and ask a question whose answer you can check. Read the cited passage and compare it with the source before relying on the response. Keep the example small so you can see where the answer came from.\n\n'.repeat(4) + 'Explore the workflow at https://siplemona.de/', evidence: ['https://siplemona.de/'] });
beforeEach(async () => {
  vi.stubEnv('SIGNAL_OFFLINE', '0'); __setConfigForTests(null); clock = fixedClock(1789600000000);
  app = createApp({ databaseUrl: ':memory:', clock, logger: silentLogger }); vault = new Vault(); remote = null; writes = 0;
  transport = vi.fn(async (url, init) => {
    if (String(url).includes('signal-connection-check')) return missing();
    if (init?.method === 'PUT') { writes++; remote = JSON.parse(String(init.body)); return Response.json({ slug: remote!.slug, status: 'published', version: 1, url: 'https://siplemona.de/writing/article' }); }
    return remote ? Response.json({ ...remote, version: 1 }) : missing();
  });
  accounts = new ConnectionService(app, vault, undefined, transport); app.connections = accounts;
  product = accounts.view().products[0]!.id;
  await accounts.connect({ productId: product, provider: 'signal-blog', credential: 'private-website-key', label: 'Lemonade website' }); accountId = accounts.accounts()[0]!.id;
  operations = new OperationsService(app); app.operations = operations;
});
afterEach(async () => { await operations.stop(); app.close(); vi.unstubAllEnvs(); __setConfigForTests(null); });
function start(limit = 1) { operations.configure(product, { objective: 'Help buyers verify local document answers.', accountIds: [accountId], intervalHours: 1, dailyLimit: limit }); operations.run(product); operations.schedule(); }
function task() { const id = operations.state(product).taskId!; app.db.update(growthTasks).set({ status: 'running' }).where(eq(growthTasks.id, id)).run(); return id; }
function observed() { app.db.insert(marketingToolCalls).values({ id: newId(), productId: product, taskId: operations.state(product).taskId!, name: 'product.inspect', status: 'done', result: JSON.stringify({ url: 'https://siplemona.de/', body: 'Current source text.' }), createdAt: clock.now() }).run(); }
function queue() { const id = task(); observed(); return operations.enqueue(product, id, copy()).id; }
function saveJob(job: Delivery) { app.db.update(settings).set({ value: job }).where(eq(settings.key, `operations.delivery.${job.id}`)).run(); }

async function linkedIn(scopes = ['openid', 'profile', 'w_member_social']) {
  transport.mockImplementation(async (url, init) => {
    if (String(url).endsWith('/userinfo')) return Response.json({ sub: 'member_123', name: 'Business owner' });
    if (String(url).endsWith('/ugcPosts') && init?.method === 'POST') { writes++; return new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:123456789' } }); }
    throw Error('Unexpected destination');
  });
  await accounts.connect({ productId: product, provider: 'linkedin', credential: 'private-linkedin-token', label: 'LinkedIn member' });
  const account = accounts.accounts().find(a => a.provider === 'linkedin')!; accountId = account.id;
  app.db.update(settings).set({ value: { ...account, grantedScopes: scopes } }).where(eq(settings.key, `connections.account.${accountId}`)).run();
}

async function xAccount(scopes = ['tweet.read', 'users.read', 'tweet.write']) {
  transport.mockImplementation(async (url, init) => {
    if (String(url).endsWith('/users/me')) return Response.json({ data: { id: '1234', username: 'business', name: 'Business' } });
    if (String(url).endsWith('/tweets') && init?.method === 'POST') { writes++; return Response.json({ data: { id: '987654321', text: 'accepted' } }, { status: 201 }); }
    throw Error('Unexpected destination');
  });
  await accounts.connect({ productId: product, provider: 'x', credential: 'private-x-token', label: 'X business' });
  const account = accounts.accounts().find(a => a.provider === 'x')!; accountId = account.id;
  app.db.update(settings).set({ value: { ...account, grantedScopes: scopes } }).where(eq(settings.key, `connections.account.${accountId}`)).run();
}
function queueX(body = 'Check the original passage behind an answer with our app. https://siplemona.de/') {
  const id = task(); observed(); return operations.enqueue(product, id, { ...copy(), body }).id;
}
async function facebook(canPost = true) {
  transport.mockImplementation(async (url, init) => {
    if (String(url).includes('/me?fields=')) return Response.json({ id: '1234', name: 'AIonX', category: 'Software', can_post: canPost });
    if (String(url).endsWith('/1234/feed') && init?.method === 'POST') { writes++; return Response.json({ id: '1234_9876' }); }
    throw Error('Unexpected Facebook endpoint');
  });
  await accounts.connect({ productId: product, provider: 'facebook', credential: 'private-page-token', label: 'AIonX Facebook' });
  accountId = accounts.accounts().filter(a => a.provider === 'facebook').at(-1)!.id;
}
it('publishes to the verified Facebook Page with tracking and a durable receipt despite Pause during acceptance', async () => {
  await facebook(); start(); queueX(); const original = transport.getMockImplementation()!;
  transport.mockImplementation(async (url, init) => {
    if (init?.method === 'POST') {
      expect(operations.deliveries()[0]?.publicationAttempt).toEqual({ author: '1234', startedAt: clock.now() });
      expect(JSON.parse(String(init.body))).toEqual({ message: expect.stringContaining('utm_campaign='), published: true });
      operations.pause(product);
    }
    return original(url, init);
  });
  await operations.tick(); const job = operations.deliveries()[0]!;
  expect(writes).toBe(1); expect(job.status).toBe('published'); expect(job.publicationAttempt?.id).toBe('1234_9876');
  expect(job.receipt?.url).toBe('https://www.facebook.com/permalink.php?story_fbid=9876&id=1234');
  expect(JSON.stringify(job)).not.toContain('private-page-token');
});
it('blocks Facebook without posting capability and catches a changed Page before sending', async () => {
  await facebook(false); expect(() => start()).toThrow('publishing access');
  await facebook(); start(); queueX(); transport.mockResolvedValue(Response.json({ id: 'different-page', category: 'Software', can_post: true }));
  await operations.tick(); expect(operations.deliveries()[0]?.status).toBe('attention'); expect(writes).toBe(0);
});
it('does not resend an uncertain Facebook submission across retry and restart', async () => {
  await facebook(); start(); const id = queueX(); const original = transport.getMockImplementation()!;
  transport.mockImplementation(async (url, init) => { if (init?.method === 'POST') { writes++; throw Error('lost-response-private-page-token'); } return original(url, init); });
  await operations.tick(); expect(operations.deliveries()[0]?.publicationAttempt).toMatchObject({ author: '1234' });
  operations = new OperationsService(app); app.operations = operations; operations.retry(product, id); await operations.tick();
  expect(writes).toBe(1); expect(operations.deliveries()[0]?.status).toBe('attention'); expect(JSON.stringify(operations.view())).not.toContain('private-page-token');
});
it('recovers a saved Facebook receipt without another send or trusting a different Page receipt', async () => {
  await facebook(); start(); queueX(); const job = operations.deliveries()[0]!;
  saveJob({ ...job, publicationAttempt: { author: '1234', startedAt: clock.now(), id: '1234_9876' } });
  transport.mockRejectedValue(Error('No requests expected')); await operations.tick();
  expect(operations.deliveries()[0]?.status).toBe('published'); expect(writes).toBe(0);
  saveJob({ ...job, publicationAttempt: { author: '9999', startedAt: clock.now(), id: '9999_9876' } }); await operations.tick();
  expect(operations.deliveries()[0]?.status).toBe('attention'); expect(writes).toBe(0);
});
it.each([['permission', 400, { error: { code: 200, message: 'private-page-token' } }, false], ['duplicate', 400, { error: { code: 506 } }, true], ['server', 500, { error: { code: 1 } }, true], ['wrong-page', 200, { id: '8888_9876' }, true]] as const)('handles Facebook %s responses without unsafe resubmission', async (_name, status, body, uncertain) => {
  await facebook(); start(); queueX(); const original = transport.getMockImplementation()!;
  transport.mockImplementation(async (url, init) => init?.method === 'POST' ? Response.json(body, { status }) : original(url, init));
  await operations.tick(); const job = operations.deliveries()[0]!;
  expect(job.status).toBe('attention'); expect(Boolean(job.publicationAttempt)).toBe(uncertain); expect(JSON.stringify(job)).not.toContain('private-page-token');
});
it('uses the Facebook writer, independent copy review and authorized queue', async () => {
  await facebook(); start(); let composed = false;
  const llm: LlmClient = { available: () => ({ ready: true }), complete: async request => {
    const review = request.task === 'operations.review';
    if (!review) { composed = true; expect(request.prompt).toContain('Create one useful Facebook Page post'); expect(request.prompt).not.toContain('A complete practical website article'); }
    return { text: JSON.stringify(review ? reviewFixture(request) : { message: 'Queue a supported Facebook post.', actions: [{ tool: 'operations.enqueue', input: { ...copy(), body: 'Our app helps you check a document answer against its source. https://siplemona.de/' } }] }), model: 'fixture', inputTokens: 0, outputTokens: 0, stopReason: 'stop' };
  } };
  await new GrowthEngine(app, llm).runNext(); expect(composed).toBe(true); await operations.tick();
  expect(operations.deliveries()[0]?.status).toBe('published'); expect(writes).toBe(1);
});
it('publishes an X post with tracked links and a durable receipt, including after Pause during acceptance', async () => {
  await xAccount(); start(); queueX();
  const original = transport.getMockImplementation()!;
  transport.mockImplementation(async (url, init) => {
    if (init?.method === 'POST') {
      expect(operations.deliveries()[0]?.publicationAttempt).toEqual({ author: '1234', startedAt: clock.now() });
      expect(JSON.parse(String(init.body))).toEqual({ text: expect.stringContaining('utm_campaign=') });
      expect(init.redirect).toBe('error'); operations.pause(product);
    }
    return original(url, init);
  });
  await operations.tick(); const job = operations.deliveries()[0]!;
  expect(job.status).toBe('published'); expect(job.receipt).toMatchObject({ id: '987654321', url: 'https://x.com/i/web/status/987654321' });
  expect(job.publicationAttempt?.id).toBe(job.receipt?.id); expect(writes).toBe(1);
  expect(JSON.stringify(job)).not.toContain('private-x-token');
});
it('requires X publishing grants before enabling a destination', async () => {
  await xAccount(['tweet.read', 'users.read']); expect(() => start()).toThrow('publishing access'); expect(writes).toBe(0);
});
it('runs the X writer through independent review and its authorized delivery', async () => {
  await xAccount(); start(); let composed = false;
  const llm: LlmClient = { available: () => ({ ready: true }), complete: async request => {
    const review = request.task === 'operations.review';
    if (!review) { composed = true; expect(request.prompt).toContain('Write one useful short X post'); expect(request.prompt).not.toContain('A complete practical website article'); expect(request.prompt).toContain('Omit URLs and affiliation text'); expect(request.prompt).not.toContain('with this business link:'); }
    return { text: JSON.stringify(review ? reviewFixture(request)
      : { message: 'Queue the supported short post.', actions: [{ tool: 'operations.enqueue', input: { ...copy(), body: 'Check a document answer against its cited source before relying on it.' } }] }), model: 'fixture', inputTokens: 0, outputTokens: 0, stopReason: 'stop' };
  } };
  await new GrowthEngine(app, llm).runNext(['marketing']); expect(composed).toBe(true);
  expect(operations.deliveries()).toHaveLength(1); expect(writes).toBe(0);
  expect(operations.deliveries()[0]!.body).toMatch(/^Our app: Check a document answer/); expect(operations.deliveries()[0]!.body).toContain('https://siplemona.de/?utm_source=signal');
  await operations.tick(); expect(writes).toBe(1); expect(operations.deliveries()[0]?.status).toBe('published');
});
it.each(['lost', 'server', 'forbidden', 'malformed', 'invalid-id'])('holds an uncertain X post after %s without another write across restart', async failure => {
  await xAccount(); start(); queueX(); const original = transport.getMockImplementation()!;
  transport.mockImplementation(async (url, init) => {
    if (init?.method !== 'POST') return original(url, init);
    writes++; if (failure === 'lost') throw Error('private-x-token lost response');
    if (failure === 'malformed') return new Response('broken', { status: 201 });
    return Response.json({ data: { id: '../invalid' } }, { status: failure === 'server' ? 503 : failure === 'forbidden' ? 403 : 201 });
  });
  await operations.tick(); let job = operations.deliveries()[0]!;
  expect(job.status).toBe('attention'); expect(job.publicationAttempt).toBeDefined();
  expect(job.detail).not.toContain('private-x-token'); expect(writes).toBe(1);
  operations = new OperationsService(app); app.operations = operations;
  clock.advance(2 * 86400000); operations.retry(product, job.id); await operations.tick();
  job = operations.deliveries()[0]!; expect(job.status).toBe('attention'); expect(writes).toBe(1); expect(job.detail).toContain('will not resend');
});
it.each([400, 401, 402, 404, 429])('permits corrected X delivery after explicit HTTP %s rejection', async status => {
  await xAccount(); start(); queueX(); const original = transport.getMockImplementation()!;
  transport.mockImplementation(async (url, init) => {
    if (init?.method === 'POST') { writes++; return new Response(null, { status }); }
    return original(url, init);
  });
  await operations.tick(); const job = operations.deliveries()[0]!;
  expect(job.publicationAttempt).toBeUndefined();
  transport.mockImplementation(original); if (job.status === 'attention') operations.retry(product, job.id);
  clock.advance(3600000); await operations.tick(); expect(operations.deliveries()[0]!.status).toBe('published'); expect(writes).toBe(2);
});
it('recovers an X receipt after restart without a second network request', async () => {
  await xAccount(); start(); queueX(); await operations.tick();
  const job = operations.deliveries()[0]!;
  saveJob({ ...job, status: 'attention', receipt: null });
  operations = new OperationsService(app); app.operations = operations; transport.mockClear();
  operations.retry(product, job.id); await operations.tick();
  expect(operations.deliveries()[0]!.status).toBe('published'); expect(transport).not.toHaveBeenCalled(); expect(writes).toBe(1);
});
it('does not start an X write when paused during identity lookup', async () => {
  await xAccount(); start(); queueX(); const original = transport.getMockImplementation()!;
  transport.mockImplementation(async (url, init) => { operations.pause(product); return original(url, init); });
  await operations.tick(); expect(writes).toBe(0); expect(operations.deliveries()[0]!.publicationAttempt).toBeUndefined();
});
it('uses X weighted Unicode and URL counts without stripping attribution', async () => {
  await xAccount(); start(); const id = task(); observed();
  expect(() => operations.enqueue(product, id, { ...copy(), body: '文'.repeat(140) + ' https://siplemona.de/' })).toThrow('280 weighted');
  const body = 'Our app: ' + '👨‍👩‍👧‍👦'.repeat(100) + ' https://siplemona.de/?example=' + 'a'.repeat(400);
  operations.enqueue(product, id, { ...copy(), body });
  const job = operations.deliveries()[0]!; expect(job.body.length).toBeGreaterThan(280); expect(job.body).toContain('utm_campaign=');
  await operations.tick(); expect(operations.deliveries()[0]!.status).toBe('published');
});

it('publishes a LinkedIn member post with a durable send record, tracked link and confirmed receipt', async () => {
  await linkedIn(); start(); queue();
  const original = transport.getMockImplementation()!;
  transport.mockImplementation(async (url, init) => {
    if (init?.method === 'POST') {
      expect(operations.deliveries()[0]?.publicationAttempt).toEqual({ author: 'urn:li:person:member_123', startedAt: clock.now() });
      const body = JSON.parse(String(init.body));
      expect(body).toMatchObject({ author: 'urn:li:person:member_123', lifecycleState: 'PUBLISHED', visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' } });
      expect(body.specificContent['com.linkedin.ugc.ShareContent'].shareCommentary.text).toContain('utm_campaign=');
      expect(init?.headers).toMatchObject({ 'X-Restli-Protocol-Version': '2.0.0' });
    }
    return original(url, init);
  });
  await operations.tick(); const job = operations.deliveries()[0]!;
  expect(job.status).toBe('published'); expect(job.receipt?.id).toBe('urn:li:share:123456789');
  expect(job.publicationAttempt?.id).toBe(job.receipt?.id); expect(writes).toBe(1);
  expect(JSON.stringify(job)).not.toContain('private-linkedin-token');
});

it('does not enable LinkedIn publishing from read-only or manual-token verification', async () => {
  await linkedIn(['openid', 'profile']); expect(() => start()).toThrow('publishing access');
  expect(writes).toBe(0);
});

it.each(['lost', 'server-error', 'missing-receipt', 'duplicate'])('never resends an uncertain LinkedIn post after %s, retry or restart', async failure => {
  await linkedIn(); start(); queue();
  const original = transport.getMockImplementation()!;
  transport.mockImplementation(async (url, init) => {
    if (init?.method !== 'POST') return original(url, init);
    writes++;
    if (failure === 'lost') throw Error('Lost private-linkedin-token response');
    return new Response(null, { status: failure === 'server-error' ? 503 : failure === 'duplicate' ? 422 : 201 });
  });
  await operations.tick(); let job = operations.deliveries()[0]!;
  expect(job.status).toBe('attention'); expect(job.publicationAttempt).toBeDefined(); expect(writes).toBe(1);
  expect(job.detail).not.toContain('private-linkedin-token');
  operations = new OperationsService(app); app.operations = operations;
  clock.advance(2 * 86400000); operations.retry(product, job.id); await operations.tick();
  job = operations.deliveries()[0]!; expect(job.status).toBe('attention'); expect(writes).toBe(1);
  expect(job.detail).toContain('will not resend');
});

it.each([400, 401, 403, 404, 429])('permits a later LinkedIn retry after an explicit HTTP %s rejection', async status => {
  await linkedIn(); start(); queue(); const original = transport.getMockImplementation()!;
  transport.mockImplementation(async (url, init) => { if (init?.method === 'POST') { writes++; return new Response(null, { status }); } return original(url, init); });
  await operations.tick(); const job = operations.deliveries()[0]!;
  expect(job.publicationAttempt).toBeUndefined(); expect(job.status).toBe(status === 429 ? 'retry' : 'attention');
  transport.mockImplementation(original); if (job.status === 'attention') operations.retry(product, job.id); clock.advance(3600000); await operations.tick();
  expect(operations.deliveries()[0]!.status).toBe('published'); expect(writes).toBe(2);
});

it('restores a LinkedIn receipt after a crash following provider acceptance without another request', async () => {
  await linkedIn(); start(); queue(); await operations.tick();
  const accepted = operations.deliveries()[0]!;
  saveJob({ ...accepted, status: 'dispatching', receipt: null, leaseUntil: 0 });
  transport.mockClear(); operations = new OperationsService(app); app.operations = operations;
  await operations.tick(); expect(operations.deliveries()[0]!.status).toBe('published');
  expect(operations.deliveries()[0]!.receipt?.id).toBe(accepted.publicationAttempt?.id);
  expect(transport).not.toHaveBeenCalled(); expect(writes).toBe(1);
});

it('holds LinkedIn before sending when paused during member lookup', async () => {
  await linkedIn(); start(); queue();
  transport.mockImplementation(async () => { operations.pause(product); return Response.json({ sub: 'member_123', name: 'Business owner' }); });
  await operations.tick(); expect(writes).toBe(0); expect(operations.deliveries()[0]?.publicationAttempt).toBeUndefined();
});

it('records LinkedIn acceptance even if Pause happens while the provider accepts the post', async () => {
  await linkedIn(); start(); queue(); const original = transport.getMockImplementation()!;
  transport.mockImplementation(async (url, init) => { const result = await original(url, init); if (init?.method === 'POST') operations.pause(product); return result; });
  await operations.tick(); expect(operations.state(product).running).toBe(false);
  expect(operations.deliveries()[0]?.status).toBe('published'); expect(writes).toBe(1);
});

it('refuses to post when the LinkedIn member lookup has no safe subject identifier', async () => {
  await linkedIn(); start(); queue(); transport.mockImplementation(async () => Response.json({ sub: 'bad/subject', name: 'Business owner' }));
  await operations.tick(); expect(operations.deliveries()[0]?.status).toBe('attention');
  expect(operations.deliveries()[0]?.publicationAttempt).toBeUndefined(); expect(writes).toBe(0);
});

it('enforces the LinkedIn size limit after adding campaign attribution', async () => {
  await linkedIn(); start(); const id = task(); observed();
  const body = 'Our app: ' + 'a'.repeat(2945) + ' https://siplemona.de/';
  expect(body.length).toBeLessThan(3000);
  expect(() => operations.enqueue(product, id, { ...copy(), body })).toThrow('3,000 characters');
});

it('starts paused and refuses unsupported, unverified, or cross-business destinations', async () => {
  expect(operations.state(product).running).toBe(false);
  expect(() => operations.run(product)).toThrow();
  const other = accounts.view().products[1]!.id;
  expect(() => operations.configure(other, { objective: 'Reach new customers', accountIds: [accountId], intervalHours: 1, dailyLimit: 1 })).toThrow('business');
  await accounts.connect({ productId: product, provider: 'resend', label: 'Email', credential: 'secret' });
  expect(() => operations.configure(product, { objective: 'Reach new customers', accountIds: [accounts.accounts().find(a => a.provider === 'resend')!.id], intervalHours: 1, dailyLimit: 1 })).toThrow('supported');
  expect(writes).toBe(0);
});
it('runs a complete agent cycle through research, durable queueing, and confirmed publication', async () => {
  start(); let n = 0;
  const llm: LlmClient = { complete: async request => ({ text: JSON.stringify(request.task === 'operations.review' ? reviewFixture(request) : n++ === 0 ? { message: 'Checking the current product facts.', actions: [{ tool: 'product.inspect', input: {} }] } : { message: 'Queueing the useful article.', actions: [{ tool: 'operations.enqueue', input: copy() }] }), model: 'fixture', inputTokens: 0, outputTokens: 0, stopReason: 'stop' }), available: () => ({ ready: true }) };
  const engine = new GrowthEngine(app, llm); await engine.runNext(['marketing']);
  const job = operations.deliveries()[0]; expect(job?.status).toBe('queued'); expect(writes).toBe(0);
  expect(job?.learning).toEqual(operations.state(product).learning); expect(job?.learning?.mode).toBe('explore');
  expect(app.db.select().from(growthTasks).where(eq(growthTasks.id, operations.state(product).taskId!)).get()).toMatchObject({ status: 'done' });
  await operations.tick(); expect(writes).toBe(1);
  expect(operations.deliveries()[0]).toMatchObject({ status: 'published', receipt: { id: job!.slug, url: `https://siplemona.de/writing/${job!.slug}` } });
  expect(remote!.body).toContain(`utm_campaign=${job!.id}`);
  expect(JSON.stringify(operations.view())).not.toContain('private-website-key');
});
it.each(['no-fit', 'ready', 'generic-replacement', 'pause'] as const)('runs an acquisition cycle through the real agent and queue: %s', async outcome => {
  operations.configure(product, { mode: 'acquisition', ownedAudience: false, objective: 'Help small business owners check document answers.', accountIds: [accountId], intervalHours: 1, dailyLimit: 1, discovery: { enabled: true, queries: [{ kind: 'hn', query: 'documents' }] } });
  const state = operations.state(product);
  const finding = { id: 'buyer-request', title: 'How can I check answers from my documents?', excerpt: 'I need to ask questions about local documents and check the cited source.', url: 'https://news.ycombinator.com/item?id=123', postedAt: clock.now(), observedAt: clock.now(), query: 'hn:documents', kind: 'hn' as const, requestLanguage: true };
  app.db.insert(settings).values({ key: 'operations.discovery.' + product, value: { productId: product, revision: state.revision, lastAttemptAt: clock.now(), nextAttemptAt: clock.now() + 3600000, searches: [], findings: [finding] } }).run();
  operations.run(product); operations.schedule();
  const tasks: string[] = [];
  const llm: LlmClient = { available: () => ({ ready: true }), complete: async request => {
    tasks.push(request.task ?? ''); let value: unknown;
    if (request.task === 'operations.acquire') {
      if (outcome === 'pause') operations.pause(product);
      value = { assessments: [{ findingId: finding.id, suitable: outcome !== 'no-fit', reason: 'This request asks for document answers with a source to check.', productExcerptId: 'product-1' }] };
    } else if (request.task === 'operations.review') value = { ...reviewFixture(request), demandFit: { concreteRequest: true, copyAddressesRequest: true, productCanHelp: true, explanation: 'This fixture covers the supported document request.' } };
    else {
      expect(request.prompt).toContain('CUSTOMER ACQUISITION');
      expect(request.prompt).not.toContain('NEW ANGLE REQUIRED');
      value = { message: 'Prepare a practical source-checking guide.', actions: [{ tool: 'operations.enqueue', input: { ...copy(), demand: { findingId: outcome === 'generic-replacement' ? 'none' : finding.id, reason: 'The guide explains how to check the cited document source.' } } }] };
    }
    return { text: JSON.stringify(value), model: 'fixture', inputTokens: 0, outputTokens: 0, stopReason: 'stop' };
  } };
  await new GrowthEngine(app, llm).runNext(['marketing']);
  const completed = app.db.select().from(growthTasks).where(eq(growthTasks.id, operations.state(product).taskId!)).get();
  if (outcome === 'ready') {
    expect(completed?.status).toBe('done'); expect(tasks).toEqual(['operations.acquire', 'operations.compose', 'operations.review']);
    expect(operations.deliveries()[0]).toMatchObject({ status: 'queued', demand: { findingId: finding.id }, accountId });
    await operations.tick(); expect(writes).toBe(1); expect(operations.deliveries()[0]?.receipt).toBeTruthy();
  } else {
    expect(operations.deliveries()).toHaveLength(0); expect(writes).toBe(0);
    if (outcome === 'no-fit') { expect(completed?.status).toBe('done'); expect(tasks).toEqual(['operations.acquire']); expect(operations.view().acquisition?.[0]?.status).toBe('no-fit'); }
    if (outcome === 'pause') expect(tasks).toEqual(['operations.acquire']);
    if (outcome === 'generic-replacement') expect(tasks).not.toContain('operations.review');
  }
});
it.each(['open', 'software', 'separate', 'restricted', 'contacted', 'limit'] as const)('takes a buyer request through qualification, review and a permission-checked Bluesky reply: %s', async outcome => {
  const restricted = outcome === 'restricted'; let seededHistory = false;
  clock.advance(Date.now() - clock.now());
  const reference = { uri: 'at://did:plc:buyer/app.bsky.feed.post/abcdef', cid: 'b' + 'a'.repeat(40), authorDid: 'did:plc:buyer' };
  const excerpt = outcome === 'software' ? 'Can anyone recommend a tool to ask questions about local documents and check the cited source?' : 'I need to ask questions about local documents and check the cited source.';
  let posted: Record<string, unknown> | undefined;
  const send: typeof fetch = async (url, init) => {
    const path = String(url);
    if (path.includes('createSession')) return Response.json({ accessJwt: 'bsky-access', refreshJwt: 'bsky-refresh' });
    if (path.includes('getSession')) return Response.json({ did: 'did:plc:ownedaccount', handle: 'owned.bsky.social' });
    if (path.includes('getRecord')) return Response.json({ error: 'RecordNotFound' }, { status: 400 });
    if (path.includes('getPostThread')) return Response.json({ thread: { post: { uri: reference.uri, cid: reference.cid, author: { did: reference.authorDid }, record: { text: excerpt, createdAt: new Date(clock.now()).toISOString() }, viewer: { replyDisabled: restricted } } } });
    if (path.includes('createRecord')) { writes++; const input = JSON.parse(String(init?.body)); posted = input.record; return Response.json({ uri: `at://did:plc:ownedaccount/app.bsky.feed.post/${input.rkey}`, cid: reference.cid }); }
    throw Error('Unexpected endpoint: ' + path);
  };
  accounts = new ConnectionService(app, vault, undefined, send); app.connections = accounts;
  await accounts.connect({ productId: product, provider: 'bluesky', credential: 'fixture-password', username: 'owned.bsky.social', label: 'Bluesky' });
  const websiteId = accountId; accountId = accounts.accounts().find(a => a.provider === 'bluesky')!.id;
  operations.configure(product, { mode: 'acquisition', replyToRequests: true, ownedAudience: false, objective: 'Help buyers check local document answers.', accountIds: [websiteId, accountId], intervalHours: 1, dailyLimit: outcome === 'separate' ? 1 : 3, ...(outcome === 'separate' ? { publicReplyLimit: 5 } : {}), discovery: { enabled: true, queries: [{ kind: 'bluesky', query: 'local documents' }] } });
  if (outcome === 'separate') app.db.insert(settings).values({ key: 'operations.delivery.previous-article', value: { id: 'previous-article', productId: product, accountId: websiteId, provider: 'signal-blog', status: 'published', attempts: 1, createdAt: clock.now() - 1000, receipt: { id: 'article', url: 'https://siplemona.de/writing/article', confirmedAt: clock.now() - 1000 } } }).run();
  const finding = { id: 'buyer-request', title: excerpt, excerpt, reply: reference, url: 'https://bsky.app/profile/did:plc:buyer/post/abcdef', postedAt: clock.now(), observedAt: clock.now(), query: 'bluesky:local documents', kind: 'bluesky', requestLanguage: true };
  app.db.insert(settings).values({ key: 'operations.discovery.' + product, value: { productId: product, revision: operations.state(product).revision, lastAttemptAt: clock.now(), nextAttemptAt: clock.now() + 3600000, searches: [], findings: [finding] } }).run();
  operations.run(product); operations.schedule();
  const tasks: string[] = [];
  const llm: LlmClient = { available: () => ({ ready: true }), complete: async request => {
    tasks.push(request.task ?? ''); let value: unknown;
    if (request.task === 'operations.acquire') value = { assessments: [{ findingId: finding.id, suitable: true, reason: 'The product source supports checking document answers against the cited source.', productExcerptId: 'product-1' }] };
    else if (request.task === 'operations.review') value = { ...reviewFixture(request), voice: { fitsConversation: true, plainLanguage: true, explanation: 'The wording is brief and answers the specific document question.' }, demandFit: { concreteRequest: true, copyAddressesRequest: true, productCanHelp: true, explanation: 'The reply answers the complete request using the inspected source.' } };
    else {
      expect(request.prompt).toContain('PUBLIC REPLY');
      // A different business reserved replies while this task was composing.
      if (!seededHistory && ['contacted', 'limit'].includes(outcome)) {
        for (let i = 0; i < (outcome === 'limit' ? 3 : 1); i++) app.db.insert(settings).values({ key: 'operations.delivery.historical-' + i, value: { id: 'historical-' + i, productId: 'other-business', taskId: 'old-task-' + i, reply: { ...reference, authorDid: outcome === 'contacted' ? reference.authorDid : 'did:plc:other' + i }, status: 'published', attempts: 1, createdAt: clock.now() } }).run();
        seededHistory = true;
      }
      value = { message: 'Answer the supported document request.', actions: [{ tool: 'operations.enqueue', input: { ...copy(), body: 'Ask a question about a local document, then check its cited source before using the answer.', demand: { findingId: finding.id, reason: 'The reply explains a supported document source check.' } } }] };
    }
    return { text: JSON.stringify(value), model: 'fixture', inputTokens: 0, outputTokens: 0, stopReason: 'stop' };
  } };
  await new GrowthEngine(app, llm).runNext(['marketing']);
  if (['contacted', 'limit'].includes(outcome)) { expect(operations.deliveries().filter(d => d.productId === product)).toHaveLength(0); expect(tasks).not.toContain('operations.review'); expect(writes).toBe(0); return; }
  expect(tasks).toEqual(['operations.acquire', 'operations.compose', 'operations.review']);
  expect(operations.deliveries()[0]).toMatchObject({ accountId, reply: { ...reference, text: excerpt }, status: 'queued' });
  expect(operations.deliveries()[0]!.body).not.toMatch(/^Our app:/);
  if (outcome === 'software') expect(operations.deliveries()[0]!.body).toContain('Our app: https://siplemona.de/');
  else {
    expect(operations.deliveries()[0]!.body).toContain('(Lemonade team)');
    expect(operations.deliveries()[0]!.body).not.toContain('https://');
  }
  expect(operations.deliveries()[0]?.image).toBeUndefined(); expect(writes).toBe(0);
  await operations.tick();
  if (restricted) { expect(writes).toBe(0); expect(operations.deliveries()[0]?.status).toBe('attention'); }
  else { expect(writes).toBe(1); expect(posted).toMatchObject({ reply: { root: { uri: reference.uri, cid: reference.cid }, parent: { uri: reference.uri, cid: reference.cid } } }); expect(operations.deliveries()[0]?.status).toBe('published'); }
});
it('stops further model requests when Pause happens during editorial review', async () => {
  start(); const tasks: string[] = [];
  const llm: LlmClient = { available: () => ({ ready: true }), complete: async request => {
    tasks.push(request.task ?? '');
    const response = request.task === 'operations.review' ? reviewFixture(request) : { message: 'Queueing the article.', actions: [{ tool: 'operations.enqueue', input: copy() }] };
    if (request.task === 'operations.review') operations.pause(product);
    return { text: JSON.stringify(response), model: 'fixture', inputTokens: 0, outputTokens: 0, stopReason: 'stop' };
  } };
  await new GrowthEngine(app, llm).runNext(['marketing']);
  expect(tasks).toEqual(['operations.compose', 'operations.review']); expect(operations.deliveries()).toHaveLength(0); expect(writes).toBe(0); expect(operations.state(product).running).toBe(false);
});
it('returns structural corrections before spending an editorial call and queues only the reviewed revision', async () => {
  start(); let composed = 0, reviewed = 0;
  const llm: LlmClient = { available: () => ({ ready: true }), complete: async request => {
    expect(operations.deliveries()).toHaveLength(0);
    let value: unknown;
    if (request.task === 'operations.review') {
      reviewed++;
      expect(composed).toBe(3);
      value = reviewFixture(request);
    } else {
      composed++;
      expect(request.jsonSchema).toMatchObject({ properties: { actions: { items: { properties: { input: { properties: {
        evidence: { minItems: 1, maxItems: 1, items: { enum: ['https://siplemona.de/'] } },
      } } } } } } });
      if (composed === 2) expect(request.prompt).toContain('cite its returned URL');
      if (composed === 3) { expect(request.prompt).toContain('call-to-action'); expect(request.prompt).toContain('NEW ANGLE REQUIRED'); }
      value = { message: 'Prepare the campaign.', actions: [{ tool: 'operations.enqueue', input: { ...copy(),
        ...(composed === 1 ? { evidence: ['https://example.com/public-question'] } : {}),
        ...(composed === 2 ? { body: 'Useful advice without a product link. '.repeat(30) } : {}),
      } }] };
    }
    return { text: JSON.stringify(value), model: 'fixture', inputTokens: 0, outputTokens: 0, stopReason: 'stop' };
  } };
  await new GrowthEngine(app, llm).runNext(['marketing']);
  expect(reviewed).toBe(1); expect(composed).toBe(3);
  expect(operations.deliveries()).toHaveLength(1); expect(writes).toBe(0);
});
it('preflight creates no delivery or capacity reservation and enqueue rechecks a paused policy', () => {
  start(); const id = task(); observed(); const input = copy();
  operations.preflight(product, id, input); operations.preflight(product, id, input);
  expect(operations.deliveries()).toHaveLength(0);
  expect(input).toEqual(copy());
  operations.pause(product);
  expect(() => operations.enqueue(product, id, input)).toThrow('start this business');
  expect(operations.deliveries()).toHaveLength(0); expect(writes).toBe(0);
});
it('carries rejected research feedback into the next agent cycle after restart', async () => {
  const finding = { id: 'unsupported-question', title: 'An unrelated buyer problem', excerpt: 'A request the product cannot support.', url: 'https://news.ycombinator.com/item?id=123', postedAt: clock.now(), observedAt: clock.now(), query: 'hn:documents', kind: 'hn' as const, requestLanguage: true };
  const begin = () => {
    start(); const state = operations.state(product);
    app.db.update(settings).set({ value: { ...state, discovery: { enabled: true, queries: [{ kind: 'hn', query: 'documents' }] }, demandEvidence: [finding] } }).where(eq(settings.key, `operations.policy.${product}`)).run();
  };
  let replacement = false, checkedHistory = false;
  const llm: LlmClient = { available: () => ({ ready: true }), complete: async request => {
    let value: unknown;
    if (request.task === 'operations.review') value = { ...reviewFixture(request, { supported: replacement }), demandFit: { concreteRequest: true, copyAddressesRequest: true, productCanHelp: replacement, explanation: 'The capability needed for this question is not in the observed source.' } };
    else {
      if (replacement) {
        checkedHistory = true;
        expect(JSON.stringify(request.jsonSchema)).not.toContain(finding.id);
        expect(request.prompt).toContain('"demandEvidence":[]');
        expect(request.prompt).toContain('"editorialFeedback":[{"title":');
        expect(request.prompt).toContain('not in the observed source');
      }
      value = { message: 'Prepare the next useful campaign.', actions: [{ tool: 'operations.enqueue', input: { ...copy(), demand: { findingId: replacement ? 'none' : finding.id, reason: 'A source-based decision for this campaign and business.' } } }] };
    }
    return { text: JSON.stringify(value), model: 'fixture', inputTokens: 0, outputTokens: 0, stopReason: 'stop' };
  } };
  begin(); await new GrowthEngine(app, llm).runNext(['marketing']); expect(operations.deliveries()).toHaveLength(0);
  operations = new OperationsService(app); app.operations = operations;
  clock.advance(3600000); replacement = true; begin(); await new GrowthEngine(app, llm).runNext(['marketing']);
  expect(checkedHistory).toBe(true); expect(operations.deliveries()).toHaveLength(1);
  expect(operations.state(product).demandEvidence).toEqual([finding]); expect(writes).toBe(0);
});
it.each([{ approveReplacement: true, followup: false }, { approveReplacement: false, followup: false }, { approveReplacement: true, followup: true }, { approveReplacement: false, followup: true }])('retains facts and changes a rejected angle (approved: $approveReplacement; follow-up: $followup)', async ({ approveReplacement, followup }) => {
  start();
  const state = operations.state(product);
  const finding = { id: 'unrelated-question', title: 'An unrelated export problem', excerpt: 'A public question is not evidence of a product feature.', url: 'https://news.ycombinator.com/item?id=123', postedAt: clock.now(), observedAt: clock.now(), query: 'hn:documents', kind: 'hn' as const, requestLanguage: true };
  app.db.update(settings).set({ value: { ...state, ...(followup ? { learning: { ...state.learning!, mode: 'test-interest', traffic: { status: 'usable', observedAt: clock.now(), detail: 'Synthetic fixture', accounts: [], reference: { id: 'previous', title: 'Ask a document question', description: 'Read the first answer from a document.', sessions: 40, engagedSessions: 20 } } } } : {}), discovery: { enabled: true, queries: [{ kind: 'hn', query: 'documents' }] }, demandEvidence: [finding] } }).where(eq(settings.key, `operations.policy.${product}`)).run();
  let composed = 0, reviewed = 0;
  const llm: LlmClient = { available: () => ({ ready: true }), complete: async request => {
    if (request.task === 'operations.followup-review') return { text: JSON.stringify({ referenceAction: 'Ask a document question', proposedAction: 'Check the answer against its cited source', relationship: 'follow-up', explanation: 'The body adds a distinct source-verification step.' }), model: 'fixture', inputTokens: 0, outputTokens: 0, stopReason: 'stop' };
    let value: unknown;
    if (request.task === 'operations.review') {
      reviewed++; const approved = approveReplacement && reviewed >= 3;
      value = reviewFixture(request, { supported: approved, explanation: 'This promised outcome is unsupported. '.repeat(20) });
    } else {
      composed++;
      expect(request.prompt).toContain('Work with local documents and check the cited source.');
      const sourceAndHistory = request.prompt.split('SOURCE AND PRIOR ATTEMPTS\n')[1];
      if (sourceAndHistory) expect(() => JSON.parse(sourceAndHistory)).not.toThrow();
      if (composed >= 3) {
        expect(request.prompt).toContain('NEW ANGLE REQUIRED');
        expect(request.prompt).toContain(followup ? 'Keep the reference buyer workflow' : 'Abandon their problem');
        expect(JSON.stringify(request.jsonSchema)).not.toContain('unrelated-question');
        expect(request.prompt).toContain('"demandEvidence":[]');
      }
      value = { message: 'Prepare an evidence-based draft.', actions: [{ tool: 'operations.enqueue', input: { ...copy(),
        ...(composed < 3 ? { body: 'Unsupported old angle. '.repeat(490) + ' https://siplemona.de/' } : {}),
        demand: { findingId: 'none', reason: 'The supplied public question does not fit this verified product task.' },
      } }] };
    }
    return { text: JSON.stringify(value), model: 'fixture', inputTokens: 0, outputTokens: 0, stopReason: 'stop' };
  } };
  await new GrowthEngine(app, llm).runNext(['marketing']);
  expect(reviewed).toBe(approveReplacement ? 3 : 4);
  expect(operations.deliveries()).toHaveLength(approveReplacement ? 1 : 0);
  expect(operations.state(product).demandEvidence).toEqual([finding]);
  expect(writes).toBe(0);
});
it('requires current-cycle product evidence and rejects placeholders, exaggerated claims, or missing calls to action', () => {
  start(); const id = task();
  expect(() => operations.enqueue(product, id, copy())).toThrow('Inspect'); observed();
  expect(() => operations.enqueue(product, id, { ...copy(), body: copy().body + ' Guaranteed results.' })).toThrow('revision');
  expect(() => operations.enqueue(product, id, { ...copy(), body: 'Useful advice without a product link. '.repeat(30) })).toThrow('call-to-action');
  expect(() => operations.enqueue(product, id, { ...copy(), evidence: ['https://cinegenaimedia.com/'] })).toThrow('Inspect');
  expect(writes).toBe(0);
});
it('reserves daily capacity, deduplicates a cycle, and waits for its next scheduled window', () => {
  start(); const id = queue(); expect(operations.enqueue(product, operations.state(product).taskId!, copy()).id).toBe(id);
  const taskId = operations.state(product).taskId; app.db.update(growthTasks).set({ status: 'done' }).where(eq(growthTasks.id, taskId!)).run(); clock.advance(2 * 3600000); operations.schedule();
  expect(operations.state(product).taskId).toBe(taskId); expect(operations.deliveries()).toHaveLength(1);
});
it('persists Run and queued work across service recreation and prevents concurrent dispatch', async () => {
  start(); queue(); operations = new OperationsService(app); app.operations = operations;
  expect(operations.state(product).running).toBe(true);
  await Promise.all([operations.tick(), operations.tick(), new OperationsService(app).tick()]); expect(writes).toBe(1);
});
it('reconciles a lost write response without creating a second publication', async () => {
  start(); queue(); const original = transport.getMockImplementation()!;
  transport.mockImplementation(async (url, init) => { const result = await original(url, init); if (init?.method === 'PUT') throw new Error('connection lost with private-website-key'); return result; });
  await operations.tick(); expect(writes).toBe(1); expect(operations.deliveries()[0]!.status).toBe('retry');
  expect(JSON.stringify(operations.view())).not.toContain('private-website-key');
  clock.advance(180000); operations = new OperationsService(app); app.operations = operations; await operations.tick();
  expect(writes).toBe(1); expect(operations.deliveries()[0]!.status).toBe('published');
});
it('recovers a crashed delivery lease using its original destination identity', async () => {
  start(); queue(); const job = operations.deliveries()[0]!;
  saveJob({ ...job, status: 'dispatching', leaseUntil: clock.now() + 180000, leaseId: 'dead-worker', attempts: 1 });
  await operations.tick(); expect(writes).toBe(0);
  clock.advance(180001); await operations.tick(); expect(writes).toBe(1); expect(operations.deliveries()[0]!.slug).toBe(job.slug);
});
it('pauses before dispatch and cancels unattempted work without sending', async () => {
  start(); const id = queue(); operations.pause(product); await operations.tick(); expect(writes).toBe(0);
  operations.cancel(product, id); operations.run(product); await operations.tick(); expect(writes).toBe(0); expect(operations.deliveries()[0]!.status).toBe('cancelled');
});
it('checks Pause again after a slow destination lookup, before making a write', async () => {
  start(); queue(); let release!: () => void; let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
  const original = transport.getMockImplementation()!;
  transport.mockImplementation(async (url, init) => { if (init?.method === 'GET') { entered(); await new Promise<void>(resolve => { release = resolve; }); } return original(url, init); });
  const running = operations.tick(); await started; operations.pause(product); release(); await running;
  expect(writes).toBe(0); expect(operations.deliveries()[0]!.status).toBe('retry');
});
it('preserves a confirmed receipt even if Pause arrives while a write is accepted', async () => {
  start(); queue(); const original = transport.getMockImplementation()!;
  transport.mockImplementation(async (url, init) => { const result = await original(url, init); if (init?.method === 'PUT') operations.pause(product); return result; });
  await operations.tick(); expect(writes).toBe(1); expect(operations.state(product).running).toBe(false); expect(operations.deliveries()[0]!.status).toBe('published');
});
it('never overwrites unrelated content at the stable website slug', async () => {
  start(); queue(); remote = { ...copy(), slug: operations.deliveries()[0]!.slug, status: 'published', author: 'Another writer' };
  await operations.tick(); expect(writes).toBe(0); expect(operations.deliveries()[0]!.status).toBe('attention');
});
it('holds a disconnected destination and prevents cross-business cancellation', async () => {
  start(); const id = queue(); const other = accounts.view().products[1]!.id;
  expect(() => operations.cancel(other, id)).toThrow('business');
  accounts.disconnect(product, accountId); await operations.tick(); expect(writes).toBe(0); expect(operations.deliveries()[0]!.status).toBe('attention');
});
it('cancels old queued content when the owner saves new operating settings', async () => {
  start(); queue(); operations.configure(product, { objective: 'Demonstrate another customer workflow.', accountIds: [accountId], intervalHours: 6, dailyLimit: 2 });
  expect(operations.state(product).running).toBe(false); expect(operations.deliveries()[0]!.status).toBe('cancelled');
  operations.run(product); await operations.tick(); expect(writes).toBe(0);
});
it('preserves uncertainty across manual retry and requires acknowledgement before stopping attempted work', async () => {
  start(); queue(); transport.mockResolvedValue(new Response('provider body containing private-website-key', { status: 503 }));
  await operations.tick(); const job = operations.deliveries()[0]!;
  expect(() => operations.configure(product, { objective: 'A changed objective for buyers.', accountIds: [accountId], intervalHours: 1, dailyLimit: 2 })).toThrow('Reconcile');
  expect(() => operations.cancel(product, job.id)).toThrow('uncertainty');
  saveJob({ ...job, status: 'attention' }); operations.retry(product, job.id);
  expect(operations.deliveries()[0]!.attempts).toBe(job.attempts);
  expect(() => operations.cancel(product, job.id)).toThrow('uncertainty');
  operations.cancel(product, job.id, true); expect(operations.deliveries()[0]!.detail).toContain('unconfirmed');
  expect(JSON.stringify(operations.view())).not.toContain('private-website-key');
});
it('refuses unchecked negative or absolute privacy copy', () => {
  start(); const id = task(); observed();
  expect(() => operations.enqueue(product, id, { ...copy(), body: copy().body + ' Your raw data never leaves your machine.' })).toThrow('absolute');
  expect(() => operations.enqueue(product, id, { ...copy(), body: copy().body + ' You retain absolute data sovereignty.' })).toThrow('absolute');
});
it('rejects invented business paths even when another call-to-action link is valid', () => {
  start(); const id = task(); observed();
  for (const url of ['https://siplemona.de/our app.', 'https://siplemona.de/unverified-trial', 'https://name@siplemona.de/']) {
    expect(() => operations.preflight(product, id, { ...copy(), body: copy().body + ' ' + url })).toThrow('Do not invent a destination path');
  }
  expect(operations.deliveries()).toHaveLength(0);
});
it('allows inspected business paths with tracking and fragments, but not another cycle\'s inspection', () => {
  start(); const id = task(); observed();
  const input = { ...copy(), body: copy().body + ' https://siplemona.de/docs/?utm_source=signal#start' };
  app.db.insert(marketingToolCalls).values({ id: newId(), productId: product, taskId: 'old-cycle', name: 'product.inspect', status: 'done', result: JSON.stringify({ url: 'https://siplemona.de/docs', body: 'A current guide.' }), createdAt: clock.now() }).run();
  expect(() => operations.preflight(product, id, input)).toThrow('page inspected during this cycle');
  app.db.insert(marketingToolCalls).values({ id: newId(), productId: product, taskId: id, name: 'product.inspect', status: 'done', result: JSON.stringify({ url: 'https://siplemona.de/docs', body: 'A current guide.' }), createdAt: clock.now() }).run();
  expect(() => operations.preflight(product, id, input)).not.toThrow();
});
it.each([
  'Describe your story and generate sequenced shots instantly.',
  'Keep their look and voice consistent across every scene you generate.',
  'Set up your character library once so they appear consistently in every generated scene.',
])('holds observed overclaims before model approval and at the queue boundary: %s', async body => {
  start(); const id = task(); observed();
  const complete = vi.fn(async () => ({ text: JSON.stringify({ approved: true, issues: [], claims: [{ claim: body, quoteId: 'source-1', supported: true }] }), model: 'fixture', inputTokens: 1, outputTokens: 1, stopReason: 'stop' as const }));
  const input = { ...copy(), description: body };
  await expect(reviewOperationCopy(app, product, id, input, { available: () => ({ ready: true }), complete }, 'fixture')).rejects.toThrow('Editorial review requires revision');
  expect(complete).not.toHaveBeenCalled();
  expect(() => operations.enqueue(product, id, input)).toThrow('promise');
  expect(operations.deliveries()).toHaveLength(0);
});
it('does not treat a malformed lookup or a reflected provider body as a safe missing article', async () => {
  start(); queue(); transport.mockResolvedValue(new Response('private-website-key', { status: 404 }));
  await operations.tick(); expect(writes).toBe(0); expect(operations.deliveries()[0]!.status).toBe('retry');
  expect(JSON.stringify(operations.view())).not.toContain('private-website-key');
});
it('requires an independent editorial verdict with actual source quotations before accepting its claims', async () => {
  start(); const id = task(); observed();
  let options = { quoteId: 'invented-source', supported: true, explanation: 'The observed source supports this exact passage.' };
  const llm: LlmClient = { available: () => ({ ready: true }), complete: async request => ({ text: JSON.stringify(reviewFixture(request, options)), model: 'fixture', inputTokens: 1, outputTokens: 1, stopReason: 'stop' }) };
  await expect(reviewOperationCopy(app, product, id, copy(), llm, 'fixture')).rejects.toThrow('not present');
  options = { quoteId: 'source-1', supported: false, explanation: 'The cited passage does not describe source checking.' };
  await expect(reviewOperationCopy(app, product, id, copy(), llm, 'fixture')).rejects.toThrow('unsupported claim in title-1: "Find the source behind your answer"');
  options.supported = true;
  const result = await reviewOperationCopy(app, product, id, copy(), llm, 'fixture');
  expect(result.approved).toBe(true);
  expect(result.claims[0]).toMatchObject({ claim: copy().title, passageId: 'title-1', quote: 'Current source text.' });
  expect(result.claims.every(claim => [copy().title, copy().description, copy().body].some(text => text.includes(claim.claim)))).toBe(true);
});
it.each(['missing', 'duplicate', 'invented', 'empty', 'missing-evidence', 'nonfactual-evidence', 'all-nonfactual', 'duplicate-evidence', 'invented-claim'] as const)('holds a structurally invalid passage review without treating it as editorial rejection: %s', problem => {
  start(); const id = task(); observed();
  const llm: LlmClient = { available: () => ({ ready: true }), complete: async request => {
    const value = reviewFixture(request);
    if (problem === 'missing') value.checks.pop();
    if (problem === 'duplicate') value.checks[1] = value.checks[0]!;
    if (problem === 'invented') value.checks[0]!.passageId = 'not-in-the-copy';
    if (problem === 'empty') value.checks = [];
    if (problem === 'missing-evidence') value.checks[0]!.quoteIds = [];
    if (problem === 'nonfactual-evidence') value.checks[0]!.verdict = 'nonfactual';
    if (problem === 'all-nonfactual') value.checks.forEach(check => { check.verdict = 'nonfactual'; check.quoteIds = []; });
    if (problem === 'duplicate-evidence') value.checks[0]!.quoteIds = ['source-1', 'source-1'];
    const result = problem === 'invented-claim' ? { ...value, claims: [{ claim: 'Free unrestricted exports for everyone' }] } : value;
    return { text: JSON.stringify(result), model: 'fixture', inputTokens: 0, outputTokens: 0, stopReason: 'stop' };
  } };
  return expect(reviewOperationCopy(app, product, id, copy(), llm, 'fixture')).rejects.toThrow(/^Editorial review (?!requires revision:)/);
});
it('requires a separate concrete-request and product-fit verdict for public research', async () => {
  start(); const id = task(); observed();
  const finding = { id: 'public-question', title: 'How do I compare local documents?', excerpt: 'Looking for a way to check the source of document answers.', url: 'https://news.ycombinator.com/item?id=123', query: 'hn:documents', kind: 'hn', requestLanguage: true, postedAt: clock.now(), observedAt: clock.now() };
  app.db.update(settings).set({ value: { ...operations.state(product), demandEvidence: [finding] } }).where(eq(settings.key, 'operations.policy.' + product)).run();
  const input = { ...copy(), demand: { findingId: finding.id, reason: 'The reader wants to check the original source of a document answer.' } };
  let fit: { concreteRequest: boolean; copyAddressesRequest: boolean; productCanHelp: boolean; explanation: string } | undefined;
  const llm: LlmClient = { available: () => ({ ready: true }), complete: async request => ({ text: JSON.stringify({ ...reviewFixture(request), ...(fit ? { demandFit: fit } : {}) }), model: 'fixture', inputTokens: 1, outputTokens: 1, stopReason: 'stop' }) };
  await expect(reviewOperationCopy(app, product, id, input, llm, 'fixture')).rejects.toThrow('did not assess');
  for (const field of ['concreteRequest', 'copyAddressesRequest', 'productCanHelp']) {
    fit = { concreteRequest: true, copyAddressesRequest: true, productCanHelp: true, explanation: 'The writer forced a connection to a broad topic.', [field]: false };
    await expect(reviewOperationCopy(app, product, id, input, llm, 'fixture')).rejects.toThrow('forced a connection');
  }
  fit = { concreteRequest: true, copyAddressesRequest: true, productCanHelp: true, explanation: 'This request and supported product task both concern source checking.' };
  await expect(reviewOperationCopy(app, product, id, input, llm, 'fixture')).resolves.toMatchObject({ demandFit: { concreteRequest: true } });
  fit = undefined;
  await expect(reviewOperationCopy(app, product, id, { ...input, demand: { ...input.demand, findingId: 'none' } }, llm, 'fixture')).resolves.toMatchObject({ approved: true });
});
it('reviews capabilities and qualifications beyond the first 32 sentences using the complete current source', async () => {
  start(); const id = task(); observed();
  const body = 'A short navigation or introduction sentence. '.repeat(45) + 'Lemonade creates editable Word documents and Excel workbooks with working formulas. Optional web and email tools connect only with permission.';
  app.db.insert(marketingToolCalls).values({ id: newId(), productId: product, taskId: id, name: 'product.inspect', status: 'done', result: JSON.stringify({ url: 'https://siplemona.de/', body }), createdAt: clock.now() }).run();
  const complete = vi.fn<LlmClient['complete']>(async request => {
    const excerpts = JSON.parse(request.prompt.split('CURRENT_SOURCE_TEXT: ')[1]!.split('\nPUBLIC_DEMAND:')[0]!) as { id: string; quote: string }[];
    expect(excerpts.some(e => e.quote.includes('Optional web and email tools connect only with permission.'))).toBe(true);
    expect(excerpts.some(e => e.quote.includes('Current source text.'))).toBe(false);
    expect(excerpts.every(e => body.includes(e.quote))).toBe(true);
    const source = excerpts.find(e => e.quote.includes('Lemonade creates editable Word documents and Excel workbooks with working formulas.'));
    expect(source).toBeDefined();
    return { text: JSON.stringify(reviewFixture(request, { quoteId: source!.id })), model: 'fixture', inputTokens: 0, outputTokens: 0, stopReason: 'stop' };
  });
  const result = await reviewOperationCopy(app, product, id, copy(), { complete, available: () => ({ ready: true }) }, 'fixture');
  expect(result.claims[0]!.quote).toContain('working formulas'); expect(complete).toHaveBeenCalledOnce();
});
it.each(['build-on', 'test-interest'] as const)('requires independent follow-up fit for a %s selection instead of approving a factual paraphrase', async mode => {
  start(); const id = task(); observed(); const state = operations.state(product);
  const reference = { id: 'prior', title: 'Ask a question across source documents', description: 'Ask across your document library and read the answer.' };
  const learning = { ...state.learning!, mode, ...(mode === 'build-on' ? { reference: { ...reference, retainedPayments: 3 } } : { traffic: { status: 'usable' as const, detail: 'Synthetic observation', observedAt: clock.now(), accounts: [], reference: { ...reference, sessions: 30, engagedSessions: 20 } } }) };
  app.db.update(settings).set({ value: { ...state, learning } }).where(eq(settings.key, `operations.policy.${product}`)).run();
  let fit: unknown; let supported = true; let pause = false; const complete = vi.fn<LlmClient['complete']>(async request => {
    if (request.task === 'operations.followup-review') {
      expect(request.prompt).toContain('REFERENCE_CAMPAIGN:'); expect(request.prompt).toContain(reference.title);
      return { text: JSON.stringify(fit ?? {}), model: 'fixture', inputTokens: 0, outputTokens: 0, stopReason: 'stop' };
    }
    expect(request.task).toBe('operations.review'); expect(request.prompt).not.toContain('REFERENCE_CAMPAIGN:');
    if (pause) operations.pause(product);
    return { text: JSON.stringify(reviewFixture(request, { supported })), model: 'fixture', inputTokens: 0, outputTokens: 0, stopReason: 'stop' };
  });
  const llm = { complete, available: () => ({ ready: true }) };
  await expect(reviewOperationCopy(app, product, id, copy(), llm, 'fixture')).rejects.toThrow('did not assess');
  fit = { referenceAction: 'Ask across documents', proposedAction: 'Ask a question across documents', relationship: 'repeat', explanation: 'This repeats the same basic document question workflow.' };
  await expect(reviewOperationCopy(app, product, id, copy(), llm, 'fixture')).rejects.toThrow('repeats the same');
  fit = { referenceAction: 'Ask across documents', proposedAction: 'Generate a video', relationship: 'unrelated', explanation: 'The public body switches to an unrelated buyer problem.' };
  await expect(reviewOperationCopy(app, product, id, copy(), llm, 'fixture')).rejects.toThrow('unrelated buyer problem');
  fit = { referenceAction: 'Ask across documents', proposedAction: 'Check the answer against its source', relationship: 'follow-up', explanation: 'The body adds a distinct source-verification step.' };
  await expect(reviewOperationCopy(app, product, id, copy(), llm, 'fixture')).resolves.toMatchObject({ selectionFit: fit });
  const comparisons = complete.mock.calls.filter(([request]) => request.task === 'operations.followup-review').length;
  supported = false; await expect(reviewOperationCopy(app, product, id, copy(), llm, 'fixture')).rejects.toThrow('unsupported claim');
  supported = true; pause = true; await expect(reviewOperationCopy(app, product, id, copy(), llm, 'fixture')).rejects.toThrow('operation changed');
  expect(complete.mock.calls.filter(([request]) => request.task === 'operations.followup-review')).toHaveLength(comparisons);
});
it('refuses an oversized editorial evidence set rather than silently omitting facts', async () => {
  start(); const id = task();
  app.db.insert(marketingToolCalls).values({ id: newId(), productId: product, taskId: id, name: 'product.inspect', status: 'done', result: JSON.stringify({ url: 'https://siplemona.de/', body: 'x'.repeat(12001) }), createdAt: clock.now() }).run();
  const complete = vi.fn<LlmClient['complete']>();
  await expect(reviewOperationCopy(app, product, id, copy(), { complete, available: () => ({ ready: true }) }, 'fixture')).rejects.toThrow('review window');
  expect(complete).not.toHaveBeenCalled();
});
it.each(["It doesn't send your documents out.", 'Work without the associated data risks.'])('rejects observed absolute-risk wording: %s', phrase => {
  start(); const id = task(); observed(); expect(() => operations.enqueue(product, id, { ...copy(), body: copy().body + '\n' + phrase })).toThrow('absolute data-transfer');
});
it('implements Bluesky TID records, link facets, and retries by reading the same record', async () => {
  let record: Record<string, unknown> | null = null; let recordUri = ''; let posts = 0;
  const send: typeof fetch = async (url, init) => {
    const path = String(url);
    if (path.includes('createSession')) return Response.json({ accessJwt: 'bsky-access', refreshJwt: 'bsky-refresh' });
    if (path.includes('getSession')) return Response.json({ did: 'did:plc:ownedaccount', handle: 'owned.bsky.social' });
    if (path.includes('getRecord')) return record ? Response.json({ uri: recordUri, value: record }) : Response.json({ error: 'RecordNotFound' }, { status: 400 });
    if (path.includes('createRecord')) { posts++; const input = JSON.parse(String(init?.body)); expect(input.rkey).toMatch(/^[234567a-z]{13}$/); record = input.record; recordUri = `at://did:plc:ownedaccount/app.bsky.feed.post/${input.rkey}`; throw new Error('lost response'); }
    throw new Error('Unexpected endpoint');
  };
  accounts = new ConnectionService(app, vault, undefined, send); app.connections = accounts;
  await accounts.connect({ productId: product, provider: 'bluesky', credential: 'app-password', username: 'owned.bsky.social', label: 'Bluesky' });
  accountId = accounts.accounts().find(a => a.provider === 'bluesky')!.id;
  start(); const id = task(); observed();
  expect(() => operations.enqueue(product, id, { ...copy(), body: 'Our app: ' + 'Useful specific task. '.repeat(11) + 'https://siplemona.de/' })).toThrow('tracked campaign link');
  expect(operations.deliveries()).toHaveLength(0);
  operations.enqueue(product, id, { ...copy(), body: 'Our product helps you check the source behind a document answer. Start with a familiar question: https://siplemona.de/' });
  await operations.tick(); expect(posts).toBe(1); expect(record).toHaveProperty('facets'); clock.advance(180000); await operations.tick();
  expect(posts).toBe(1); expect(operations.deliveries()[0]!.receipt?.id).toBe(recordUri);
});
