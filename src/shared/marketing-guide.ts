import { z } from 'zod';
import type { OperationsView } from './operations.js';
import type { MarketingView } from './marketing.js';

export const guidePlanSchema = z.object({
  goal: z.enum(['first-sales', 'more-trials', 'repeatable-sales']),
  audience: z.string().trim().max(500),
}).strict();
export type GuidePlan = z.infer<typeof guidePlanSchema>;
export const GUIDE_GOALS: Record<GuidePlan['goal'], { label: string; why: string }> = {
  'first-sales': { label: 'Find my first paying customers', why: 'Start with a small group who have a problem your product can solve. Learn what helps them decide to buy.' },
  'more-trials': { label: 'Help more people try my product', why: 'Give the right people one useful task to try. A download alone does not tell us whether they found value.' },
  'repeatable-sales': { label: 'Make sales more consistent', why: 'Compare recent purchases with the activities that led to them before repeating or expanding a channel.' },
};
export type GuideDestination =
  | { screen: 'operations'; section: 'overview' | 'research' | 'conversations' | 'deliveries' | 'settings' }
  | { screen: 'sales'; section: 'prospects' | 'drafts' | 'conversations' | 'setup' }
  | { screen: 'marketing'; section: 'content' }
  | { screen: 'connections' | 'settings' | 'analytics' | 'revenue' };
export interface GuideStep { id: string; title: string; detail: string; why: string; button: string; destination?: GuideDestination; }
export interface GuideSummary { next: GuideStep; needsYou: GuideStep[]; status: string; statusDetail: string; working: boolean; }

