import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp, type App } from '../../src/core/app.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { __setConfigForTests } from '../../src/core/config/load.js';
import { settings, growthTasks, marketingWorkflows } from '../../src/core/db/schema.js';
import { standardImageWorkflow } from '../../src/core/marketing/comfy.js';
import { ConnectionService } from '../../src/core/connections/service.js';
import { OperationsService } from '../../src/core/operations/service.js';
import { SalesService } from '../../src/core/sales/service.js';
import { OutreachService } from '../../src/core/sales/outreach-service.js';
import { SalesReplyService } from '../../src/core/sales/reply-service.js';
import { ProspectService } from '../../src/core/sales/prospects.js';
import { RevenueService } from '../../src/core/revenue/service.js';
import { AnalyticsService } from '../../src/core/analytics/service.js';
import { RuntimeSupervisor, pauseAllOperations } from '../../src/core/runtime/continuity.js';
import { agentModel } from '../../src/core/runtime/client.js';
import { saveRuntimeSettings, runtimeSettings } from '../../src/core/runtime/settings.js';
import type { ConnectedAccount } from '../../src/shared/connections.js';

let app: App; let operations: OperationsService; let productId: string; let otherId: string;
const put = (key: string, value: unknown) => app.db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
function account(provider: ConnectedAccount['provider'], id = provider, override: Partial<ConnectedAccount> = {}) {
  const row: ConnectedAccount = { id, provider, productId, label: `Business ${provider}`, identity: 'sales@example.test', site: '', username: '', status: 'verified', detail: '', createdAt: Date.now(), checkedAt: Date.now(), expiresAt: null, refreshable: false, grantedScopes: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send', 'Mail.Read', 'Mail.ReadWrite', 'Mail.Send'], ...override }; put(`connections.account.${id}`, row); return row;
}
function inbox(triage = false) { account('gmail'); app.sales!.configure(productId, { accountId: 'gmail', since: Date.now() - 86400000, autoSync: true, aiTriage: triage }); }
beforeEach(() => {
  vi.stubEnv('SIGNAL_OFFLINE', '0'); __setConfigForTests(null); app = createApp({ databaseUrl: ':memory:', logger: silentLogger });
  app.connections = new ConnectionService(app, { available: () => true, get: () => undefined, set: () => {}, delete: () => {} });
  [productId, otherId] = app.connections.view().products.map(p => p.id) as [string, string];
  operations = new OperationsService(app); app.operations = operations; app.sales = new SalesService(app); app.outreach = new OutreachService(app); app.salesReplies = new SalesReplyService(app); app.prospects = new ProspectService(app); app.revenue = new RevenueService(app); app.analytics = new AnalyticsService(app);
});
afterEach(async () => { await operations.stop(); app.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); __setConfigForTests(null); });
it('allows saving no publication destinations but blocks Run without any activity', () => {
  operations.configure(productId, { objective: 'Help people complete their first useful task.', accountIds: [], intervalHours: 24, dailyLimit: 1 });
  expect(operations.readiness(productId).ready).toBe(false); expect(() => operations.run(productId)).toThrow('Configure at least one');
});
it('runs inbox monitoring without an AI runtime or publishing', async () => {
  inbox(); const prepare = vi.fn(async () => {}); await operations.start(productId, prepare); operations.schedule();
  expect(operations.state(productId).running).toBe(true); expect(operations.agentModels(productId)).toEqual([]); expect(prepare).not.toHaveBeenCalled(); expect(app.db.select().from(growthTasks).all()).toHaveLength(0);
  expect(operations.state(otherId).running).toBe(false);
});
it('requires a selected verified Bluesky account and a Bluesky search before enabling public replies', () => {
  account('bluesky');
  const policy = { mode: 'acquisition' as const, replyToRequests: true, objective: 'Answer supported requests about documents.', accountIds: ['bluesky'], intervalHours: 24, dailyLimit: 1, discovery: { enabled: true, queries: [{ kind: 'hn' as const, query: 'documents' }] } };
  operations.configure(productId, policy);
  expect(operations.readiness(productId).blockers.join()).toContain('Bluesky');
  operations.configure(productId, { ...policy, discovery: { enabled: true, queries: [{ kind: 'bluesky', query: 'recommend PDF' }] } });
  expect(operations.readiness(productId).ready).toBe(true);
  account('bluesky', 'bluesky', { status: 'attention' });
  expect(operations.readiness(productId).ready).toBe(false);
});
it('checks only the marketing model for an email-only operation', async () => {
  inbox(true); app.outreach!.configure(productId, { enabled: true, accountId: 'gmail', objective: 'Help opted-in buyers get a useful result.', mailingAddress: 'Example business, 123 Example Street', dailyLimit: 2, delayMinutes: 10 });
  const prepare = vi.fn(async () => {}); await operations.start(productId, prepare); operations.schedule();
  expect(prepare).toHaveBeenCalledExactlyOnceWith([agentModel(app, 'marketing')]); expect(app.db.select().from(growthTasks).all()).toHaveLength(0);
  expect(operations.readiness(productId).activities.map(a => a.label)).toContain('Initial outreach');
});
it.each(['unverified', 'expired', 'read-scope', 'identity', 'other-business'])('blocks a broken monitored inbox: %s', kind => {
  inbox(); account('gmail', 'gmail', kind === 'unverified' ? { status: 'attention' } : kind === 'expired' ? { expiresAt: Date.now() - 1000 } : kind === 'read-scope' ? { grantedScopes: [] } : kind === 'identity' ? { identity: '' } : { productId: otherId });
  expect(operations.readiness(productId).ready).toBe(false); expect(() => operations.run(productId)).toThrow('Inbox monitoring');
});
it('allows a refreshable expired token and blocks replies without sending scopes', () => {
  inbox(true); app.salesReplies!.configure(productId, { enabled: true, accountIds: ['gmail'], dailyLimit: 3, delayMinutes: 5 });
  account('gmail', 'gmail', { expiresAt: Date.now() - 1000, refreshable: true }); expect(operations.readiness(productId).ready).toBe(true);
  account('gmail', 'gmail', { grantedScopes: ['https://www.googleapis.com/auth/gmail.readonly'] }); expect(operations.readiness(productId).blockers.join()).toContain('Email replies');
});
it('does not borrow an activity from another business', () => { inbox(); expect(() => operations.run(otherId)).toThrow('Configure at least one'); });
it('blocks Run offline without starting the model', async () => {
  inbox(true); app.env.SIGNAL_OFFLINE = '1'; const prepare = vi.fn(async () => {});
  await expect(operations.start(productId, prepare)).rejects.toThrow('offline'); expect(prepare).not.toHaveBeenCalled();
});
it('leaves the business paused when model startup fails', async () => {
  inbox(true); await expect(operations.start(productId, async () => { throw new Error('Model missing'); })).rejects.toThrow('Model missing'); expect(operations.state(productId).running).toBe(false);
});
it('honors Pause while model startup is still in flight', async () => {
  inbox(true); let release!: () => void; const pending = operations.start(productId, () => new Promise<void>(resolve => { release = resolve; }));
  operations.pause(productId); release(); await expect(pending).rejects.toThrow('cancelled'); expect(operations.state(productId).running).toBe(false);
});
it('Pause all also cancels a startup that has not yet reached running state', async () => {
  inbox(true); let release!: () => void; const pending = operations.start(productId, () => new Promise<void>(resolve => { release = resolve; }));
  pauseAllOperations(app); release(); await expect(pending).rejects.toThrow('cancelled'); expect(operations.state(productId).running).toBe(false);
});
it('does not let an older startup override a newer start', async () => {
  inbox(true); let release!: () => void; const older = operations.start(productId, () => new Promise<void>(resolve => { release = resolve; }));
  await operations.start(productId, async () => {}); release(); await expect(older).rejects.toThrow('cancelled'); expect(operations.state(productId).running).toBe(true);
});
it('rechecks connections after runtime startup', async () => {
  inbox(true); await expect(operations.start(productId, async () => { app.db.delete(settings).where(eq(settings.key, 'connections.account.gmail')).run(); })).rejects.toThrow('Inbox monitoring'); expect(operations.state(productId).running).toBe(false);
});
it('runs configured Mailchimp ingestion without an AI model', async () => {
  account('mailchimp'); put(`prospects.source.${productId}`, { productId, enabled: true, businessConfirmed: true, accountId: 'mailchimp', listId: 'audience1', audienceName: 'Signups', revision: 1 });
  const prepare = vi.fn(async () => {}); await operations.start(productId, prepare); expect(prepare).not.toHaveBeenCalled(); expect(operations.readiness(productId).activities[0]?.label).toBe('Prospect ingestion');
});
it('runs Stripe and Analytics reads without a publishing account', async () => {
  account('stripe'); account('ga4');
  put(`revenue.config.${productId}`, { productId, accountId: 'stripe', stripeProductIds: ['prod_123'], since: 0, live: true });
  put(`analytics.config.${productId}`, { productId, accountId: 'ga4', propertyId: '123', hostname: 'siplemona.de' });
  const prepare = vi.fn(async () => {}); await operations.start(productId, prepare); expect(prepare).not.toHaveBeenCalled(); expect(operations.readiness(productId).activities.map(a => a.label)).toEqual(['Sales tracking', 'Traffic analytics']);
});
it('supervises the model used by the running operation, not unused models', async () => {
  inbox(true); operations.run(productId); saveRuntimeSettings(app, { ...runtimeSettings(app), autoStart: false, localVisionModel: 'unused-vision' });
  const status = vi.fn(async () => ({ ok: true, managed: false, models: [agentModel(app, 'marketing')], detail: 'Fixture runtime' }));
  const supervisor = new RuntimeSupervisor(app, { status, start: async () => {}, stop: () => {} }); await supervisor.tick(); expect(supervisor.view().status).toBe('ready'); await supervisor.stop();
});
it('does not recover a local runtime for a read-only operation when autostart is off', async () => {
  inbox(); operations.run(productId); saveRuntimeSettings(app, { ...runtimeSettings(app), autoStart: false });
  const status = vi.fn(); const start = vi.fn(); const supervisor = new RuntimeSupervisor(app, { status, start, stop: () => {} }); await supervisor.tick(); expect(status).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled(); await supervisor.stop();
});
it('requires the selected image reviewer and clears it when image publishing is disabled', async () => {
  account('bluesky'); app.db.insert(marketingWorkflows).values({ id: 'image-workflow', productId, name: 'Local image', workflow: standardImageWorkflow('installed.safetensors') }).run();
  saveRuntimeSettings(app, { ...runtimeSettings(app), localVisionModel: 'selected-vision' });
  const policy = { objective: 'Help buyers compare source documents.', accountIds: ['bluesky'], dailyLimit: 1, intervalHours: 24 };
  operations.configure(productId, { ...policy, imageWorkflowId: 'image-workflow' }); operations.run(productId);
  expect(operations.agentModels(productId)).toContain('selected-vision');
  const supervisor = new RuntimeSupervisor(app, { status: async () => ({ ok: true, managed: false, models: [agentModel(app, 'marketing')], detail: 'Fixture' }), start: async () => {}, stop: () => {} });
  await supervisor.tick(); expect(supervisor.view().status).toBe('attention'); expect(supervisor.view().detail).toContain('selected-vision');
  operations.configure(productId, { ...policy, accountIds: [] });
  expect(operations.state(productId).imageWorkflowId).toBeUndefined(); expect(operations.readiness(productId).activities).toEqual([]); await supervisor.stop();
});
