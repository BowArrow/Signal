import { createHash, randomUUID } from 'node:crypto';
import { eq, like } from 'drizzle-orm';
import type { App } from '../app.js';
import { settings } from '../db/schema.js';
import type { PipelineLead, PipelineStage } from '../../shared/sales-pipeline.js';

export const pipelineKey = (kind: string, id: string) => `sales.pipeline.${kind}.${id}`;
export const contactId = (productId: string, email: string) => createHash('sha256').update(`${productId}:${email.trim().toLowerCase()}`).digest('hex');
export function pipelineGet<T>(app: App, kind: string, id: string) { return app.db.select().from(settings).where(eq(settings.key, pipelineKey(kind, id))).get()?.value as T | undefined; }
export function pipelinePut(app: App, kind: string, id: string, value: unknown) {
  const updatedAt = app.clock.now();
  app.db.insert(settings).values({ key: pipelineKey(kind, id), value, updatedAt }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt } }).run();
}
export function pipelineRows<T>(app: App, kind: string) { return app.db.select().from(settings).where(like(settings.key, pipelineKey(kind, '%'))).all().map(r => r.value as T); }
const transitions: Record<PipelineStage, readonly PipelineStage[]> = {
  DISCOVERED: ['ENRICHED', 'REPLIED', 'DISQUALIFIED'], ENRICHED: ['QUALIFIED', 'REPLIED', 'DISQUALIFIED'], QUALIFIED: ['DRAFT_READY', 'REPLIED', 'DISQUALIFIED'],
  DRAFT_READY: ['OUTREACH_ACTIVE', 'REPLIED', 'DISQUALIFIED'], OUTREACH_ACTIVE: ['REPLIED', 'DISQUALIFIED', 'CLOSED_WON'],
  REPLIED: ['MEETING_BOOKED', 'CHECKOUT_SENT', 'NURTURE_LATER', 'DISQUALIFIED', 'CLOSED_WON'],
  MEETING_BOOKED: ['CHECKOUT_SENT', 'CLOSED_WON', 'NURTURE_LATER', 'DISQUALIFIED'], CHECKOUT_SENT: ['CLOSED_WON', 'REPLIED', 'NURTURE_LATER', 'DISQUALIFIED'],
  NURTURE_LATER: ['REPLIED', 'DISQUALIFIED', 'CLOSED_WON'], CLOSED_WON: [], DISQUALIFIED: [],
};
export function savePipelineLead(app: App, lead: PipelineLead, patch: Partial<PipelineLead>, reason: string): PipelineLead {
  return app.db.transaction(() => {
    const current = pipelineGet<PipelineLead>(app, 'lead', lead.id);
    if (!current || current.productId !== lead.productId || current.revision !== lead.revision) throw new Error('This lead changed. Reload before continuing.');
    const stage = patch.stage ?? current.stage;
    if (stage !== current.stage && !transitions[current.stage].includes(stage)) throw new Error(`Invalid pipeline transition: ${current.stage} to ${stage}.`);
    const next = { ...current, ...patch, id: current.id, productId: current.productId, revision: current.revision + 1, updatedAt: app.clock.now(), detail: reason,
      history: stage === current.stage ? current.history : [...current.history, { stage, at: app.clock.now(), reason }].slice(-100) };
    pipelinePut(app, 'lead', next.id, next); return next;
  });
}
export function claimPipelineLead(app: App, lead: PipelineLead) {
  if (lead.lease && lead.lease.until > app.clock.now()) throw new Error('This lead is already processing.');
  return savePipelineLead(app, lead, { lease: { token: randomUUID(), until: app.clock.now() + 15 * 60000 } }, 'Preparing the next pipeline stage.');
}
