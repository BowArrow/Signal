import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { App } from '../app.js';
import { settings, studioLeads } from '../db/schema.js';
import { requireProduct } from '../marketing/store.js';
import { newId } from '../lib/id.js';
import { mailboxAddress } from './inbox.js';
import { isSalesSuppressed } from './suppression.js';
import { leadImportActionSchema, parseLeadCsv, type LeadImportPreview } from '../../shared/lead-import.js';

/** Preview and commit both derive from current records; the renderer cannot supply lead values. */
export function importLeads(app: App, input: unknown): LeadImportPreview {
  const action = leadImportActionSchema.parse(input); requireProduct(app, action.productId);
  const contacts = parseLeadCsv(action.csv);
  const existing = app.db.select().from(studioLeads).where(eq(studioLeads.productId, action.productId)).all();
  const rows: LeadImportPreview['rows'] = contacts.map((contact, i) => {
    const matches = existing.filter(l => mailboxAddress(l.value.contact) === contact.email);
    if (contact.permission === 'do-not-contact') return { row: i + 2, contact, status: 'opt-out', detail: 'Record an opt-out and stop follow-ups for this business.' };
    if (isSalesSuppressed(app, action.productId, contact.email) || matches.some(l => l.value.permission === 'do-not-contact')) return { row: i + 2, contact, status: 'suppressed', detail: 'Keep existing do-not-contact protection; no prospect will be added.' };
    if (matches.length) return { row: i + 2, contact, status: 'existing', detail: 'Keep the existing lead, stage, notes and permission unchanged.' };
    if (app.revenue?.purchaseForContact(action.productId, contact.email)) return { row: i + 2, contact, status: 'customer', detail: 'Add as a customer based on matched Stripe purchase history; no initial outreach.' };
    return { row: i + 2, contact, status: 'add', detail: contact.permission === 'opted-in' ? 'Add an opted-in prospect for the configured outreach policy.' : 'Add for research; unknown permission prevents automatic initial outreach.' };
  });
  // Include existing values so a changed permission, stage or source requires another preview.
  const previewId = createHash('sha256').update(JSON.stringify({ productId: action.productId, rows, existing: existing.filter(l => contacts.some(c => c.email === mailboxAddress(l.value.contact))).sort((a, b) => a.id.localeCompare(b.id)) })).digest('hex');
  const counts = { added: rows.filter(r => r.status === 'add').length, existing: rows.filter(r => r.status === 'existing').length, suppressed: rows.filter(r => r.status === 'suppressed').length, customers: rows.filter(r => r.status === 'customer').length, optOuts: rows.filter(r => r.status === 'opt-out').length };
  if (action.previewId) {
    if (action.previewId !== previewId) throw new Error('The contacts or pipeline changed. Preview this import again before saving.');
    if (!app.sales || !app.operations) throw new Error('Sales and Operations must be initialized before importing contacts.');
    // The owner resumes after reviewing the resulting pipeline. No new lead can send during import.
    app.operations.pause(action.productId);
    app.db.transaction(() => {
      for (const row of rows) {
        const { contact } = row;
        if (row.status === 'opt-out') { app.sales!.suppress(action.productId, contact.email, `CSV opt-out: ${contact.source}`.slice(0, 500)); continue; }
        if (!['add', 'customer'].includes(row.status)) continue;
        app.db.insert(studioLeads).values({ id: newId(), productId: action.productId, createdAt: app.clock.now(), value: {
          name: contact.name, contact: contact.email, source: contact.source, permission: contact.permission,
          stage: row.status === 'customer' ? 'customer' : 'discovered', followUpAt: null, campaignId: '',
          notes: [contact.notes, contact.consent ? `Recorded consent: ${contact.consent}` : ''].filter(Boolean).join('\n\n'),
        } }).run();
      }
      app.db.insert(settings).values({ key: `sales.import.${action.productId}.${previewId}`, value: { productId: action.productId, counts, importedAt: app.clock.now() }, updatedAt: app.clock.now() }).onConflictDoNothing().run();
    });
  }
  return { productId: action.productId, previewId, committed: Boolean(action.previewId), rows, counts };
}
