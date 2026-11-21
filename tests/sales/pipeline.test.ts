import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp, type App } from '../../src/core/app.js';
import { fixedClock, DAY } from '../../src/core/lib/clock.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { ConnectionService } from '../../src/core/connections/service.js';
import { SalesService } from '../../src/core/sales/service.js';
import { OutreachService } from '../../src/core/sales/outreach-service.js';
import { SalesPipeline } from '../../src/core/sales/pipeline.js';
import { pipelinePut, pipelineRows, contactId, savePipelineLead, claimPipelineLead } from '../../src/core/sales/pipeline-store.js';
import { checkPipelineDns, configurePipelineInbox, verifyPipelineEmail, assertPipelineSend, mailboxPacing, reserveMailboxPacing, suppressPipelineDomain } from '../../src/core/sales/pipeline-deliverability.js';
import { firstEmailViolations } from '../../src/core/sales/pipeline-agents.js';
import { isSalesSuppressed } from '../../src/core/sales/suppression.js';
import { settings } from '../../src/core/db/schema.js';
import type { LlmClient } from '../../src/core/llm/client.js';
import type { PipelineRun, EmailVerification } from '../../src/shared/sales-pipeline.js';
import type { SalesMessage } from '../../src/shared/sales.js';
import type { OutreachJob } from '../../src/shared/outreach.js';

