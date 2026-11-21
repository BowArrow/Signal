import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp, type App } from '../../src/core/app.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { fixedClock } from '../../src/core/lib/clock.js';
import { growthTasks, marketingDrafts, settings } from '../../src/core/db/schema.js';
import { marketingAction } from '../../src/core/marketing/actions.js';
import { marketingView, scheduleMarketing } from '../../src/core/marketing/store.js';
import { scheduleTeamRuns, teamAction, teamRun, teamRuns, teamViews } from '../../src/core/marketing/team-store.js';
import { GrowthEngine } from '../../src/core/growth/engine.js';
import type { LlmClient, CompletionRequest } from '../../src/core/llm/client.js';
import { TEAM_ROLES, type TeamArtifact, type TeamBrief } from '../../src/shared/marketing-team.js';
import { codexGuideTaskIds } from '../../src/core/marketing/mission.js';
import { publicPage } from '../../src/core/marketing/web.js';
import { RevenueService } from '../../src/core/revenue/service.js';
import { recordTeamWorker } from '../../src/core/marketing/team-monitor.js';

vi.mock('../../src/core/marketing/web.js', () => ({
  publicPage: vi.fn(async (_app: unknown, url: string) => ({ url, title: 'Verified product fixture', body: 'A desktop assistant for working with local documents. Trial available. This is test evidence, not live validation.', observedAt: Date.now(), trust: 'untrusted source' })),
  searchWeb: vi.fn(async () => ({ results: [{ title: 'Buyer question fixture', url: 'https://example.org/buyer', excerpt: 'How can I work with private documents locally?' }] })),
}));
const now = Date.parse('2026-11-11T12:00:00-08:00');
const brief: TeamBrief = { objective: 'Find the first attributable sales', audience: 'People comparing local document assistants', offer: 'Verify the trial and demonstrate a useful workflow', constraints: 'Zero cash. No invented claims or contacts.', references: [] };
let app: App; let productId: string; let otherId: string;
beforeEach(() => { vi.stubEnv('SIGNAL_OFFLINE', '0'); app = createApp({ databaseUrl: ':memory:', clock: fixedClock(now), logger: silentLogger }); app.env.SIGNAL_OFFLINE = '0'; const products = marketingView(app).products; productId = products[0]!.id; otherId = products[1]!.id; vi.mocked(publicPage).mockClear(); });
afterEach(() => { app.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
function start() { return teamAction(app, productId, { command: 'start', brief }); }
function artifact(role: string, ids: string[]): TeamArtifact {
  return { status: 'ready', title: `Prepared ${role}`, summary: 'A specific next action supported by the saved evidence.', body: `Finished ${role} deliverable with a concrete buyer problem, workflow and validation step. Missing revenue remains unknown.`, evidenceIds: ids.slice(-1), nextAction: 'Review the buyer evidence and the proposed placement.',
    draft: role === 'copy' ? { title: 'Try a local document workflow', body: 'We build this assistant. Try one local document workflow and inspect the result before choosing a tool.', kind: 'social', targetUrl: 'https://siplemona.de/' } : null,
    experiment: role === 'strategy' ? { audience: brief.audience, channel: 'A relevant opt-in community', hypothesis: 'A useful demonstration may lead to trial interest.', action: 'Review one specific placement', successMetric: 'Proposed target: one qualified trial request', stopRule: 'Reassess after seven days without a response', durationDays: 7, cashBudgetCents: 0 } : null,
  };
}
function model(transform?: (value: TeamArtifact, request: CompletionRequest) => unknown): LlmClient {
  return { available: () => ({ ready: true }), complete: async request => {
    const run = teamRuns(app, productId)[0]!; const role = request.task!.split('.').at(-1)!;
    const value = artifact(role, run.evidence.filter(e => e.status === 'done').map(e => e.id));
    return { text: JSON.stringify(transform ? transform(value, request) : { actions: [], artifact: value }), model: 'test', inputTokens: 10, outputTokens: 10, stopReason: 'stop' };
  } };
}
async function completeRun() {
  const id = start(); const engine = new GrowthEngine(app, model());
  for (let i = 0; i < TEAM_ROLES.length; i++) { expect(await engine.runNext(['marketing'])).toBe(true); scheduleTeamRuns(app); }
  return id;
}
it('runs seven specialists through the real queue, preserves handoffs and saves actual reviewable copy', async () => {
  const id = await completeRun(); const run = teamRun(app, productId, id);
  expect(run.status).toBe('review'); expect(run.steps.every(s => s.status === 'done' && s.artifact)).toBe(true);
  expect(run.steps[2]!.draftId).toBeTruthy(); expect(app.db.select().from(marketingDrafts).all()).toHaveLength(1);
  expect(run.evidence.some(e => e.tool === 'product.inspect')).toBe(true);
  expect(teamViews(app)[0]!.outcomes).toMatchObject({ published: 0, payments: null, sessions: null, collectedCents: null });
  expect(() => teamAction(app, productId, { command: 'approve', runId: id, operationRevision: 0, durationDays: 7 })).toThrow('Operations');
  expect(teamRun(app, productId, id).status).toBe('review');
  expect(app.db.select().from(marketingDrafts).all()[0]!.status).toBe('draft'); // Failed activation must preserve the review packet.
});
it('serializes handoffs, rejects duplicate campaigns and isolates businesses', () => {
  const id = start(); scheduleTeamRuns(app); scheduleTeamRuns(app);
  expect(app.db.select().from(growthTasks).all()).toHaveLength(1);
  expect(() => start()).toThrow('Finish or cancel');
  expect(() => teamAction(app, otherId, { command: 'pause', runId: id })).toThrow('not found');
  expect(() => teamAction(app, productId, { command: 'approve', runId: id, operationRevision: 0, durationDays: 7 })).toThrow('completed');
  expect(teamRuns(app, otherId)).toHaveLength(0);
});
it('cancels in-flight output when paused and resumes with a new task', async () => {
  const id = start(); const originalTask = teamRun(app, productId, id).steps[0]!.taskId;
  const engine = new GrowthEngine(app, model(value => { teamAction(app, productId, { command: 'pause', runId: id }); return { actions: [], artifact: value }; }));
  await engine.runNext(['marketing']);
  expect(teamRun(app, productId, id).status).toBe('paused'); expect(teamRun(app, productId, id).steps[0]!.artifact).toBeNull();
  expect(app.db.select().from(growthTasks).where(eq(growthTasks.id, originalTask!)).get()!.status).toBe('cancelled');
  teamAction(app, productId, { command: 'resume', runId: id });
  expect(teamRun(app, productId, id).steps[0]!.taskId).not.toBe(originalTask);
});
it('does not execute publication requests or accept invented evidence', async () => {
  const id = start(); const engine = new GrowthEngine(app, model(() => ({ actions: [{ tool: 'blog.save', input: {} }], artifact: null })));
  await engine.runNext(['marketing']); scheduleTeamRuns(app);
  expect(teamRun(app, productId, id).status).toBe('attention'); expect(teamRun(app, productId, id).steps[0]!.artifact).toBeNull();
  teamAction(app, productId, { command: 'resume', runId: id });
  await new GrowthEngine(app, model(v => ({ actions: [], artifact: { ...v, evidenceIds: ['invented'] } }))).runNext(['marketing']); scheduleTeamRuns(app);
  expect(teamRun(app, productId, id).steps[0]!.error).toContain('Evidence');
});
it('halts at an explicit blocker and retries only the unfinished role', async () => {
  const id = start(); await new GrowthEngine(app, model(v => ({ actions: [], artifact: { ...v, status: 'blocked', nextAction: 'Restore access to the product source.' } }))).runNext(['marketing']); scheduleTeamRuns(app);
  expect(teamRun(app, productId, id).status).toBe('attention'); expect(teamRun(app, productId, id).steps[1]!.taskId).toBeNull();
  teamAction(app, productId, { command: 'resume', runId: id });
  await new GrowthEngine(app, model()).runNext(['marketing']); scheduleTeamRuns(app);
  expect(teamRun(app, productId, id).steps[0]!.status).toBe('done'); expect(teamRun(app, productId, id).steps[1]!.status).toBe('queued');
});
it('invalidates dependent work on revision but preserves earlier evidence and prevents stale copy approval', async () => {
  const id = await completeRun(); const before = teamRun(app, productId, id);
  await marketingAction(app, { type: 'draftEdit', productId, id: before.steps[2]!.draftId, body: 'Owner changed the reviewed copy.' });
  expect(() => teamAction(app, productId, { command: 'approve', runId: id, operationRevision: 0, durationDays: 7 })).toThrow('changed');
  teamAction(app, productId, { command: 'revise', runId: id, role: 'copy', feedback: 'Use a narrower buyer problem.' });
  const after = teamRun(app, productId, id); expect(after.steps[0]).toEqual(before.steps[0]); expect(after.steps[1]).toEqual(before.steps[1]);
  expect(after.steps.slice(2).every(s => s.artifact === null)).toBe(true); expect(after.steps[2]!.status).toBe('queued');
});
it('routes team work through connected Codex and holds generic automatic cycles', () => {
  app.db.insert(settings).values({ key: `marketing.codex.${productId}`, value: { model: 'codex', verifiedAt: now } }).run();
  start(); expect(codexGuideTaskIds(app)).toHaveLength(1);
  const before = app.db.select().from(growthTasks).all().length; scheduleMarketing(app);
  expect(app.db.select().from(growthTasks).all()).toHaveLength(before);
});
it('requires current product evidence before ready research or copy', async () => {
  vi.mocked(publicPage).mockRejectedValueOnce(new Error('Product page unavailable'));
  const id = start(); await new GrowthEngine(app, model()).runNext(['marketing']); scheduleTeamRuns(app);
  expect(teamRun(app, productId, id).status).toBe('attention'); expect(teamRun(app, productId, id).steps[0]!.error).toContain('product inspection failed');
});
it('recovers an interrupted task as a visible failure instead of replaying it', () => {
  const id = start(); const taskId = teamRun(app, productId, id).steps[0]!.taskId!;
  app.db.update(growthTasks).set({ status: 'failed', error: 'Worker interrupted.' }).where(eq(growthTasks.id, taskId)).run(); scheduleTeamRuns(app);
  expect(teamRun(app, productId, id)).toMatchObject({ status: 'attention' });
  expect(app.db.select().from(growthTasks).all()).toHaveLength(1);
});
it('keeps offline runs saved without starting a task', () => {
  app.env.SIGNAL_OFFLINE = '1'; start(); scheduleTeamRuns(app);
  expect(app.db.select().from(growthTasks).all()).toHaveLength(0);
});
it('reports worker freshness and real campaign tasks without mixing another business', () => {
  const id = start(); recordTeamWorker(app, true);
  const task = teamRun(app, productId, id).steps[0]!.taskId!;
  app.db.update(growthTasks).set({ status: 'running' }).where(eq(growthTasks.id, task)).run();
  let view = teamViews(app).find(r => r.id === id)!;
  expect(view.monitor.worker.status).toBe('online'); expect(view.monitor.state).toBe('working'); expect(view.monitor.tasks[0]?.role).toBe('Buyer researcher');
  teamAction(app, otherId, { command: 'start', brief });
  view = teamViews(app).find(r => r.id === id)!; expect(view.monitor.tasks).toHaveLength(1);
  app.db.update(settings).set({ value: { running: true, at: now - 21000 } }).where(eq(settings.key, 'marketing.worker.health')).run();
  expect(teamViews(app).find(r => r.id === id)?.monitor.state).toBe('offline');
});
it('updates the brief durably, cancels stale work and rejects a stale editor', async () => {
  const id = await completeRun(); const saved = teamRun(app, productId, id);
  teamAction(app, productId, { command: 'update-brief', runId: id, expectedRevision: saved.revision, brief: { ...brief, audience: 'Researchers comparing long source documents' } });
  const after = teamRun(app, productId, id);
  expect(after.brief.audience).toContain('Researchers'); expect(after.status).toBe('running'); expect(after.steps.every(s => s.artifact === null)).toBe(true);
  expect(after.changes?.at(-1)?.detail).toContain('brief updated');
  expect(() => teamAction(app, productId, { command: 'update-brief', runId: id, expectedRevision: saved.revision, brief })).toThrow('while you were editing');
  expect(() => teamAction(app, otherId, { command: 'update-brief', runId: id, expectedRevision: after.revision, brief })).toThrow('not found');
});
it('scores only fresh, same-account, campaign-attributed live payments after refunds', () => {
  const id = start(); app.revenue = new RevenueService(app);
  const state = { productId, accountId: 'stripe', live: true, status: 'current', since: now - 100, lastCompleteAt: now, stripeProductIds: ['p'], revision: 1, cursor: '', scanStartedAt: null, lastAttemptAt: now, scanned: 1, excluded: 0, detail: 'Fixture' };
  app.db.insert(settings).values({ key: `revenue.config.${productId}`, value: state }).run();
  const p = { id: 'p1', accountId: 'stripe', productId, live: true, currency: 'usd', createdAt: now, observedAt: now, captured: 4900, refunded: 0, disputed: false, attribution: 'matched', campaignId: id };
  app.db.insert(settings).values({ key: `revenue.snapshot.${productId}`, value: [p, { ...p, observedAt: now + 1, refunded: 900 }, { ...p, id: 'test', live: false }, { ...p, id: 'unrelated', campaignId: 'other' }, { ...p, id: 'dispute', disputed: true }, { ...p, id: 'foreign', currency: 'eur' }, { ...p, id: 'wrong-account', accountId: 'other' }] }).run();
  expect(teamViews(app)[0]!.outcomes).toMatchObject({ payments: 1, collectedCents: 4000 });
  app.db.update(settings).set({ value: { ...state, lastCompleteAt: now - 86400001 } }).where(eq(settings.key, `revenue.config.${productId}`)).run();
  expect(teamViews(app)[0]!.outcomes).toMatchObject({ payments: null, collectedCents: null });
});
