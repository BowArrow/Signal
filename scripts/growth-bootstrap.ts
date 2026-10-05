/** Prepare real local growth plans. Never fabricates results or publishes assets. */
import { mkdirSync } from 'node:fs';
import { createApp } from '../src/core/app.js';
import { openDatabase } from '../src/core/db/client.js';
import { GrowthEngine } from '../src/core/growth/engine.js';
import {
  applyGrowthAction,
  dashboard,
  DEFAULT_SETTINGS,
  queueTask,
} from '../src/core/growth/store.js';
import { growthPlans } from '../src/core/db/schema.js';

mkdirSync('data/growth-validation', { recursive: true });
const existing = openDatabase('data/signal.db');
await existing.raw.backup(
  `data/growth-validation/before-growth-${Date.now()}.db`,
);
existing.close();
const app = createApp();
const engine = new GrowthEngine(app);
try {
  applyGrowthAction(app, {
    type: 'settings',
    value: { ...DEFAULT_SETTINGS, enabled: true },
  });
  const runtime = await engine.checkRuntime();
  if (!runtime.ok) throw new Error(runtime.detail);
  for (const product of dashboard(app).products)
    applyGrowthAction(app, { type: 'research', productId: product.id });
  for (let i = 0; i < 38 && (await engine.runNext(['research'])); i++) {
    const state = dashboard(app);
    console.log(
      state.products
        .map(
          (p) =>
            `${p.name}: ${p.channels.filter((c) => c.idea).length}/19 researched, ${p.tasks.filter((t) => t.status === 'failed').length} failures`,
        )
        .join(' | '),
    );
  }
  // Plan the first affordable tests after all channels have been considered.
  app.db.update(growthPlans).set({ lastScheduledAt: null }).run();
  engine.schedule();
  for (const product of dashboard(app).products)
    queueTask(app, product.id, 'analysis', product.id);
  // Existing community work remains queued for the desktop worker.
  for (
    let i = 0;
    i < 12 && (await engine.runNext(['research', 'campaign', 'analysis']));
    i++
  )
    console.log(`Prepared campaign/memo task ${i + 1}`);
  console.log(
    JSON.stringify(
      dashboard(app).products.map((p) => ({
        product: p.name,
        researched: p.channels.filter((c) => c.idea).length,
        experiments: p.experiments.length,
        campaigns: p.tasks.filter(
          (t) => t.kind === 'campaign' && t.status === 'done',
        ).length,
        failures: p.tasks
          .filter((t) => t.status === 'failed')
          .map((t) => ({ kind: t.kind, error: t.error })),
      })),
      null,
      2,
    ),
  );
} finally {
  await engine.stop();
  app.close();
}