/** Recommendations are derived from saved evidence, never invented by a model. */
export function marketingGuide(view: OperationsView, marketing: MarketingView, productId: string, now: number): GuideSummary {
  const state = view.states.find(s => s.productId === productId);
  const cycle = view.acquisition?.find(c => c.productId === productId && c.revision === state?.revision);
  const handoffs = view.handoffs?.find(h => h.productId === productId);
  const outreach = view.outreachActivity?.find(a => a.productId === productId);
  const readiness = view.readiness?.find(r => r.productId === productId);
  const needsYou: GuideStep[] = [];
  if (handoffs?.open) needsYou.push({ id: 'handoff', title: `${handoffs.open} conversation${handoffs.open === 1 ? '' : 's'} need your judgment`, detail: 'Read the customer’s question and Signal’s explanation before deciding how to respond.', why: 'A buying question or uncertain reply deserves a human decision. Signal has saved the context for you.', button: 'Review conversations', destination: { screen: 'sales', section: 'conversations' } });
  const publicResponses = view.conversations?.filter(c => c.productId === productId && c.archivedAt == null).reduce((sum, c) => sum + c.replies.filter(r => !c.reviewedUris.includes(r.uri)).length, 0) ?? 0;
  if (publicResponses) needsYou.push({ id: 'public-responses', title: `${publicResponses} public response${publicResponses === 1 ? '' : 's'} to read`, detail: 'Someone responded to a tracked public conversation. Read their words before deciding the next step.', why: 'A response can reveal a useful question or an objection. It is not automatically a sales lead.', button: 'Read public responses', destination: { screen: 'operations', section: 'conversations' } });
  if (view.deliveries.some(d => d.productId === productId && d.status === 'attention')) needsYou.push({ id: 'delivery', title: 'Check a publication that needs attention', detail: 'Open its delivery record to see what happened and what can be done next.', why: 'An uncertain delivery may already be public. Checking it avoids sending the same message twice.', button: 'Review delivery', destination: { screen: 'operations', section: 'deliveries' } });
  if ((outreach?.draftsForReview ?? 0) + (outreach?.placementsForReview ?? 0) > 0) needsYou.push({ id: 'outreach', title: 'Review prepared introductions and placements', detail: 'Check the recipient, proposed message and any community requirements.', why: 'Signal can prepare the work. You decide whether this is an appropriate introduction or placement.', button: 'Review suggestions', destination: { screen: 'sales', section: 'drafts' } });
  if (marketing.drafts.some(d => d.productId === productId && d.status === 'draft')) needsYou.push({ id: 'drafts', title: 'Give feedback on prepared copy', detail: 'Open your drafts to edit the wording, approve it for later use, or reject an angle.', why: 'Your feedback helps the agent learn your voice. Approving a draft does not publish it.', button: 'Review copy', destination: { screen: 'marketing', section: 'content' } });

  const health = view.runtimeHealth;
  const healthy = health?.status === 'ready' && health.checkedAt !== null && health.checkedAt <= now && now - health.checkedAt < 5 * 60000;
  const working = Boolean(state?.running && !view.offline && (readiness?.needsAgents === false || healthy) && readiness?.ready);
  const status = view.offline ? 'Offline preview' : !state?.running ? 'Marketing is paused' : working ? 'Marketing is enabled' : 'Marketing needs a check';
  const statusDetail = view.offline ? 'Research and sending are disabled in this session.' : !state?.running ? 'You can plan and review here. Open operating settings when you are ready to run activities.' : working ? 'Signal can work within your saved limits while the app stays open. Enabled does not mean a message has been sent.' : health?.detail || 'The saved Run setting is on, but current readiness has not been confirmed.';
  let next: GuideStep;
  const plan = marketing.guidePlans?.find(p => p.productId === productId)?.value;
  const diagnosis = marketing.salesDiagnoses?.find(d => d.productId === productId);
  if (needsYou[0] && ['handoff', 'public-responses'].includes(needsYou[0].id)) next = needsYou[0];
  else if (!plan) next = { id: 'goal', title: 'Tell me what we’re working toward', detail: 'Choose a goal below. If you are unsure who your buyers are, leave the audience blank and we can work it out together.', why: 'The goal gives our research and conversations a purpose. Saving it does not start a campaign.', button: 'Choose my goal' };
  else if (!view.offline && state?.running && !healthy && readiness?.needsAgents !== false) next = { id: 'runtime', title: 'Get your marketing assistant ready', detail: statusDetail, why: 'A saved Run setting is not proof that the agent can work. Check the model connection before relying on new research or drafts.', button: 'Check agent settings', destination: { screen: 'settings' } };
  else if (!view.offline && diagnosis && (['access', 'measurement'].includes(diagnosis.stage) || diagnosis.recovery?.status === 'done')) next = diagnosis.next;
  else if (needsYou.length && needsYou[0]!.id !== 'drafts') next = needsYou[0]!;
  else if (view.offline) next = { id: 'offline-plan', title: 'Plan your next small test', detail: 'You can review saved research and refine your focus in this offline session. New research and sending will wait.', why: 'Choose a specific problem and a relevant audience before preparing more content.', button: 'Review saved research', destination: { screen: 'operations', section: 'research' } };
  else if (!state?.accountIds.length || readiness?.blockers.length) next = { id: 'setup', title: 'Choose how we’ll reach people', detail: readiness?.blockers.join(' ') || 'Connect a place where your intended buyers spend time, then choose the activities you want Signal to run.', why: 'A finished draft needs a relevant audience and a working destination before it can help you find customers.', button: 'Review channel setup', destination: { screen: 'operations', section: 'settings' } };
  else if (diagnosis) next = diagnosis.next;
  else if (needsYou.length) next = needsYou[0]!;
  else if (plan.goal === 'repeatable-sales') next = { id: 'results', title: 'Check which activity led to purchases', detail: 'Review the reporting period and refresh your payment records before choosing what to repeat.', why: 'Posts and visits are useful clues. Recent, attributable purchases are stronger evidence for where to focus.', button: 'Review sales evidence', destination: { screen: 'revenue' } };
  else if (plan.goal === 'more-trials') next = { id: 'trials', title: 'Find where people stop before trying', detail: 'Check recorded visits, downloads and signups. Missing measurement should stay unknown.', why: 'If people arrive but do not try the product, a clearer first task may help more than another post.', button: 'Review the buyer journey', destination: { screen: 'analytics' } };
  else next = { id: 'research', title: cycle?.status === 'no-fit' ? 'Find a better match for your offer' : 'Find people with a problem you can solve', detail: cycle?.status === 'no-fit' ? 'The last requests were not a product fit. Review the searches before widening the campaign.' : 'Look for a specific request or a relevant business. Check the whole problem before preparing an introduction.', why: 'Someone mentioning a keyword is not necessarily a buyer. A small, relevant audience gives us a useful first sales test.', button: 'Review buyer research', destination: { screen: 'operations', section: 'research' } };
  return { next, needsYou, status, statusDetail, working };
}
