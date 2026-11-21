import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp, type App } from '../../src/core/app.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { growthTasks, marketingToolCalls, settings } from '../../src/core/db/schema.js';
import { OperationsService } from '../../src/core/operations/service.js';
import { marketingView } from '../../src/core/marketing/store.js';
import { scheduleAcquisitionRecovery, assertRecoveryActive, validateRecoveryDraft } from '../../src/core/marketing/acquisition-recovery.js';
import { salesDiagnosis } from '../../src/core/marketing/sales-diagnosis.js';
import { executeMarketingTool } from '../../src/core/marketing/agent.js';
import { GrowthEngine } from '../../src/core/growth/engine.js';
import { growthSettings, applyGrowthAction } from '../../src/core/growth/store.js';
import { draftInputSchema, marketingActionSchema } from '../../src/shared/marketing.js';

let app: App, productId: string, otherId: string, now: number;
const put = (key: string, value: unknown) => app.db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
beforeEach(() => {
  now = 1800000000000;
  app = createApp({ databaseUrl: ':memory:', logger: silentLogger, clock: { now: () => now } });
  [productId, otherId] = marketingView(app).products.map(p => p.id) as [string, string];
  app.env.SIGNAL_OFFLINE = '0'; app.operations = new OperationsService(app);
  put('operations.policy.' + productId, { productId, objective: 'Reach document buyers', mode: 'acquisition', accountIds: [], intervalHours: 1, dailyLimit: 2, running: true, revision: 2, authorizedAt: now - 86400000, lastCycleAt: now - 7200000, taskId: null, discovery: { enabled: true, queries: [{ kind: 'hn', query: 'documents' }] } });
  put('operations.discovery.' + productId, { productId, revision: 2, lastAttemptAt: now, nextAttemptAt: now + 60000, findings: [], searches: [{ query: 'hn:documents', status: 'ok', attemptedAt: now, found: 0, detail: 'No candidates' }] });
});
afterEach(() => { app.close(); vi.restoreAllMocks(); });

