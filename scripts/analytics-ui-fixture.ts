import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { ConnectionService, type CredentialVault } from '../src/core/connections/service.js';
import { AnalyticsService } from '../src/core/analytics/service.js';
import { settings } from '../src/core/db/schema.js';
import type { ConnectedAccount } from '../src/shared/connections.js';
import type { AnalyticsSnapshot } from '../src/shared/analytics.js';
import { SeoService } from '../src/core/seo/service.js';
if (process.env['SIGNAL_OFFLINE'] !== '1' || !process.env['SIGNAL_DATABASE_URL']?.includes('analytics-validation')) throw new Error('Only isolated offline validation databases are supported.');
const app = createApp({ logger: silentLogger });
try {
  const vault: CredentialVault = { available: () => false, get: () => undefined, set: () => { throw new Error('No credentials in this fixture'); }, delete: () => {} };
  const connection = new ConnectionService(app, vault); app.connections = connection;
  const productId = connection.view().products[0]!.id;
  const account: ConnectedAccount = { id: 'fixture-ga4', productId, provider: 'ga4', label: 'Website analytics fixture', status: 'verified', detail: 'Offline test only', identity: 'Test', site: '', username: '', createdAt: Date.now(), checkedAt: Date.now(), expiresAt: null, refreshable: false, grantedScopes: [] };
  app.db.insert(settings).values({ key: `connections.account.${account.id}`, value: account }).run();
  const service = new AnalyticsService(app); service.configure(productId, { accountId: account.id, propertyId: '1234' });
  const state = service.states()[0]!;
  const current = { ...state, status: 'limited', lastCompleteAt: Date.now(), detail: 'Simulated analytics report for desktop validation.' };
  app.db.insert(settings).values({ key: `analytics.config.${productId}`, value: current }).onConflictDoUpdate({ target: settings.key, set: { value: current } }).run();
  const snapshot: AnalyticsSnapshot = { productId, accountId: account.id, propertyId: '1234', hostname: state.hostname, startDate: '2026-08-17', endDate: '2026-09-15', timeZone: 'America/Los_Angeles', currencyCode: 'USD', observedAt: Date.now(), limitations: ['This report uses sampled data.'], rows: [{ campaignId: 'fixture-campaign', attribution: 'matched', sessions: 240, engagedSessions: 120, keyEvents: 12, ecommercePurchases: 2, purchaseRevenue: 49.5 }, { campaignId: null, attribution: 'none', sessions: 60, engagedSessions: 20, keyEvents: 1, ecommercePurchases: 0, purchaseRevenue: 0 }] };
  snapshot.funnel = { status: 'available', limitations: [], rows: [{ campaignId: 'fixture-campaign', attribution: 'matched', event: 'begin_checkout', count: 7 }] };
  app.db.insert(settings).values({ key: `analytics.snapshot.${productId}`, value: snapshot }).run();
  const searchAccount = { ...account, id: 'fixture-search', provider: 'search-console', label: 'Search Console fixture' };
  app.db.insert(settings).values({ key: 'connections.account.fixture-search', value: searchAccount }).run();
  const seo = new SeoService(app); seo.configure(productId, { accountId: 'fixture-search', siteUrl: 'sc-domain:siplemona.de' });
  app.db.insert(settings).values({ key: `seo.snapshot.${productId}`, value: { productId, accountId: 'fixture-search', siteUrl: 'sc-domain:siplemona.de', observedAt: Date.now(), startDate: '2026-08-28', endDate: '2026-09-24', limitations: ['Search impressions are not total keyword volume.'], rows: [{ query: 'compare client reports', page: 'https://siplemona.de/', clicks: 2, impressions: 40, ctr: 0.05, position: 14 }] } }).run();
} finally { app.close(); }
