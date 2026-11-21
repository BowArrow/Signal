// One explicit retry after repairing draft persistence; no new delivery authority.
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { applyGrowthAction } from '../src/core/growth/store.js';
import { growthTasks, products, settings } from '../src/core/db/schema.js';
process.env['SIGNAL_OFFLINE'] = '1';
if (!process.env['APPDATA']) throw new Error('Windows owner profile required.');
const app = createApp({ databaseUrl: join(process.env['APPDATA'], 'signal', 'signal.db'), logger: silentLogger, migrate: false });
try {
  const product = app.db.select().from(products).where(eq(products.key, 'lemonade')).get();
  if (!product) throw new Error('Lemonade is not configured.');
  const recovery = app.db.select().from(settings).where(eq(settings.key, `marketing.acquisition-recovery.${product.id}`)).get()?.value as { taskId: string; revision: number } | undefined;
  const policy = app.db.select().from(settings).where(eq(settings.key, `operations.policy.${product.id}`)).get()?.value as { running: boolean; revision: number; teamEndsAt?: number } | undefined;
  if (!recovery || !policy?.running || recovery.revision !== policy.revision || policy.teamEndsAt && policy.teamEndsAt <= Date.now()) throw new Error('The original acquisition scope is no longer active.');
  const task = app.db.select().from(growthTasks).where(eq(growthTasks.id, recovery.taskId)).get();
  if (task?.status !== 'failed') { console.log('No failed recovery task to retry.'); }
  else {
    applyGrowthAction(app, { type: 'retry', taskId: task.id });
    console.log(JSON.stringify({ queued: true, originalTaskId: task.id, scope: 'Original research-and-draft permissions only' }));
  }
} finally { app.close(); }
