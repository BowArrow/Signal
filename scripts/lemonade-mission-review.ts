import { app as electron } from 'electron';
import Database from 'better-sqlite3';
import { join, resolve } from 'node:path';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { eq, inArray } from 'drizzle-orm';
import { createApp } from '../src/core/app.js';
import { selectNativeBinding } from '../src/core/db/client.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { AccountVault } from '../electron/main/connection-handlers.js';
import { ConnectionService } from '../src/core/connections/service.js';
import { RevenueService } from '../src/core/revenue/service.js';
import { AnalyticsService } from '../src/core/analytics/service.js';
import { OperationsService } from '../src/core/operations/service.js';
import { marketingAction } from '../src/core/marketing/actions.js';
import { marketingView } from '../src/core/marketing/store.js';
import { connectCodex, missionView, queueMissionReview, saveMission } from '../src/core/marketing/mission.js';
import { GrowthEngine } from '../src/core/growth/engine.js';
import { growthTasks, marketingMessages, marketingDrafts, products } from '../src/core/db/schema.js';
import { LEMONADE_MISSION } from '../src/shared/revenue-mission.js';

// Read-only owner snapshot. This starts no scheduler and sends no outreach.
async function main() {
const owner = join(process.env['APPDATA']!, 'signal');
const folder = resolve('data/operations-validation/mission');
mkdirSync(folder, { recursive: true });
const profile = join(folder, `electron-profile-${Date.now()}`);
mkdirSync(profile, { recursive: true });
copyFileSync(join(owner, 'Local State'), join(profile, 'Local State'));
electron.disableHardwareAcceleration(); electron.setPath('userData', profile);
await electron.whenReady();
const database = join(folder, `review-${Date.now()}.db`);
const source = new Database(join(owner, 'signal.db'), { readonly: true, nativeBinding: selectNativeBinding() });
await source.backup(database); source.close();
const app = createApp({ databaseUrl: database, logger: silentLogger, migrate: false });
try {
  const vault = new AccountVault(join(owner, 'account-credentials'));
  const transient = new Map<string, string>();
  app.connections = new ConnectionService(app, { available: () => vault.available(), get: key => transient.get(key) ?? vault.get(key), set: (key, value) => { transient.set(key, value); }, delete: key => { transient.delete(key); } });
  app.revenue = new RevenueService(app); app.analytics = new AnalyticsService(app); app.operations = new OperationsService(app);
  const product = app.db.select().from(products).where(eq(products.key, 'lemonade')).get();
  if (!product) throw new Error('Lemonade not found.');
  marketingView(app);
  // Only the disposable snapshot has its old queue cleared.
  app.db.update(growthTasks).set({ status: 'cancelled', lease: null }).where(inArray(growthTasks.status, ['queued', 'running'])).run();
  saveMission(app, product.id, LEMONADE_MISSION);
  await marketingAction(app, { type: 'guide-plan', productId: product.id, value: { goal: 'first-sales', audience: '' } });
  const revenueState = app.revenue.states().find(s => s.productId === product.id);
  let syncError: string | undefined;
  if (revenueState) {
    try { await app.revenue.sync(product.id); } catch (error) { syncError = String(error); }
    if (app.revenue.states().find(s => s.productId === product.id)?.status === 'attention') {
      try { await app.connections.revenueRead(product.id, revenueState, new AbortController().signal, { cursor: '', startedAt: Date.now() }); }
      catch (error) { syncError = String(error).replace(/(?:sk|rk)_(?:live|test)_[A-Za-z0-9]+/g, '[redacted]'); }
    }
  }
  console.log(JSON.stringify({ stage: 'evidence', mission: missionView(app, product.id), syncError, accounts: app.connections.accounts().filter(a => a.productId === product.id).map(a => ({ provider: a.provider, status: a.status })), analytics: app.analytics.snapshot(product.id) ? { observedAt: app.analytics.snapshot(product.id)!.observedAt, startDate: app.analytics.snapshot(product.id)!.startDate, endDate: app.analytics.snapshot(product.id)!.endDate } : null }));
  if (process.argv.includes('--evidence-only')) return;
  await connectCodex(app, product.id);
  const taskId = queueMissionReview(app, product.id);
  console.log(JSON.stringify({ stage: 'codex-review', taskId }));
  await new GrowthEngine(app).runNext(['marketing'], [taskId]);
  const task = app.db.select().from(growthTasks).where(eq(growthTasks.id, taskId)).get();
  const messages = app.db.select().from(marketingMessages).where(eq(marketingMessages.taskId, taskId)).all();
  const drafts = app.db.select().from(marketingDrafts).where(eq(marketingDrafts.productId, product.id)).all().filter(d => d.createdAt >= task!.createdAt);
  const receipt = { checkedAt: Date.now(), database, mission: missionView(app, product.id), task, messages, drafts, ownerDatabaseChanged: false, externalDeliveries: 0 };
  writeFileSync(join(folder, 'review.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ stage: 'finished', status: task?.status, error: task?.error, reply: messages.find(m => m.role === 'assistant')?.body, draftTitles: drafts.map(d => d.value.title) }));
  if (task?.status !== 'done') process.exitCode = 1;
} finally { app.close(); electron.exit(process.exitCode ?? 0); }
}
void main().catch(error => { console.error(String(error)); electron.exit(1); });
