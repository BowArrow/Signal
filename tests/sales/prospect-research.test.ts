import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, type App } from '../../src/core/app.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { fixedClock } from '../../src/core/lib/clock.js';
import { ConnectionService } from '../../src/core/connections/service.js';
import { OperationsService } from '../../src/core/operations/service.js';
import { ProspectResearchService, businessEmails, prospectUrl } from '../../src/core/sales/prospect-research.js';
import { pageLinks, type PublicPage } from '../../src/core/marketing/web.js';
import type { LlmClient } from '../../src/core/llm/client.js';
import { studioLeads, settings } from '../../src/core/db/schema.js';
import { prospectResearchActionSchema } from '../../src/shared/prospect-research.js';

let app: App, service: ProspectResearchService, productId: string, otherId: string, clock: ReturnType<typeof fixedClock>;
let complete: ReturnType<typeof vi.fn<LlmClient['complete']>>, read: ReturnType<typeof vi.fn<(app: App, url: string, signal?: AbortSignal) => Promise<PublicPage>>>;
let search: ReturnType<typeof vi.fn<(app: App, query: string, signal?: AbortSignal) => Promise<string[]>>>;
const business = 'We prepare grant proposals and detailed client research reports for local nonprofits.';
const product = 'Lemonade helps compare documents and prepare editable drafts from source material.';
let candidate: { suitable: boolean; kind: 'business' | 'blog' | 'community'; name: string; reason: string; prospectQuote: string; productQuote: string; subject: string; body: string; nextStep?: string };
beforeEach(() => {
  vi.stubEnv('SIGNAL_OFFLINE', '0'); clock = fixedClock(1790640000000);
  app = createApp({ databaseUrl: ':memory:', clock, logger: silentLogger }); app.env.SIGNAL_OFFLINE = '0';
  app.connections = new ConnectionService(app, { available: () => false, get: () => undefined, set: () => {}, delete: () => {} });
  [productId, otherId] = app.connections.view().products.map(p => p.id) as [string, string];
  app.operations = new OperationsService(app);
  candidate = { suitable: true, kind: 'business', name: 'Example Consulting', reason: 'Preparing source-based client reports is a plausible document workflow fit.', prospectQuote: business, productQuote: product, subject: 'A source check for your client reports', body: 'Your site describes preparing client research reports. We build Lemonade, which helps compare documents and prepare an editable draft. Would checking one report against its sources be useful for your work?' };
  complete = vi.fn(async input => ({ text: JSON.stringify(input.task?.endsWith('review') ? { approved: true, reason: 'The supplied sources support this decision.' } : candidate), model: 'fixture', inputTokens: 1, outputTokens: 1, stopReason: 'stop' }));
  read = vi.fn(async (_app, url) => ({ url, body: url.includes('example.org') ? business + ' Contact hello@example.org' : product, title: 'Example', trust: 'Untrusted', observedAt: clock.now(), links: [] }));
  search = vi.fn(async () => ['https://example.org/services']);
  service = new ProspectResearchService(app, { complete, available: () => ({ ready: true }) }, read, search); app.prospectResearch = service;
});
afterEach(async () => { await service.stop(); app.env.SIGNAL_OFFLINE = '0'; app.close(); vi.unstubAllEnvs(); });
const run = async () => { service.request(productId); await service.tick(); return service.drafts(productId)[0]!; };
function savedLead(stage: 'discovered' | 'contacted' = 'discovered', permission: 'unknown' | 'do-not-contact' = 'unknown') {
  const row = { id: 'saved-lead', productId, value: { name: 'Saved business', contact: 'hello@example.org', stage, permission, source: 'https://example.org/services', notes: stage === 'contacted' ? 'Submitted a partnership inquiry through their form.' : 'Source-based reports are a possible fit.', followUpAt: null, campaignId: '' }, createdAt: clock.now() };
  app.db.insert(studioLeads).values(row).run(); return row;
}
it('drafts for a selected saved prospect while paused and retains its original lead record', async () => {
  const lead = savedLead(); service.requestLead(productId, lead.id); await service.tick();
  const draft = service.drafts(productId)[0]!;
  expect(draft).toMatchObject({ leadId: lead.id, name: lead.value.name, status: 'draft', contact: 'hello@example.org' });
  expect(search).not.toHaveBeenCalled(); expect(app.db.select().from(studioLeads).all()).toHaveLength(1);
  expect(app.db.select().from(studioLeads).all()[0]!.value).toEqual(lead.value);
  expect(complete.mock.calls[0]![0].prompt).toContain('SAVED LEAD');
  expect(app.db.select().from(settings).all().some(s => /^sales\.outreach\./.test(s.key))).toBe(false);
});
it('prepares a contacted lead follow-up without making it a new cold email', async () => {
  const lead = savedLead('contacted'); service.requestLead(productId, lead.id); await service.tick();
  const draft = service.drafts(productId)[0]!; expect(draft.status).toBe('suggestion'); expect(draft.nextStep).toContain('existing reply thread');
  expect(complete.mock.calls[0]![0].prompt).toContain('Submitted a partnership inquiry');
  expect(() => service.approve(productId, draft.id, draft.updatedAt, 1, 'sales@example.org')).toThrow('current draft');
});
it('blocks another business, opted-out leads, duplicates and missing source URLs before generation', async () => {
  const lead = savedLead(); expect(() => service.requestLead(otherId, lead.id)).toThrow('not found');
  app.db.update(studioLeads).set({ value: { ...lead.value, source: 'Imported contact' } }).run();
  expect(() => service.requestLead(productId, lead.id)).toThrow('HTTPS');
  service.requestLead(productId, lead.id, 'https://example.org/services'); await service.tick();
  expect(() => service.requestLead(productId, lead.id)).toThrow('already has');
  app.db.update(studioLeads).set({ value: { ...lead.value, permission: 'do-not-contact' } }).run();
  expect(() => service.requestLead(productId, lead.id)).toThrow('blocked');
});
it('does not replace a saved recipient with a different email discovered on the website', async () => {
  const lead = savedLead();
  app.db.update(studioLeads).set({ value: { ...lead.value, contact: 'different@example.org' } }).run();
  service.requestLead(productId, lead.id); await service.tick();
  expect(service.drafts(productId)[0]).toMatchObject({ status: 'no-contact', contact: '', leadId: lead.id });
});
it('lets an owner retry a held lead but preserves a dismissed finished pitch', async () => {
  const lead = savedLead(); candidate.suitable = false;
  service.requestLead(productId, lead.id); await service.tick(); expect(service.drafts(productId)[0]!.status).toBe('rejected');
  candidate.suitable = true; service.requestLead(productId, lead.id); await service.tick();
  expect(service.drafts(productId)).toHaveLength(1); expect(service.drafts(productId)[0]!.status).toBe('draft');
  service.reject(productId, service.drafts(productId)[0]!.id);
  expect(() => service.requestLead(productId, lead.id)).toThrow('already has');
});
it('rechecks the selected lead after model work and does not overwrite a changed contact', async () => {
  const lead = savedLead(); const original = complete.getMockImplementation()!;
  complete.mockImplementation(async input => { const response = await original(input); if (input.task === 'sales.prospect-review') app.db.update(studioLeads).set({ value: { ...lead.value, permission: 'do-not-contact' } }).run(); return response; });
  service.requestLead(productId, lead.id); await service.tick(); expect(service.drafts(productId)).toEqual([]); expect(service.state(productId).detail).toContain('blocked');
});
it('creates a sourced review draft and visible lead without opting anyone in or creating an email delivery', async () => {
  const draft = await run();
  expect(draft).toMatchObject({ status: 'draft', contact: 'hello@example.org', contactSource: 'https://example.org/services', prospectQuote: business, productQuote: product });
  expect(app.db.select().from(studioLeads).all()[0]!.value).toMatchObject({ permission: 'unknown', stage: 'discovered' });
  expect(app.db.select().from(settings).all().some(s => /^sales\.outreach\./.test(s.key))).toBe(false);
  expect(complete).toHaveBeenCalledTimes(2);
});
it('keeps both old partner leads and new business prospects visible', async () => {
  app.db.insert(studioLeads).values({ id: 'partner', productId, value: { name: 'LTD partner', contact: '', stage: 'contacted', permission: 'unknown', source: 'https://partner.example', notes: 'Submitted', followUpAt: null, campaignId: '' }, createdAt: clock.now() }).run();
  await run(); expect(app.db.select().from(studioLeads).all()).toHaveLength(2);
});
it('rejects invented evidence before creating a lead or draft', async () => {
  candidate.prospectQuote = 'This fabricated quote is not on the business website.';
  await run(); expect(service.drafts(productId)).toEqual([]); expect(service.state(productId).detail).toContain('verifiable');
  expect(app.db.select().from(studioLeads).all()).toEqual([]);
});
it('stores the reason for a poor fit without creating customer copy', async () => {
  candidate.suitable = false; const draft = await run(); expect(draft.status).toBe('rejected'); expect(draft.body).toBe(''); expect(draft.leadId).toBeNull();
});
it('holds copy rejected by the independent reviewer', async () => {
  complete.mockImplementation(async input => ({ text: JSON.stringify(input.task === 'sales.prospect-review' ? { approved: false, reason: 'Generic sales copy does not help this business.' } : candidate), model: 'fixture', inputTokens: 1, outputTokens: 1, stopReason: 'stop' }));
  expect((await run()).status).toBe('rejected'); expect(app.db.select().from(studioLeads).all()).toEqual([]);
});
it('reassesses an unjustified rejection once and still reviews the resulting copy', async () => {
  let attempts = 0;
  complete.mockImplementation(async input => ({ text: JSON.stringify(input.task === 'sales.prospect-fit-review' ? { approved: false, reason: 'Preparing client reports is a supported workflow hypothesis without buying intent.' } : input.task === 'sales.prospect-review' ? { approved: true, reason: 'A concrete source-supported introduction.' } : ++attempts === 1 ? { ...candidate, suitable: false, reason: 'No expressed buying intent was found on this business page.' } : candidate), model: 'fixture', inputTokens: 1, outputTokens: 1, stopReason: 'stop' }));
  expect((await run()).status).toBe('draft'); expect(complete).toHaveBeenCalledTimes(4);
});
it('repairs an absolute privacy claim before accepting a researched email', async () => {
  let attempts = 0;
  complete.mockImplementation(async input => ({ text: JSON.stringify(input.task === 'sales.prospect-review' ? { approved: true, reason: 'The repaired introduction is factual and modest.' } : ++attempts === 1 ? { ...candidate, body: candidate.body + ' Do it without uploading sensitive files externally.' } : candidate), model: 'fixture', inputTokens: 1, outputTokens: 1, stopReason: 'stop' }));
  const draft = await run(); expect(draft.status).toBe('draft'); expect(draft.body).not.toContain('without uploading'); expect(complete).toHaveBeenCalledTimes(3);
});
it('does not save an email when a bounded copy repair repeats the same unsupported promise', async () => {
  candidate.body += ' Do it without uploading sensitive files externally.';
  await run(); expect(service.drafts(productId)).toEqual([]); expect(complete).toHaveBeenCalledTimes(2); expect(service.state(productId).detail).toContain('correction');
});
it('does not guess an email address when none is published', async () => {
  read.mockImplementation(async (_app, url) => ({ url, title: '', body: url.includes('example.org') ? business : product, observedAt: clock.now(), trust: '' }));
  const draft = await run(); expect(draft.status).toBe('no-contact'); expect(draft.contact).toBe(''); expect(draft.body).toContain('Lemonade');
  expect(draft.nextStep).toContain('copy the prepared message'); expect(draft.contactSource).toBe('https://example.org/services');
});
it('records an unsuitable page even when the model leaves its name empty', async () => {
  candidate.suitable = false; candidate.name = ''; const draft = await run(); expect(draft.status).toBe('rejected'); expect(draft.name).toBe('Example');
});
it('accepts null unused fields for a rejected page without inventing outreach', async () => {
  complete.mockImplementation(async input => ({ text: JSON.stringify(input.task === 'sales.prospect-fit-review' ? { approved: true, reason: 'No relevant audience is present.' } : { suitable: false, reason: 'This page has no relevant buyer or editorial context.', kind: null, name: null, prospectQuote: null, productQuote: null, subject: null, body: null }), model: 'fixture', inputTokens: 1, outputTokens: 1, stopReason: 'stop' }));
  const draft = await run(); expect(draft.status).toBe('rejected'); expect(draft.body).toBe(''); expect(draft.leadId).toBeNull();
});
it('preserves a reviewed draft when the contact page cannot be loaded', async () => {
  read.mockImplementation(async (_app, url) => {
    if (url.endsWith('/contact')) throw Error('Page returned HTTP 503');
    return { url, title: '', body: url.includes('example.org') ? business : product, observedAt: clock.now(), trust: '', links: [{ url: 'https://example.org/contact', text: 'Contact' }] };
  });
  const draft = await run(); expect(draft.status).toBe('no-contact'); expect(draft.contactSource).toBe('https://example.org/services');
});
it('recovers an interrupted research state without inventing a finished draft', () => {
  app.db.insert(settings).values({ key: 'sales.prospect-research.' + productId, value: { ...service.state(productId), status: 'researching', requested: true } }).run();
  service = new ProspectResearchService(app, { complete, available: () => ({ ready: true }) }, read, search);
  expect(service.state(productId)).toMatchObject({ status: 'attention', requested: false }); expect(service.drafts(productId)).toEqual([]);
});
it('looks up only a same-site contact page and records that source', async () => {
  read.mockImplementation(async (_app, url) => ({ url, title: '', body: url.endsWith('/contact') ? 'Email hello@example.org' : url.includes('example.org') ? business : product, observedAt: clock.now(), trust: '', links: [{ url: 'https://evil.example/contact', text: 'Contact' }, { url: 'https://example.org/contact', text: 'Contact' }] }));
  expect((await run()).contactSource).toBe('https://example.org/contact');
  expect(read.mock.calls.some(([, url]) => url.includes('evil'))).toBe(false);
});
it('makes community suggestions without turning an author into an email lead', async () => {
  candidate.kind = 'community'; const draft = await run();
  expect(draft).toMatchObject({ status: 'suggestion', contact: '', rulesQuote: '' });
  expect(draft.nextStep).toContain('Read its rules'); expect(draft.detail).toContain('permission is unverified');
  expect(app.db.select().from(studioLeads).all()).toEqual([]);
});
it('normalizes punctuation before independent review without relaxing other voice checks', async () => {
  candidate.body = candidate.body.replace('Lemonade,', 'Lemonade —');
  const draft = await run(); expect(draft.status).toBe('draft'); expect(draft.body).not.toContain('—');
  expect(complete.mock.calls[1]![0].prompt).toContain('We build Lemonade,');
});
it('stops research at the saved daily draft budget', async () => {
  const state = service.state(productId);
  service.configure(productId, { audience: state.audience, enabled: true, dailyDraftLimit: 1, queries: ['business contact reports', 'blog contributor guidelines'] });
  await run(); service.request(productId); await service.tick();
  expect(search).toHaveBeenCalledTimes(1); expect(service.state(productId).detail).toContain('limit reached');
});
it('retains search candidates and rotates queries after exhausting the batch', async () => {
  const state = service.state(productId);
  service.configure(productId, { audience: state.audience, enabled: false, dailyDraftLimit: 3, queries: ['business contact reports', 'blog contributor guidelines'] });
  search.mockResolvedValue(['https://example.org/', 'https://second.example/']);
  await run(); service.request(productId); await service.tick();
  expect(search.mock.calls.map(call => call[1])).toEqual(['business contact reports']);
  expect(read.mock.calls.some(call => call[1] === 'https://second.example/')).toBe(true);
  service.request(productId); await service.tick();
  expect(search.mock.calls.map(call => call[1])).toEqual(['business contact reports', 'blog contributor guidelines']);
});
it('continues past a failed source without discarding the rest of the search or retrying that source', async () => {
  search.mockResolvedValue(['https://broken.example/', 'https://example.org/services']);
  const original = read.getMockImplementation()!;
  read.mockImplementation(async (...args) => { if (args[1].includes('broken.example')) throw Error('Page returned HTTP 403'); return original(...args); });
  await run();
  expect(service.state(productId).pending).toEqual(['https://example.org/services']);
  expect(service.state(productId).nextAt).toBe(clock.now() + 60000);
  service.request(productId); await service.tick();
  expect(service.drafts(productId)[0]!.status).toBe('draft');
  service.request(productId); await service.tick();
  expect(read.mock.calls.filter(call => call[1].includes('broken.example'))).toHaveLength(1);
});
it('counts failed source attempts against the daily inspection budget', async () => {
  const state = service.state(productId);
  app.db.insert(settings).values({ key: 'sales.prospect-research.' + productId, value: { ...state, attempts: Array.from({ length: 24 }, (_, n) => ({ url: `https://failed${n}.example/`, at: clock.now() })) } }).run();
  await run(); expect(search).not.toHaveBeenCalled(); expect(service.state(productId).detail).toContain('limit reached');
});
it('saves real contributor guidance for a proposed blog placement', async () => {
  candidate.kind = 'blog'; candidate.nextStep = 'Send the proposed tutorial to the editor using the published contributor form.';
  read.mockImplementation(async (_app, url) => ({ url, title: '', body: url.endsWith('/guidelines') ? 'Send a practical guest tutorial proposal to the editor. No sponsored link inserts.' : url.includes('example.org') ? business : product, observedAt: clock.now(), trust: '', links: [{ url: 'https://example.org/guidelines', text: 'Contributor guidelines' }] }));
  const draft = await run(); expect(draft.rulesQuote).toContain('practical guest tutorial'); expect(draft.status).toBe('suggestion');
  expect(draft.nextStep).toBe(candidate.nextStep);
  service.submitted(productId, draft.id, 'https://example.org/submission/receipt'); expect(service.draft(productId, draft.id).detail).toContain('not been verified');
});
it('enforces business isolation and rejects stale draft edits', async () => {
  const draft = await run();
  expect(() => service.edit(otherId, draft.id, draft.updatedAt, draft.subject, draft.body)).toThrow('business');
  service.edit(productId, draft.id, draft.updatedAt, draft.subject, draft.body + ' One report is enough.');
  expect(() => service.edit(productId, draft.id, draft.updatedAt, draft.subject, draft.body)).toThrow('changed');
});
it('does not research the same business again or overwrite an owner dismissal', async () => {
  const draft = await run(); service.reject(productId, draft.id); clock.advance(60000); await run(); expect(complete).toHaveBeenCalledTimes(2); expect(service.drafts(productId)).toHaveLength(1);
});
it('waits when paused, offline or the runtime is unavailable', async () => {
  await service.tick(); expect(search).not.toHaveBeenCalled(); service.request(productId); await service.tick(false); expect(search).not.toHaveBeenCalled();
  app.env.SIGNAL_OFFLINE = '1'; await service.tick(); expect(() => service.request(productId)).toThrow('offline'); expect(search).not.toHaveBeenCalled();
});
it('shows search failures without making empty or invented prospects', async () => {
  search.mockRejectedValue(new Error('Search requires human verification.')); await run(); expect(service.state(productId).status).toBe('attention'); expect(service.drafts(productId)).toEqual([]);
});
it('stops an in-flight request without creating a draft', async () => {
  search.mockImplementation((_app, _query, signal) => new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('Stopped')))));
  service.request(productId); const promise = service.tick(); service.pause(productId); await promise; expect(service.drafts(productId)).toEqual([]);
});
it('uses only published business-domain addresses, never guessed or consumer-mail addresses', () => {
  const page = { url: 'https://example.org', body: 'hello@example.org someone@gmail.com privacy@example.org name@other.org', links: [{ url: 'mailto:office@example.org', text: '' }], title: '', observedAt: 0, trust: '' };
  expect(businessEmails(page, page.url)).toEqual(['hello@example.org', 'office@example.org']);
  expect(businessEmails({ ...page, links: [], body: 'Email megan -at- example -dot- org' }, page.url)).toEqual(['megan@example.org']);
});
it('extracts bounded source links without accepting active content or credentials', () => {
  expect(pageLinks('<a href="/contact">Contact</a><a href="javascript:alert(1)">bad</a><a href="https://a:b@example.org">bad</a>', 'https://example.org')).toEqual([{ url: 'https://example.org/contact', text: 'Contact' }]);
  expect(() => prospectUrl('http://127.0.0.1/')).toThrow();
  expect(() => prospectResearchActionSchema.parse({ type: 'approve', productId, id: 'one', updatedAt: 1, reviewed: false })).toThrow();
});
