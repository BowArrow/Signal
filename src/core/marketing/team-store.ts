import { and, desc, eq, inArray, like } from 'drizzle-orm';
import type { App } from '../app.js';
import { growthTasks, marketingDrafts, products, settings } from '../db/schema.js';
import { newId } from '../lib/id.js';
import { TEAM_ROLES, teamActionSchema, type TeamRun, type TeamRole } from '../../shared/marketing-team.js';
import { queueMarketing } from './store.js';
import { teamMonitor } from './team-monitor.js';
import { operationPolicySchema } from '../../shared/operations.js';

const prefix = 'marketing.team.run.';
function put(app: App, key: string, value: unknown) {
  app.db.insert(settings).values({ key, value, updatedAt: app.clock.now() }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: app.clock.now() } }).run();
}
export function saveTeamRun(app: App, run: TeamRun) { run.updatedAt = app.clock.now(); put(app, prefix + run.id, run); }
export function teamRuns(app: App, productId?: string): TeamRun[] {
  return app.db.select().from(settings).where(like(settings.key, `${prefix}%`)).orderBy(desc(settings.updatedAt)).all()
    .map(r => r.value as TeamRun).filter(r => !productId || r.productId === productId);
}
export function teamRun(app: App, productId: string, id: string): TeamRun {
  const run = app.db.select().from(settings).where(eq(settings.key, prefix + id)).get()?.value as TeamRun | undefined;
  if (!run || run.productId !== productId) throw new Error('Marketing team campaign not found for this business.');
  return run;
}
export function teamTask(app: App, taskId: string) {
  return app.db.select().from(settings).where(eq(settings.key, `marketing.team.task.${taskId}`)).get()?.value as { runId: string; role: TeamRole; revision: number } | undefined;
}
export function unfinishedTeam(run: TeamRun) { return !['cancelled', 'approved'].includes(run.status) || (run.status === 'approved' && Boolean(run.execution && run.execution.status !== 'complete')); }
function stopExecution(app: App, run: TeamRun, detail: string) {
  const state = app.operations?.state(run.productId);
  if (state?.teamRunId === run.id && state.revision === run.execution?.operationRevision) {
    app.operations!.pause(run.productId);
    if (state.taskId) app.db.update(growthTasks).set({ status: 'cancelled', lease: null, updatedAt: app.clock.now() }).where(and(eq(growthTasks.id, state.taskId), inArray(growthTasks.status, ['queued', 'running']))).run();
  }
  if (run.execution) { run.execution.status = 'paused'; run.execution.detail = detail; }
}
/** Runs before other campaign workers; never resurrects a manually paused policy. */
export function tickTeamExecution(app: App) {
  for (const run of teamRuns(app).filter(r => r.status === 'approved' && r.execution)) {
    const before = JSON.stringify(run);
    const state = app.operations?.state(run.productId);
    const execution = run.execution!;
    run.deliveryIds = [...new Set([...(run.deliveryIds ?? []), ...(app.operations?.deliveries() ?? []).filter(d => d.productId === run.productId && d.teamRunId === run.id).map(d => d.id)])];
    if (execution.status !== 'complete' && app.clock.now() >= execution.endsAt) {
      stopExecution(app, run, 'Campaign duration complete. Results remain available.'); execution.status = 'complete';
    } else if (execution.status === 'active' && (!state?.running || state.teamRunId !== run.id || state.revision !== execution.operationRevision)) {
      execution.status = 'paused'; execution.detail = 'Operations was paused or its settings changed. Review the operating scope before resuming.';
    } else if (execution.status === 'active' && state) {
      const task = state.taskId ? app.db.select().from(growthTasks).where(eq(growthTasks.id, state.taskId)).get() : undefined;
      const issue = app.operations?.deliveries().find(d => d.teamRunId === run.id && d.status === 'attention');
      execution.detail = issue ? `Delivery needs attention: ${issue.detail}` : task?.status === 'failed' ? `Cycle could not finish: ${task.error ?? 'Check the agent runtime.'} The next eligible cycle retries automatically within the approved limits.` : task?.status === 'running' ? 'The team is researching, drafting and reviewing the next campaign delivery.' : 'Working autonomously within the approved scope. Results update from delivery, analytics and payment receipts. Keep Signal open.';
    }
    if (JSON.stringify(run) !== before) saveTeamRun(app, run);
  }
}
function stopTasks(app: App, run: TeamRun, from = 0) {
  for (const step of run.steps.slice(from)) {
    if (step.taskId) app.db.update(growthTasks).set({ status: 'cancelled', lease: null, updatedAt: app.clock.now() })
      .where(and(eq(growthTasks.id, step.taskId), eq(growthTasks.productId, run.productId), inArray(growthTasks.status, ['queued', 'running']))).run();
    if (step.status !== 'done') { step.status = 'waiting'; step.taskId = null; step.error = null; }
  }
  run.revision++;
}
export function reconcileTeamRun(app: App, run: TeamRun) {
  if (run.status !== 'running') return run;
  for (const step of run.steps) {
    if (!step.taskId || step.status === 'done') continue;
    const task = app.db.select().from(growthTasks).where(eq(growthTasks.id, step.taskId)).get();
    if (!task || ['failed', 'cancelled'].includes(task.status)) {
      step.status = 'failed'; step.error = task?.error || 'Task interrupted. Resume to retry this role.'; run.status = 'attention';
    } else if (task.status === 'done') {
      step.status = step.artifact ? step.artifact.status === 'blocked' ? 'blocked' : 'done' : 'failed';
      if (step.status !== 'done') { run.status = 'attention'; step.error = step.artifact?.nextAction || 'The role finished without a deliverable.'; }
    } else step.status = task.status === 'running' ? 'running' : 'queued';
  }
  if (run.steps.every(s => s.status === 'done')) run.status = 'review';
  return run;
}
export function teamViews(app: App) { return teamRuns(app).map(r => {
  const run = reconcileTeamRun(app, r);
  const monitor = teamMonitor(app, run);
  const ids = new Set([run.id, ...(run.deliveryIds ?? []), ...monitor.deliveries.map(d => d.id)]);
  const revenue = app.revenue?.states().find(s => s.productId === run.productId);
  const product = app.db.select().from(products).where(eq(products.id, run.productId)).get();
  const currency = product?.currency.toLowerCase() ?? 'usd';
  const now = app.clock.now();
  const revenueReady = Boolean(revenue?.live && revenue.status === 'current' && revenue.since <= run.createdAt && revenue.lastCompleteAt && revenue.lastCompleteAt >= run.createdAt && revenue.lastCompleteAt <= now && now - revenue.lastCompleteAt <= 86400000);
  const payments = new Map<string, NonNullable<ReturnType<NonNullable<App['revenue']>['payments']>>[number]>();
  for (const p of app.revenue?.payments(run.productId) ?? []) {
    if (p.productId !== run.productId || p.accountId !== revenue?.accountId || !p.live || p.createdAt < run.createdAt || p.createdAt > now) continue;
    const key = `${p.accountId}:${p.id}`;
    if ((payments.get(key)?.observedAt ?? -1) <= p.observedAt) payments.set(key, p);
  }
  const matched = [...payments.values()].filter(p => p.currency.toLowerCase() === currency && !p.disputed && p.attribution === 'matched' && p.campaignId && ids.has(p.campaignId) && p.captured > p.refunded);
  const analytics = app.analytics?.context(run.productId);
  const snapshot = analytics?.snapshot;
  const analyticsReady = Boolean(analytics?.sourceAvailable && !analytics.stale && snapshot && snapshot.observedAt >= run.createdAt && snapshot.observedAt <= now);
  return { ...run, monitor, outcomes: {
    published: (app.operations?.deliveries() ?? []).filter(d => d.productId === run.productId && ids.has(d.id) && d.status === 'published' && d.receipt).length,
    sessions: analyticsReady ? snapshot!.rows.filter(r => r.attribution === 'matched' && r.campaignId && ids.has(r.campaignId)).reduce((sum, r) => sum + r.sessions, 0) : null,
    analyticsAt: snapshot?.observedAt ?? null,
    payments: revenueReady ? matched.length : null, collectedCents: revenueReady ? matched.reduce((sum, p) => sum + p.captured - p.refunded, 0) : null,
    revenueAt: revenue?.lastCompleteAt ?? null, currency,
    detail: 'Only matching campaign metadata or linked delivery IDs count. Payments exclude test mode, disputes and fully refunded purchases. Unknown means missing or stale evidence; zero attributed payments does not establish zero total sales. Website sessions cover the analytics report window.',
  } };
}); }
export function scheduleTeamRuns(app: App) {
  if (app.env.SIGNAL_OFFLINE === '1') return;
  for (const saved of teamRuns(app).filter(r => r.status === 'running')) app.db.transaction(() => {
    const run = reconcileTeamRun(app, saved);
    const step = run.steps.find(s => s.status !== 'done');
    if (run.status === 'running' && step?.status === 'waiting') {
      step.taskId = queueMarketing(app, run.productId, `${TEAM_ROLES.find(r => r.id === step.role)!.name}: ${run.brief.objective}`);
      step.status = 'queued';
      put(app, `marketing.guide-task.${step.taskId}`, true);
      put(app, `marketing.team.task.${step.taskId}`, { runId: run.id, role: step.role, revision: run.revision });
    }
    saveTeamRun(app, run);
  });
}
export function teamAction(app: App, productId: string, input: unknown) {
  const action = teamActionSchema.parse(input);
  const product = app.db.select().from(products).where(and(eq(products.id, productId), eq(products.enabled, true))).get();
  if (!product) throw new Error('Choose an active business.');
  return app.db.transaction(() => {
    if (action.command === 'start') {
      if (teamRuns(app, productId).some(r => unfinishedTeam(reconcileTeamRun(app, r)))) throw new Error('Finish or cancel the current team campaign before starting another.');
      const run: TeamRun = { id: newId(), productId, brief: action.brief, status: 'running', revision: 1, feedback: '', createdAt: app.clock.now(), updatedAt: app.clock.now(), evidence: [],
        steps: TEAM_ROLES.map(r => ({ role: r.id, status: 'waiting', taskId: null, artifact: null, draftId: null, error: null })) };
      saveTeamRun(app, run); scheduleTeamRuns(app); return run.id;
    }
    const run = reconcileTeamRun(app, teamRun(app, productId, action.runId));
    if (action.command === 'update-brief' || action.command === 'update-settings') {
      if (action.expectedRevision !== run.revision) throw new Error('This campaign changed while you were editing. Reload the saved version before applying your changes.');
      if (run.status === 'cancelled') throw new Error('Create a new campaign after cancellation.');
      if (teamRuns(app, productId).some(r => r.id !== run.id && unfinishedTeam(r))) throw new Error('Finish the current campaign before editing an older one.');
      if (action.command === 'update-brief') {
        if (JSON.stringify(action.brief) === JSON.stringify(run.brief)) return run.id;
        stopExecution(app, run, 'Campaign brief changed.'); stopTasks(app, run);
        delete run.execution; run.brief = action.brief; run.status = 'running';
        run.feedback = 'The owner updated the campaign brief. Prepare a fresh packet using the new objective, audience, offer and constraints.';
        for (const step of run.steps) { step.status = 'waiting'; step.taskId = null; step.artifact = null; step.draftId = null; step.error = null; }
      } else {
        const state = app.operations?.state(productId);
        if (!state || state.revision !== action.operationRevision) throw new Error('Operating settings changed while you were editing. Reload the saved settings before applying changes.');
        const { durationDays, ...scope } = action.value;
        const policy = operationPolicySchema.parse({ ...operationPolicySchema.strip().parse(state), ...scope });
        stopExecution(app, run, 'Campaign settings changed.');
        app.operations!.configure(productId, policy); stopTasks(app, run);
        delete run.execution; run.launchDurationDays = durationDays;
        if (run.steps.every(s => s.status === 'done')) run.status = 'review';
      }
    } else if (action.command === 'link-delivery') {
      const delivery = app.operations?.deliveries().find(d => d.productId === productId && d.id === action.deliveryId && d.status === 'published' && d.receipt);
      if (!delivery) throw new Error('Choose a published delivery receipt belonging to this business.');
      if (delivery.teamRunId && delivery.teamRunId !== run.id) throw new Error('This receipt belongs to another team campaign.');
      if (delivery.createdAt < run.createdAt) throw new Error('This delivery predates the campaign.');
      if (teamRuns(app, productId).some(r => r.id !== run.id && r.deliveryIds?.includes(delivery.id))) throw new Error('This receipt is already linked to another campaign.');
      run.deliveryIds = [...new Set([...(run.deliveryIds ?? []), delivery.id])];
    } else if (action.command === 'cancel') { stopExecution(app, run, 'Campaign cancelled.'); stopTasks(app, run); run.status = 'cancelled'; }
    else if (action.command === 'pause') {
      if (run.status === 'approved' && run.execution?.status === 'active') { stopExecution(app, run, 'Campaign paused by owner.'); run.changes = [...(run.changes ?? []), { at: app.clock.now(), detail: 'Paused campaign execution' }].slice(-50); saveTeamRun(app, run); return run.id; }
      if (run.status !== 'running') throw new Error('Only a working campaign can be paused.');
      stopTasks(app, run); run.status = 'paused';
    } else if (action.command === 'resume') {
      if (run.status === 'approved' && run.execution?.status === 'paused') {
        const state = app.operations?.state(productId);
        if (!state || state.teamRunId !== run.id || state.revision !== run.execution.operationRevision) throw new Error('Operating scope changed. Revise and approve the campaign again.');
        if (run.execution.endsAt <= app.clock.now()) throw new Error('This campaign has ended. Start a new campaign.');
        app.operations!.run(productId, true); run.execution.status = 'active'; run.execution.detail = 'Working autonomously within the approved scope.';
        run.changes = [...(run.changes ?? []), { at: app.clock.now(), detail: 'Resumed campaign execution' }].slice(-50);
        saveTeamRun(app, run); return run.id;
      }
      if (!['paused', 'attention'].includes(run.status)) throw new Error('This campaign is not paused or waiting for a retry.');
      stopTasks(app, run); run.status = 'running';
    } else if (action.command === 'approve') {
      if (run.status === 'approved' && run.execution) return run.id; // Double clicks and IPC retries cannot restart it.
      if (!['review', 'approved'].includes(run.status) || !run.steps.every(s => s.status === 'done')) throw new Error('Review the completed team deliverables first.');
      for (const step of run.steps) if (step.draftId) {
        const draft = app.db.select().from(marketingDrafts).where(and(eq(marketingDrafts.id, step.draftId), eq(marketingDrafts.productId, productId))).get();
        if (!draft || draft.status === 'rejected' || (['title', 'body', 'kind', 'targetUrl'] as const).some(key => draft.value[key] !== step.artifact?.draft?.[key])) throw new Error('Campaign copy changed or was rejected. Ask the copywriter to revise before approving the packet.');
      }
      if (!app.operations) throw new Error('Operations is unavailable. Open the Signal desktop app.');
      if (teamRuns(app, productId).some(r => r.id !== run.id && unfinishedTeam(r))) throw new Error('Finish or cancel the current campaign first.');
      const endsAt = app.clock.now() + action.durationDays * 86400000;
      const started = app.operations.startTeamCampaign(productId, run.id, run.brief.objective, action.operationRevision, endsAt);
      run.status = 'approved';
      run.execution = { status: 'active', approvedAt: app.clock.now(), endsAt, operationRevision: started.revision, policy: started.policy, detail: 'Working autonomously within the approved scope. Keep Signal open.' };
    } else if (action.command === 'revise') {
      if (run.status === 'cancelled') throw new Error('Start a new campaign after cancellation.');
      if (teamRuns(app, productId).some(r => r.id !== run.id && unfinishedTeam(r))) throw new Error('Finish the current campaign before reopening an older one.');
      stopExecution(app, run, 'Revision requires a fresh campaign approval.'); delete run.execution;
      const index = run.steps.findIndex(s => s.role === action.role);
      // Cancel every active task before invalidating dependent deliverables.
      stopTasks(app, run);
      for (const step of run.steps.slice(index)) { step.status = 'waiting'; step.taskId = null; step.artifact = null; step.draftId = null; step.error = null; }
      run.feedback = action.feedback; run.status = 'running';
    }
    run.changes = [...(run.changes ?? []), { at: app.clock.now(), detail: ({ 'update-brief': 'Campaign brief updated; team preparation restarted', 'update-settings': 'Campaign settings updated; execution awaits approval', approve: 'Approved campaign execution', cancel: 'Cancelled campaign', pause: 'Paused team preparation', resume: 'Resumed team preparation', revise: 'Requested specialist revisions', 'link-delivery': 'Linked a publication receipt' } as Record<string, string>)[action.command] ?? 'Campaign updated' }].slice(-50);
    saveTeamRun(app, run); scheduleTeamRuns(app); return run.id;
  });
}
