import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { parseLeadCsv } from '../../src/shared/lead-import.js';
import { importLeads } from '../../src/core/sales/lead-import.js';
import { createApp, type App } from '../../src/core/app.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { studioView, studioAction } from '../../src/core/studio/store.js';
import { OperationsService } from '../../src/core/operations/service.js';
import { SalesService } from '../../src/core/sales/service.js';
import { RevenueService } from '../../src/core/revenue/service.js';
import { settings, studioLeads } from '../../src/core/db/schema.js';

describe('prospect CSV parsing', () => {
  it('reads BOM, quoted commas, escaped quotes, embedded newlines and CRLF', () => {
    const [row] = parseLeadCsv('\uFEFFname,email,source,notes\r\n"A, B", Person@Example.test ,Website,"Asked about ""reports""\r\nand documents"\r\n');
    expect(row).toMatchObject({ name: 'A, B', email: 'person@example.test', permission: 'unknown', notes: 'Asked about "reports"\r\nand documents' });
  });
  it.each([
    ['email,source\na@example.test,"unterminated', 'unclosed'],
    ['email,source\na@example.test,"closed"extra', 'quoting'],
    ['email,source\na@example.test,bad"quote', 'quoting'],
    ['email,source\na@example.test', 'columns'],
    ['email,email,source\na@example.test,a@example.test,form', 'headers'],
    ['email,source,stage\na@example.test,form,customer', 'headers'],
    ['email,source\ninvalid,form', 'email'],
    ['email,source\na@example.test,', 'source'],
    ['email,source,permission\na@example.test,form,opted-in', 'consent'],
    ['email,source,permission\na@example.test,form,existing-conversation', 'permission'],
    ['email,source\na@example.test,form\nA@EXAMPLE.TEST,other', 'repeats'],
    ['email,source\na@example.test,\u0000', 'binary'],
  ])('rejects invalid CSV without partial results: %s', (csv, message) => expect(() => parseLeadCsv(csv)).toThrow(message));
  it('bounds both file length and record count', () => {
    expect(() => parseLeadCsv('a'.repeat(1_000_001))).toThrow('characters');
    expect(() => parseLeadCsv('email,source\n' + Array.from({ length: 501 }, (_, i) => `a${i}@example.test,form`).join('\n'))).toThrow('500');
  });
});

