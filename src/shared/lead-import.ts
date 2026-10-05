import { z } from 'zod';

export const LEAD_IMPORT_LIMIT = 500;
export const LEAD_IMPORT_MAX_CHARS = 1_000_000;
export const leadImportActionSchema = z.object({
  productId: z.string().min(1).max(100), csv: z.string().min(1).max(LEAD_IMPORT_MAX_CHARS),
  previewId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
export type LeadImportAction = z.infer<typeof leadImportActionSchema>;
export const importedContactSchema = z.object({
  name: z.string().trim().min(1).max(200), email: z.string().trim().email().max(254).transform(v => v.toLowerCase()),
  source: z.string().trim().min(1).max(2000), notes: z.string().trim().max(2000),
  permission: z.enum(['unknown', 'opted-in', 'do-not-contact']), consent: z.string().trim().max(1500),
}).strict().superRefine((row, ctx) => {
  if (row.permission === 'opted-in' && row.consent.length < 10) ctx.addIssue({ code: 'custom', path: ['consent'], message: 'Opted-in contacts need a consent record describing where and when they agreed to marketing from this business.' });
});
export type ImportedContact = z.infer<typeof importedContactSchema>;
export type LeadImportStatus = 'add' | 'existing' | 'suppressed' | 'customer' | 'opt-out';
export interface LeadImportPreview {
  productId: string; previewId: string; committed: boolean;
  rows: { row: number; contact: ImportedContact; status: LeadImportStatus; detail: string }[];
  counts: { added: number; existing: number; suppressed: number; customers: number; optOuts: number };
}

/** RFC 4180 quoting, with LF line endings and UTF-8 BOM accepted for common exports. */
export function parseLeadCsv(input: string): ImportedContact[] {
  if (!input.length || input.length > LEAD_IMPORT_MAX_CHARS) throw new Error('Choose a CSV containing at most 1,000,000 characters.');
  const text = input.replace(/^\uFEFF/, '');
  // Reject binary controls while retaining tabs and CSV line breaks.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]/.test(text)) throw new Error('Use a UTF-8 CSV without binary or invalid text.');
  const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false; let closed = false;
  const endField = () => { row.push(field); field = ''; closed = false; if (row.length > 6) throw new Error('Use only the six supported CSV columns.'); };
  const endRow = () => { endField(); rows.push(row); row = []; if (rows.length > LEAD_IMPORT_LIMIT + 1) throw new Error('Import at most 500 contacts at a time.'); };
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } }
      else field += char;
    } else if (char === ',') endField();
    else if (char === '\r' || char === '\n') { if (char === '\r' && text[i + 1] === '\n') i++; endRow(); }
    else if (char === '"' && !field && !closed) quoted = true;
    else { if (char === '"' || closed) throw new Error(`Invalid CSV quoting in record ${rows.length + 1}.`); field += char; }
  }
  if (quoted) throw new Error('CSV has an unclosed quoted field.');
  if (row.length || field || closed) endRow();
  const headers = rows.shift()?.map(h => h.trim().toLowerCase()) ?? [];
  const supported = ['name', 'email', 'source', 'permission', 'consent', 'notes'];
  if (!headers.includes('email') || !headers.includes('source') || headers.some(h => !supported.includes(h)) || new Set(headers).size !== headers.length) throw new Error('CSV needs unique email and source headers. Optional headers: name, permission, consent, notes.');
  if (!rows.length) throw new Error('CSV contains no contacts.');
  const seen = new Set<string>();
  return rows.map((values, i) => {
    if (values.length !== headers.length) throw new Error(`Record ${i + 2} has a different number of columns from the header.`);
    const value = Object.fromEntries(headers.map((h, j) => [h, values[j]!.trim()]));
    const result = importedContactSchema.safeParse({ name: value.name || value.email, email: value.email, source: value.source, permission: value.permission || 'unknown', consent: value.consent || '', notes: value.notes || '' });
    if (!result.success) throw new Error(`Record ${i + 2}: ${result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
    if (seen.has(result.data.email)) throw new Error(`Record ${i + 2} repeats an email address. Keep one record per contact so consent is unambiguous.`);
    seen.add(result.data.email); return result.data;
  });
}