let app: App, service: SalesPipeline, clock: ReturnType<typeof fixedClock>, productId: string, otherId: string;
let complete: ReturnType<typeof vi.fn<LlmClient['complete']>>;
const email = 'buyer@example.org', signal = 'We need a local AI tool to compare client documents without another subscription.';
const fact = 'Lemonade compares source documents and prepares editable drafts.';
const body = 'You mentioned needing a local tool to compare client documents. We build Lemonade, which compares source documents and prepares editable drafts. Would a short setup guide help?';
const intake = { email, name: 'Example Buyer', sourceUrl: 'https://example.org/request', sourceSignal: signal };
const put = (key: string, value: unknown) => app.db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
beforeEach(() => {
  vi.stubEnv('SIGNAL_OFFLINE', '0'); clock = fixedClock(1795000000000);
  app = createApp({ databaseUrl: ':memory:', clock, logger: silentLogger });
  app.connections = new ConnectionService(app, { available: () => false, get: () => undefined, set: () => {}, delete: () => {} });
  [productId, otherId] = app.connections.view().products.map(p => p.id) as [string, string];
  complete = vi.fn(async request => {
    const output = request.task?.endsWith('qualify') ? { qualified: true, icp_score: 85, angle_tag: 'local_workflow_speed', specific_pain_point: 'Comparing client documents', recommended_cta: 'send_guide_link', reasoning: 'Explicit local document workflow request.' }
      : request.task?.endsWith('critic') ? { passed: true, word_count: body.split(/\s+/).length, contains_ai_cliches: false, references_source_signal: true, has_low_friction_cta: true, violations: [], rewrite_instruction: null }
      : request.task?.endsWith('triage') ? { intent: 'INTERESTED_READY', confidence: 0.95, suggested_reply: 'Thanks for asking. Here is the Lemonade guide: https://siplemona.de.', next_stage: 'CHECKOUT_SENT', requires_human_approval: false }
      : { subject: 'Comparing client documents', body, product_quote: fact };
    return { text: JSON.stringify(output), model: 'fixture-local', inputTokens: 1, outputTokens: 1, stopReason: 'stop' };
  });
  service = new SalesPipeline(app, { complete, available: () => ({ ready: true }) }, async (_app, url) => ({ url, title: 'Source', body: url.includes('example.org') ? signal + ' Contact: ' + email : fact, observedAt: clock.now(), trust: 'Untrusted source' })); app.salesPipeline = service;
  app.sales = new SalesService(app);
});
afterEach(async () => { await service.stop(); await app.outreach?.stop(); app.close(); vi.unstubAllEnvs(); });
async function prepared() { const lead = service.ingest(productId, intake); for (let i = 0; i < 3; i++) await service.tick(); return service.lead(productId, lead.id); }
function mailbox() {
  put('connections.account.mail', { id: 'mail', productId, provider: 'gmail', identity: 'hello@send-example.net', status: 'verified', grantedScopes: ['https://www.googleapis.com/auth/gmail.send'] });
  app.sales!.configure(productId, { accountId: 'mail', since: clock.now() - DAY, autoSync: true, aiTriage: true });
  put('sales.source.mail', { ...app.sales!.source(productId, 'mail'), status: 'current', lastCompleteAt: clock.now() });
  app.outreach = new OutreachService(app);
  app.outreach.configure(productId, { enabled: true, accountId: 'mail', objective: 'Offer a useful local document setup guide.', mailingAddress: 'Example Team, 123 Example Street', dailyLimit: 3, delayMinutes: 5 });
  configurePipelineInbox(app, { productId, accountId: 'mail', sender: 'hello@send-example.net', dkimSelector: 'google', warmupStartedAt: clock.now() - 15 * DAY });
  pipelinePut(app, 'inbox', contactId(productId, 'mail'), { productId, accountId: 'mail', sender: 'hello@send-example.net', dkimSelector: 'google', warmupStartedAt: clock.now() - 15 * DAY, checkedAt: clock.now(), spf: true, dkim: true, dmarc: true, detail: 'Fixture DNS proof' });
  pipelinePut(app, 'verification', contactId(productId, email), { email, checkedAt: clock.now(), valid: true, status: 'valid', subStatus: '' } satisfies EmailVerification);
}
async function approved() {
  const lead = await prepared(); mailbox();
  await service.action({ type: 'approve', productId, id: lead.id, revision: lead.revision, policyRevision: app.outreach!.policy(productId).revision, sender: 'hello@send-example.net', reviewed: true });
  return app.outreach!.jobs(productId)[0]!;
}
it('rejects generic company descriptions, missing contacts and globally suppressed email/domain before inference', () => {
  expect(() => service.ingest(productId, { ...intake, sourceSignal: 'We prepare reports for our clients.' })).toThrow('concrete');
  expect(() => service.ingest(productId, { ...intake, email: '' })).toThrow();
  suppressPipelineDomain(app, 'example.org', 'Owner requested domain suppression');
  expect(() => service.ingest(productId, intake)).toThrow('suppressed'); expect(complete).not.toHaveBeenCalled();
  expect(isSalesSuppressed(app, otherId, 'one@sub.example.org')).toBe(true);
});
it('deduplicates by normalized email and rejects stale/cross-business transitions', () => {
  const lead = service.ingest(productId, { ...intake, email: email.toUpperCase() });
  expect(service.ingest(productId, intake).id).toBe(lead.id);
  expect(() => service.lead(otherId, lead.id)).toThrow('not found');
  expect(() => savePipelineLead(app, lead, { stage: 'CLOSED_WON' }, 'Invented sale')).toThrow('Invalid');
  savePipelineLead(app, lead, { requested: false }, 'Paused');
  expect(() => savePipelineLead(app, lead, {}, 'Stale')).toThrow('changed');
});
it('runs source verification, qualification and bounded generator/critic; never sends or auto-approves', async () => {
  const lead = await prepared(); expect(lead.stage).toBe('DRAFT_READY'); expect(lead.draft?.criticPassed).toBe(true);
  expect(lead.history.map(h => h.stage)).toEqual(['DISCOVERED', 'ENRICHED', 'QUALIFIED', 'DRAFT_READY']);
  expect(lead.deliveryId).toBeUndefined(); expect(complete).toHaveBeenCalledTimes(3);
  for (const [request] of complete.mock.calls) { expect(request.jsonSchema).toMatchObject({ additionalProperties: false }); expect(request.prompt).toContain('untrusted'); }
  expect(service.view().metrics.find(m => m.productId === productId)).toMatchObject({ sent: 0, schemaPassRate: 1, revenue: null });
});
it('requires the exact source quote and public address, never guessed enrichment', async () => {
  const lead = service.ingest(productId, { ...intake, email: 'invented@example.org' }); await service.tick();
  expect(service.lead(productId, lead.id)).toMatchObject({ stage: 'DISCOVERED', requested: false }); expect(complete).not.toHaveBeenCalled();
});
it('rejects low score even when model says qualified', async () => {
  const original = complete.getMockImplementation()!;
  complete.mockImplementation(async r => { const result = await original(r); return r.task?.endsWith('qualify') ? { ...result, text: result.text.replace('85', '69') } : result; });
  const lead = await prepared(); expect(lead.stage).toBe('DISQUALIFIED'); expect(complete).toHaveBeenCalledTimes(1);
});
it('caps invalid structured output at two calls and records failures without advancing', async () => {
  complete.mockResolvedValue({ text: '{"qualified":true}', model: 'bad', inputTokens: 0, outputTokens: 0, stopReason: 'stop' });
  const lead = await prepared(); expect(lead.stage).toBe('ENRICHED'); expect(lead.requested).toBe(false); expect(complete).toHaveBeenCalledTimes(2);
  expect(pipelineRows<PipelineRun>(app, 'run').map(r => r.schemaValid)).toEqual([false, false]);
});
it('retains a failed draft for manual review after two rewrites', async () => {
  const original = complete.getMockImplementation()!;
  complete.mockImplementation(async r => { const result = await original(r); return r.task?.endsWith('critic') ? { ...result, text: result.text.replace('"passed":true', '"passed":false') } : result; });
  const lead = await prepared(); expect(lead.stage).toBe('DRAFT_READY'); expect(lead.draft?.criticPassed).toBe(false);
  expect(complete.mock.calls.filter(([r]) => r.task?.endsWith('draft'))).toHaveLength(3);
});
it('rejects links, long copy, lists, cliches and invented first-email subjects deterministically', () => {
  expect(firstEmailViolations('A document question', body)).toEqual([]);
  for (const bad of [body + ' https://example.org', 'word '.repeat(75) + '?', 'We can leverage this. Would it help?', '- One thing\nWould that help?', 'Hello 😀 Would that help?']) expect(firstEmailViolations('A question', bad).length).toBeGreaterThan(0);
  expect(firstEmailViolations('Re: fake conversation', body).length).toBeGreaterThan(0);
});
it('leases preparation durably and rejects late model output after pause', async () => {
  const original = service.ingest(productId, intake); const claimed = claimPipelineLead(app, original);
  await service.tick(); expect(complete).not.toHaveBeenCalled();
  clock.advance(16 * 60000); await service.tick(); expect(service.lead(productId, claimed.id).stage).toBe('ENRICHED');
  complete.mockImplementation(async () => { const current = service.lead(productId, claimed.id); await service.action({ type: 'pause', productId, id: current.id, revision: current.revision }); return { text: '{}', model: 'late', inputTokens: 1, outputTokens: 1, stopReason: 'stop' }; });
  await service.tick(); expect(service.lead(productId, claimed.id)).toMatchObject({ stage: 'ENRICHED', requested: false, lease: null });
});
it('binds approval to current sender/policy and enforces recipient verification and DNS before queueing', async () => {
  const lead = await prepared(); mailbox();
  const action = { type: 'approve' as const, productId, id: lead.id, revision: lead.revision, policyRevision: app.outreach!.policy(productId).revision, sender: 'hello@send-example.net', reviewed: true as const };
  await expect(service.action({ ...action, sender: 'other@send-example.net' })).rejects.toThrow('settings changed');
  pipelinePut(app, 'verification', contactId(productId, email), { email, checkedAt: clock.now(), valid: false });
  await expect(service.action(action)).rejects.toThrow('Verify this recipient'); expect(app.outreach!.jobs(productId)).toHaveLength(0);
});
it('queues one reviewed email idempotently and keeps send confirmation separate from approval', async () => {
  const job = await approved(); expect(job.status).toBe('queued'); expect(job.attemptedAt).toBeNull();
  const lead = service.lead(productId, job.leadId); expect(lead.stage).toBe('DRAFT_READY');
  await expect(service.action({ type: 'approve', productId, id: lead.id, revision: lead.revision, policyRevision: job.revision, sender: job.from, reviewed: true })).rejects.toThrow('current draft');
  service.confirmed(job); expect(service.lead(productId, job.leadId).stage).toBe('OUTREACH_ACTIVE');
});
it('blocks stale verification, insufficient warmup and primary product domains', async () => {
  const job = await approved(); clock.advance(DAY + 1); expect(() => assertPipelineSend(app, job)).toThrow('SPF');
  pipelinePut(app, 'inbox', contactId(productId, 'mail'), { productId, accountId: 'mail', sender: job.from, checkedAt: clock.now(), spf: true, dkim: true, dmarc: true, warmupStartedAt: clock.now() });
  expect(() => assertPipelineSend(app, job)).toThrow('14 days');
});
it('checks DNS records deterministically and fails closed on missing DKIM', async () => {
  mailbox(); const resolver = vi.fn(async (name: string) => name.startsWith('_dmarc') ? [['v=DMARC1; p=quarantine;']] : name.includes('_domainkey') ? [] : [['v=spf1 include:_spf.google.com -all']]);
  const result = await checkPipelineDns(app, productId, 'mail', resolver); expect(result).toMatchObject({ spf: true, dkim: false, dmarc: true });
});
it('verifies the exact recipient and rejects catch-all results without exposing the API key', async () => {
  vi.stubEnv('ZEROBOUNCE_API_KEY', 'fixture-private-key');
  const transport = vi.fn<typeof fetch>(async () => Response.json({ address: email, status: 'catch-all', sub_status: '' }));
  expect(await verifyPipelineEmail(app, productId, email, transport)).toMatchObject({ valid: false });
  transport.mockResolvedValueOnce(Response.json({ address: 'different@example.org', status: 'valid' }));
  await expect(verifyPipelineEmail(app, productId, email, transport)).rejects.toThrow('could not be confirmed');
  expect(JSON.stringify(service.view())).not.toContain('fixture-private-key');
});
it('shares pacing across businesses and reserves randomized delay once', async () => {
  const job = await approved(); reserveMailboxPacing(app, job, () => 0);
  expect(() => mailboxPacing(app, job, [])).not.toThrow();
  expect(() => mailboxPacing(app, { ...job, id: 'other', productId: otherId }, [])).toThrow('randomized');
  clock.advance(4 * 60000); expect(() => mailboxPacing(app, { ...job, id: 'other' }, [])).not.toThrow();
  const used: OutreachJob[] = Array.from({ length: 25 }, (_, i) => ({ ...job, id: String(i), attemptedAt: clock.now() }));
  expect(() => mailboxPacing(app, job, used)).toThrow('25');
});
it('routes inbound to review regardless of model approval/stage claims', async () => {
  const lead = await prepared();
  const message: SalesMessage = { id: 'incoming', productId, accountId: 'mail', providerId: 'm1', threadId: 't1', internetId: '<m1@example.org>', from: email, subject: 'Please send the guide', body: 'Could you send the local setup guide?', receivedAt: clock.now(), observedAt: clock.now(), automated: false, bounce: false, truncated: false, category: 'inquiry', summary: '', evidence: '', leadId: lead.id, reviewedAt: null, triageAttemptAt: null };
  put('sales.message.incoming', message); service.inbound(message); await service.tick();
  expect(service.lead(productId, lead.id)).toMatchObject({ stage: 'REPLIED', requested: false, triage: { requires_human_approval: true, next_stage: 'CHECKOUT_SENT' } });
  expect(app.db.select().from(settings).where(eq(settings.key, 'sales.reply.incoming')).get()).toBeUndefined();
});
it('mailbox ingestion cancels an approved introduction and suppresses standalone stop before any model call', async () => {
  const job = await approved(); const calls = complete.mock.calls.length;
  vi.spyOn(app.connections!, 'inboxRead').mockResolvedValue({ messages: [{ providerId: 'stop1', threadId: 'thread1', internetId: '<stop1@example.org>', from: email, subject: 'Your email', body: 'stop', receivedAt: clock.now(), automated: false, bounce: false, truncated: false }], next: '', scanned: 1 });
  await app.sales!.sync(productId, 'mail');
  expect(app.outreach!.jobs(productId)[0]).toMatchObject({ status: 'cancelled', attemptedAt: null });
  expect(service.lead(productId, job.leadId).stage).toBe('DISQUALIFIED');
  expect(isSalesSuppressed(app, otherId, email)).toBe(true); expect(complete).toHaveBeenCalledTimes(calls);
});
it('keeps feedback out of training until the edited draft has a confirmed sent copy', async () => {
  let lead = await prepared(); const edited = body.replace('a short setup guide', 'a brief setup guide');
  await service.action({ type: 'edit', productId, id: lead.id, revision: lead.revision, subject: lead.draft!.subject, body: edited });
  expect(service.lead(productId, lead.id).draft?.criticPassed).toBe(false);
  await service.tick(); lead = service.lead(productId, lead.id);
  expect(lead.draft).toMatchObject({ originalBody: body, body: edited, criticPassed: true });
  expect(pipelineRows(app, 'feedback')).toHaveLength(0);
  mailbox(); await service.action({ type: 'approve', productId, id: lead.id, revision: lead.revision, policyRevision: app.outreach!.policy(productId).revision, sender: 'hello@send-example.net', reviewed: true });
  expect(pipelineRows(app, 'feedback')).toHaveLength(0);
  const job = app.outreach!.jobs(productId)[0]!; service.confirmed(job); service.confirmed(job);
  expect(pipelineRows(app, 'feedback')).toHaveLength(1);
  expect(pipelineRows(app, 'feedback')[0]).toMatchObject({ originalDraft: body, finalSent: edited });
});
it('reserves and reconciles an uncertain provider write without a second send', async () => {
  const job = await approved();
  app.operations = { state: () => ({ running: true }) } as unknown as NonNullable<App['operations']>;
  const write = vi.spyOn(app.connections!, 'deliverOutreach').mockImplementation(async (_job, _signal, beforeWrite, accepted) => { await beforeWrite(); accepted('provider-1'); throw new Error('Response lost after acceptance'); });
  vi.spyOn(app.connections!, 'reconcileOutreach').mockResolvedValue({ id: 'provider-1', threadId: 'thread1' });
  clock.advance(5 * 60000); put('sales.source.mail', { ...app.sales!.source(productId, 'mail'), status: 'current', lastCompleteAt: clock.now() });
  await app.outreach!.tick(false); expect(app.outreach!.jobs(productId)[0]).toMatchObject({ status: 'attention', acceptedId: 'provider-1' });
  await app.outreach!.reconcile(productId, job.id); await app.outreach!.tick(false);
  expect(write).toHaveBeenCalledTimes(1); expect(service.lead(productId, job.leadId).stage).toBe('OUTREACH_ACTIVE');
});
it('does not infer revenue from customer identity or model proposals', async () => {
  const job = await approved(); service.confirmed(job);
  app.revenue = { purchaseForContact: () => ({ live: true, captured: 4900, refunded: 0, disputed: false, createdAt: clock.now() }), context: () => ({ status: 'current', lastCompleteAt: clock.now() }), payments: () => [] } as unknown as NonNullable<App['revenue']>;
  service.purchaseConfirmed(productId, email);
  expect(service.lead(productId, job.leadId).stage).toBe('CLOSED_WON');
  expect(service.view().metrics.find(m => m.productId === productId)?.revenue).toBeNull();
});
