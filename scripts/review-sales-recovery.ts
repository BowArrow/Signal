// Re-evaluate the two recovery briefs against the repaired acceptance checks.
// Retains evidence and useful drafts; queues only a scoped research/draft retry.
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { newId } from '../src/core/lib/id.js';
import { applyGrowthAction } from '../src/core/growth/store.js';
import { marketingAction } from '../src/core/marketing/actions.js';
import { remember } from '../src/core/marketing/store.js';
import { validateRecoveryDraft } from '../src/core/marketing/acquisition-recovery.js';
import { growthTasks, marketingDrafts, marketingMessages, products, settings } from '../src/core/db/schema.js';
process.env['SIGNAL_OFFLINE'] = '1';
if (!process.env['APPDATA']) throw new Error('Owner profile required.');
const app = createApp({ databaseUrl: join(process.env['APPDATA'], 'signal', 'signal.db'), logger: silentLogger, migrate: false });
try {
  for (const key of ['lemonade', 'cinegen']) {
    const product = app.db.select().from(products).where(eq(products.key, key)).get()!;
    const marker = `marketing.recovery-quality-review.2026-11-12.${product.id}`;
    if (app.db.select().from(settings).where(eq(settings.key, marker)).get()) continue;
    const record = app.db.select().from(settings).where(eq(settings.key, `marketing.acquisition-recovery.${product.id}`)).get()?.value as { taskId: string; revision: number } | undefined;
    const policy = app.db.select().from(settings).where(eq(settings.key, `operations.policy.${product.id}`)).get()?.value as { running: boolean; revision: number; teamEndsAt?: number } | undefined;
    if (!record || !policy?.running || record.revision !== policy.revision || policy.teamEndsAt && policy.teamEndsAt <= Date.now()) continue;
    const draftId = key === 'cinegen' ? 'XnqicTirbKRztFOVyL11h' : 'sv_8efblgfHNk4uBxE5nx';
    const draft = app.db.select().from(marketingDrafts).where(eq(marketingDrafts.id, draftId)).get();
    const task = app.db.select().from(growthTasks).where(eq(growthTasks.id, record.taskId)).get();
    if (!draft || draft.productId !== product.id || task?.status !== 'done') continue;
    let reason = '';
    try { validateRecoveryDraft(app, product.id, task.id, draft.value); } catch (error) { reason = error instanceof Error ? error.message : 'Recovery evidence is incomplete.'; }
    if (!reason) continue;
    if (key === 'cinegen') await marketingAction(app, { type: 'draftStatus', productId: product.id, id: draft.id, status: 'rejected' });
    app.db.transaction(() => {
      app.db.update(growthTasks).set({ status: 'failed', error: `Post-run quality review: ${reason}`, updatedAt: app.clock.now() }).where(eq(growthTasks.id, task.id)).run();
      app.db.insert(marketingMessages).values({ id: newId(), productId: product.id, role: 'assistant', taskId: task.id, body: key === 'cinegen' ? 'Review rejected the previous recovery draft: its placement was a placeholder and its free-versus-paid explanation was unclear. A replacement must cite a real placement and current product facts.' : 'The saved brief correctly identifies blockers, but it does not yet supply a source-checked placement. I retained it as research and requested a concrete replacement brief.', createdAt: app.clock.now() }).run();
      remember(app, product.id, { title: 'Recovery quality correction', body: `Draft ${draft.id} is not an accepted acquisition placement. ${reason} No public placement occurred. Use current product and placement sources; do not repeat the rejected draft as evidence.`, kind: 'observation', source: `draft:${draft.id}`, confidence: 1 });
      applyGrowthAction(app, { type: 'retry', taskId: task.id });
      app.db.insert(settings).values({ key: marker, value: { taskId: task.id, draftId, reason }, updatedAt: app.clock.now() }).run();
    });
    console.log(JSON.stringify({ business: key, originalDraft: draft.id, qualityIssue: reason, scopedRetryQueued: true }));
  }
} finally { app.close(); }