describe('pipeline import', () => {
  let app: App; let productId: string; let secondId: string;
  const csv = 'name,email,source,permission,consent,notes\nPat,pat@example.test,Signup form,opted-in,Signup form marketing checkbox on 2026-09-15,Needs document search\nLee,lee@example.test,Conference,unknown,,Asked about a demo';
  const preview = (text = csv) => importLeads(app, { productId, csv: text });
  const commit = (text = csv) => importLeads(app, { productId, csv: text, previewId: preview(text).previewId });
  const leads = () => app.db.select().from(studioLeads).all();
  beforeEach(() => {
    app = createApp({ databaseUrl: ':memory:', logger: silentLogger });
    [productId, secondId] = studioView(app).products.map(p => p.id) as [string, string];
    app.sales = new SalesService(app); app.operations = new OperationsService(app); app.revenue = new RevenueService(app);
  });
  afterEach(() => { vi.restoreAllMocks(); app.close(); });
  it('previews without writes, saves sources and consent, and pauses only the selected operation', () => {
    const pause = vi.spyOn(app.operations!, 'pause');
    expect(preview().counts.added).toBe(2); expect(leads()).toHaveLength(0); expect(pause).not.toHaveBeenCalled();
    expect(commit().committed).toBe(true); expect(pause).toHaveBeenCalledExactlyOnceWith(productId);
    expect(leads().find(l => l.value.contact === 'pat@example.test')?.value).toMatchObject({ stage: 'discovered', permission: 'opted-in', source: 'Signup form', notes: expect.stringContaining('Recorded consent: Signup form marketing checkbox on 2026-09-15') });
    expect(leads().find(l => l.value.contact === 'lee@example.test')?.value.permission).toBe('unknown');
    expect(app.db.select().from(settings).all().some(r => r.key.startsWith('sales.import.'))).toBe(true);
  });
  it('rejects stale previews and leaves the operation alone', () => {
    const old = preview(); commit(); const pause = vi.spyOn(app.operations!, 'pause');
    expect(() => importLeads(app, { productId, csv, previewId: old.previewId })).toThrow('changed');
    expect(leads()).toHaveLength(2); expect(pause).not.toHaveBeenCalled();
    expect(commit().counts.existing).toBe(2); expect(leads()).toHaveLength(2);
  });
  it('preserves lead stage, consent and notes on repeated imports', () => {
    commit(); const lead = leads()[0]!; const value = { ...lead.value, stage: 'customer' as const, permission: 'unknown' as const, notes: 'Owner verified the customer.' };
    studioAction(app, { type: 'lead', productId, id: lead.id, value }); commit();
    expect(leads().find(l => l.id === lead.id)?.value).toEqual(value);
  });
  it('invalidates a preview when a matching lead changes', () => {
    commit(); const before = preview(); const lead = leads()[0]!;
    studioAction(app, { type: 'lead', productId, id: lead.id, value: { ...lead.value, notes: 'Changed after preview.' } });
    expect(() => importLeads(app, { productId, csv, previewId: before.previewId })).toThrow('changed');
  });
  it('does not re-enable suppressed contacts and detects suppression after preview', () => {
    const before = preview(); app.sales!.suppress(productId, 'pat@example.test', 'Prior opt-out');
    expect(() => importLeads(app, { productId, csv, previewId: before.previewId })).toThrow('changed');
    expect(commit().counts).toMatchObject({ added: 1, suppressed: 1 }); expect(leads()).toHaveLength(1);
  });
  it('also preserves do-not-contact on a manually recorded lead', () => {
    commit(); const lead = leads()[0]!;
    app.db.update(studioLeads).set({ value: { ...lead.value, permission: 'do-not-contact' } }).where(eq(studioLeads.id, lead.id)).run();
    expect(commit().counts.suppressed).toBe(1); expect(leads()).toHaveLength(2);
  });
  it('imports opt-outs into suppression and stops existing follow-ups', () => {
    commit(); const lead = leads()[0]!;
    app.db.update(studioLeads).set({ value: { ...lead.value, followUpAt: Date.now() + 50000 } }).where(eq(studioLeads.id, lead.id)).run();
    const result = commit('email,source,permission\npat@example.test,CRM unsubscribe,do-not-contact\nnew@example.test,CRM unsubscribe,do-not-contact');
    expect(result.counts.optOuts).toBe(2); expect(leads()).toHaveLength(2);
    expect(leads().find(l => l.id === lead.id)?.value).toMatchObject({ permission: 'do-not-contact', followUpAt: null });
    expect(app.sales!.isSuppressed(productId, 'new@example.test')).toBe(true);
    expect(app.sales!.isSuppressed(secondId, 'new@example.test')).toBe(false);
  });
  it('marks known purchases as customers and invalidates previews after a purchase', () => {
    const before = preview(); vi.spyOn(app.revenue!, 'purchaseForContact').mockImplementation((_id, contact) => contact === 'pat@example.test' ? { captured: 4900 } as ReturnType<RevenueService['purchaseForContact']> : undefined);
    expect(() => importLeads(app, { productId, csv, previewId: before.previewId })).toThrow('changed');
    expect(commit().counts.customers).toBe(1); expect(leads().find(l => l.value.contact === 'pat@example.test')?.value.stage).toBe('customer');
  });
  it('isolates businesses and rejects a preview token used for another business', () => {
    const before = preview(); expect(() => importLeads(app, { productId: secondId, csv, previewId: before.previewId })).toThrow('changed');
    commit(); expect(importLeads(app, { productId: secondId, csv }).counts.added).toBe(2);
  });
  it('rolls back every added lead and receipt if a later opt-out fails', () => {
    vi.spyOn(app.sales!, 'suppress').mockImplementation(() => { throw new Error('Injected storage failure'); });
    expect(() => commit('email,source,permission\na@example.test,form,unknown\nb@example.test,unsubscribe,do-not-contact')).toThrow('storage');
    expect(leads()).toHaveLength(0); expect(app.db.select().from(settings).all().filter(r => r.key.startsWith('sales.import.'))).toHaveLength(0);
  });
  it('does not accept renderer-supplied lead state or invalid trailing records', () => {
    expect(() => importLeads(app, { productId, csv, rows: [] })).toThrow();
    expect(() => commit(csv + '\nBad,invalid,Form,opted-in,,')).toThrow(); expect(leads()).toHaveLength(0);
  });
});
