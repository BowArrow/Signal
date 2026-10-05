import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { ConnectionService, type CredentialVault } from '../src/core/connections/service.js';
import { SalesService } from '../src/core/sales/service.js';
import { settings } from '../src/core/db/schema.js';
import type { ConnectedAccount } from '../src/shared/connections.js';
import type { SalesMessage } from '../src/shared/sales.js';
import { SalesReplyService } from '../src/core/sales/reply-service.js';
import type { SalesReply, SalesSequence } from '../src/shared/sales-replies.js';
if (process.env['SIGNAL_OFFLINE'] !== '1' || !process.env['SIGNAL_DATABASE_URL']?.includes('sales-validation')) throw new Error('Only isolated offline validation databases are supported.');
const app = createApp({ logger: silentLogger });
try {
  const vault: CredentialVault = { available: () => false, get: () => undefined, set: () => { throw new Error('No credentials in this fixture'); }, delete: () => {} };
  const connection = new ConnectionService(app, vault); app.connections = connection; const productId = connection.view().products[0]!.id;
  const outlook = process.env['SIGNAL_UI_INBOX_PROVIDER'] === 'outlook';
  const account: ConnectedAccount = { id: 'fixture-inbox', productId, provider: outlook ? 'outlook' : 'gmail', label: outlook ? 'Lemonade Outlook inbox' : 'Lemonade sales inbox', status: 'verified', detail: 'Offline fixture only', identity: 'sales@example.org', site: '', username: '', createdAt: Date.now(), checkedAt: Date.now(), expiresAt: null, refreshable: false, grantedScopes: outlook ? ['Mail.ReadWrite', 'Mail.Send'] : [] };
  app.db.insert(settings).values({ key: `connections.account.${account.id}`, value: account }).run();
  const service = new SalesService(app); app.sales = service; service.configure(productId, { accountId: account.id, since: Date.now() - 86400000, autoSync: true, aiTriage: true });
  const row: SalesMessage = { id: 'fixture-message', productId, accountId: account.id, providerId: 'fixture-provider-message', threadId: 'fixture-thread', internetId: '<fixture@example.org>', from: 'buyer@example.com', subject: 'Can Lemonade help with my project files?', body: 'I spend too much time finding project files. Can I try Lemonade?\n\n<script>throw new Error("mail must never execute")</script>', receivedAt: Date.now() - 60000, automated: false, bounce: false, truncated: false, observedAt: Date.now(), category: 'inquiry', summary: 'A prospective customer asks to try Lemonade to help find project files.', evidence: 'Can I try Lemonade?', leadId: null, reviewedAt: null, triageAttemptAt: Date.now() };
  app.db.insert(settings).values({ key: 'sales.message.fixture-message', value: row }).run();
  const replies = new SalesReplyService(app); app.salesReplies = replies;
  const reply: SalesReply = { id: 'fixture-reply', productId, accountId: account.id, messageId: row.id, revision: 0, from: account.identity, to: row.from, threadId: row.threadId, inReplyTo: row.internetId, internetId: '<signal-fixture@example.org>', subject: `Re: ${row.subject}`, body: 'Lemonade helps you find project files. Learn more at https://siplemona.de.\n\nLemonade team · AI assistant', bodyHash: 'fixture', sourceBody: row.body, sourceProviderId: row.providerId, sourceReceivedAt: row.receivedAt, status: 'queued', detail: 'Offline fixture: no real email can be sent.', createdAt: Date.now(), updatedAt: Date.now(), dueAt: Date.now() + 300000, attemptedAt: null, acceptedId: null, sentAt: null, checkedAt: null, reconciliationChecks: 0, prepareAttempts: 1, retryAt: null, evidence: [{ url: 'https://siplemona.de', quote: 'Lemonade helps you find project files.', observedAt: Date.now() }] };
  app.db.insert(settings).values({ key: 'sales.reply.fixture-reply', value: reply }).run();
  const sequence: SalesSequence = { id: 'fixture-sequence', rootReplyId: 'fixture-root', lastReplyId: 'fixture-root', productId, accountId: account.id, messageId: row.id, leadId: 'fixture-sequence-lead', to: 'sequence-buyer@example.com', revision: 0, delays: [2, 5], completedSteps: 0, status: 'active', detail: 'Offline fixture: waiting for a customer reply.', startedAt: Date.now(), updatedAt: Date.now(), nextAt: Date.now() + 2 * 86400000 };
  app.db.insert(settings).values({ key: 'sales.sequence.fixture-sequence', value: sequence }).run();
} finally { app.close(); }
