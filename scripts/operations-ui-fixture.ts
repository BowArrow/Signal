import { seedProspectWorkspace } from './prospect-ui-fixture.js';
import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { ConnectionService, type CredentialVault } from '../src/core/connections/service.js';
import { OperationsService } from '../src/core/operations/service.js';
import { chooseOperation } from '../src/core/operations/learning.js';
import { settings } from '../src/core/db/schema.js';
import type { ConnectedAccount } from '../src/shared/connections.js';
import { seedTrafficFixture } from './traffic-fixture.js';
import { seedConversations } from './conversation-ui-fixture.js';
const traffic = process.env['SIGNAL_TRAFFIC_FIXTURE'] === '1';

if (process.env['SIGNAL_OFFLINE'] !== '1' || !process.env['SIGNAL_DATABASE_URL']?.includes('operations-validation')) throw new Error('This fixture requires an isolated offline validation database.');
const app = createApp({ logger: silentLogger });
try {
  const vault: CredentialVault = { available: () => false, get: () => undefined, set: () => { throw new Error('Fixture never stores credentials'); }, delete: () => {} };
  const accounts = new ConnectionService(app, vault); app.connections = accounts;
  const product = accounts.view().products[0]!;
  if (process.env['SIGNAL_CONVERSATION_FIXTURE'] === '1') seedConversations(app, product.id);
  const account: ConnectedAccount = { id: 'fixture-website', productId: product.id, provider: 'signal-blog', label: 'Lemonade website (test fixture)', site: 'https://siplemona.de', username: '', identity: 'Offline fixture', status: 'verified', detail: 'Test fixture only; no credentials', checkedAt: Date.now(), expiresAt: null, refreshable: false, grantedScopes: [], createdAt: Date.now() };
  app.db.insert(settings).values({ key: `connections.account.${account.id}`, value: account }).run();
  app.db.insert(settings).values({ key: 'connections.account.fixture-blue', value: { ...account, id: 'fixture-blue', provider: 'bluesky', label: 'Bluesky publishing fixture', site: '', identity: 'fixture.bsky.social' } }).run();
  for (const publish of [true, false]) {
    const linked: ConnectedAccount = { ...account, id: 'fixture-linkedin-' + publish, provider: 'linkedin', site: '', label: publish ? 'LinkedIn publishing fixture' : 'LinkedIn read-only fixture', grantedScopes: publish ? ['openid', 'profile', 'w_member_social'] : ['openid', 'profile'] };
    app.db.insert(settings).values({ key: `connections.account.${linked.id}`, value: linked }).run();
    const x: ConnectedAccount = { ...account, id: 'fixture-x-' + publish, provider: 'x', site: '', label: publish ? 'X publishing fixture' : 'X read-only fixture', grantedScopes: publish ? ['tweet.read', 'users.read', 'tweet.write'] : ['tweet.read', 'users.read'] };
    app.db.insert(settings).values({ key: `connections.account.${x.id}`, value: x }).run();
    const facebook: ConnectedAccount = { ...account, id: 'fixture-facebook-' + publish, provider: 'facebook', site: '', label: publish ? 'Facebook publishing fixture' : 'Facebook read-only fixture', facebookPage: { id: publish ? '1234' : '5678', canPost: publish } };
    app.db.insert(settings).values({ key: `connections.account.${facebook.id}`, value: facebook }).run();
  }
  const operations = new OperationsService(app);
  operations.configure(product.id, { ...(process.env['SIGNAL_CONVERSATION_FIXTURE'] === '1' ? { mode: 'acquisition' as const, replyToRequests: true } : {}), objective: 'Help buyers verify local document answers before they rely on them.', accountIds: [account.id, ...(traffic ? ['fixture-linkedin-true'] : [])], intervalHours: 24, dailyLimit: 1, discovery: { enabled: true, queries: [{ kind: 'hn', query: 'local AI assistant' }] } });
  const state = operations.state(product.id);
  app.db.insert(settings).values({ key: 'operations.discovery.' + product.id, value: { productId: product.id, revision: state.revision, lastAttemptAt: Date.now(), nextAttemptAt: Date.now() + 3600000, searches: [{ query: 'hn:local AI assistant', attemptedAt: Date.now(), status: 'ok', found: 1, detail: 'Isolated synthetic research fixture.' }], findings: [{ id: 'fixture-question', title: 'How can I check an answer across my own documents?', excerpt: 'Synthetic question for desktop validation: I need to compare reports and find the original source.', url: 'https://news.ycombinator.com/item?id=123', postedAt: Date.now() - 60000, observedAt: Date.now(), query: 'hn:local AI assistant', kind: 'hn', requestLanguage: true }] } }).run();
  const history = traffic ? seedTrafficFixture(app, product.id, account.id) : [];
  if (traffic) history.push(...history.map((d, i) => ({ ...d, id: `unobserved-${i}`, accountId: 'fixture-linkedin-true', body: `Our app: https://siplemona.de/?utm_campaign=unobserved-${i}` })));
  const learning = chooseOperation(app, state, history);
  app.db.insert(settings).values({ key: `operations.policy.${product.id}`, value: { ...state, learning } }).onConflictDoUpdate({ target: settings.key, set: { value: { ...state, learning } } }).run();
  app.db.insert(settings).values({ key: `sales.reply-policy.${product.id}`, value: { productId: product.id, enabled: true, accountIds: ['fixture-inbox'], dailyLimit: 5, delayMinutes: 5, followUpDays: [2, 5], revision: 1, configuredAt: Date.now() } }).run();
  const inbox: ConnectedAccount = { ...account, id: 'fixture-inbox', provider: 'gmail', site: '', label: 'Sales fixture', identity: 'owner@example.com', grantedScopes: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'] };
  app.db.insert(settings).values({ key: 'connections.account.' + inbox.id, value: inbox }).run();
  app.db.insert(settings).values({ key: 'sales.source.' + inbox.id, value: { productId: product.id, accountId: inbox.id, mailbox: inbox.identity, senderEmail: 'sales@example.com', since: Date.now(), autoSync: true, aiTriage: true, revision: 1, cursor: '', watermark: Date.now(), scanUntil: null, lastAttemptAt: null, lastCompleteAt: null, status: 'idle', detail: 'Offline fixture' } }).run();
  if (process.env['SIGNAL_PROSPECT_FIXTURE'] === '1') seedProspectWorkspace(app, product.id);
} finally { app.close(); }
