import { readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { products, settings, growthTasks, marketingMessages, marketingDrafts } from '../src/core/db/schema.js';
import { guidePlan } from '../src/core/marketing/store.js';
import { marketingAction } from '../src/core/marketing/actions.js';
import { saveMission } from '../src/core/marketing/mission.js';
import { draftInputSchema } from '../src/shared/marketing.js';
import { LEMONADE_MISSION } from '../src/shared/revenue-mission.js';
import { executeMarketingTool } from '../src/core/marketing/agent.js';
import { z } from 'zod';

// Invoked by the installer only after Signal is closed and package hashes match.
const receiptPath = resolve('data/operations-validation/mission/review.json');
const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
const task = receipt.task as typeof growthTasks.$inferInsert;
if (task.status !== 'done' || task.kind !== 'marketing' || !task.model?.startsWith('gpt-') || !Array.isArray(receipt.messages) || !Array.isArray(receipt.drafts)) throw new Error('A completed live Codex review is required.');
const folder = join(process.env['APPDATA']!, 'signal');
const app = createApp({ databaseUrl: process.env['SIGNAL_MISSION_DATABASE'] ?? join(folder, 'signal.db'), logger: silentLogger, migrate: false });
try {
  const product = app.db.select().from(products).where(eq(products.key, 'lemonade')).get();
  if (!product || product.id !== task.productId) throw new Error('Review belongs to a different business.');
  const backupFolder = join(folder, 'backups', `before-mission-${Date.now()}`); mkdirSync(backupFolder, { recursive: true });
  await app.dbHandle.raw.backup(join(backupFolder, 'signal.db'));
  if (!guidePlan(app, product.id)) await marketingAction(app, { type: 'guide-plan', productId: product.id, value: { goal: 'first-sales', audience: '' } });
  const put = (key: string, value: unknown) => app.db.insert(settings).values({ key, value, updatedAt: Date.now() }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: Date.now() } }).run();
  app.db.transaction(() => {
    // The owner requested a dots handoff to conserve Codex usage. Keep the optional
    // Codex connection and its daily inference schedule off until explicitly chosen.
    if (!app.db.select().from(settings).where(eq(settings.key, `marketing.mission.${product.id}`)).get()) saveMission(app, product.id, { ...LEMONADE_MISSION, active: false });
    if (!app.db.select().from(growthTasks).where(eq(growthTasks.id, task.id!)).get()) {
      app.db.insert(growthTasks).values(task).run();
      for (const row of receipt.messages) {
        if (row.productId !== product.id || row.taskId !== task.id || !['user', 'assistant'].includes(row.role)) throw new Error('Unexpected review message.');
        z.string().min(1).max(20000).parse(row.body);
        app.db.insert(marketingMessages).values(row).run();
      }
      for (const row of receipt.drafts) {
        if (row.productId !== product.id || row.status !== 'draft' || row.publishedUrl !== null) throw new Error('Only unpublished review drafts can be imported.');
        draftInputSchema.parse(row.value);
        app.db.insert(marketingDrafts).values(row).run();
      }
    }
    put(`marketing.guide-task.${task.id}`, true);
    if (!app.db.select().from(settings).where(eq(settings.key, `marketing.mission-review.${product.id}`)).get()) put(`marketing.mission-review.${product.id}`, { at: task.createdAt, taskId: task.id });
  });
  const kickoff = readFileSync('docs/lemonade-mission-kickoff.md', 'utf8');
  const prepared: { title: string; section: string; end: string; kind: 'social'; targetUrl: string }[] = [
    { title: 'Mission kickoff: LinkedIn report comparison trial', section: '## LinkedIn draft', end: '## Bluesky draft', kind: 'social', targetUrl: 'https://siplemona.de/?utm_source=linkedin&utm_medium=social&utm_campaign=lemonade_mission_oct13' },
    { title: 'Mission kickoff: Bluesky report comparison trial', section: '## Bluesky draft', end: '## How this test becomes useful', kind: 'social', targetUrl: 'https://siplemona.de/?utm_source=bluesky&utm_medium=social&utm_campaign=lemonade_mission_oct13' },
  ];
  for (const draft of prepared) {
    const body = kickoff.split(draft.section)[1]?.split(draft.end)[0]?.trim();
    if (!body) throw new Error('Kickoff draft is missing.');
    const exists = app.db.select().from(marketingDrafts).where(eq(marketingDrafts.productId, product.id)).all().some(d => d.value.title === draft.title);
    if (!exists) await executeMarketingTool(app, product.id, 'draft.save', { title: draft.title, body, kind: draft.kind, targetUrl: draft.targetUrl, evidence: ['https://siplemona.de/'] }, new AbortController().signal);
  }
  console.log(JSON.stringify({ saved: true, product: 'Lemonade', taskId: task.id, missionKey: `marketing.mission.${product.id}`, targetCents: LEMONADE_MISSION.targetCents, deadline: '2026-12-31 America/Los_Angeles', drafts: app.db.select().from(marketingDrafts).where(eq(marketingDrafts.productId, product.id)).all().filter(d => d.value.title.startsWith('Mission kickoff:')).map(d => ({ id: d.id, title: d.value.title, status: d.status })), externalDeliveries: 0 }));
} finally { app.close(); }
