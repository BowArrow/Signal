import { createApp } from '../src/core/app.js';
import { GrowthEngine } from '../src/core/growth/engine.js';
import { dashboard, queueTask } from '../src/core/growth/store.js';
const app = createApp();
const engine = new GrowthEngine(app);
try {
  for (const product of dashboard(app).products) {
    for (const exp of product.experiments.filter((e) => e.status === 'planned'))
      queueTask(app, product.id, 'campaign', exp.id);
    queueTask(app, product.id, 'analysis', product.id);
  }
  for (
    let i = 0;
    i < 8 && (await engine.runNext(['campaign', 'analysis']));
    i++
  )
    console.log(`Validated campaign/memo ${i + 1}/8`);
  console.log(
    JSON.stringify(
      dashboard(app).products.map((p) => ({
        name: p.name,
        latest: p.tasks
          .filter((t) => ['campaign', 'analysis'].includes(t.kind))
          .slice(0, 4)
          .map((t) => ({ kind: t.kind, status: t.status, error: t.error })),
      })),
      null,
      2,
    ),
  );
} finally {
  await engine.stop();
  app.close();
}
