import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { App } from '../app.js';
import { settings } from '../db/schema.js';

const KEY = 'operations.editorial-feedback.';
const WEEK = 7 * 86400000;
const entrySchema = z.object({
  attemptId: z.string().max(160), sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  title: z.string().min(1).max(160), findingId: z.string().max(80).nullable(),
  correction: z.string().min(1).max(1200), at: z.number().int().min(0),
}).strict();
type Entry = z.infer<typeof entrySchema>;
function sourceHash(source: unknown): string | null {
  const parsed = z.object({ url: z.string().url(), body: z.string().min(1) }).safeParse(source);
  return parsed.success ? createHash('sha256').update(JSON.stringify([parsed.data.url, parsed.data.body.replace(/\s+/g, ' ').trim()])).digest('hex') : null;
}
function read(app: App, productId: string): Entry[] {
  const raw = app.db.select().from(settings).where(eq(settings.key, KEY + productId)).get()?.value;
  if (!Array.isArray(raw)) return [];
  const now = app.clock.now();
  return raw.flatMap(value => { const parsed = entrySchema.safeParse(value); return parsed.success && parsed.data.at <= now && parsed.data.at > now - WEEK ? [parsed.data] : []; }).slice(-24);
}
/** Fallible review feedback, scoped to the business and the source that was checked. */
export function campaignFeedback(app: App, productId: string, source: unknown) {
  const hash = sourceHash(source);
  const entries = hash ? read(app, productId).filter(row => row.sourceHash === hash) : [];
  const counts = new Map<string, number>();
  for (const row of entries) if (row.findingId) counts.set(row.findingId, (counts.get(row.findingId) ?? 0) + 1);
  return {
    deferredFindingIds: [...counts].filter(([, count]) => count >= 2).map(([id]) => id),
    corrections: entries.slice(-4).map(row => ({ title: row.title, correction: row.correction.slice(0, 500), at: row.at })),
  };
}
export function rememberCampaignRejection(app: App, productId: string, taskId: string, attempt: number, source: unknown, input: unknown, error: unknown): void {
  if (!(error instanceof Error) || !/^(Editorial review requires revision|Public research does not support)/.test(error.message)) return;
  const hash = sourceHash(source);
  const draft = z.object({ title: z.string().trim().min(1).max(160), demand: z.object({ findingId: z.string().max(80) }).optional() }).safeParse(input);
  if (!hash || !draft.success) return;
  const finding = draft.data.demand?.findingId;
  const entry: Entry = { attemptId: `${taskId}:${attempt}`, sourceHash: hash, title: draft.data.title,
    findingId: finding && finding !== 'none' ? finding : null, correction: error.message.slice(0, 1200), at: app.clock.now() };
  const rows = [...read(app, productId).filter(row => row.attemptId !== entry.attemptId), entry].slice(-24);
  app.db.insert(settings).values({ key: KEY + productId, value: rows }).onConflictDoUpdate({ target: settings.key, set: { value: rows, updatedAt: app.clock.now() } }).run();
}
/** A corrected, accepted use of a finding supersedes its failed drafts. */
export function clearRecoveredFinding(app: App, productId: string, source: unknown, input: unknown): void {
  const hash = sourceHash(source);
  const parsed = z.object({ demand: z.object({ findingId: z.string().max(80) }) }).safeParse(input);
  if (!hash || !parsed.success || parsed.data.demand.findingId === 'none') return;
  const rows = read(app, productId).filter(row => row.sourceHash !== hash || row.findingId !== parsed.data.demand.findingId);
  app.db.update(settings).set({ value: rows, updatedAt: app.clock.now() }).where(eq(settings.key, KEY + productId)).run();
}
