import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp, type App } from '../../src/core/app.js';
import { fixedClock } from '../../src/core/lib/clock.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { addEngineeringRequest, budget, DEFAULT_MARKETING, initializeMarketing, marketingView, queueMarketing, recall, remember, saveMarketingSettings } from '../../src/core/marketing/store.js';
import { marketingAction } from '../../src/core/marketing/actions.js';
import { executeMarketingTool } from '../../src/core/marketing/agent.js';
import { GrowthEngine } from '../../src/core/growth/engine.js';
import { ScriptedLlmClient } from '../../src/core/llm/client.js';
import { growthExperiments, growthTasks, marketingCash, marketingMemory } from '../../src/core/db/schema.js';
import { DEFAULT_GOAL } from '../../src/core/growth/store.js';
import { parseWorkflow } from '../../src/core/marketing/comfy.js';
import { publicPage } from '../../src/core/marketing/web.js';

let app: App;
beforeEach(() => { app = createApp({ databaseUrl: ':memory:', clock: fixedClock(1800000000000), logger: silentLogger }); initializeMarketing(app); });
afterEach(() => app.close());
const product = () => marketingView(app).products[0]!;
const request = { title: 'Useful demo export', problem: 'A recorded onboarding observation needs a reusable demonstration.', rationale: 'A demo unblocks a zero-cost tutorial experiment.', acceptance: ['Export one real walkthrough with a verifiable product version.'], evidence: ['Owner interview note'], workaround: 'Record it manually', metric: 'Qualified onboarding completions', priority: 'now' as const, channelKey: 'content' };
function winner() {
  const p = product();
  const channel = app.dbHandle.raw.prepare('select id from growth_channels where product_id = ? limit 1').get(p.id) as { id: string };
  app.db.insert(growthExperiments).values({ id: 'win1', productId: p.id, channelId: channel.id, title: 'Measured organic test', goal: DEFAULT_GOAL, status: 'completed', trackedUrl: 'https://example.com', result: { visitors: 120, leads: 20, customers: 4, spendCents: 0, revenueCents: 100000, audienceFit: 'good', source: 'Owned purchase report', notes: '' } }).run();
}
describe('local marketing operator', () => {
  it('starts at zero, seeds sourced proposals once and does not turn experiment revenue into spendable cash', () => {
    const before = marketingView(app);
    initializeMarketing(app);
    expect(marketingView(app).requests).toHaveLength(before.requests.length);
    expect(budget(app, product().id).availableCents).toBe(0);
    winner();
    expect(budget(app, product().id)).toMatchObject({ availableCents: 0, tier: 'organic' });
  });
  it('funds, reserves, settles, and contracts the envelope without duplicate cash or double-counted commitments', async () => {
    const p = product(); winner();
    saveMarketingSettings(app, { ...DEFAULT_MARKETING, capCents: 10000 });
    await marketingAction(app, { type: 'cash', productId: p.id, value: { kind: 'settled_surplus', amountCents: 100000, reference: 'payout-1', note: 'After fees, costs and obligations' } });
    expect(budget(app, p.id)).toMatchObject({ availableCents: 10000, tier: 'funded-tests' });
    await expect(marketingAction(app, { type: 'cash', productId: p.id, value: { kind: 'settled_surplus', amountCents: 100000, reference: 'payout-1', note: 'Duplicate' } })).rejects.toThrow('already');
    await marketingAction(app, { type: 'reserve', productId: p.id, amountCents: 3000, reference: 'test-1', note: 'Concrete funded test' });
    expect(budget(app, p.id).availableCents).toBe(7000);
    await marketingAction(app, { type: 'cash', productId: p.id, value: { kind: 'spend', amountCents: 3000, reference: 'test-1', note: 'Actual test expense' } });
    expect(budget(app, p.id)).toMatchObject({ availableCents: 7000, committedCents: 0, spentCents: 3000 });
    await marketingAction(app, { type: 'cash', productId: p.id, value: { kind: 'adjustment', amountCents: 90000, reference: 'refund-1', note: 'Surplus adjustment' } });
    expect(budget(app, p.id)).toMatchObject({ availableCents: 0, tier: 'organic' });
  });
  it('rejects unfunded reservations and keeps products cash-isolated', async () => {
    const [a, b] = marketingView(app).products;
    await marketingAction(app, { type: 'cash', productId: a!.id, value: { kind: 'settled_surplus', amountCents: 100000, reference: 'p1', note: 'Confirmed surplus' } });
    expect(budget(app, b!.id).availableCents).toBe(0);
    await expect(marketingAction(app, { type: 'reserve', productId: a!.id, amountCents: 1, reference: 'r1', note: 'No validated organic test yet' })).rejects.toThrow('cash tier');
  });
  it('keeps hypotheses separate, scopes retrieval, corrects graph history, and forgets active content', async () => {
    const [a, b] = marketingView(app).products;
    const first = remember(app, a!.id, { title: 'Old offer', body: 'Special trial is seven days', kind: 'observation', source: 'Owner verification', confidence: 1 });
    const next = remember(app, a!.id, { title: 'Corrected offer', body: 'The verified trial is fourteen days', kind: 'observation', source: 'Owner correction', confidence: 1, supersedesId: first });
    expect(recall(app, a!.id, 'trial').memories.some((m) => m.id === first)).toBe(false);
    expect(recall(app, b!.id, 'trial').memories.some((m) => m.id === next)).toBe(false);
    expect(marketingView(app).edges.some((e) => e.fromId === next && e.toId === first && e.relation === 'supersedes')).toBe(true);
    await marketingAction(app, { type: 'forget', productId: a!.id, id: next });
    expect(app.db.select().from(marketingMemory).where(eq(marketingMemory.id, next)).get()?.body).toBe('');
    expect(recall(app, a!.id, 'trial').memories.some((m) => m.id === next)).toBe(false);
    await executeMarketingTool(app, a!.id, 'memory.remember', { title: 'Maybe useful', body: 'An unverified demand idea', kind: 'product', source: 'model', confidence: 1 }, new AbortController().signal);
    expect(recall(app, a!.id, 'unverified').memories.find((m) => m.title === 'Maybe useful')).toMatchObject({ kind: 'hypothesis', confidence: 0.6 });
  });
  it('deduplicates engineering requests and creates an evidence-bearing memory connection', () => {
    const p = product(); const first = addEngineeringRequest(app, p.id, request); const second = addEngineeringRequest(app, p.id, { ...request, title: 'Useful Demo Export!' });
    expect(second).toEqual({ id: first.id, duplicate: true });
    expect(recall(app, p.id, 'demo export').memories.some((m) => m.source === `engineering:${first.id}`)).toBe(true);
  });
  it('executes a local tool cycle with audited outcomes and conversational completion', async () => {
    const p = product(); const id = queueMarketing(app, p.id, 'Prepare a concrete engineering request for a real demo.');
    const llm = new ScriptedLlmClient([JSON.stringify({ message: 'I’ll capture the demo requirement.', actions: [{ tool: 'engineering.add', input: request }] }), JSON.stringify({ message: 'The demo request is ready for engineering. It starts with a manual recording.', actions: [] })]);
    await new GrowthEngine(app, llm).runNext(['marketing']);
    expect(app.db.select().from(growthTasks).where(eq(growthTasks.id, id)).get()?.status).toBe('done');
    expect(marketingView(app).tools[0]?.name).toBe('engineering.add');
    expect(marketingView(app).messages.at(-1)?.body).toContain('ready for engineering');
    expect(llm.calls[0]?.prompt).toContain('untrusted reference data');
    expect(app.db.select().from(marketingCash).all()).toHaveLength(0);
  });
  it('requires a real publication URL and approval without treating a saved draft as sent', async () => {
    const p = product();
    await executeMarketingTool(app, p.id, 'draft.save', { title: 'Helpful reply', body: 'Here is a useful way to inspect local model memory requirements.', kind: 'reply', targetUrl: '', evidence: ['Owner observation'] }, new AbortController().signal);
    const draft = marketingView(app).drafts[0]!;
    expect(draft.status).toBe('draft');
    await expect(marketingAction(app, { type: 'draftStatus', productId: p.id, id: draft.id, status: 'published', publishedUrl: 'https://example.com/post' })).rejects.toThrow('Approve');
  });
  it('does not report an automatic cycle as done when the model only asks questions', async () => {
    const p = product(); const id = queueMarketing(app, p.id, 'Run our next marketing cycle.');
    const answer = JSON.stringify({ message: 'What should I work on?', actions: [] });
    await new GrowthEngine(app, new ScriptedLlmClient([answer, answer, answer, answer])).runNext(['marketing']);
    expect(app.db.select().from(growthTasks).where(eq(growthTasks.id, id)).get()).toMatchObject({ status: 'failed' });
    expect(marketingView(app).drafts).toHaveLength(0);
  });
  it('rejects remote API workflows and private network reads', async () => {
    expect(() => parseWorkflow({ '1': { class_type: 'API', inputs: { api_key: 'example' } } })).toThrow('local workflow');
    await expect(publicPage(app, 'https://127.0.0.1/')).rejects.toThrow('Private network');
    await expect(publicPage(app, 'http://example.com/')).rejects.toThrow('public HTTPS');
  });
});
