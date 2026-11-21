import { and, desc, eq, inArray, like } from 'drizzle-orm';
import type { App } from '../app.js';
import { growthTasks, marketingToolCalls, settings } from '../db/schema.js';
import { TEAM_ROLES, type TeamMonitor, type TeamRun } from '../../shared/marketing-team.js';
import { deliveryCapacity } from '../../shared/delivery-capacity.js';
import { acquisitionCycle } from '../operations/acquisition.js';
import { acquisitionStall, recoveryRecord } from './sales-diagnosis.js';

const WORKER = 'marketing.worker.health';
export function recordTeamWorker(app: App, running: boolean) {
  const now = app.clock.now();
  app.db.insert(settings).values({ key: WORKER, value: { running, at: now }, updatedAt: now }).onConflictDoUpdate({ target: settings.key, set: { value: { running, at: now }, updatedAt: now } }).run();
}
const label = (role: string) => TEAM_ROLES.find(r => r.id === role)?.name ?? 'Campaign operator';
const toolLabel: Record<string, string> = { 'product.inspect': 'Checked current product facts', 'operations.review': 'Reviewed claims, voice and campaign fit', 'operations.enqueue': 'Prepared a delivery', 'web.search': 'Searched for buyer evidence', 'web.read': 'Read a source', 'signals.find': 'Checked buyer conversations', 'accounts.list': 'Checked connected destinations', 'draft.save': 'Saved campaign copy' };
export function teamMonitor(app: App, run: TeamRun): TeamMonitor {
  const now = app.clock.now();
  const health = app.db.select().from(settings).where(eq(settings.key, WORKER)).get()?.value as { running: boolean; at: number } | undefined;
  const worker: TeamMonitor['worker'] = { status: app.env.SIGNAL_OFFLINE === '1' ? 'offline' : health?.running && health.at <= now && now - health.at < 20000 ? 'online' : health ? 'offline' : 'unknown', heartbeatAt: health?.at ?? null };
  const assignments = app.db.select().from(settings).where(like(settings.key, 'marketing.team.%task.%')).all().flatMap(row => {
    const value = row.value as { runId?: string; role?: string; productId?: string };
    return value.runId === run.id && (!value.productId || value.productId === run.productId) ? [{ id: row.key.split('.').at(-1)!, role: label(value.role ?? '') }] : [];
  });
  const taskRoles = new Map([...assignments, ...run.steps.filter(s => s.taskId).map(s => ({ id: s.taskId!, role: label(s.role) }))].map(t => [t.id, t.role]));
  const tasks = taskRoles.size ? app.db.select().from(growthTasks).where(and(eq(growthTasks.productId, run.productId), inArray(growthTasks.id, [...taskRoles.keys()]))).orderBy(desc(growthTasks.createdAt)).limit(100).all() : [];
  const tools = tasks.length ? app.db.select().from(marketingToolCalls).where(and(eq(marketingToolCalls.productId, run.productId), inArray(marketingToolCalls.taskId, tasks.map(t => t.id)))).orderBy(desc(marketingToolCalls.createdAt)).limit(80).all() : [];
  const allDeliveries = app.operations?.deliveries() ?? [];
  const deliveries = allDeliveries.filter(d => d.productId === run.productId && (d.teamRunId === run.id || run.deliveryIds?.includes(d.id)));
  const activity: TeamMonitor['activity'] = [
    { id: 'created', at: run.createdAt, role: 'You', title: 'Campaign brief saved', detail: run.brief.objective, status: 'done' },
    ...(run.execution ? [{ id: 'approved', at: run.execution.approvedAt, role: 'You', title: 'Campaign execution approved', detail: 'The team can execute within the saved destinations, limits and duration.', status: 'done' }] : []),
    ...(run.changes ?? []).map((c, i) => ({ id: `change-${i}`, at: c.at, role: 'You', title: c.detail, detail: '', status: 'done' })),
    ...tasks.map(t => ({ id: t.id, at: t.updatedAt, role: taskRoles.get(t.id)!, title: t.status === 'done' ? typeof t.output?.acquisition === 'string' ? `Buyer check: ${t.output.acquisition}` : 'Work completed' : t.status === 'running' ? 'Work started' : t.status === 'failed' ? 'Work could not finish' : t.status === 'cancelled' ? 'Work stopped' : 'Work queued', detail: t.error ?? (typeof t.output?.summary === 'string' ? t.output.summary : typeof t.output?.artifact === 'string' ? t.output.artifact : ''), status: t.status })),
    ...tools.map(t => ({ id: t.id, at: t.createdAt, role: taskRoles.get(t.taskId)!, title: toolLabel[t.name] ?? t.name, detail: t.status === 'failed' ? t.result.slice(0, 1000) : 'Saved tool receipt. Open the specialist output for source detail.', status: t.status })),
    ...run.evidence.filter(e => !tools.some(t => t.id === e.id)).map(e => ({ id: e.id, at: e.at, role: label(e.role), title: toolLabel[e.tool] ?? e.tool, detail: e.status === 'failed' ? e.result.slice(0, 1000) : 'Source evidence saved with the specialist handoff.', status: e.status })),
    ...deliveries.map(d => ({ id: d.id, at: d.receipt?.confirmedAt ?? d.updatedAt, role: 'Distribution', title: `${d.status === 'published' && d.receipt ? 'Published' : d.status}: ${d.title}`, detail: d.detail, status: d.status })),
  ].sort((a, b) => b.at - a.at).slice(0, 70);
  const operation = app.operations?.state(run.productId);
  const owns = Boolean(operation?.teamRunId === run.id && operation.revision === run.execution?.operationRevision);
  const currentTasks = tasks.filter(t => ['queued', 'running'].includes(t.status));
  const active = currentTasks.find(t => t.status === 'running');
  const failed = tasks[0]?.status === 'failed' ? tasks[0] : undefined;
  const decision = acquisitionCycle(app, run.productId);
  const currentDecision = decision && decision.revision === operation?.revision && taskRoles.has(decision.taskId) ? decision : undefined;
  const connection = app.db.select().from(settings).where(eq(settings.key, `marketing.codex.${run.productId}`)).get();
  const day = new Date(now).toISOString().slice(0, 10);
  const usage = connection ? { used: (app.db.select().from(settings).where(eq(settings.key, `marketing.codex-calls.${run.productId}.${day}`)).get()?.value as number | undefined) ?? 0, limit: 20, resetsAt: Date.parse(day + 'T00:00:00Z') + 86400000 } : null;
  const runtime = app.runtimeSupervisor?.view();
  const blockers = [
    ...(!connection && (currentTasks.length || owns) && runtime?.status === 'attention' ? [runtime.detail] : []),
    ...(owns ? app.operations?.readiness(run.productId).blockers ?? [] : []),
    ...deliveries.filter(d => d.status === 'attention').map(d => d.detail),
    ...(failed?.error ? [failed.error] : []),
    ...(run.status === 'attention' ? run.steps.filter(s => s.error).map(s => s.error!) : []),
  ];
  const result: TeamMonitor = { observedAt: now, worker, state: 'waiting', headline: 'Waiting for the next cycle', detail: 'No model task is running for this campaign.', next: 'The worker will check the saved schedule and available buyer evidence.', nextAt: null, lastActivityAt: activity[0]?.at ?? null, blockers: [...new Set(blockers)], activity, tasks: tasks.slice(0, 30).map(t => ({ id: t.id, role: taskRoles.get(t.id)!, status: t.status, model: t.model, updatedAt: t.updatedAt, detail: t.error ?? (typeof t.output?.summary === 'string' ? t.output.summary : '') })), deliveries: deliveries.slice(0, 100), usage };
  if (run.status === 'cancelled' || run.execution?.status === 'complete' || (run.execution && run.execution.endsAt <= now)) Object.assign(result, { state: 'complete', headline: run.status === 'cancelled' ? 'Campaign cancelled' : 'Campaign finished', detail: 'The saved outputs and delivery receipts remain available.', next: 'Review the results or create a new campaign.' });
  else if (run.status === 'paused' || run.execution?.status === 'paused' || (run.execution && (!owns || !operation?.running))) Object.assign(result, { state: 'paused', headline: 'Campaign paused', detail: run.execution?.detail ?? 'Preparation is paused. Completed work is saved.', next: owns || !run.execution ? 'Resume the team when ready.' : 'Operating settings changed. Save the intended campaign settings and approve the updated scope.' });
  else if (run.status === 'review' || (run.status === 'approved' && !run.execution)) Object.assign(result, { state: 'review', headline: 'Campaign has not started', detail: 'The specialists prepared the packet. Execution is waiting for you to start it.', next: 'Review the campaign settings, then approve and start execution.' });
  else if (app.env.SIGNAL_OFFLINE === '1' || worker.status !== 'online') Object.assign(result, { state: 'offline', headline: app.env.SIGNAL_OFFLINE === '1' ? 'Offline preview' : 'Worker activity is unconfirmed', detail: app.env.SIGNAL_OFFLINE === '1' ? 'Network and model execution are disabled in offline mode. The activity below is saved history.' : health ? 'No recent worker heartbeat. Saved task states may be out of date.' : 'This version has not recorded a worker heartbeat yet.', next: app.env.SIGNAL_OFFLINE === '1' ? 'Turn off offline mode to allow authorized campaign work to continue.' : 'Keep Signal open and check the agent runtime. This view does not prove background work is running.' });
  else if (active) Object.assign(result, { state: 'working', headline: `${taskRoles.get(active.id)} is working`, detail: tools.find(t => t.taskId === active.id)?.name ? `Latest recorded step: ${toolLabel[tools.find(t => t.taskId === active.id)!.name] ?? tools.find(t => t.taskId === active.id)!.name}. Waiting for the next result.` : 'The task has started. Waiting for its first saved tool result.', next: 'The next result will appear automatically. You can pause the team at any time.' });
  else if (usage && usage.used >= usage.limit) Object.assign(result, { state: 'waiting', headline: 'Daily model allowance reached', detail: `${usage.used} of ${usage.limit} Codex calls used for this business today.`, next: 'Model work can continue after the allowance resets, subject to the campaign schedule.', nextAt: usage.resetsAt });
  else if (blockers.length) Object.assign(result, { state: 'attention', headline: 'The campaign needs attention', detail: blockers[0], next: failed ? 'The next eligible cycle can retry. Resolve any account or source issue shown below.' : 'Resolve the listed issue before this work can proceed.' });
  else if (currentTasks.length) Object.assign(result, { state: 'waiting', headline: 'Campaign work is queued', detail: `${currentTasks.length} task${currentTasks.length === 1 ? '' : 's'} waiting for the shared worker.`, next: 'The team will continue when the worker and model are available.' });
  else if (owns && operation) {
    const stall = acquisitionStall(app, run.productId);
    const recovery = recoveryRecord(app, run.productId);
    const capacity = deliveryCapacity(operation, allDeliveries, now);
    const pending = deliveries.find(d => ['queued', 'dispatching', 'retry'].includes(d.status));
    if (pending) Object.assign(result, { headline: pending.status === 'dispatching' ? 'Delivering campaign content' : 'Delivery is queued', detail: pending.detail, next: 'A confirmed destination receipt will appear here after publication.', nextAt: pending.nextAttemptAt > now ? pending.nextAttemptAt : null });
    else if (!capacity.canPublish && !capacity.canReply) Object.assign(result, { headline: 'Waiting within the daily delivery limits', detail: `${capacity.publicationUsed} publication slots and ${capacity.replyUsed} reply slots are in use. Pending deliveries also reserve capacity.`, next: 'Work can continue when a delivery slot becomes available.' });
    else if (stall) Object.assign(result, { state: 'attention', headline: 'Acquisition is stalled', detail: stall, next: recovery?.revision === operation.revision ? 'Review the recovery brief in My marketer and Content & responses. Source checks continue; another identical plan will not be queued.' : 'The next worker cycle will prepare one recovery brief with a reachable placement and a concrete handoff.', nextAt: null });
    else if (operation.mode === 'acquisition') Object.assign(result, { headline: currentDecision?.status === 'awaiting-access' ? 'A placement needs access' : 'Looking for a suitable buyer request', detail: currentDecision?.detail ?? 'Buyer research is enabled. No suitable placement has been selected for this campaign yet.', next: 'New qualifying requests trigger another acquisition check. A completed check does not mean a post was published.', nextAt: operation.discovery?.enabled ? app.operations!.discovery.snapshot(operation).nextAttemptAt : null });
    else Object.assign(result, { nextAt: operation.lastCycleAt === null ? now : operation.lastCycleAt + operation.intervalHours * 3600000, next: 'The next scheduled cycle prepares another delivery within the approved campaign.' });
  }
  return result;
}
