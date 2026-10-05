import { afterEach, beforeEach, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp, type App } from '../../src/core/app.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { studioAction, studioView, exportCampaign, creativePromptNeedsRepair, copyWarnings } from '../../src/core/studio/store.js';
import { studioAssets, growthTasks } from '../../src/core/db/schema.js';
import { GrowthEngine } from '../../src/core/growth/engine.js';
import { ScriptedLlmClient } from '../../src/core/llm/client.js';
import { budget } from '../../src/core/marketing/store.js';
import { PLAYBOOKS } from '../../src/shared/playbooks.js';
import { CHANNELS } from '../../src/shared/growth.js';

let app: App;
beforeEach(() => { app = createApp({ databaseUrl: ':memory:', logger: silentLogger }); });
afterEach(() => app.close());
function campaign() {
  const product = studioView(app).products[0]!;
  studioAction(app, { type: 'campaign', productId: product.id, value: { title: 'First customer tutorial', channel: 'content', objective: 'Help one buyer complete a real workflow', audience: product.brand.audience, offer: product.brand.offer, formats: ['social', 'video-script'] } });
  return { product, campaign: studioView(app).campaigns[0]! };
}
const copy = (title: string) => ({ title, body: 'I build this product. Here is a concrete workflow to try: choose your input, inspect the result, and save the useful output. Tell us where you got stuck so we can help.', rationale: 'A useful demonstration tests buyer interest.', evidence: ['Owner product profile'], reviewNotes: ['Verify the product steps before publication.'] });
it('has an executable playbook for every channel', () => { expect(new Set(PLAYBOOKS.map(p => p.channel))).toEqual(new Set(CHANNELS.map(c => c[0]))); expect(PLAYBOOKS.every(p => p.steps.length >= 4 && p.materials.length > 0)).toBe(true); });
it('catches generated product interfaces while allowing explicit negative constraints', () => {
  expect(creativePromptNeedsRepair('A three-panel screenshot composite of the interface.')).toBe(true);
  expect(creativePromptNeedsRepair('A closed notebook on a quiet desk.\nNegative: no UI or screenshots.')).toBe(false);
  expect(copyWarnings('Nothing leaves your computer.')).toContain('Qualify absolute privacy claims. Distinguish local inference from setup, licensing, and optional network tools.');
  expect(copyWarnings('Model inference runs locally. Setup and approved tools can use the network.')).toEqual([]);
});
it('generates durable formats and resumes after a failure without overwriting completed copy', async () => {
  const { product, campaign: c } = campaign();
  studioAction(app, { type: 'generate', productId: product.id, id: c.id });
  const llm = new ScriptedLlmClient([JSON.stringify(copy('Social')), 'bad json', 'bad json']);
  await new GrowthEngine(app, llm).runNext(['studio']);
  expect(studioView(app).assets).toHaveLength(1);
  expect(studioView(app).campaigns[0]!.task!.status).toBe('failed');
  studioAction(app, { type: 'generate', productId: product.id, id: c.id });
  await new GrowthEngine(app, new ScriptedLlmClient([JSON.stringify(copy('Script'))])).runNext(['studio']);
  const state = studioView(app);
  expect(state.assets).toHaveLength(2);
  expect(state.assets.every(a => a.status === 'draft' && a.copy.body.includes(c.trackedUrl))).toBe(true);
  expect(exportCampaign(app, product.id, c.id)).toContain('Script');
  expect(() => studioAction(app, { type: 'generate', productId: product.id, id: c.id })).toThrow('All requested');
});
it('repairs invented interface prompts before saving render-ready material', async () => {
  const product = studioView(app).products[0]!;
  studioAction(app, { type: 'campaign', productId: product.id, value: { title: 'Brand image', channel: 'content', objective: 'Illustrate private document work', audience: product.brand.audience, offer: product.brand.offer, formats: ['image-prompt'] } });
  const c = studioView(app).campaigns[0]!;
  studioAction(app, { type: 'generate', productId: product.id, id: c.id });
  const bad = { ...copy('Bad image'), body: 'Create a detailed product screenshot showing a file explorer and a dashboard with legible interface labels and prompt boxes.' };
  const good = { ...copy('Quiet desk'), body: 'A closed cream notebook, a silver desktop computer, and a small lemon on a warm wood desk. Soft window light, editorial photography, blank space at the top left. No text or logos.' };
  await new GrowthEngine(app, new ScriptedLlmClient([JSON.stringify(bad), JSON.stringify(good)])).runNext(['studio']);
  expect(studioView(app).assets).toHaveLength(1);
  expect(studioView(app).assets[0]!.copy.body).toBe(good.body);
});
it('prevents cross-product changes, requires explicit review, and resets approval on edits', () => {
  const { product, campaign: c } = campaign();
  app.db.insert(studioAssets).values({ id: 'asset', productId: product.id, campaignId: c.id, kind: 'social', copy: copy('Draft') }).run();
  const other = studioView(app).products[1]!;
  expect(() => studioAction(app, { type: 'edit', productId: other.id, id: 'asset', body: copy('x').body })).toThrow('not found');
  expect(() => studioAction(app, { type: 'review', productId: product.id, id: 'asset', approved: true, checks: ['claims'] })).toThrow('Verify');
  studioAction(app, { type: 'review', productId: product.id, id: 'asset', approved: true, checks: ['claims', 'voice', 'destination'] });
  studioAction(app, { type: 'edit', productId: product.id, id: 'asset', body: `${copy('x').body} Additional detail.` });
  expect(studioView(app).assets[0]!.status).toBe('draft');
  expect(() => studioAction(app, { type: 'published', productId: product.id, id: 'asset', url: 'https://example.org/post', note: 'Recorded publication' })).toThrow('Approve');
});
it('imports outcomes idempotently and atomically without turning revenue into spendable cash', () => {
  const { product, campaign: c } = campaign();
  const sale = { reference: 'payment-1', campaignId: c.id, kind: 'sale', count: 1, amountCents: 4900, source: 'Owner payment export', occurredAt: app.clock.now() };
  const action = { type: 'outcomes', productId: product.id, values: [sale] };
  studioAction(app, action); studioAction(app, action);
  expect(studioView(app).campaigns[0]!.totals).toMatchObject({ sales: 1, revenueCents: 4900 });
  expect(budget(app, product.id).availableCents).toBe(0);
  expect(() => studioAction(app, { ...action, values: [{ ...sale, reference: 'payment-2' }, { ...sale, amountCents: 999 }] })).toThrow('different data');
  expect(studioView(app).outcomes).toHaveLength(1);
});
it('discards an in-flight generation after cancellation', async () => {
  const { product, campaign: c } = campaign(); studioAction(app, { type: 'generate', productId: product.id, id: c.id });
  const llm = { available: () => ({ ready: true }), complete: async () => { app.db.update(growthTasks).set({ status: 'cancelled' }).where(eq(growthTasks.targetId, c.id)).run(); return { text: JSON.stringify(copy('late')), model: 'test', inputTokens: 1, outputTokens: 1, stopReason: 'stop' }; } };
  await new GrowthEngine(app, llm).runNext(['studio']); expect(studioView(app).assets).toHaveLength(0);
});
