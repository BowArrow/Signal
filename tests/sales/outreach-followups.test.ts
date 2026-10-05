import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp, type App } from '../../src/core/app.js';
import { __setConfigForTests } from '../../src/core/config/load.js';
import { settings, studioLeads } from '../../src/core/db/schema.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { fixedClock } from '../../src/core/lib/clock.js';
import { ConnectionService } from '../../src/core/connections/service.js';
import { OperationsService } from '../../src/core/operations/service.js';
import { SalesService } from '../../src/core/sales/service.js';
import { OutreachService } from '../../src/core/sales/outreach-service.js';
import { ProspectService } from '../../src/core/sales/prospects.js';
import { outreachPolicySchema, type OutreachJob } from '../../src/shared/outreach.js';
import type { ConnectedAccount } from '../../src/shared/connections.js';
import type { LlmClient } from '../../src/core/llm/client.js';

const DAY = 86400000; const addr = (address: string) => ({ emailAddress: { address } });
describe.each(['gmail', 'outlook'] as const)('%s initial outreach follow-ups', provider => {
  let app: App; let service: OutreachService; let productId: string; let clock: ReturnType<typeof fixedClock>;
  let transport: ReturnType<typeof vi.fn<typeof fetch>>; let complete: ReturnType<typeof vi.fn<LlmClient['complete']>>;
  let extraMessage: boolean; let lateReply: boolean; let loseResponse: boolean; let altered: boolean; let pauseBeforeSend: boolean;
  const remote = new Map<string, { job: OutreachJob; draft: boolean; internetId: string }>();
  const put = (key: string, value: unknown) => app.db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
  const jobs = () => service.jobs(productId).sort((a, b) => a.createdAt - b.createdAt);
  const active = () => jobs().find(j => ['preparing', 'dispatching'].includes(j.status))!;
  const fresh = () => put('sales.source.inbox', { ...app.sales!.source(productId, 'inbox'), status: 'current', lastCompleteAt: clock.now() });
  const writes = () => transport.mock.calls.filter(([, init]) => init?.method === 'POST');
  function record(id: string) {
    const r = remote.get(id)!; const j = r.job;
    const headers = [{ name: 'From', value: j.from }, { name: 'To', value: j.to }, { name: 'Subject', value: j.subject }, { name: 'Message-ID', value: r.internetId }, { name: 'X-Signal-Outreach-ID', value: j.id }, ...(j.followUp ? [{ name: 'In-Reply-To', value: j.followUp.inReplyTo }, { name: 'References', value: j.followUp.references.join(' ') }] : [])];
    const body = altered && !j.followUp ? j.body + ' modified' : j.body;
    if (provider === 'gmail') return { id, threadId: 'thread1', labelIds: ['SENT'], payload: { mimeType: 'text/plain', headers, body: { data: Buffer.from(body).toString('base64url') } } };
    return { id, conversationId: 'thread1', internetMessageId: r.internetId, isDraft: r.draft, parentFolderId: r.draft ? 'drafts' : 'sentitems', hasAttachments: false, subject: j.subject, from: addr(j.from), sender: addr(j.from), toRecipients: [addr(j.to)], ccRecipients: [], bccRecipients: [], replyTo: [], body: { contentType: 'text', content: body }, internetMessageHeaders: headers };
  }
  beforeEach(() => {
    vi.stubEnv('SIGNAL_OFFLINE', '0'); __setConfigForTests(null); clock = fixedClock(1789700000000); app = createApp({ databaseUrl: ':memory:', clock, logger: silentLogger });
    remote.clear(); extraMessage = lateReply = loseResponse = altered = pauseBeforeSend = false;
    complete = vi.fn(async request => {
      const step = active()?.followUp?.step ?? 0;
      return { model: 'fixture', inputTokens: 1, outputTokens: 1, stopReason: 'stop', text: JSON.stringify(request.task === 'sales.outreach-review' ? { approved: true, reason: 'Supported task.', sourceIds: ['source-1'] } : { decision: 'email', subject: active()?.subject || 'Find a project file with Lemonade', body: ['Try Lemonade with a project folder to find a file you recognize. Would that be useful?', 'Try Lemonade with a specific question about a document and check the cited passage. Would a small example help?', 'One last idea for Lemonade: compare a familiar answer with its original source. Happy to leave it here if this is not useful.'][step], reason: 'A distinct useful task.' }) };
    });
    transport = vi.fn(async (input, init) => {
      const u = new URL(String(input)); expect(init?.redirect).toBe('error');
      expect(u.origin).toBe(provider === 'gmail' ? 'https://gmail.googleapis.com' : 'https://graph.microsoft.com');
      if (init?.method === 'POST') {
        const job = active(); expect(job.attemptedAt).not.toBeNull();
        if (provider === 'gmail' || u.pathname === '/v1.0/me/messages' || u.pathname.endsWith('/createReply')) {
          const mime = Buffer.from(provider === 'gmail' ? JSON.parse(String(init.body)).raw : String(init.body), provider === 'gmail' ? 'base64url' : 'base64').toString();
          expect(mime).toContain(`To: ${job.to}`); expect(mime).not.toContain('Bcc:'); expect(mime).toContain('List-Unsubscribe:');
          if (job.followUp) {
            expect(mime).toContain(`In-Reply-To: ${job.followUp.inReplyTo}`); expect(mime).toContain(`References: ${job.followUp.references.join(' ')}`);
            if (provider === 'gmail') expect(JSON.parse(String(init.body)).threadId).toBe('thread1');
            else expect(decodeURIComponent(u.pathname)).toContain('/' + service.history(job).at(-1)!.acceptedId + '/createReply');
          }
          const id = 'sent' + (remote.size + 1); remote.set(id, { job: structuredClone(job), draft: provider === 'outlook', internetId: provider === 'gmail' ? job.internetId : `<provider-${id}@example.test>` });
          if (job.followUp && lateReply) extraMessage = true;
          if (provider === 'gmail' && job.followUp && loseResponse) throw new Error('Accepted, response lost');
          return Response.json({ id }, { status: provider === 'gmail' ? 200 : 201 });
        }
        const id = decodeURIComponent(u.pathname.split('/').at(-2)!); remote.get(id)!.draft = false;
        if (job.followUp && loseResponse) throw new Error('Accepted, response lost');
        return new Response(null, { status: 202 });
      }
      if (u.pathname.endsWith('/sentitems')) return Response.json({ id: 'sentitems' });
      if (u.pathname.includes('/threads/')) return Response.json({ id: 'thread1', messages: [...remote.keys()].map(record) });
      if (u.pathname.endsWith('/messages')) {
        const q = u.searchParams.get('q') ?? '';
        if (q.includes('rfc822msgid:')) return Response.json({ messages: [...remote].filter(([, r]) => q.includes(r.job.internetId)).map(([id]) => ({ id })) });
        if (pauseBeforeSend) app.operations!.pause(productId);
        const ids = [...remote.keys(), ...(extraMessage ? ['new-inbound-or-manual'] : [])].map(id => ({ id }));
        return Response.json(provider === 'gmail' ? { messages: ids } : { value: ids });
      }
      if (u.pathname.includes('/messages/')) return Response.json(record(decodeURIComponent(u.pathname.split('/').at(-1)!)));
      throw new Error('Unexpected fixture request');
    });
    app.connections = new ConnectionService(app, { available: () => true, get: () => JSON.stringify({ accessToken: 'fixture-only-secret' }), set: () => {}, delete: () => {} }, undefined, transport);
    productId = app.connections.view().products[0]!.id;
    const account: ConnectedAccount = { id: 'inbox', productId, provider, label: 'Test inbox', identity: 'sales@example.org', username: '', site: '', status: 'verified', detail: '', checkedAt: clock.now(), createdAt: clock.now(), expiresAt: null, refreshable: false, grantedScopes: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send', 'Mail.Read', 'Mail.ReadWrite', 'Mail.Send'] }; put('connections.account.inbox', account);
    app.sales = new SalesService(app); app.sales.configure(productId, { accountId: 'inbox', since: clock.now() - DAY, autoSync: true, aiTriage: true }); fresh();
    app.operations = new OperationsService(app); service = new OutreachService(app, { complete, available: () => ({ ready: true }) }, async (_app, url) => ({ url, title: 'Product', body: 'Lemonade helps you find project files and ask questions about documents, with cited passages to check.', observedAt: clock.now(), trust: 'Untrusted source text' })); app.outreach = service;
    service.configure(productId, { enabled: true, accountId: 'inbox', objective: 'Help opted-in buyers complete a useful task.', mailingAddress: 'Example Business, 123 Example Street', dailyLimit: 3, delayMinutes: 5, followUpDays: [3, 7] });
    app.db.insert(studioLeads).values({ id: 'lead', productId, value: { name: 'Test buyer', contact: 'buyer@example.com', permission: 'opted-in', stage: 'discovered', source: 'Explicitly recorded signup', notes: '', followUpAt: null, campaignId: '' }, createdAt: clock.now() }).run();
    app.operations.run(productId);
  });
  afterEach(async () => { await service.stop(); app.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); __setConfigForTests(null); });
  async function sendQueued() { clock.advance(5 * 60000); fresh(); await service.tick(false); }
  async function first() { await service.prepare(productId, 'lead'); await sendQueued(); expect(jobs()[0]?.status).toBe('sent'); }
  async function due(days = 3) { clock.advance(days * DAY); fresh(); await service.tick(); }
  it('sends two bounded follow-ups in the original thread with distinct copy and provider references', async () => {
    await first(); await service.tick(); expect(jobs()).toHaveLength(1); await due(); expect(jobs()[1]?.status).toBe('queued'); await sendQueued(); expect(jobs()[1]?.status).toBe('sent');
    expect(jobs()[1]?.followUp?.inReplyTo).toBe(jobs()[0]?.providerInternetId);
    await due(7); await sendQueued(); expect(jobs()).toHaveLength(3); expect(jobs()[2]?.status).toBe('sent'); expect(jobs()[2]?.followUp?.references).toEqual(jobs().slice(0, 2).map(j => j.providerInternetId));
    await due(7); expect(jobs()).toHaveLength(3); expect(writes()).toHaveLength(provider === 'gmail' ? 3 : 6);
  });
  it.each(['reply', 'opt-out', 'purchase', 'owner-stop', 'policy-change', 'expired', 'lead-change'])('stops before preparing a follow-up after %s', async condition => {
    await first(); const before = writes().length;
    if (condition === 'reply') vi.spyOn(app.sales!, 'messages').mockReturnValue([{ from: 'buyer@example.com' }] as ReturnType<SalesService['messages']>);
    if (condition === 'opt-out') app.sales!.suppress(productId, 'buyer@example.com', 'Opted out');
    if (condition === 'owner-stop') service.stopFollowUps(productId, jobs()[0]!.id);
    if (condition === 'policy-change') { const p = service.policy(productId); service.configure(productId, { enabled: false, accountId: p.accountId, objective: p.objective, mailingAddress: p.mailingAddress, dailyLimit: p.dailyLimit, delayMinutes: p.delayMinutes, followUpDays: p.followUpDays }); }
    if (condition === 'purchase' || condition === 'lead-change') { const lead = app.db.select().from(studioLeads).get()!; app.db.update(studioLeads).set({ value: { ...lead.value, ...(condition === 'purchase' ? { stage: 'customer' as const } : { notes: 'Changed lead facts' }) } }).where(eq(studioLeads.id, lead.id)).run(); }
    await due(condition === 'expired' ? 31 : 3); expect(writes()).toHaveLength(before); expect(jobs()).toHaveLength(1);
  });
  it.each(['extra-message', 'tampered-history', 'pause', 'late-opt-out'])('blocks a prepared follow-up after %s', async condition => {
    await first(); await due(); expect(jobs()[1]?.status).toBe('queued'); const before = writes().length;
    if (condition === 'extra-message') extraMessage = true; if (condition === 'tampered-history') altered = true; if (condition === 'pause') pauseBeforeSend = true;
    if (condition === 'late-opt-out') app.sales!.suppress(productId, 'buyer@example.com', 'Stopped before send');
    await sendQueued(); expect(writes()).toHaveLength(before); expect(jobs()[1]?.status).not.toBe('sent');
  });
  it('reconciles a lost follow-up send response without another send', async () => {
    await first(); await due(); loseResponse = true; await sendQueued(); const job = jobs()[1]!; expect(job.status).toBe('attention'); const count = writes().length;
    await service.reconcile(productId, job.id); expect(jobs()[1]?.status).toBe('sent'); expect(writes()).toHaveLength(count);
  });
  it('keeps confirmed sequence history across a service restart', async () => {
    await first(); service = new OutreachService(app, { complete, available: () => ({ ready: true }) }, async (_app, url) => ({ url, title: 'Product', body: 'Lemonade helps you find project files and check document sources.', observedAt: clock.now(), trust: 'Untrusted source text' })); app.outreach = service;
    await due(); await sendQueued(); expect(jobs()[1]?.status).toBe('sent'); expect(jobs()).toHaveLength(2);
  });
  it('rechecks linked audience consent before a follow-up write', async () => {
    await first(); await due(); app.prospects = new ProspectService(app); vi.spyOn(app.prospects, 'assertContact').mockRejectedValue(new Error('Consent withdrawn')); const count = writes().length; await sendQueued(); expect(writes()).toHaveLength(count);
  });
  it('reserves the same rolling daily capacity for initial emails and follow-ups', async () => {
    await first(); clock.advance(3 * DAY); fresh();
    put(`sales.outreach-policy.${productId}`, { ...service.policy(productId), dailyLimit: 1 });
    app.db.insert(studioLeads).values({ id: 'second-lead', productId, value: { name: 'Second buyer', contact: 'second@example.com', permission: 'opted-in', stage: 'discovered', source: 'Recorded signup', notes: '', followUpAt: null, campaignId: '' }, createdAt: clock.now() }).run();
    await service.prepare(productId, 'second-lead'); await service.tick();
    expect(jobs().filter(j => j.followUp)).toHaveLength(0);
    service.cancel(productId, jobs().find(j => j.leadId === 'second-lead')!.id);
    await service.tick(); expect(jobs().filter(j => j.followUp)).toHaveLength(1);
    await expect(service.prepare(productId, 'second-lead')).rejects.toThrow('daily outreach limit');
    await sendQueued();
    await expect(service.prepare(productId, 'second-lead')).rejects.toThrow('daily outreach limit');
    clock.advance(DAY + 1); fresh(); await service.prepare(productId, 'second-lead');
    expect(jobs().find(j => j.leadId === 'second-lead')?.status).toBe('queued');
  });
  it('measures the next delay from a confirmed send after a pause', async () => {
    await first(); app.operations!.pause(productId); await due(5); expect(jobs()).toHaveLength(1);
    app.operations!.run(productId); await service.tick(); await sendQueued();
    const firstFollowUp = jobs()[1]!; expect(firstFollowUp.status).toBe('sent');
    const sequence = service.view().sequences!.find(s => s.rootId === jobs()[0]!.id)!;
    expect(sequence.completedSteps).toBe(1); expect(sequence.nextAt).toBe(firstFollowUp.sentAt! + 7 * DAY);
    await due(6); expect(jobs()).toHaveLength(2); await due(1); expect(jobs()[2]?.status).toBe('queued');
  });
  it('does not enroll an old initial email when follow-ups are newly enabled', async () => {
    put(`sales.outreach-policy.${productId}`, { ...service.policy(productId), followUpDays: [] });
    await first(); const { enabled, accountId, objective, mailingAddress, dailyLimit, delayMinutes } = service.policy(productId);
    service.configure(productId, { enabled, accountId, objective, mailingAddress, dailyLimit, delayMinutes, followUpDays: [3, 7] });
    app.operations!.run(productId); await due(3); expect(jobs()).toHaveLength(1);
    expect(service.view().sequences![0]?.status).toBe('stopped');
  });
  it('records a purchase stop and cancels an unattempted child', async () => {
    await first(); await due(); service.stopForPurchase(productId, 'buyer@example.com');
    expect(jobs()[0]?.followUpsStopped).toBeDefined(); expect(jobs()[1]?.status).toBe('cancelled');
    const count = writes().length; await due(8); expect(writes()).toHaveLength(count);
    expect(service.view().sequences![0]?.status).toBe('stopped');
  });
  it('preserves an uncertain send for reconciliation after a purchase stops the sequence', async () => {
    await first(); await due(); loseResponse = true; await sendQueued();
    expect(jobs()[1]?.status).toBe('attention'); const count = writes().length;
    service.stopForPurchase(productId, 'buyer@example.com');
    expect(jobs()[1]?.status).toBe('attention');
    await service.reconcile(productId, jobs()[1]!.id); expect(jobs()[1]?.status).toBe('sent');
    await due(8); expect(jobs()).toHaveLength(2); expect(writes()).toHaveLength(count);
  });
  if (provider === 'outlook') it('leaves the new draft unsent when a reply arrives after draft creation', async () => {
    await first(); await due(); lateReply = true; const count = writes().length; await sendQueued(); expect(writes()).toHaveLength(count + 1); expect(remote.get(jobs()[1]!.acceptedId!)?.draft).toBe(true); expect(jobs()[1]?.status).toBe('attention');
    await service.reconcile(productId, jobs()[1]!.id); expect(writes()).toHaveLength(count + 1);
  });
});
it('keeps follow-ups disabled for existing policies and bounds cadence', () => {
  const base = { enabled: false, accountId: '', objective: 'A useful business objective.', mailingAddress: '', dailyLimit: 2, delayMinutes: 5 };
  expect(outreachPolicySchema.parse(base).followUpDays).toEqual([]);
  for (const followUpDays of [[1], [3, 4, 5], [14, 14]]) expect(() => outreachPolicySchema.parse({ ...base, followUpDays })).toThrow();
});