it('queues one recovery after empty research without fabricating a buyer or delivering anything', () => {
  const id = scheduleAcquisitionRecovery(app, productId)!;
  expect(id).toBeTruthy(); expect(scheduleAcquisitionRecovery(app, productId)).toBeUndefined();
  expect(scheduleAcquisitionRecovery(app, otherId)).toBeUndefined();
  expect(marketingView(app).guideTaskIds).toContain(id);
  const display = marketingView(app).messages.find(m => m.taskId === id)!;
  expect(display.role).toBe('assistant');
  expect(display.body).not.toContain('draft.save');
  expect(display.body).not.toContain('observedAt');
  expect(app.operations!.deliveries()).toEqual([]);
  expect(app.operations!.state(productId).taskId).toBeNull();
  app.db.update(growthTasks).set({ status: 'done' }).where(eq(growthTasks.id, id)).run();
  now += 86400000; expect(scheduleAcquisitionRecovery(app, productId)).toBeUndefined();
});
it('allows a substantive recovery brief to be saved and edited with the same bounded limit', async () => {
  const body = 'A source-grounded recovery brief. '.repeat(200);
  const value = { title: 'Recovery brief', body, kind: 'article', targetUrl: '', evidence: [] };
  const saved = await executeMarketingTool(app, productId, 'draft.save', value, AbortSignal.timeout(5000));
  expect(saved).toMatchObject({ status: 'draft saved for review; not sent or published' });
  expect(marketingActionSchema.safeParse({ type: 'draftEdit', productId, id: 'draft', body }).success).toBe(true);
  expect(draftInputSchema.safeParse({ ...value, body: 'x'.repeat(16001) }).success).toBe(false);
});
it('preserves the recovery scope and active record when the owner retries a failed task', async () => {
  const id = scheduleAcquisitionRecovery(app, productId)!;
  app.db.update(growthTasks).set({ status: 'failed' }).where(eq(growthTasks.id, id)).run();
  applyGrowthAction(app, { type: 'retry', taskId: id });
  const retried = app.db.select().from(growthTasks).all().find(t => t.id !== id)!;
  expect(marketingView(app).guideTaskIds).toContain(retried.id);
  expect((app.db.select().from(settings).where(eq(settings.key, `marketing.acquisition-recovery.${productId}`)).get()!.value as { taskId: string }).taskId).toBe(retried.id);
  await expect(executeMarketingTool(app, productId, 'engineering.add', {}, AbortSignal.timeout(5000), retried.id)).rejects.toThrow('only read evidence');
  expect(scheduleAcquisitionRecovery(app, productId)).toBeUndefined();
});
it('requires observed placement evidence, finished copy and honest demonstration status', () => {
  const id = scheduleAcquisitionRecovery(app, productId)!;
  const draft = { kind: 'article', body: 'Buyer: report reviewers. Alternative: manual comparison. First task: compare synthetic sources. Demonstration status: not verified. '.repeat(4), targetUrl: 'https://news.ycombinator.com/submit', evidence: ['https://siplemona.de/', 'https://news.ycombinator.com/showhn.html'] };
  const add = (name: string, url: string, body: string) => app.db.insert(marketingToolCalls).values({ id: name, productId, taskId: id, name, status: 'done', result: JSON.stringify({ url, body }) }).run();
  add('product.inspect', draft.evidence[0]!, 'Current product source. '.repeat(20));
  add('web.read', draft.evidence[1]!, 'Rules');
  expect(() => validateRecoveryDraft(app, productId, id, draft)).toThrow('substantive');
  app.db.update(marketingToolCalls).set({ result: JSON.stringify({ url: draft.evidence[1], body: 'Actual placement rules. '.repeat(20) }) }).where(eq(marketingToolCalls.id, 'web.read')).run();
  expect(() => validateRecoveryDraft(app, productId, id, draft)).not.toThrow();
  expect(() => validateRecoveryDraft(app, productId, id, { ...draft, body: draft.body + '[Need you to confirm the best URL]' })).toThrow('placeholders');
  expect(() => validateRecoveryDraft(app, productId, id, { ...draft, body: draft.body.replaceAll('Demonstration status: not verified.', 'Demonstrated successfully.') })).toThrow('not verified');
  expect(() => validateRecoveryDraft(app, productId, id, { ...draft, targetUrl: 'https://unread.example/submit' })).toThrow('placement host');
  expect(() => validateRecoveryDraft(app, productId, id, { ...draft, body: draft.body + 'Use the free storyboard.' })).toThrow('paid');
});
it('uses the operating scheduler even when there are no acquisition candidates', () => {
  app.operations!.schedule(productId);
  const tasks = app.db.select().from(growthTasks).where(eq(growthTasks.productId, productId)).all();
  expect(tasks).toHaveLength(1); expect(tasks[0]!.kind).toBe('marketing');
});
it('does not recover while paused, offline, too new, or after the approved expiry', () => {
  const original = app.operations!.state(productId);
  for (const patch of [{ running: false }, { authorizedAt: now }, { teamEndsAt: now - 1 }]) {
    put('operations.policy.' + productId, { ...original, ...patch });
    expect(scheduleAcquisitionRecovery(app, productId)).toBeUndefined();
  }
  put('operations.policy.' + productId, original); app.env.SIGNAL_OFFLINE = '1';
  expect(scheduleAcquisitionRecovery(app, productId)).toBeUndefined();
});
it('holds recovery writes after pause or revision and keeps publishing tools unavailable', async () => {
  const id = scheduleAcquisitionRecovery(app, productId)!;
  await expect(executeMarketingTool(app, productId, 'operations.enqueue', {}, new AbortController().signal, id)).rejects.toThrow('only read evidence');
  put('operations.policy.' + productId, { ...app.operations!.state(productId), revision: 3 });
  expect(() => assertRecoveryActive(app, productId, id)).toThrow('replaced');
  await expect(executeMarketingTool(app, productId, 'draft.save', {}, new AbortController().signal, id)).rejects.toThrow('replaced');
});
it('does not schedule broad growth analysis for a business with active acquisition', () => {
  put('growth.runtime.v1', { ...growthSettings(app), enabled: true, autoPlan: false, intervalMinutes: 60 });
  new GrowthEngine(app).schedule();
  expect(app.db.select().from(growthTasks).where(eq(growthTasks.productId, productId)).all().filter(t => t.kind === 'analysis')).toEqual([]);
});
it('treats stale and limited analytics as unknown and low traffic as a reach problem', () => {
  const context = { sourceAvailable: true, stale: false, status: 'current', snapshot: { productId, startDate: '2027-01-01', endDate: '2027-01-30', limitations: [], omittedRows: 0, totals: { sessions: 8 }, funnel: { status: 'available', rows: [], limitations: [] } } };
  app.analytics = { context: () => context, states: () => [] } as unknown as NonNullable<App['analytics']>;
  expect(salesDiagnosis(app, productId)).toMatchObject({ stage: 'reach', sessions: 8 });
  context.stale = true;
  expect(salesDiagnosis(app, productId)).toMatchObject({ stage: 'measurement', sessions: null });
  context.stale = false; context.status = 'limited';
  expect(salesDiagnosis(app, productId).sessions).toBeNull();
});
