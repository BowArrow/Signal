import type { OperationsView } from './operations.js';
import { deliveryCapacity } from './delivery-capacity.js';
import { operationSlots } from './operations.js';

export interface OperationProgress {
  stage: 'paused' | 'attention' | 'researching' | 'preparing' | 'delivering' | 'waiting';
  title: string; detail: string; nextAt: number | null;
  observations: number; assessed: number; supported: number;
  publicReplies: number; websiteArticles: number; otherPosts: number;
}

/** Summarize saved evidence, never infer reach or revenue from completed tasks. */
export function operationProgress(view: OperationsView, productId: string, now: number): OperationProgress {
  const state = view.states.find(s => s.productId === productId);
  const cycle = view.acquisition?.find(c => c.productId === productId && c.revision === state?.revision);
  const research = view.discovery?.find(d => d.productId === productId && d.revision === state?.revision);
  const jobs = view.deliveries.filter(j => j.productId === productId);
  const published = jobs.filter(j => j.status === 'published' && j.receipt);
  const result: OperationProgress = {
    stage: 'paused', title: 'Ready to start', detail: 'Run marketing starts the saved research, delivery and Sales policies.', nextAt: null,
    observations: research?.findings.length ?? 0, assessed: cycle?.assessments.length ?? 0,
    supported: cycle?.assessments.filter(a => a.suitable).length ?? 0,
    publicReplies: published.filter(j => j.reply).length,
    websiteArticles: published.filter(j => j.provider === 'signal-blog').length,
    otherPosts: published.filter(j => !j.reply && j.provider !== 'signal-blog').length,
  };
  const set = (stage: OperationProgress['stage'], title: string, detail: string, nextAt: number | null = null) => ({ ...result, stage, title, detail, nextAt });
  const blockers = view.readiness?.find(r => r.productId === productId)?.blockers ?? [];
  if (view.offline) return set('attention', 'Offline mode is on', 'Turn off offline mode to research buyers and reach connected accounts.');
  if (blockers.length) return set('attention', 'Setup needs attention', blockers.join(' '));
  if (!state?.running) return result;
  const failed = jobs.find(j => j.status === 'attention');
  if (failed) return set('attention', 'A delivery needs attention', failed.detail + ' Review it in Delivery history; other configured activities may continue.');
  const pending = jobs.find(j => ['queued', 'dispatching', 'retry'].includes(j.status));
  if (pending) return set('delivering', pending.attempts ? 'Checking delivery' : 'Preparing delivery', pending.detail, pending.status === 'retry' ? pending.nextAttemptAt : null);
  const task = view.tasks.find(t => t.id === state.taskId && t.productId === productId);
  if (task && ['queued', 'running'].includes(task.status)) return set('preparing', task.status === 'queued' ? 'Waiting for the agent' : 'Agent is working', 'Checking product fit, writing useful copy and reviewing its claims. Completed work will appear in Delivery history.');
  if (task?.status === 'failed') return set('attention', 'The last marketing cycle failed', 'The last agent task did not finish. See its error below. Research and configured inbox monitoring can continue.');
  const capacity = deliveryCapacity(state, view.deliveries, now);
  const reserved = operationSlots(state.publicReplyLimit !== undefined ? jobs.filter(j => !j.reply) : jobs, productId, now);
  if (!capacity.canPublish && !capacity.canReply) {
    const expirations = reserved.filter((at): at is number => at !== null).sort((a, b) => a - b);
    const nextAt = capacity.separate ? null : expirations[reserved.length - state.dailyLimit] ?? null;
    return set('waiting', state.publicReplyLimit !== undefined ? 'Daily publishing and reply allowances used' : 'Daily publication allowance used', 'Public research, inbox monitoring and sales reporting can continue. The next publication waits for a rolling daily slot.', nextAt);
  }
  if (!research?.lastAttemptAt && state.discovery?.enabled) return set('researching', 'Starting buyer research', 'Searching the saved sources before assigning the first marketing cycle.');
  if (cycle?.status === 'awaiting-access') return set('attention', 'A distribution route is missing', cycle.detail);
  if (cycle?.status === 'attention') return set('attention', 'Buyer qualification needs attention', cycle.detail);
  const queue = view.acquisitionQueue?.find(q => q.productId === productId);
  if (queue?.count && queue.nextAt !== null) return set('researching', 'New requests awaiting assessment', `${queue.count} candidates are available for the next batch. The agent will check product fit before preparing a response.`, Math.max(now, queue.nextAt));
  const nextAt = queue ? queue.nextAt : state.lastCycleAt === null ? now : Math.max(now, state.lastCycleAt + state.intervalHours * 3600000);
  return set('researching', cycle?.status === 'no-fit' ? 'Looking for a better buyer fit' : 'Researching the next opportunity', cycle?.status === 'no-fit' ? 'The last requests did not fit the product. Signal continues searching and will assess new candidates at the next cycle; it has not contacted those people.' : 'While daily capacity remains, successful searches refresh every 15 minutes. Fresh candidates are assessed after each completed cycle; relevance checks still apply.', nextAt);
}
