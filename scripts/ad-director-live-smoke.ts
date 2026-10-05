import { join, resolve } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { settings } from '../src/core/db/schema.js';
import { dashboard } from '../src/core/growth/store.js';
import { agentClient, agentModel } from '../src/core/runtime/client.js';
import { LocalRuntime } from '../src/core/runtime/manager.js';
import { runtimeSettings } from '../src/core/runtime/settings.js';
import { adDirectorPlans, requestAdConcepts, runAdDirector } from '../src/core/video/ad-director.js';

// Real research and CPU inference, isolated from owner delivery and publishing queues.
const folder = resolve('data/ad-director-live-validation', String(Date.now())); mkdirSync(folder, { recursive: true });
const owner = new DatabaseSync(join(process.env.APPDATA!, 'signal/signal.db'), { readOnly: true });
const app = createApp({ databaseUrl: join(folder, 'research.db'), logger: silentLogger });
const runtime = new LocalRuntime(app);
try {
  for (const key of ['runtime.provider.v1', 'growth.runtime.v1', 'marketing.operator.v1']) {
    const row = owner.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined;
    if (row) app.db.insert(settings).values({ key, value: JSON.parse(row.value) }).onConflictDoUpdate({ target: settings.key, set: { value: JSON.parse(row.value) } }).run();
  }
  const config = runtimeSettings(app);
  if (config.provider !== 'local' || config.localDevice !== 'cpu') throw new Error('This validation requires the configured CPU model.');
  const product = dashboard(app).products.find(p => p.name === 'Lemonade')!;
  const original = owner.prepare("SELECT id FROM products WHERE key='lemonade'").get() as { id: string };
  const brand = owner.prepare('SELECT value FROM settings WHERE key=?').get('studio.brand.' + original.id) as { value: string } | undefined;
  if (brand) app.db.insert(settings).values({ key: 'studio.brand.' + product.id, value: JSON.parse(brand.value) }).run();
  if (process.argv[2]) {
    const previous = JSON.parse(readFileSync(process.argv[2], 'utf8')).plans[0];
    app.db.insert(settings).values({ key: 'video.ad-director.live-reference', value: { ...previous, id: 'live-reference', productId: product.id, status: 'attention' } }).run();
  }
  await runtime.start();
  const signal = AbortSignal.timeout(20 * 60000);
  const plan = requestAdConcepts(app, product.id, { objective: 'Create a concrete, surprising ad about finding and using evidence across documents. Show the actual app and invite a product visit.', audience: 'Independent consultants who prepare client reports and proposals', ratio: '9:16' });
  const client = agentClient(app, signal);
  await runAdDirector(app, product.id, plan.id, plan.taskId, { available: () => client.available(), complete: async request => {
    const response = await client.complete(request);
    writeFileSync(join(folder, 'model-output.json'), JSON.stringify({ text: response.text }, null, 2));
    return response;
  } }, agentModel(app, 'marketing'), signal);
  writeFileSync(join(folder, 'result.json'), JSON.stringify({ mode: 'live public research and CPU model; isolated profile; no publishing or sending', plan: adDirectorPlans(app)[0] }, null, 2));
  console.log(JSON.stringify({ ok: true, folder, concepts: adDirectorPlans(app)[0]?.result?.concepts.length }));
} catch (error) {
  writeFileSync(join(folder, 'failure.json'), JSON.stringify({ error: error instanceof Error ? error.message : String(error), plans: adDirectorPlans(app) }, null, 2));
  throw error;
} finally { runtime.stop(); owner.close(); app.close(); }
