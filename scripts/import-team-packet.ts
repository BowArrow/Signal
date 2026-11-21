import { join, resolve } from 'node:path';
import { and, eq, inArray, like } from 'drizzle-orm';
import { openDatabase } from '../src/core/db/client.js';
import { growthTasks, marketingDrafts, marketingMessages, marketingToolCalls, products, settings } from '../src/core/db/schema.js';
import type { TeamRun } from '../src/shared/marketing-team.js';

// Imports only a completed, internally prepared packet. Never starts workers,
// copies account credentials or approves any content for publication.
const sourcePath = resolve('data/team-validation/lemonade-live.db');
const targetPath = join(process.env['APPDATA']!, 'signal', 'signal.db');
const source = openDatabase(sourcePath); const target = openDatabase(targetPath);
try {
  const row = source.db.select().from(settings).where(like(settings.key, 'marketing.team.run.%')).all().at(-1);
  if (!row) throw new Error('No live packet exists.');
  const run = row.value as TeamRun;
  if (run.status !== 'review' || !run.steps.every(s => s.status === 'done' && s.artifact)) throw new Error('Only a completed packet can be imported.');
  const sourceProduct = source.db.select().from(products).where(eq(products.id, run.productId)).get();
  const ownerProduct = target.db.select().from(products).where(and(eq(products.key, sourceProduct?.key ?? ''), eq(products.enabled, true))).get();
  if (!ownerProduct) throw new Error('Matching installed business not found.');
  if (target.db.select().from(settings).where(eq(settings.key, row.key)).get()) throw new Error('This packet was already imported.');
  const existing = target.db.select().from(settings).where(like(settings.key, 'marketing.team.run.%')).all().map(r => r.value as TeamRun);
  if (existing.some(r => r.productId === ownerProduct.id && !['cancelled', 'approved'].includes(r.status))) throw new Error('The installed business already has an unfinished team campaign.');
  const tasks = source.db.select().from(growthTasks).where(eq(growthTasks.productId, run.productId)).all();
  if (tasks.some(t => ['running', 'queued'].includes(t.status))) throw new Error('Wait for the source worker to stop before importing.');
  console.log(JSON.stringify({ product: ownerProduct.name, campaignId: run.id, completedRoles: run.steps.length, draftCount: run.steps.filter(s => s.draftId).length, apply: process.argv.includes('--apply') }));
  if (process.argv.includes('--apply')) target.db.transaction(() => {
    const put = (key: string, value: unknown) => target.db.insert(settings).values({ key, value, updatedAt: Date.now() }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: Date.now() } }).run();
    for (const task of tasks) target.db.insert(growthTasks).values({ ...task, productId: ownerProduct.id }).run();
    const ids = tasks.map(t => t.id);
    if (ids.length) {
      for (const message of source.db.select().from(marketingMessages).where(inArray(marketingMessages.taskId, ids)).all()) target.db.insert(marketingMessages).values({ ...message, productId: ownerProduct.id }).run();
      for (const receipt of source.db.select().from(marketingToolCalls).where(inArray(marketingToolCalls.taskId, ids)).all()) target.db.insert(marketingToolCalls).values({ ...receipt, productId: ownerProduct.id }).run();
    }
    for (const step of run.steps) if (step.draftId) {
      const draft = source.db.select().from(marketingDrafts).where(eq(marketingDrafts.id, step.draftId)).get();
      if (!draft || draft.status !== 'draft') throw new Error('A prepared draft is missing or no longer in review.');
      target.db.insert(marketingDrafts).values({ ...draft, productId: ownerProduct.id }).run();
    }
    // Carry actual model usage into the destination allowance; importing must not reset it.
    for (const usage of source.db.select().from(settings).where(like(settings.key, `marketing.codex-calls.${run.productId}.%`)).all()) {
      const key = usage.key.replace(run.productId, ownerProduct.id);
      const prior = target.db.select().from(settings).where(eq(settings.key, key)).get()?.value as number | undefined;
      put(key, (prior ?? 0) + Number(usage.value));
    }
    const codex = source.db.select().from(settings).where(eq(settings.key, `marketing.codex.${run.productId}`)).get();
    if (codex) put(`marketing.codex.${ownerProduct.id}`, codex.value);
    const scope = 'Prepared with live source research in an isolated workspace. Connected-account, inbox and commercial snapshots were unavailable during preparation. Refresh the analyst in this business before drawing account or revenue conclusions.';
    put(row.key, { ...run, productId: ownerProduct.id, brief: { ...run.brief, constraints: `${run.brief.constraints}\n\nPreparation context: ${scope}` }, feedback: scope });
    put(`marketing.team.import.${run.id}`, { source: 'Isolated live preparation', importedAt: Date.now(), sourceProductId: run.productId, productId: ownerProduct.id });
  });
} finally { source.close(); target.close(); }
