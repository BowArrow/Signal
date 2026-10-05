// Apply the scheduler fix to an already-running owner operation. No credential
// access, model execution or external delivery from this helper.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { products } from '../src/core/db/schema.js';
import { ConnectionService } from '../src/core/connections/service.js';
import { OperationsService } from '../src/core/operations/service.js';

const app = createApp({ databaseUrl: join(process.env['APPDATA']!, 'signal', 'signal.db'), logger: silentLogger, migrate: false });
try {
  app.connections = new ConnectionService(app, { available: () => false, get: () => undefined, set: () => { throw Error('No credential writes'); }, delete: () => {} });
  const operations = new OperationsService(app); app.operations = operations;
  const product = app.db.select().from(products).where(eq(products.key, 'lemonade')).get(); assert.ok(product);
  const before = operations.state(product.id);
  assert.ok(before.running && before.authorizedAt && before.mode === 'acquisition', 'The owner must have started Run marketing.');
  const candidates = operations.discovery.context(before).length;
  operations.schedule(product.id);
  const after = operations.state(product.id);
  console.log(JSON.stringify({ business: product.name, running: after.running, candidateBatch: candidates, queued: after.taskId !== before.taskId, taskId: after.taskId, policyUnchanged: after.revision === before.revision, externalDeliveriesByHelper: 0 }));
} finally { app.close(); }
