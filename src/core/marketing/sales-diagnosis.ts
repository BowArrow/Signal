import { eq } from 'drizzle-orm';
import type { App } from '../app.js';
import { growthTasks, settings } from '../db/schema.js';
import type { SalesDiagnosis } from '../../shared/sales-diagnosis.js';
import { acquisitionCycle } from '../operations/acquisition.js';

const DAY = 86400000;
export interface RecoveryRecord { revision: number; taskId: string; at: number; attempts: number; }
export function recoveryRecord(app: App, productId: string) {
  return app.db.select().from(settings).where(eq(settings.key, `marketing.acquisition-recovery.${productId}`)).get()?.value as RecoveryRecord | undefined;
}
/** Diagnoses observable constraints. Event totals are never treated as a cohort. */
export function salesDiagnosis(app: App, productId: string): SalesDiagnosis {
  const now = app.clock.now();
  const state = app.operations?.state(productId);
  const deliveries = app.operations?.deliveries().filter(d => d.productId === productId && d.status === 'published' && d.receipt && d.receipt.confirmedAt <= now && d.receipt.confirmedAt >= now - 30 * DAY) ?? [];
  const analytics = app.analytics?.context(productId);
  const report = analytics?.snapshot;
  const fresh = Boolean(analytics?.sourceAvailable && !analytics.stale && analytics.status === 'current' && report && !report.limitations.length && report.omittedRows === 0);
  const sessions = fresh ? report!.totals.sessions : null;
  const discovery = state?.discovery?.enabled ? app.operations!.discovery.snapshot(state) : undefined;
  const failed = discovery?.searches.filter(s => s.status === 'attention' && s.attemptedAt <= now && now - s.attemptedAt <= DAY) ?? [];
  const evidence = [`${deliveries.length} confirmed publications in the last 30 days.`, sessions === null ? 'Traffic is unknown: the report is missing, stale, limited or inaccessible.' : `${sessions} measured website sessions from ${report!.startDate} through ${report!.endDate}. Sessions are not unique buyers.`];
  if (failed.length) evidence.push(`${failed.length} research searches currently need attention.`);
  const saved = recoveryRecord(app, productId);
  const task = saved && saved.revision === state?.revision ? app.db.select().from(growthTasks).where(eq(growthTasks.id, saved.taskId)).get() : undefined;
  const base = { productId, observedAt: now, sessions, published30Days: deliveries.length, evidence, ...(task && saved ? { recovery: { taskId: task.id, status: task.status, attempts: saved.attempts } } : {}) };
  const accounts = app.connections?.accounts() ?? [];
  const broken = state?.accountIds.filter(id => !accounts.some(a => a.id === id && a.productId === productId && a.status === 'verified' && (!a.expiresAt || a.expiresAt > now || a.refreshable))) ?? [];
  if (broken.length) return { ...base, stage: 'access', next: { id: 'sales-access', title: 'Restore the blocked publishing access', detail: `${broken.length} selected destination${broken.length === 1 ? ' needs' : 's need'} reconnection. Public research can continue, and healthy authorized destinations remain usable.`, why: 'An enabled campaign cannot deliver through a rejected account session.', button: 'Repair connections', destination: { screen: 'connections' } } };
  if (!fresh) return { ...base, stage: 'measurement', next: { id: 'sales-measurement', title: 'Restore the evidence for sales decisions', detail: app.analytics?.states().find(s => s.productId === productId)?.detail || 'Connect and sync this business Analytics property, then verify a tagged visit and the trial or signup event.', why: 'Without a current report we cannot tell low reach from missing measurement. Keep researching relevant placements while fixing this.', button: 'Check measurement', destination: { screen: 'analytics' } } };
  // 50 is a triage threshold, not a statistical test or a conversion benchmark.
  if (sessions! < 50 || deliveries.length === 0) return { ...base, stage: 'reach', next: { id: 'sales-reach', title: 'Put one useful demonstration in front of buyers', detail: `${sessions} measured sessions and ${deliveries.length} recent publications are too little evidence to blame price or conversion. Prepare one reachable placement, a source-checked demonstration and one clear trial action.`, why: 'A website article needs distribution. Choose a specific audience and placement, then measure visits and voluntary task feedback. The 50-session threshold is only a work-priority heuristic.', button: task?.status === 'done' ? 'Review the prepared recovery work' : 'Review placements', destination: task?.status === 'done' ? { screen: 'marketing', section: 'content' } : { screen: 'sales', section: 'drafts' } } };
  const events = fresh && report!.funnel?.status === 'available' && !report!.funnel.limitations.length ? report!.funnel.rows : [];
  const activation = events.filter(r => r.event === 'product_activation').reduce((n, r) => n + r.count, 0);
  if (!activation) return { ...base, stage: 'activation', next: { id: 'sales-activation', title: 'Check whether visitors reach a useful result', detail: 'No activation events are recorded in the current report. Verify instrumentation, then observe a consenting trial user complete one real task. Do not infer abandonment from missing events.', why: 'More traffic will not fix an unmeasured or difficult first experience. Downloads and task completion are different observations.', button: 'Review trial evidence', destination: { screen: 'analytics' } } };
  return { ...base, stage: 'purchase', next: { id: 'sales-purchase', title: 'Review mature trials and buying objections', detail: 'There is recorded activation activity. Check current payment evidence and the trial period before changing the offer; ask consenting users what prevented purchase.', why: 'Aggregate activation and purchase events are not a linked funnel. Payment receipts and actual customer feedback should guide the next experiment.', button: 'Review purchases', destination: { screen: 'revenue' } } };
}

export function acquisitionStall(app: App, productId: string): string | undefined {
  const state = app.operations?.state(productId);
  const now = app.clock.now();
  if (!state?.running || state.mode !== 'acquisition' || !state.discovery?.enabled || !state.authorizedAt || state.authorizedAt > now - 2 * 3600000 || state.teamEndsAt && state.teamEndsAt <= now) return;
  if (app.operations!.deliveries().some(d => d.productId === productId && d.revision === state.revision && (['queued', 'dispatching', 'retry'].includes(d.status) || d.status === 'published' && d.receipt && d.receipt.confirmedAt >= now - DAY))) return;
  const snapshot = app.operations!.discovery.snapshot(state);
  if (!snapshot.lastAttemptAt || now - snapshot.lastAttemptAt > DAY || app.operations!.discovery.context(state).length) return;
  const cycle = acquisitionCycle(app, productId);
  if (snapshot.searches.length < state.discovery.queries.length && cycle?.revision !== state.revision) return;
  return snapshot.searches.some(s => s.status === 'attention') ? 'Repeated source failures and no eligible buyer requests are preventing delivery.' : 'The current search strategy has produced no eligible request or recent delivery after at least two hours.';
}
