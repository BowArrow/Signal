import { join } from 'node:path';
import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { OperationsService } from '../src/core/operations/service.js';
const app = createApp({ databaseUrl: join(process.env['APPDATA']!, 'signal', 'signal.db'), logger: silentLogger, migrate: false });
const operations = new OperationsService(app); app.operations = operations;
try {
  for (const thread of operations.conversations.view().slice(0, 10)) {
    await operations.conversations.refresh(thread.productId, thread.deliveryId);
    const current = operations.conversations.view().find(s => s.deliveryId === thread.deliveryId)!;
    console.log(JSON.stringify({ deliveryId: current.deliveryId, status: current.status, observedResponses: current.replies.length, detail: current.detail }));
  }
} finally { await operations.stop(); app.close(); }
