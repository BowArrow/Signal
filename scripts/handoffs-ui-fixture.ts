import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { ConnectionService, type CredentialVault } from '../src/core/connections/service.js';
import { SalesService } from '../src/core/sales/service.js';
import { SalesReplyService } from '../src/core/sales/reply-service.js';
import { SalesHandoffs } from '../src/core/sales/handoffs.js';
import { settings } from '../src/core/db/schema.js';
import type { ConnectedAccount } from '../src/shared/connections.js';
import type { SalesMessage } from '../src/shared/sales.js';
import type { SalesReply } from '../src/shared/sales-replies.js';
if (process.env['SIGNAL_OFFLINE'] !== '1' || !process.env['SIGNAL_DATABASE_URL']?.includes('handoffs-validation')) throw new Error('Only isolated offline handoff fixtures are supported.');
const app = createApp({ logger: silentLogger });
try {
  const vault: CredentialVault = { available: () => false, get: () => undefined, set: () => { throw new Error('No credentials in this fixture'); }, delete: () => {} };
  const connection = new ConnectionService(app, vault); app.connections = connection; const productId = connection.view().products[0]!.id;
  const account: ConnectedAccount = { id: 'fixture-inbox', productId, provider: 'gmail', label: 'Lemonade sales inbox', status: 'verified', detail: 'Offline fixture only', identity: 'sales@example.org', site: '', username: '', createdAt: Date.now(), checkedAt: Date.now(), expiresAt: null, refreshable: false, grantedScopes: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'] };
  app.db.insert(settings).values({ key: `connections.account.${account.id}`, value: account }).run();
  const sales = new SalesService(app); app.sales = sales; sales.configure(productId, { accountId: account.id, since: Date.now() - 86400000, autoSync: true, aiTriage: true });
  app.db.update(settings).set({ value: { ...sales.source(productId, account.id), status: 'current', lastCompleteAt: Date.now() } }).where(eq(settings.key, `sales.source.${account.id}`)).run();
  const replies = new SalesReplyService(app); app.salesReplies = replies; replies.configure(productId, { enabled: true, accountIds: [account.id], dailyLimit: 5, delayMinutes: 5, followUpDays: [2] });
  const messages: SalesMessage[] = ['one', 'two', 'uncertain'].map((name, i) => ({ id: `handoff-${name}`, productId, accountId: account.id, providerId: `mail-${name}`, threadId: `thread-${name}`, internetId: `<inquiry-${name}@example.com>`, from: `owner-${name}@example.com`, subject: i === 0 ? 'Can you confirm the annual plan?' : i === 1 ? 'Following up on our conversation' : 'Did my reply go through?', body: i === 0 ? 'Can you confirm the annual plan? <script>throw new Error("Do not execute email")</script>' : 'I would like to understand the next step.', receivedAt: Date.now() - 60000, automated: false, bounce: false, truncated: false, observedAt: Date.now(), category: i === 2 ? 'inquiry' : 'handoff', summary: i === 0 ? 'The published source does not confirm an annual plan.' : 'This conversation needs owner attention.', evidence: '', leadId: null, reviewedAt: null, triageAttemptAt: Date.now() }));
  for (const message of messages) app.db.insert(settings).values({ key: `sales.message.${message.id}`, value: message }).run();
  const source = messages[2]!; const body = 'A simulated response with an unresolved delivery outcome.';
  const reply: SalesReply = { id: 'uncertain-reply', productId, accountId: account.id, messageId: source.id, revision: replies.policy(productId).revision, from: account.identity, to: source.from, threadId: source.threadId, inReplyTo: source.internetId, internetId: '<signal-uncertain@example.org>', subject: `Re: ${source.subject}`, body, bodyHash: createHash('sha256').update(body).digest('hex'), sourceBody: source.body, sourceProviderId: source.providerId, sourceReceivedAt: source.receivedAt, status: 'attention', detail: 'Fixture only: sending is uncertain. Check the original mailbox before any further response.', createdAt: Date.now(), updatedAt: Date.now(), dueAt: Date.now(), attemptedAt: Date.now(), acceptedId: null, sentAt: null, checkedAt: null, reconciliationChecks: 0, prepareAttempts: 1, retryAt: null, evidence: [] };
  app.db.insert(settings).values({ key: `sales.reply.${reply.id}`, value: reply }).run();
  const handoffs = new SalesHandoffs(app); app.salesHandoffs = handoffs; handoffs.sync();
} finally { app.close(); }
