import { and, desc, eq, inArray, like } from 'drizzle-orm';
import type { App } from '../app.js';
import { growthTasks, marketingDrafts, settings } from '../db/schema.js';
import { revenueMissionSchema, scoreMission, type MissionView } from '../../shared/revenue-mission.js';
import { queueMarketing, requireProduct } from './store.js';
import { isTeamOperationTask } from './team-runtime.js';
import { CodexClient, inspectCodex } from '../llm/codex.js';
import { teamRuns, unfinishedTeam } from './team-store.js';

export interface CodexConnection { model: string; verifiedAt: number; detail: string; }
export function codexConnection(app: App, productId: string) { return app.db.select().from(settings).where(eq(settings.key, `marketing.codex.${productId}`)).get()?.value as CodexConnection | undefined; }
function put(app: App, key: string, value: unknown) { app.db.insert(settings).values({ key, value, updatedAt: app.clock.now() }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: app.clock.now() } }).run(); }
export async function connectCodex(app: App, productId: string) {
  requireProduct(app, productId);
  if (app.env.SIGNAL_OFFLINE === '1') throw new Error('Codex cannot connect in offline mode.');
  const { model } = await inspectCodex();
  const response = await new CodexClient({ model, offline: false }).complete({ model, prompt: 'Connection test. Return exactly SIGNAL_CONNECTED. Do not call tools.', maxTokens: 64 });
  if (response.text.trim() !== 'SIGNAL_CONNECTED') throw new Error('Codex responded, but did not pass the connection check.');
  put(app, `marketing.codex.${productId}`, { model: response.model, verifiedAt: app.clock.now(), detail: 'A live Codex reply completed successfully.' } satisfies CodexConnection);
}
export function missionView(app: App, productId: string): MissionView | undefined {
  const row = app.db.select().from(settings).where(eq(settings.key, `marketing.mission.${productId}`)).get();
  if (!row) return undefined;
  const value = revenueMissionSchema.parse(row.value);
  const run = app.db.select().from(settings).where(eq(settings.key, `marketing.mission-review.${productId}`)).get()?.value as { at: number; taskId: string } | undefined;
  const task = run ? app.db.select().from(growthTasks).where(eq(growthTasks.id, run.taskId)).get() : undefined;
  const waitingForReview = task?.status === 'done' && app.db.select().from(marketingDrafts).where(and(eq(marketingDrafts.productId, productId), eq(marketingDrafts.status, 'draft'))).all().some(d => d.createdAt >= task.createdAt);
  const score = scoreMission(value, productId, app.revenue?.states().find(s => s.productId === productId), app.revenue?.payments(productId) ?? [], app.clock.now());
  return { productId, value, score, lastTaskId: run?.taskId ?? null, waitingForReview, nextReviewAt: value.active && !waitingForReview && !score.reached && app.clock.now() < value.endsAt ? Math.max(value.startsAt, (run?.at ?? 0) + 86400000) : null };
}
export function saveMission(app: App, productId: string, input: unknown) {
  requireProduct(app, productId); const value = revenueMissionSchema.parse(input);
  app.db.transaction(() => {
    put(app, `marketing.mission.${productId}`, value);
    if (!value.active) {
      const id = missionView(app, productId)?.lastTaskId;
      if (id) app.db.update(growthTasks).set({ status: 'cancelled', updatedAt: app.clock.now() }).where(and(eq(growthTasks.id, id), eq(growthTasks.status, 'queued'))).run();
    }
  });
}
export function isCodexGuideTask(app: App, productId: string, taskId: string) { return Boolean(codexConnection(app, productId) && (app.db.select().from(settings).where(eq(settings.key, `marketing.guide-task.${taskId}`)).get() || isTeamOperationTask(app, productId, taskId))); }
export function codexGuideTaskIds(app: App) {
  return app.db.select().from(growthTasks).where(and(eq(growthTasks.kind, 'marketing'), eq(growthTasks.status, 'queued'))).all().filter(t => isCodexGuideTask(app, t.productId, t.id)).map(t => t.id);
}
export function reserveCodexCall(app: App, productId: string) {
  const key = `marketing.codex-calls.${productId}.${new Date(app.clock.now()).toISOString().slice(0, 10)}`;
  app.db.transaction(() => {
    const count = (app.db.select().from(settings).where(eq(settings.key, key)).get()?.value as number | undefined) ?? 0;
    if (count >= 20) throw new Error('The daily limit of 20 Codex calls for this business has been reached. Replies can continue tomorrow.');
    put(app, key, count + 1);
  });
}
export function queueMissionReview(app: App, productId: string) {
  const mission = missionView(app, productId); if (!mission) throw new Error('Save a revenue mission first.');
  if (!codexConnection(app, productId)) throw new Error('Connect Codex first.');
  const queued = app.db.select().from(growthTasks).where(and(eq(growthTasks.productId, productId), eq(growthTasks.kind, 'marketing'), inArray(growthTasks.status, ['queued', 'running']))).orderBy(desc(growthTasks.createdAt)).get();
  if (queued) throw new Error('Let the saved marketing task finish before starting another mission review.');
  return app.db.transaction(() => {
    const id = queueMarketing(app, productId, 'Review our revenue mission. Inspect the current product offer and commercial evidence. Decide the single most useful action toward collected revenue. Explain why, then prepare a concrete customer-facing sales draft supported by the product and buyer evidence. Use web.search to investigate an audience if qualified prospects are missing. Do not fabricate prospects, research or sales. Check the prior conversation and avoid repeating work waiting for a person. No paid campaigns or new sending authority. If revenue is unknown, explain the exact measurement blocker in your reply and continue useful buyer research. Do not save internal plans or measurement handoffs as customer content drafts. The current mission review task is not a prior review.');
    put(app, `marketing.guide-task.${id}`, true);
    put(app, `marketing.mission-review.${productId}`, { at: app.clock.now(), taskId: id });
    return id;
  });
}
export function scheduleMissionReviews(app: App) {
  if (app.env.SIGNAL_OFFLINE === '1') return;
  for (const row of app.db.select().from(settings).where(like(settings.key, 'marketing.mission.%')).all()) {
    const productId = row.key.slice('marketing.mission.'.length);
    if (teamRuns(app, productId).some(r => unfinishedTeam(r))) continue;
    const mission = missionView(app, productId);
    if (!mission?.value.active || mission.score.reached || !mission.nextReviewAt || mission.nextReviewAt > app.clock.now() || !codexConnection(app, productId)) continue;
    try { queueMissionReview(app, productId); } catch (error) { if (!(error instanceof Error && error.message.startsWith('Let the saved'))) throw error; }
  }
}
