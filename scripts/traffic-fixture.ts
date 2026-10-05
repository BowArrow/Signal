import type { App } from '../src/core/app.js';
import { AnalyticsService } from '../src/core/analytics/service.js';
import { analyticsDates } from '../src/core/analytics/ga4.js';
import { requireProduct } from '../src/core/marketing/store.js';
import { settings } from '../src/core/db/schema.js';
import type { Delivery } from '../src/shared/operations.js';
import type { ConnectedAccount } from '../src/shared/connections.js';

/** Isolated validation only. Synthetic traffic is never real commercial evidence. */
export function seedTrafficFixture(app: App, productId: string, accountId: string): Delivery[] {
  const product = requireProduct(app, productId), now = app.clock.now();
  const put = (key: string, value: unknown) => app.db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
  const account: ConnectedAccount = { id: 'fixture-ga4', productId, provider: 'ga4', label: 'Synthetic analytics fixture', site: '', username: '', identity: 'Fixture only', status: 'verified', detail: 'No real analytics access', checkedAt: now, createdAt: now, expiresAt: null, refreshable: false, grantedScopes: [] };
  put(`connections.account.${account.id}`, account);
  app.analytics = new AnalyticsService(app); app.analytics.configure(productId, { accountId: account.id, propertyId: '123' });
  const config = app.analytics.states().find(s => s.productId === productId)!;
  put(`analytics.config.${productId}`, { ...config, status: 'current', lastCompleteAt: now });
  const topics = product.key === 'cinegen' ? ['Develop a concept into a storyboard', 'Arrange generated clips into a sequence'] : ['Ask across related source documents', 'Check the cited source behind an answer'];
  const deliveries = topics.map((title, i): Delivery => {
    const id = `fixture-interest-${i + 1}`, createdAt = now - (20 - i * 10) * 86400000;
    return { id, productId, accountId, provider: 'bluesky', taskId: id, title, description: `${title}. Synthetic prior campaign for testing the selection workflow.`, body: `Our app: ${title}. ${product.utmBase}?utm_campaign=${id}`, evidence: [product.utmBase], revision: 1, status: 'published', fingerprint: id, slug: id, recordKey: id, author: product.name, createdAt, updatedAt: createdAt, nextAttemptAt: createdAt, attempts: 1, leaseId: '', leaseUntil: 0, detail: 'Simulated prior publication, not a live post.', receipt: { id, url: `https://example.test/${id}`, confirmedAt: createdAt } };
  });
  put(`analytics.snapshot.${productId}`, { productId, accountId: account.id, propertyId: config.propertyId, hostname: config.hostname, observedAt: now, timeZone: 'America/Los_Angeles', currencyCode: 'USD', ...analyticsDates(now, 'America/Los_Angeles'), limitations: [], rows: deliveries.map((d, i) => ({ campaignId: d.id, attribution: 'matched', sessions: 35 - i * 10, engagedSessions: 20 - i * 5, keyEvents: 0, ecommercePurchases: 0, purchaseRevenue: 0 })) });
  return deliveries;
}
