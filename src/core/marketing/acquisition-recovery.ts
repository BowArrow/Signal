import { and, eq, inArray } from 'drizzle-orm';
import type { App } from '../app.js';
import { growthTasks, marketingToolCalls, settings } from '../db/schema.js';
import { acquisitionStall, recoveryRecord, salesDiagnosis } from './sales-diagnosis.js';
import { queueMarketing } from './store.js';

/** One useful recovery brief per operating revision, with one delayed failure retry. */
export function scheduleAcquisitionRecovery(app: App, productId: string) {
  if (app.env.SIGNAL_OFFLINE === '1') return;
  const reason = acquisitionStall(app, productId);
  if (!reason) return;
  const state = app.operations!.state(productId);
  const saved = recoveryRecord(app, productId);
  const same = saved?.revision === state.revision;
  const previous = same ? app.db.select().from(growthTasks).where(eq(growthTasks.id, saved.taskId)).get() : undefined;
  if (same && (previous?.status !== 'failed' || saved.attempts >= 2 || app.clock.now() - saved.at < 86400000)) return;
  if (app.db.select().from(growthTasks).where(and(eq(growthTasks.productId, productId), eq(growthTasks.kind, 'marketing'), inArray(growthTasks.status, ['queued', 'running']))).get()) return;
  const diagnosis = salesDiagnosis(app, productId);
  const taskId = queueMarketing(app, productId, `Recover a stalled acquisition experiment. ${reason}\nEvidence: ${JSON.stringify(diagnosis)}\nInspect the current product and search/read sources. Prepare ONE finished recovery brief as a draft: a narrowly defined buyer and job, their current alternative, a reachable placement URL with observed access/rules, one demonstrated first-value task, finished copy with a tracked link, a seven-day distribution test, and an observation window that allows the trial to mature. Include a second placement only as fallback if the first lacks access. Differentiate verified facts from proposals; do not invent a prospect, permission, test result, price or successful demonstration. If search is unavailable, save the exact blocker and a useful manual placement handoff. Choose buyer conversations or a concrete placement before more generic blog posts. No videos are required. Respect the existing campaign audience and offer. Research and drafting only: do not send, publish, change operating settings, spend, or relax qualification. Save the brief with draft.save and explain the single next decision in My marketer.`);
  const put = (key: string, value: unknown) => app.db.insert(settings).values({ key, value, updatedAt: app.clock.now() }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: app.clock.now() } }).run();
  put(`marketing.guide-task.${taskId}`, true);
  put(`marketing.recovery-task.${taskId}`, { productId, revision: state.revision });
  put(`marketing.acquisition-recovery.${productId}`, { taskId, revision: state.revision, at: app.clock.now(), attempts: same ? saved.attempts + 1 : 1 });
  if (state.teamRunId) put(`marketing.team.recovery-task.${taskId}`, { runId: state.teamRunId, productId, revision: state.revision, role: 'strategy' });
  return taskId;
}

export function assertRecoveryActive(app: App, productId: string, taskId: string) {
  const marker = app.db.select().from(settings).where(eq(settings.key, `marketing.recovery-task.${taskId}`)).get()?.value as { productId: string; revision: number } | undefined;
  if (!marker) return;
  const state = app.operations?.state(productId);
  if (marker.productId !== productId || !state?.running || state.revision !== marker.revision || state.teamEndsAt && state.teamEndsAt <= app.clock.now()) throw new Error('Acquisition recovery was paused, expired or replaced.');
}

/** A saved placeholder or unsupported placement is not a completed recovery. */
export function validateRecoveryDraft(app: App, productId: string, taskId: string, draft: { body: string; kind: string; targetUrl: string; evidence: string[] }) {
  if (!['article', 'demo'].includes(draft.kind) || draft.body.length < 350) throw new Error('Save the finished recovery brief as article or demo, including buyer, alternative, first task, copy and decision rule.');
  if (/\[(?:need|insert|add|todo)|\brecentWork\b|confirm the best URL|placement (?:URL|link) here/i.test(draft.body)) throw new Error('Replace placeholders with a concrete placement and source evidence.');
  if (!/demonstration status:\s*not verified/i.test(draft.body)) throw new Error('Include "Demonstration status: not verified". This recovery task has not run the product demonstration.');
  let placement: URL;
  try { placement = new URL(draft.targetUrl); } catch { throw new Error('Set targetUrl to the specific HTTPS placement being proposed.'); }
  if (placement.protocol !== 'https:' || placement.username || placement.password) throw new Error('Use a public HTTPS placement URL.');
  const observations = app.db.select().from(marketingToolCalls).where(and(eq(marketingToolCalls.taskId, taskId), eq(marketingToolCalls.productId, productId), eq(marketingToolCalls.status, 'done'))).all().flatMap(row => {
    if (!['product.inspect', 'web.read'].includes(row.name)) return [];
    try { const result = JSON.parse(row.result) as { url?: string; body?: string }; return typeof result.url === 'string' && typeof result.body === 'string' && result.body.trim().length >= 200 ? [{ url: result.url, product: row.name === 'product.inspect' }] : []; } catch { return []; }
  });
  const cited = observations.filter(o => draft.evidence.includes(o.url));
  if (!cited.some(o => o.product) || !cited.some(o => !o.product && new URL(o.url).hostname === placement.hostname)) throw new Error('Cite the product.inspect URL and a substantive web.read page from the proposed placement host. Search snippets and unread rules do not establish placement evidence. If access is blocked, read a documented fallback placement; never invent permission.');
  if (/consistent (?:shots|characters)|identical characters/i.test(draft.body) && !/vary|not guaranteed/i.test(draft.body)) throw new Error('Do not promise character consistency. Generated results can vary.');
  if (/free/i.test(draft.body) && /storyboard|character (?:creator|tools)|full AI generation/i.test(draft.body) && !/paid/i.test(draft.body)) throw new Error('Distinguish the free editor from paid planning and AI features.');
}
