import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, type App } from '../../src/core/app.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { fixedClock, DAY } from '../../src/core/lib/clock.js';
import { __setConfigForTests } from '../../src/core/config/load.js';
import { ConnectionService } from '../../src/core/connections/service.js';
import { SalesService } from '../../src/core/sales/service.js';
import { OutreachService } from '../../src/core/sales/outreach-service.js';
import { importLeads } from '../../src/core/sales/lead-import.js';
import { ProspectService } from '../../src/core/sales/prospects.js';
import { createHash } from 'node:crypto';
import { OperationsService } from '../../src/core/operations/service.js';
import { RevenueService } from '../../src/core/revenue/service.js';
import { purchaseContactHash } from '../../src/core/revenue/identity.js';
import { settings, studioLeads } from '../../src/core/db/schema.js';
import type { LlmClient } from '../../src/core/llm/client.js';
import type { ConnectedAccount } from '../../src/shared/connections.js';
import type { ProspectDraft } from '../../src/shared/prospect-research.js';
import type { OutreachJob } from '../../src/shared/outreach.js';

describe.each(['gmail', 'outlook'] as const)('%s proactive outreach', provider => {
  let app: App; let service: OutreachService; let productId: string; let clock: ReturnType<typeof fixedClock>;
  let send: ReturnType<typeof vi.fn<typeof fetch>>; let complete: ReturnType<typeof vi.fn<LlmClient['complete']>>;
  let remote: Record<string, unknown> | null; let priorContact: boolean; let loseSend: boolean; let loseDraft: boolean; let tamper: boolean; let pauseBeforeWrite: boolean;
  const fact = 'Lemonade helps you find project files.'; const addr = (address: string) => ({ emailAddress: { address } });
  const job = () => service.jobs(productId)[0]!;
  const put = (key: string, value: unknown) => app.db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
  function fresh() { const source = app.sales!.source(productId, 'inbox'); put('sales.source.inbox', { ...source, status: 'current', lastCompleteAt: clock.now() }); }
  const writes = () => send.mock.calls.filter(([, init]) => init?.method === 'POST');
  function makeRemote(j: OutreachJob, draft: boolean) {
    const headers = [{ name: 'From', value: j.from }, { name: 'To', value: j.to }, { name: 'Subject', value: j.subject }, { name: 'Message-ID', value: j.internetId }, { name: 'X-Signal-Outreach-ID', value: j.id }];
    if (provider === 'gmail') return { id: 'sent1', threadId: 'thread1', labelIds: ['SENT'], payload: { mimeType: 'text/plain', headers, body: { data: Buffer.from(j.body).toString('base64url') } } };
    return { id: 'immutable+1=', conversationId: 'thread+1=', isDraft: draft, parentFolderId: draft ? 'drafts' : 'sentitems', hasAttachments: false, subject: j.subject, from: addr(j.from), sender: addr(j.from), toRecipients: [addr(j.to)], ccRecipients: [], bccRecipients: [], replyTo: [], body: { contentType: 'text', content: j.body }, internetMessageHeaders: headers };
  }
  beforeEach(() => {
    vi.stubEnv('SIGNAL_OFFLINE', '0'); __setConfigForTests(null); clock = fixedClock(1789700000000); app = createApp({ databaseUrl: ':memory:', clock, logger: silentLogger });
    remote = null; priorContact = loseSend = loseDraft = tamper = pauseBeforeWrite = false;
    complete = vi.fn(async request => ({ text: JSON.stringify(request.task === 'sales.outreach-review' ? { approved: true, reason: 'Grounded in the current source.', sourceIds: ['source-1'] } : { decision: 'email', subject: 'Find a project file with Lemonade', body: 'Try Lemonade with one project folder to find a file you already know. You can check the result before expanding your workflow. Would that help with your next project?', reason: 'A useful first task.' }), model: 'fixture', inputTokens: 1, outputTokens: 1, stopReason: 'stop' }));
    send = vi.fn(async (input, init) => {
      const url = new URL(String(input)); expect(init?.redirect).toBe('error');
      expect(url.origin).toBe(provider === 'gmail' ? 'https://gmail.googleapis.com' : 'https://graph.microsoft.com');
      if (init?.method === 'POST') {
        expect(job().attemptedAt).not.toBeNull(); expect(job().status).toBe('dispatching');
        if (provider === 'gmail' || url.pathname === '/v1.0/me/messages') {
          const mime = provider === 'gmail' ? Buffer.from(JSON.parse(String(init.body)).raw, 'base64url').toString() : Buffer.from(String(init.body), 'base64').toString();
          expect(mime).toContain(`To: ${job().to}`); expect(mime).not.toContain('In-Reply-To:'); expect(mime).not.toContain('Bcc:'); expect(mime).toContain('List-Unsubscribe:');
          expect(Buffer.from(mime.split('\r\n\r\n')[1]!, 'base64').toString().replace(/\r\n/g, '\n')).toBe(job().body);
          remote = makeRemote(job(), provider === 'outlook');
          if (provider === 'outlook') { if (loseDraft) throw new Error('Draft response lost'); return Response.json({ id: remote.id }, { status: 201 }); }
          if (loseSend) throw new Error('Send response lost'); return Response.json({ id: remote.id, threadId: remote.threadId });
        }
        expect(job().acceptedId).toBe('immutable+1='); remote!.isDraft = false; remote!.parentFolderId = 'sentitems';
        if (loseSend) throw new Error('Send response lost'); return new Response(null, { status: 202 });
      }
      if (provider === 'gmail') {
        if (url.pathname.endsWith('/messages')) {
          const reconcile = url.searchParams.get('q')!.includes('rfc822msgid:');
          if (!reconcile && pauseBeforeWrite) app.operations!.pause(productId);
          return Response.json({ messages: reconcile ? remote ? [{ id: remote.id }] : [] : priorContact ? [{ id: 'prior' }] : [] });
        }
        if (url.pathname.endsWith('/sent1')) return Response.json(tamper ? { ...remote, payload: { ...(remote!.payload as object), headers: [] } } : remote);
      } else {
        expect(new Headers(init?.headers).get('prefer')).toContain('ImmutableId');
        if (url.pathname === '/v1.0/me/messages' && url.searchParams.has('$search')) { expect(url.searchParams.get('$search')).toBe('"participants:buyer@example.com"'); if (pauseBeforeWrite) app.operations!.pause(productId); return Response.json({ value: priorContact ? [{ id: 'prior' }] : remote ? [{ id: remote.id }] : [] }); }
        if (url.pathname.endsWith('/sentitems')) return Response.json({ id: 'sentitems' });
        if (url.pathname.includes('/messages/')) return Response.json(tamper ? { ...remote, subject: 'Altered draft' } : remote);
      }
      throw new Error('Unexpected fixture request');
    });
    app.connections = new ConnectionService(app, { available: () => true, get: () => JSON.stringify({ accessToken: 'fixture-secret-token' }), set: () => {}, delete: () => {} }, undefined, send);
    productId = app.connections.view().products[0]!.id;
    for (const id of ['inbox', 'website']) {
      const account: ConnectedAccount = { id, productId, provider: id === 'inbox' ? provider : 'signal-blog', label: id, identity: id === 'inbox' ? 'sales@example.org' : 'website', username: '', site: '', status: 'verified', detail: 'Synthetic account', checkedAt: clock.now(), createdAt: clock.now(), expiresAt: null, refreshable: false, grantedScopes: provider === 'gmail' ? ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'] : ['Mail.Read', 'Mail.ReadWrite', 'Mail.Send'] }; put(`connections.account.${id}`, account);
    }
    app.sales = new SalesService(app); app.sales.configure(productId, { accountId: 'inbox', since: clock.now() - DAY, autoSync: true, aiTriage: true }); fresh();
    app.operations = new OperationsService(app); app.operations.configure(productId, { objective: 'Help buyers find useful workflows.', accountIds: ['website'], intervalHours: 24, dailyLimit: 1 });
    service = new OutreachService(app, { complete, available: () => ({ ready: true }) }, async (_app, url) => ({ url, title: 'Lemonade', body: fact, observedAt: clock.now(), trust: 'Untrusted website text.' })); app.outreach = service;
    service.configure(productId, { enabled: true, accountId: 'inbox', objective: 'Offer a useful first task for opted-in prospects.', mailingAddress: 'Example Business, 123 Example Street, Example City', dailyLimit: 2, delayMinutes: 5 });
    app.db.insert(studioLeads).values({ id: 'lead1', productId, value: { name: 'Interested buyer', contact: 'buyer@example.com', permission: 'opted-in', stage: 'discovered', source: 'Owner-recorded signup', notes: '', followUpAt: null, campaignId: '' }, createdAt: clock.now() }).run();
  });
  it('explains eligibility without creating emails or touching the sending policy', async () => {
    expect(service.activity(productId)).toMatchObject({ leads: 1, candidates: 1, eligible: 1, sent48h: 0, pending: 0 });
    app.db.insert(studioLeads).values({ id: 'partner', productId, value: { name: 'Partner', contact: 'partner@example.com', permission: 'unknown', stage: 'contacted', source: 'Submission form', notes: '', followUpAt: null, campaignId: '' }, createdAt: clock.now() }).run();
    expect(service.activity(productId)).toMatchObject({ leads: 2, candidates: 1, eligible: 1 });
    clock.advance(6 * 60000);
    const activity = service.activity(productId);
    expect(activity.eligible).toBe(0); expect(activity.blockers[0]).toContain('fresh inbox scan');
    expect(service.jobs(productId)).toEqual([]); expect(writes()).toEqual([]);
    expect(app.operations!.view().outreachActivity?.[0]).toMatchObject({ productId, eligible: 0 });
  });
  afterEach(async () => { await service.stop(); app.close(); vi.unstubAllEnvs(); __setConfigForTests(null); });
  function coldDraft(): ProspectDraft {
    const lead = app.db.select().from(studioLeads).all()[0]!;
    app.db.update(studioLeads).set({ value: { ...lead.value, permission: 'unknown' } }).run();
    return { id: 'researched-prospect', productId, leadId: 'lead1', kind: 'business', rulesUrl: '', rulesQuote: '', nextStep: '', name: lead.value.name, url: 'https://example.com/services', contact: 'buyer@example.com', contactSource: 'https://example.com/contact', fit: 'Specific public document workflow.', prospectQuote: 'We prepare document reports for clients.', productQuote: fact, productUrl: 'https://siplemona.de/', observedAt: clock.now(), createdAt: clock.now(), updatedAt: clock.now(), status: 'draft', detail: 'Ready for review.', subject: 'One project folder with Lemonade', body: 'We build Lemonade to help find project files. Your site describes preparing reports for clients. Would trying one project folder be useful for that work?' };
  }
  it('queues one reviewed cold introduction without changing consent and confirms it through the normal delivery path', async () => {
    const draft = coldDraft(); const id = service.queueReviewedProspect(draft);
    expect(writes()).toHaveLength(0); expect(job().id).toBe(id); expect(job().coldApproval?.draftId).toBe(draft.id);
    expect(job().body).toBe(service.prospectPreview(draft)); expect(job().followUpsStopped).toBeDefined();
    expect(app.db.select().from(studioLeads).all()[0]!.value.permission).toBe('unknown');
    await dispatch(); expect(job().status).toBe('sent');
    expect(app.db.select().from(studioLeads).all()[0]!.value.permission).toBe('unknown');
    expect(() => service.queueReviewedProspect(draft)).toThrow('already has outreach');
  });
  it('does not automatically prepare unknown contacts without an individual cold approval', async () => {
    coldDraft(); app.operations!.run(productId); await service.tick(); expect(service.jobs(productId)).toEqual([]); expect(writes()).toEqual([]);
  });
  it('allows local approval while paused with a stale inbox but waits for a fresh scan before sending', async () => {
    const draft = coldDraft(); clock.advance(6 * 60000);
    service.queueReviewedProspect(draft); await service.tick(); expect(writes()).toEqual([]); expect(job().status).toBe('queued');
    clock.advance(6 * 60000); app.operations!.run(productId); await service.tick();
    expect(writes()).toEqual([]); expect(job().status).toBe('queued');
    fresh(); await service.tick(); expect(job().status).toBe('sent');
  });
  it('retains opt-out, policy-change, pause and uncertain-send protections for cold email', async () => {
    const draft = coldDraft(); service.queueReviewedProspect(draft);
    app.sales!.suppress(productId, draft.contact, 'The owner recorded an opt-out.'); await dispatch();
    expect(writes()).toEqual([]); expect(job().status).toBe('cancelled');
  });
  it('rejects mismatched recipients, forged reply subjects and foreign links before queuing cold email', () => {
    const draft = coldDraft();
    expect(() => service.queueReviewedProspect({ ...draft, contact: 'other@example.com' })).toThrow('contact changed');
    expect(() => service.queueReviewedProspect({ ...draft, subject: 'Re: fabricated history' })).toThrow('subject');
    expect(() => service.queueReviewedProspect({ ...draft, body: draft.body + ' https://other.example/' })).toThrow('links');
    expect(service.jobs(productId)).toEqual([]);
  });
  const prepare = () => service.prepare(productId, 'lead1');
  async function dispatch() { app.operations!.run(productId); clock.advance(5 * 60000); fresh(); await service.tick(); }
  if (provider === 'gmail') it.each([false, true])('checks the selected outreach sender before writing; revoked=%s', async revokedBeforeSend => {
    const alias = 'sales@aionx.aionapp.org'; let revoked = false;
    const original = send.getMockImplementation()!;
    send.mockImplementation(async (input, init) => String(input).endsWith('/settings/sendAs') ? Response.json({ sendAs: [{ sendAsEmail: 'sales@example.org', isPrimary: true }, { sendAsEmail: alias, verificationStatus: revoked ? 'pending' : 'accepted' }] }) : original(input, init));
    await app.sales!.configureVerified(productId, { accountId: 'inbox', since: clock.now() - DAY, autoSync: true, aiTriage: true, senderEmail: alias }); fresh();
    await prepare(); expect(job()).toMatchObject({ from: alias, mailbox: 'sales@example.org', status: 'queued' });
    revoked = revokedBeforeSend; await dispatch();
    expect(writes()).toHaveLength(revoked ? 0 : 1);
    if (!revoked) {
      const mime = Buffer.from(JSON.parse(String(writes()[0]![1]!.body)).raw, 'base64url').toString();
      expect(mime).toContain(`From: ${alias}\r\n`); expect(mime).toContain(`List-Unsubscribe: <mailto:${alias}?subject=unsubscribe>`);
      expect(job().status).toBe('sent');
    } else expect(job()).toMatchObject({ status: 'attention', attemptedAt: null });
  });
  it.each(['subscribed', 'unsubscribed', 'missing', 'unavailable', 'after-draft'] as const)('rechecks Mailchimp consent at delivery: %s', async consent => {
    const mailTransport = send.getMockImplementation()!; let delivering = false;
    const member = { id: createHash('md5').update('buyer@example.com').digest('hex'), email_address: 'buyer@example.com', full_name: 'Interested buyer', list_id: 'audience1', status: 'subscribed', consents_to_one_to_one_messaging: true, last_changed: new Date(clock.now() - 1000).toISOString(), timestamp_opt: new Date(clock.now() - 60000).toISOString(), marketing_permissions: [] };
    send.mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === 'us21.api.mailchimp.com') {
        expect(init?.method).toBe('GET');
        if (url.pathname === '/3.0/lists/audience1') return Response.json({ id: 'audience1', name: 'Lemonade signups' });
        if (url.pathname === '/3.0/lists/audience1/members') return Response.json({ members: [member], total_items: 1 });
        if (delivering && consent === 'missing') return new Response(null, { status: 404 });
        if (delivering && consent === 'unavailable') return new Response(null, { status: 503 });
        return Response.json({ ...member, status: delivering && (consent === 'unsubscribed' || (consent === 'after-draft' && remote)) ? 'unsubscribed' : 'subscribed' });
      }
      return mailTransport(input, init);
    });
    app.connections = new ConnectionService(app, { available: () => true, get: key => JSON.stringify({ accessToken: key === 'account.audience' ? 'fixture-audience-us21' : 'fixture-secret-token' }), set: () => {}, delete: () => {} }, undefined, send);
    put('connections.account.audience', { ...app.connections.accounts()[0], id: 'audience', productId, provider: 'mailchimp', identity: 'Lemonade' });
    app.db.delete(studioLeads).run(); app.prospects = new ProspectService(app);
    await app.prospects.configure(productId, { accountId: 'audience', listId: 'audience1', enabled: true, businessConfirmed: true, marketingPermissionId: '' });
    app.operations!.run(productId); await app.prospects.tick(); await service.tick(); expect(job().status).toBe('queued');
    delivering = true; await dispatch();
    const sent = consent === 'subscribed' || (consent === 'after-draft' && provider === 'gmail');
    expect(job().status).toBe(sent ? 'sent' : consent === 'unsubscribed' ? 'cancelled' : 'attention');
    expect(writes()).toHaveLength(sent ? (provider === 'gmail' ? 1 : 2) : consent === 'after-draft' ? 1 : 0);
    if (!sent && consent !== 'after-draft') expect(job().attemptedAt).toBeNull();
    if (consent === 'after-draft' && provider === 'outlook') { expect(job().acceptedId).toBeTruthy(); expect(remote?.isDraft).toBe(true); }
    if (consent === 'unavailable') {
      expect(job().retryAt).toBe(clock.now() + 10 * 60000);
      delivering = false; clock.advance(10 * 60000); fresh(); await service.tick(); expect(job().status).toBe('queued');
      await dispatch(); expect(job().status).toBe('sent'); expect(job().prepareAttempts).toBe(2);
      expect(writes()).toHaveLength(provider === 'gmail' ? 1 : 2);
    }
  });
  it.each(['subscribed', 'unsubscribed', 'unavailable', 'after-draft'] as const)('imports website requests and rechecks consent at actual email delivery: %s', async consent => {
    const mailTransport = send.getMockImplementation()!; let delivering = false;
    const member = { id: createHash('sha256').update('buyer@example.com').digest('hex'), email: 'buyer@example.com', name: 'Website visitor', goal: 'Find a project document', campaign: '', status: 'subscribed', verified: true, consentVersion: 'website-help-2026-09-17', consentText: 'Email me product guidance and promotional follow-ups from Lemonade, including personal messages from its AI assistant. I can opt out at any time by replying stop or returning to this page.', source: 'https://siplemona.de/get-started', optedAt: new Date(clock.now() - 1000).toISOString(), changedAt: new Date(clock.now()).toISOString(), seq: 1 };
    send.mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.origin === 'https://siplemona.de') {
        expect(init?.method).toBe('GET');
        if (url.pathname.endsWith('/meta')) return Response.json({ product: 'lemonade', id: 'website', name: 'Lemonade website requests', signupUrl: 'https://siplemona.de/get-started', consentVersion: member.consentVersion });
        if (url.pathname.endsWith('/changes')) return Response.json({ product: 'lemonade', records: [member], cursor: 1, head: 1, hasMore: false });
        if (delivering && consent === 'unavailable') return new Response(null, { status: 503 });
        return Response.json({ product: 'lemonade', contact: { ...member, status: delivering && (consent === 'unsubscribed' || (consent === 'after-draft' && remote)) ? 'unsubscribed' : 'subscribed' } });
      }
      return mailTransport(input, init);
    });
    put('connections.account.website', { ...app.connections!.accounts()[0], id: 'website', productId, provider: 'signal-blog', site: 'https://siplemona.de', identity: 'Lemonade' });
    app.db.delete(studioLeads).run(); app.prospects = new ProspectService(app);
    await app.prospects.configure(productId, { provider: 'signal-blog', accountId: 'website', listId: 'website', enabled: true, businessConfirmed: true, marketingPermissionId: '' });
    app.operations!.run(productId); await app.prospects.tick(); await service.tick(); expect(job().status).toBe('queued');
    delivering = true; await dispatch();
    const sent = consent === 'subscribed' || (consent === 'after-draft' && provider === 'gmail');
    expect(job().status).toBe(sent ? 'sent' : consent === 'unsubscribed' ? 'cancelled' : 'attention');
    expect(writes()).toHaveLength(sent ? (provider === 'gmail' ? 1 : 2) : consent === 'after-draft' ? 1 : 0);
    if (consent === 'after-draft' && provider === 'outlook') expect(remote?.isDraft).toBe(true);
    if (consent === 'unavailable') expect(job().retryAt).toBe(clock.now() + 10 * 60000);
  });
  it('runs imported opted-in prospects through delivery while leaving unknown contacts unsent', async () => {
    app.db.delete(studioLeads).run();
    const csv = 'email,source,permission,consent\nunknown@example.com,Conference,unknown,\nbuyer@example.com,Product signup,opted-in,Product marketing checkbox on 2026-09-15';
    const preview = importLeads(app, { productId, csv });
    importLeads(app, { productId, csv, previewId: preview.previewId });
    await service.tick(); expect(service.jobs(productId)).toHaveLength(0);
    app.operations!.run(productId); await service.tick(); expect(job().status).toBe('queued');
    await dispatch(); expect(job()).toMatchObject({ to: 'buyer@example.com', status: 'sent' });
    await service.tick(); expect(service.jobs(productId)).toHaveLength(1);
    expect(app.db.select().from(studioLeads).all().find(l => l.value.contact === 'unknown@example.com')?.value.stage).toBe('discovered');
    expect(writes()).toHaveLength(provider === 'gmail' ? 1 : 2);
  });
  it('researches, reviews, delays and confirms exactly one initial message with tracking and opt-out', async () => {
    await prepare(); expect(job().status).toBe('queued'); expect(writes()).toHaveLength(0);
    expect(job().body).toContain(`utm_campaign=${job().id}`); expect(job().body).toContain('Promotional message'); expect(job().body).toContain('Reply "stop"');
    await dispatch(); expect(job()).toMatchObject({ status: 'sent', to: 'buyer@example.com' }); expect(job().threadId).toBeTruthy();
    expect(app.db.select().from(studioLeads).get()!.value.stage).toBe('contacted');
    await service.tick(); await expect(prepare()).rejects.toThrow(); expect(writes()).toHaveLength(provider === 'gmail' ? 1 : 2);
    expect(JSON.stringify(service.view())).not.toContain('fixture-secret-token');
  });
  it('automatically selects opted-in leads only while Run is active', async () => {
    await service.tick(); expect(service.jobs(productId)).toHaveLength(0); app.operations!.run(productId); await service.tick(); expect(job().status).toBe('queued'); expect(writes()).toHaveLength(0);
  });
  it.each(['unknown', 'existing-conversation', 'do-not-contact'] as const)('does not infer consent from %s permission', async permission => {
    const lead = app.db.select().from(studioLeads).get()!; app.db.update(studioLeads).set({ value: { ...lead.value, permission } }).run(); await expect(prepare()).rejects.toThrow('opted-in'); expect(complete).not.toHaveBeenCalled();
  });
  it('stops a queued message after opt-out or a changed contact', async () => {
    await prepare(); app.sales!.suppress(productId, 'buyer@example.com', 'Owner recorded opt-out'); await dispatch(); expect(writes()).toHaveLength(0); expect(job().status).toBe('cancelled'); expect(job().retryAt).toBeNull();
  });
  it('does not send after a matching purchase and retains contact permission', async () => {
    put('connections.account.stripe', { ...app.connections!.accounts()[0], id: 'stripe', productId, provider: 'stripe', identity: 'Fixture Stripe' });
    await prepare(); put(`revenue.config.${productId}`, { accountId: 'stripe', productId, live: true }); put(`revenue.snapshot.${productId}`, [{ id: 'ch_fixture', productId, accountId: 'stripe', live: true, captured: 4900, contactHash: purchaseContactHash('stripe', 'buyer@example.com') }]);
    app.revenue = new RevenueService(app); app.revenue.reconcileCustomers(productId); expect(job().status).toBe('cancelled'); await dispatch(); expect(writes()).toHaveLength(0);
    expect(app.db.select().from(studioLeads).get()!.value.permission).toBe('opted-in');
  });
  it('checks prior mailbox contact and Pause immediately before writing', async () => {
    await prepare(); priorContact = true; await dispatch(); expect(writes()).toHaveLength(0);
    priorContact = false; await prepare(); pauseBeforeWrite = true; await dispatch(); expect(writes()).toHaveLength(0);
  });
  it('reconciles a lost send acknowledgment after restart without another write', async () => {
    await prepare(); loseSend = true; await dispatch(); expect(job().status).toBe('attention'); const count = writes().length;
    service = new OutreachService(app); app.outreach = service; await service.reconcile(productId, job().id); expect(job().status).toBe('sent'); expect(writes()).toHaveLength(count);
  });
  if (provider === 'gmail') {
    it('confirms a provider-rewritten Message-ID only for an acknowledged send and saves it for threading', async () => {
      await prepare(); await dispatch();
      const payload = remote!.payload as { headers: { name: string; value: string }[] };
      payload.headers.find(h => h.name === 'Message-ID')!.value = '<rewritten@mail.gmail.com>';
      put('sales.outreach.' + job().id, { ...job(), providerInternetId: undefined, status: 'attention' });
      const count = writes().length;
      await service.reconcile(productId, job().id);
      expect(job()).toMatchObject({ status: 'sent', providerInternetId: '<rewritten@mail.gmail.com>' });
      expect(writes()).toHaveLength(count);
      payload.headers.find(h => h.name === 'Message-ID')!.value = '<changed-again@mail.gmail.com>';
      await service.reconcile(productId, job().id); expect(job().status).toBe('attention');
    });
    it('does not trust a rewritten ID without send acknowledgment or with changed content', async () => {
      await prepare(); loseSend = true; await dispatch();
      const payload = remote!.payload as { headers: { name: string; value: string }[] };
      payload.headers.find(h => h.name === 'Message-ID')!.value = '<different@mail.gmail.com>';
      await service.reconcile(productId, job().id); expect(job().status).toBe('attention');
      put('sales.outreach.' + job().id, { ...job(), acceptedId: 'sent1' });
      payload.headers.find(h => h.name === 'To')!.value = 'wrong@example.org';
      await service.reconcile(productId, job().id); expect(job().status).toBe('attention');
      expect(writes()).toHaveLength(1);
    });
  }
  it('leaves a mismatched sent copy uncertain and never sends it again', async () => {
    await prepare(); loseSend = true; await dispatch(); tamper = true; await service.reconcile(productId, job().id); expect(job().status).toBe('attention');
    await expect(prepare()).rejects.toThrow('already has outreach'); expect(writes()).toHaveLength(provider === 'gmail' ? 1 : 2);
  });
  it('rejects a sent copy whose reply address was redirected', async () => {
    await prepare(); loseSend = true; await dispatch();
    if (provider === 'gmail') { const payload = remote!.payload as { headers: { name: string; value: string }[] }; payload.headers.push({ name: 'Reply-To', value: 'other@example.test' }); }
    else remote!.replyTo = [addr('other@example.test')];
    await service.reconcile(productId, job().id); expect(job().status).toBe('attention'); expect(writes()).toHaveLength(provider === 'gmail' ? 1 : 2);
  });
  it('preserves a cancelled contact across policy edits and refuses cross-business actions', async () => {
    await prepare(); service.cancel(productId, job().id); const other = app.connections!.view().products[1]!.id;
    expect(() => service.cancel(other, job().id)).toThrow('not found'); await dispatch(); expect(writes()).toHaveLength(0); expect(service.jobs(other)).toHaveLength(0);
  });
  it('reserves capacity and deduplicates duplicate lead entries by recipient', async () => {
    await prepare(); const lead = app.db.select().from(studioLeads).get()!; app.db.insert(studioLeads).values({ ...lead, id: 'duplicate' }).run(); await expect(service.prepare(productId, 'duplicate')).rejects.toThrow('already has outreach'); expect(service.jobs(productId)).toHaveLength(1);
    const policy = service.policy(productId); put(`sales.outreach-policy.${productId}`, { ...policy, dailyLimit: 1 }); app.db.insert(studioLeads).values({ ...lead, id: 'lead2', value: { ...lead.value, contact: 'second@example.com' } }).run(); await expect(service.prepare(productId, 'lead2')).rejects.toThrow('limit');
  });
  it('holds unsupported copy and recovers an interrupted preparation', async () => {
    complete.mockResolvedValue({ text: '{}', model: 'fixture', inputTokens: 0, outputTokens: 0, stopReason: 'stop' }); await prepare(); expect(job()).toMatchObject({ status: 'attention', prepareAttempts: 1 }); expect(job().retryAt).not.toBeNull();
    put(`sales.outreach.${job().id}`, { ...job(), status: 'preparing' }); service = new OutreachService(app); service.view(); expect(job().status).toBe('attention'); expect(writes()).toHaveLength(0);
  });
  it('expires stored copy without allowing another send', async () => {
    await prepare(); await dispatch(); clock.advance(31 * DAY); service.view(); expect(job().body).toBe(''); expect(job().status).toBe('sent'); await expect(prepare()).rejects.toThrow();
  });
  it('waits for incomplete inbox scans and rechecks changed lead details before writing', async () => {
    await prepare(); app.operations!.run(productId); clock.advance(5 * 60000);
    put('sales.source.inbox', { ...app.sales!.source(productId, 'inbox'), status: 'partial' }); await service.tick(); expect(job().status).toBe('queued'); expect(writes()).toHaveLength(0);
    fresh(); const lead = app.db.select().from(studioLeads).get()!; app.db.update(studioLeads).set({ value: { ...lead.value, contact: 'different@example.com' } }).run(); await service.tick(); expect(writes()).toHaveLength(0); expect(job().status).toBe('attention');
  });
  it('rejects absolute privacy promises before editorial approval', async () => {
    complete.mockResolvedValue({ text: JSON.stringify({ decision: 'email', subject: 'Try a useful document task', body: 'Lemonade helps you answer questions while keeping everything local. Nothing ever leaves your computer.', reason: 'Unsupported promise' }), model: 'fixture', inputTokens: 0, outputTokens: 0, stopReason: 'stop' });
    await prepare(); expect(job().status).toBe('attention'); expect(writes()).toHaveLength(0); expect(complete).toHaveBeenCalledTimes(1);
  });
  it('bounds automatic preparation retries without sending rejected output', async () => {
    complete.mockResolvedValue({ text: '{}', model: 'fixture', inputTokens: 0, outputTokens: 0, stopReason: 'stop' }); app.operations!.run(productId); await service.tick();
    for (let i = 0; i < 2; i++) { clock.advance(job().retryAt! - clock.now()); fresh(); await service.tick(); }
    expect(job()).toMatchObject({ status: 'attention', prepareAttempts: 3, retryAt: null }); await service.tick(); expect(complete).toHaveBeenCalledTimes(3); expect(writes()).toHaveLength(0);
  });
  it('rejects internal drafting instructions copied into the message', async () => {
    complete.mockResolvedValue({ text: JSON.stringify({ decision: 'email', subject: 'Try a practical workflow', body: 'Lemonade helps find files. Signal adds the business identity, AI disclosure, mailing address and reply-to-stop instructions.', reason: 'Drafting instruction leaked' }), model: 'fixture', inputTokens: 0, outputTokens: 0, stopReason: 'stop' });
    await prepare(); expect(job().status).toBe('attention'); expect(complete).toHaveBeenCalledTimes(1); expect(writes()).toHaveLength(0);
  });
  it('holds canned outreach with a concrete correction for the next attempt', async () => {
    complete.mockResolvedValue({ text: JSON.stringify({ decision: 'email', subject: 'A document task', body: 'Lemonade helps find files. Our game-changing app can supercharge your workflow.', reason: 'Fixture' }), model: 'fixture', inputTokens: 0, outputTokens: 0, stopReason: 'stop' });
    await prepare();
    expect(job().status).toBe('attention');
    expect(job().feedback).toContain('Reply voice needs revision');
    expect(writes()).toHaveLength(0);
  });
  it('feeds a concrete copy correction into an automatic preparation retry', async () => {
    const original = complete.getMockImplementation()!; let first = true;
    complete.mockImplementation(async request => {
      if (first) { first = false; return { text: JSON.stringify({ decision: 'email', subject: 'Try a document task', body: 'When you have files scattered across folders, pick a document and ask it one specific question.', reason: 'Product omitted' }), model: 'fixture', inputTokens: 0, outputTokens: 0, stopReason: 'stop' }; }
      if (request.task === 'sales.outreach') expect(request.prompt).toContain('Name the product in the opening');
      return original(request);
    });
    app.operations!.run(productId); await service.tick(); expect(job().status).toBe('attention'); clock.advance(job().retryAt! - clock.now()); fresh(); await service.tick();
    expect(job()).toMatchObject({ status: 'queued', prepareAttempts: 2 }); expect(writes()).toHaveLength(0);
  });
  it('lets opt-out interrupt model work before a message is queued', async () => {
    const original = complete.getMockImplementation()!; complete.mockImplementation(async request => { const result = await original(request); app.sales!.suppress(productId, 'buyer@example.com', 'Opt-out during preparation'); return result; });
    await prepare(); expect(job().status).toBe('cancelled'); expect(job().retryAt).toBeNull(); expect(writes()).toHaveLength(0);
  });
  if (provider === 'outlook') {
    it('never sends an orphaned draft after losing its create response', async () => {
      await prepare(); loseDraft = true; await dispatch(); expect(job()).toMatchObject({ status: 'attention', acceptedId: null }); expect(writes()).toHaveLength(1); await service.reconcile(productId, job().id); expect(job().status).toBe('attention'); expect(writes()).toHaveLength(1); expect(remote!.isDraft).toBe(true);
    });
    it('holds a modified draft before calling send', async () => {
      await prepare(); tamper = true; await dispatch(); expect(writes()).toHaveLength(1); expect(job().status).toBe('attention'); expect(remote!.isDraft).toBe(true);
    });
  }
});
