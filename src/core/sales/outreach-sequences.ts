import type { OutreachJob, OutreachPolicyState, OutreachSequenceView } from '../../shared/outreach.js';

const DAY = 86400000;
export function outreachHistory(job: OutreachJob, jobs: readonly OutreachJob[]): OutreachJob[] {
  if (!job.followUp) return [];
  const history: OutreachJob[] = []; let previousId = job.followUp.previousId;
  if (!Number.isInteger(job.followUp.step) || job.followUp.step < 1 || job.followUp.step > 2) throw new Error('Invalid outreach follow-up step.');
  for (let step = job.followUp.step - 1; step >= 0; step--) {
    const previous = jobs.find(j => j.id === previousId);
    if (!previous || previous.status !== 'sent' || !previous.acceptedId || previous.sentAt === null || !previous.body || previous.productId !== job.productId || previous.leadId !== job.leadId || previous.accountId !== job.accountId || previous.to !== job.to || previous.from !== job.from || previous.revision !== job.revision || previous.threadId !== job.followUp.threadId || previous.subject.replace(/^re:\s*/i, '') !== job.subject.replace(/^re:\s*/i, '') || (previous.followUp?.step ?? 0) !== step || (previous.followUp?.rootId ?? previous.id) !== job.followUp.rootId) throw new Error('The preceding outreach messages are not confirmed for this conversation.');
    history.unshift(previous); previousId = previous.followUp?.previousId ?? '';
  }
  if (history[0]?.id !== job.followUp.rootId || history.at(-1)?.providerInternetId !== job.followUp.inReplyTo || JSON.stringify(history.map(j => j.providerInternetId)) !== JSON.stringify(job.followUp.references)) throw new Error('Outreach thread references changed.');
  return history;
}

export function nextOutreachStep(root: OutreachJob, policy: OutreachPolicyState, jobs: readonly OutreachJob[], now: number) {
  if (root.followUp || root.followUpsStopped || root.status !== 'sent' || root.sentAt === null || !root.providerInternetId || !root.threadId || !policy.enabled || root.revision !== policy.revision || root.accountId !== policy.accountId || now - root.sentAt > 30 * DAY) return null;
  let previous = root;
  for (let step = 1; step <= policy.followUpDays.length; step++) {
    const matches = jobs.filter(j => j.followUp?.rootId === root.id && j.followUp.step === step);
    if (matches.length > 1) return null;
    const existing = matches[0];
    if (!existing) return { previous, step, dueAt: previous.sentAt! + policy.followUpDays[step - 1]! * DAY };
    if (existing.status !== 'sent' || existing.sentAt === null || !existing.providerInternetId) return null;
    previous = existing;
  }
  return null;
}

export function outreachSequenceView(root: OutreachJob, policy: OutreachPolicyState, jobs: readonly OutreachJob[], now: number): OutreachSequenceView | null {
  if (root.followUp || root.status !== 'sent') return null;
  const children = jobs.filter(j => j.followUp?.rootId === root.id);
  if (!policy.followUpDays.length && !children.length && !root.followUpsStopped) return null;
  const completedSteps = children.filter(j => j.status === 'sent').length;
  const base = { productId: root.productId, rootId: root.id, to: root.to, completedSteps, totalSteps: root.revision === policy.revision ? policy.followUpDays.length : children.length, nextAt: null };
  if (root.followUpsStopped || root.revision !== policy.revision || !policy.enabled) return { ...base, status: 'stopped', detail: root.followUpsStopped?.reason ?? 'Outreach settings changed.' };
  const pending = children.find(j => j.status !== 'sent');
  if (pending) return { ...base, status: ['queued', 'preparing'].includes(pending.status) ? 'waiting' : 'attention', detail: pending.detail, nextAt: pending.status === 'queued' ? pending.dueAt : pending.retryAt };
  const next = nextOutreachStep(root, policy, jobs, now);
  if (next) return { ...base, status: 'waiting', nextAt: next.dueAt, detail: 'Waiting for the next follow-up, then fresh product, consent and conversation checks.' };
  return { ...base, status: completedSteps >= policy.followUpDays.length ? 'completed' : 'attention', detail: completedSteps >= policy.followUpDays.length ? 'All configured follow-ups are complete. No further outreach is scheduled.' : 'The original sent copy or sequence is unavailable. No further send is scheduled.' };
}
