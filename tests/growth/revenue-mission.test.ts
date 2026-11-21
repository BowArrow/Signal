import { afterEach, beforeEach, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp, type App } from '../../src/core/app.js';
import { fixedClock } from '../../src/core/lib/clock.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { settings, growthTasks } from '../../src/core/db/schema.js';
import { LEMONADE_MISSION, scoreMission } from '../../src/shared/revenue-mission.js';
import type { RevenuePayment, RevenueState } from '../../src/shared/revenue.js';
import { marketingView } from '../../src/core/marketing/store.js';
import { marketingAction } from '../../src/core/marketing/actions.js';
import { codexGuideTaskIds, missionView, queueMissionReview, reserveCodexCall, saveMission, scheduleMissionReviews } from '../../src/core/marketing/mission.js';
import { GrowthEngine } from '../../src/core/growth/engine.js';
import { ScriptedLlmClient } from '../../src/core/llm/client.js';

const now = Date.parse('2026-10-13T12:00:00-07:00');
const state: RevenueState = { productId: 'lemon', accountId: 'stripe', stripeProductIds: ['lemonade'], since: LEMONADE_MISSION.startsAt, live: true, revision: 1, cursor: '', scanStartedAt: null, lastAttemptAt: now, lastCompleteAt: now, scanned: 0, excluded: 0, status: 'current', detail: 'Current' };
const payment = (extra: Partial<RevenuePayment> = {}): RevenuePayment => ({ id: 'payment', productId: 'lemon', accountId: 'stripe', live: true, currency: 'usd', captured: 4900, refunded: 0, disputed: false, createdAt: now, observedAt: now, campaignId: null, attribution: 'unknown', ...extra });
it('counts only actual in-period USD collections, deduplicates, reverses refunds and holds disputes', () => {
  const rows = [payment(), payment({ observedAt: now + 1, refunded: 900 }), payment({ id: 'test', live: false }), payment({ id: 'other', productId: 'cinegen' }), payment({ id: 'other-account', accountId: 'other' }), payment({ id: 'old', createdAt: LEMONADE_MISSION.startsAt - 1 }), payment({ id: 'deadline', createdAt: LEMONADE_MISSION.endsAt }), payment({ id: 'future', createdAt: now + 1 }), payment({ id: 'euro', currency: 'eur' }), payment({ id: 'disputed', disputed: true })];
  expect(scoreMission(LEMONADE_MISSION, 'lemon', state, rows, now)).toMatchObject({ observedCents: 4000, payments: 1, excludedCurrency: 1, disputedCents: 4900, verified: true, reached: false });
});
it('never declares success from missing, partial, stale or incomplete history', () => {
  const rows = [payment({ captured: 10000000 })];
  for (const bad of [undefined, { ...state, status: 'partial' as const }, { ...state, live: false }, { ...state, since: now }, { ...state, lastCompleteAt: now - 86400001 }]) expect(scoreMission(LEMONADE_MISSION, 'lemon', bad, rows, now).reached).toBe(false);
  expect(scoreMission(LEMONADE_MISSION, 'lemon', state, rows, now).reached).toBe(true);
});
it('scores the complete ledger beyond the 300-payment UI limit and respects Pacific DST boundaries', () => {
  const rows = Array.from({ length: 2041 }, (_, i) => payment({ id: String(i) }));
  expect(scoreMission(LEMONADE_MISSION, 'lemon', state, rows, now)).toMatchObject({ observedCents: 10000900, reached: true, remainingCents: 0 });
  expect(new Date(LEMONADE_MISSION.startsAt).toISOString()).toBe('2026-10-13T07:00:00.000Z');
  expect(new Date(LEMONADE_MISSION.endsAt).toISOString()).toBe('2027-01-01T08:00:00.000Z');
});

let app: App;
beforeEach(() => { app = createApp({ databaseUrl: ':memory:', clock: fixedClock(now), logger: silentLogger }); });
afterEach(() => app.close());
function setup() {
  const product = marketingView(app).products[0]!;
  app.db.insert(settings).values({ key: `marketing.codex.${product.id}`, value: { model: 'test-codex', verifiedAt: now, detail: 'Fixture' } }).run();
  saveMission(app, product.id, LEMONADE_MISSION);
  return product;
}
it('persists the mission for one business and queues at most one guarded daily review', () => {
  const product = setup();
  scheduleMissionReviews(app); scheduleMissionReviews(app);
  const view = marketingView(app);
  expect(view.missions).toHaveLength(1);
  expect(view.missions![0]!.score.verified).toBe(false);
  expect(view.tasks).toHaveLength(1);
  expect(codexGuideTaskIds(app)).toEqual([view.tasks[0]!.id]);
  expect(missionView(app, product.id)?.nextReviewAt).toBe(now + 86400000);
  expect(view.guideTaskIds).toContain(view.tasks[0]!.id);
});
it('honors paused, future, expired and offline missions', () => {
  const product = setup();
  for (const value of [{ ...LEMONADE_MISSION, active: false }, { ...LEMONADE_MISSION, startsAt: now + 1 }, { ...LEMONADE_MISSION, endsAt: now - 1 }]) {
    saveMission(app, product.id, value); scheduleMissionReviews(app);
    expect(codexGuideTaskIds(app)).toHaveLength(0);
  }
  saveMission(app, product.id, LEMONADE_MISSION);
  const offline = { ...app, env: { ...app.env, SIGNAL_OFFLINE: '1' as const } };
  scheduleMissionReviews(offline); expect(codexGuideTaskIds(app)).toHaveLength(0);
});
it('runs only the selected Codex task while other local-model work is queued', async () => {
  const product = setup();
  await marketingAction(app, { type: 'chat', productId: product.id, message: 'Existing local job' });
  const localId = marketingView(app).tasks[0]!.id;
  await marketingAction(app, { type: 'guide-chat', productId: product.id, message: 'Review the revenue mission.' });
  const ids = codexGuideTaskIds(app);
  const llm = new ScriptedLlmClient([JSON.stringify({ message: 'Verify live revenue first.', actions: [] })]);
  await new GrowthEngine(app, llm).runNext(['marketing'], ids);
  expect(app.db.select().from(growthTasks).where(eq(growthTasks.id, localId)).get()?.status).toBe('queued');
  expect(app.db.select().from(growthTasks).where(eq(growthTasks.id, ids[0]!)).get()?.status).toBe('done');
  expect(llm.calls[0]?.prompt).toContain('10000000');
});
it('limits Codex calls durably per business and refuses duplicate mission work', () => {
  const p = setup();
  for (let i = 0; i < 20; i++) reserveCodexCall(app, p.id);
  expect(() => reserveCodexCall(app, p.id)).toThrow('daily limit');
  queueMissionReview(app, p.id);
  expect(() => queueMissionReview(app, p.id)).toThrow('Let the saved');
});
