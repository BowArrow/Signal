import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { ConnectionService, type CredentialVault } from '../src/core/connections/service.js';
import { RevenueService } from '../src/core/revenue/service.js';
import { settings, studioLeads } from '../src/core/db/schema.js';
import { purchaseContactHash } from '../src/core/revenue/identity.js';
import type { ConnectedAccount } from '../src/shared/connections.js';
import type { RevenuePayment } from '../src/shared/revenue.js';
if (process.env['SIGNAL_OFFLINE'] !== '1' || !process.env['SIGNAL_DATABASE_URL']?.includes('revenue-validation')) throw new Error('Only isolated offline validation databases are supported.');
const app = createApp({ logger: silentLogger });
try {
  const vault: CredentialVault = { available: () => false, get: () => undefined, set: () => { throw new Error('No credentials in this fixture'); }, delete: () => {} };
  const connection = new ConnectionService(app, vault); app.connections = connection;
  const productId = connection.view().products[0]!.id;
  const account: ConnectedAccount = { id: 'fixture-stripe', productId, provider: 'stripe', label: 'Stripe test fixture', status: 'verified', detail: 'Offline test only', identity: 'Test', site: '', username: '', createdAt: Date.now(), checkedAt: Date.now(), expiresAt: null, refreshable: false, grantedScopes: [] };
  app.db.insert(settings).values({ key: `connections.account.${account.id}`, value: account }).run();
  const service = new RevenueService(app); service.configure(productId, { accountId: account.id, stripeProductIds: ['lemonade'], since: Date.now() - 86400000, live: false });
  const state = service.states()[0]!;
  app.db.insert(settings).values({ key: `revenue.config.${productId}`, value: { ...state, status: 'current', lastCompleteAt: Date.now(), scanned: 2, detail: 'Simulated payment records for desktop validation.' } }).onConflictDoUpdate({ target: settings.key, set: { value: { ...state, status: 'current', lastCompleteAt: Date.now(), scanned: 2, detail: 'Simulated payment records for desktop validation.' } } }).run();
  const rows: RevenuePayment[] = [{ id: 'ch_fixtureusd', productId, accountId: account.id, live: false, currency: 'usd', captured: 4900, refunded: 1200, disputed: false, createdAt: Date.now(), observedAt: Date.now(), campaignId: null, attribution: 'none' }, { id: 'ch_fixturejpy', productId, accountId: account.id, live: false, currency: 'jpy', captured: 600, refunded: 0, disputed: true, createdAt: Date.now(), observedAt: Date.now(), campaignId: null, attribution: 'none' }];
  app.db.insert(settings).values({ key: `revenue.snapshot.${productId}`, value: rows }).onConflictDoUpdate({ target: settings.key, set: { value: rows } }).run();
  rows[0] = { ...rows[0]!, live: true, contactHash: purchaseContactHash(account.id, 'fixture-buyer@example.test'), contactMatch: 'available' };
  app.db.insert(studioLeads).values({ id: 'fixture-paid-lead', productId, value: { name: 'Fixture buyer', contact: 'fixture-buyer@example.test', stage: 'customer', permission: 'existing-conversation', followUpAt: null, source: 'Offline validation', notes: '', campaignId: '' }, createdAt: Date.now() }).run();
  app.db.insert(settings).values({ key: `revenue.snapshot.${productId}`, value: rows }).onConflictDoUpdate({ target: settings.key, set: { value: rows } }).run();
} finally { app.close(); }
