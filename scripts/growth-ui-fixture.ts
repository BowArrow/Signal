import { eq } from 'drizzle-orm';
import { createApp } from '../src/core/app.js';
import { dashboard } from '../src/core/growth/store.js';
import { growthChannels, growthTasks } from '../src/core/db/schema.js';
import { resolve, sep } from 'node:path';
const databaseUrl = process.argv[2];
if (
  !databaseUrl ||
  !resolve(databaseUrl).startsWith(resolve('data/growth-validation') + sep)
)
  throw new Error('Fixture database must stay inside growth-validation');
const app = createApp({ databaseUrl });
try {
  const product = dashboard(app).products[0]!;
  if (process.argv[3] === 'waiting') {
    const task = product.tasks.find((t) => t.status === 'queued');
    if (!task) throw new Error('No queued task for waiting-state fixture');
    app.db.update(growthTasks).set({ status: 'running', updatedAt: Date.now() - 65000, lease: 'ui-fixture' }).where(eq(growthTasks.id, task.id)).run();
  }
  app.db
    .update(growthChannels)
    .set({
      idea: {
        hypothesis: 'UI test fixture: a practical local AI tutorial',
        audience: 'Local AI developers',
        test: 'Publish a practical tutorial',
        successSignal: 'Three paying customers',
        estimatedCostCents: 0,
        estimatedHours: 2,
        potentialCustomers: 10,
        confidence: 0.3,
        rationale: 'Synthetic UI fixture, not real market evidence',
        evidenceIds: [],
      },
    })
    .where(
      eq(growthChannels.productId, product.id),
    )
    .run();
} finally {
  app.close();
}
