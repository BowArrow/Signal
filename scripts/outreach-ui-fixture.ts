import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { ConnectionService } from '../src/core/connections/service.js';
import { SalesService } from '../src/core/sales/service.js';
import { OutreachService } from '../src/core/sales/outreach-service.js';
import { OperationsService } from '../src/core/operations/service.js';
import { settings, studioLeads } from '../src/core/db/schema.js';
import type { ConnectedAccount } from '../src/shared/connections.js';
import type { ProspectState } from '../src/shared/prospects.js';
import type { OutreachJob } from '../src/shared/outreach.js';
if (process.env['SIGNAL_OFFLINE'] !== '1' || !process.env['SIGNAL_DATABASE_URL']?.includes('outreach-validation')) throw new Error('An isolated offline outreach profile is required.');
const app = createApp({ logger: silentLogger });
try {
  app.connections = new ConnectionService(app, { available: () => false, get: () => undefined, set: () => { throw new Error('No credentials in this fixture'); }, delete: () => {} });
  const productId = app.connections.view().products[0]!.id;
  for (const id of ['fixture-inbox', 'fixture-website']) {
    const account: ConnectedAccount = { id, productId, provider: id === 'fixture-inbox' ? 'gmail' : 'signal-blog', label: id === 'fixture-inbox' ? 'Offline business inbox' : 'Offline website', identity: 'sales@example.org', username: '', site: '', status: 'verified', detail: 'Synthetic fixture only', checkedAt: Date.now(), createdAt: Date.now(), expiresAt: null, refreshable: false, grantedScopes: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'] };
    app.db.insert(settings).values({ key: `connections.account.${id}`, value: account }).run();
  }
  app.sales = new SalesService(app); app.sales.configure(productId, { accountId: 'fixture-inbox', since: Date.now() - 86400000, autoSync: true, aiTriage: true });
  app.operations = new OperationsService(app); app.operations.configure(productId, { objective: 'Help buyers find a practical product workflow.', accountIds: ['fixture-website'], dailyLimit: 1, intervalHours: 24 });
  app.outreach = new OutreachService(app);
  app.db.insert(settings).values({ key: 'connections.account.fixture-mailchimp', value: { ...app.connections.accounts()[0], id: 'fixture-mailchimp', productId, provider: 'mailchimp', label: 'Offline Mailchimp audience', identity: 'Lemonade' } }).run();
  app.db.insert(settings).values({ key: `prospects.source.${productId}`, value: { productId, accountId: 'fixture-mailchimp', listId: 'audience1', enabled: true, businessConfirmed: true, marketingPermissionId: '', revision: 1, audienceName: 'Lemonade signups', status: 'current', detail: 'Synthetic audience source for offline UI validation.', watermark: Date.now(), scanSince: 0, scanUntil: null, offset: 0, lastCompleteAt: Date.now(), lastFullAt: Date.now(), nextAttemptAt: Date.now() + 300000, scanned: 2, added: 1, suppressed: 1 } satisfies ProspectState }).run();
  app.db.insert(settings).values({ key: `prospects.website.${productId}`, value: { productId, provider: 'signal-blog', accountId: 'fixture-website', listId: 'website', enabled: true, businessConfirmed: true, marketingPermissionId: '', revision: 1, audienceName: 'Lemonade website requests', status: 'current', detail: 'Synthetic website source for offline UI validation.', watermark: Date.now(), scanSince: 0, scanUntil: null, offset: 0, lastCompleteAt: Date.now(), lastFullAt: null, nextAttemptAt: Date.now() + 300000, scanned: 1, added: 1, suppressed: 0, websiteCursor: 1, websiteHead: null } satisfies ProspectState }).run();
  app.outreach.configure(productId, { enabled: false, accountId: 'fixture-inbox', objective: 'Offer a useful project-file workflow to opted-in prospects.', mailingAddress: 'Example Business, 123 Example Street, Example City', dailyLimit: 2, delayMinutes: 10 });
  app.db.insert(studioLeads).values({ id: 'fixture-opt-in', productId, value: { name: 'Offline prospect', contact: 'prospect@example.test', stage: 'discovered', permission: 'opted-in', source: 'Synthetic opt-in fixture', notes: '', followUpAt: null, campaignId: '' }, createdAt: Date.now() }).run();
  const sentAt = Date.now() - 86400000;
  app.db.insert(settings).values({ key: 'sales.outreach.fixture-sent', value: {
    id: 'fixture-sent', productId, leadId: 'fixture-opt-in', accountId: 'fixture-inbox', revision: 2,
    from: 'sales@example.org', to: 'prospect@example.test', subject: 'Try a document question with Lemonade',
    body: 'Synthetic sent copy for an offline desktop check.', bodyHash: 'fixture', internetId: '<fixture@example.org>',
    providerInternetId: '<fixture@example.org>', leadFingerprint: 'fixture', status: 'sent', detail: 'Synthetic confirmed copy; no email was sent.',
    createdAt: sentAt, updatedAt: sentAt, dueAt: sentAt, attemptedAt: sentAt, acceptedId: 'fixture-remote-id', sentAt,
    threadId: 'fixture-thread', checkedAt: sentAt, reconciliationChecks: 0, prepareAttempts: 1, retryAt: null, evidence: [],
  } satisfies OutreachJob }).run();
} finally { app.close(); }
