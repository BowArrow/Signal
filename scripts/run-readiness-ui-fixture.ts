import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { settings } from '../src/core/db/schema.js';
import { ConnectionService } from '../src/core/connections/service.js';
import { OperationsService } from '../src/core/operations/service.js';
import { SalesService } from '../src/core/sales/service.js';
import { growthSettings } from '../src/core/growth/store.js';
import { marketingSettings, saveMarketingSettings } from '../src/core/marketing/store.js';
import { runtimeSettings, saveRuntimeSettings } from '../src/core/runtime/settings.js';
import { insertSource } from '../tests/helpers/db.js';
import type { ConnectedAccount } from '../src/shared/connections.js';

if (process.env['SIGNAL_OFFLINE'] !== '0' || !process.env['SIGNAL_DATABASE_URL']?.includes('run-validation')) throw new Error('Use an isolated read-only Run validation profile.');
const app = createApp({ logger: silentLogger });
try {
  // A disabled source prevents normal first-launch seeding and public ingestion.
  insertSource(app.dbHandle, { enabled: false });
  app.connections = new ConnectionService(app, { available: () => false, get: () => undefined, set: () => { throw new Error('No credentials in this fixture'); }, delete: () => {} });
  const productId = app.connections.view().products[0]!.id;
  const account: ConnectedAccount = { id: 'read-only-fixture', productId, provider: 'gmail', label: 'Isolated read-only inbox', identity: 'fixture@example.test', status: 'verified', site: '', username: '', detail: 'Synthetic connection, no token or real mailbox access.', createdAt: Date.now(), checkedAt: Date.now(), expiresAt: null, refreshable: false, grantedScopes: ['https://www.googleapis.com/auth/gmail.readonly'] };
  app.db.insert(settings).values({ key: `connections.account.${account.id}`, value: account }).run();
  app.operations = new OperationsService(app); app.sales = new SalesService(app);
  app.sales.configure(productId, { accountId: account.id, since: Date.now() - 86400000, autoSync: true, aiTriage: false });
  app.operations.configure(productId, { objective: 'Monitor the isolated synthetic inbox without AI or publishing.', accountIds: [], intervalHours: 24, dailyLimit: 1 });
  saveRuntimeSettings(app, { ...runtimeSettings(app), provider: 'local', autoStart: false });
  const model = 'signal-validation-deliberately-unavailable:latest';
  app.db.insert(settings).values({ key: 'growth.runtime.v1', value: { ...growthSettings(app), enabled: false, model, pipelineModel: model } }).onConflictDoUpdate({ target: settings.key, set: { value: { ...growthSettings(app), enabled: false, model, pipelineModel: model } } }).run();
  saveMarketingSettings(app, { ...marketingSettings(app), enabled: false, model });
} finally { app.close(); }
