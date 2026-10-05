import { eq, like } from 'drizzle-orm';
import type { App } from '../app.js';
import { settings, studioLeads } from '../db/schema.js';
import { requireProduct } from '../marketing/store.js';
import { mailboxAddress } from './inbox.js';
import { isSalesSuppressed } from './suppression.js';
import type { ReplyPolicyState, SalesReply, SalesSequence } from '../../shared/sales-replies.js';

const PREFIX = 'sales.sequence.'; const DAY = 86400000;
export class SalesSequences {
  constructor(private readonly app: App) {}
  list(productId: string) { requireProduct(this.app, productId); return this.app.db.select().from(settings).where(like(settings.key, `${PREFIX}%`)).all().map(r => r.value as SalesSequence).filter(r => r.productId === productId); }
  get(productId: string, id: string) { const row = this.list(productId).find(s => s.id === id); if (!row) throw new Error('Sequence not found for this business.'); return row; }
  private save(sequence: SalesSequence) { const value = { ...sequence, updatedAt: this.app.clock.now() }; this.app.db.insert(settings).values({ key: PREFIX + sequence.id, value, updatedAt: this.app.clock.now() }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: this.app.clock.now() } }).run(); }
  private lead(sequence: SalesSequence) { const lead = this.app.db.select().from(studioLeads).where(eq(studioLeads.id, sequence.leadId)).get(); if (!lead || lead.productId !== sequence.productId) throw new Error('The sequence lead is unavailable.'); return lead; }
  private setDue(sequence: SalesSequence, nextAt: number | null) { const lead = this.lead(sequence); if (lead.value.followUpAt === sequence.nextAt) this.app.db.update(studioLeads).set({ value: { ...lead.value, followUpAt: nextAt } }).where(eq(studioLeads.id, lead.id)).run(); }
  stop(productId: string, id: string, detail = 'Stopped by the owner.', status: 'stopped' | 'attention' = 'stopped') {
    const sequence = this.get(productId, id); if (sequence.status !== 'active' && !(sequence.status === 'attention' && status === 'stopped')) return;
    this.app.db.transaction(() => { try { this.setDue(sequence, null); } catch { /* Lead may have been removed. */ } this.save({ ...sequence, status, nextAt: null, detail }); });
    this.app.salesReplies?.pause(productId);
  }
  enroll(root: SalesReply, policy: ReplyPolicyState) {
    if (this.app.revenue?.purchaseForContact(root.productId, root.to)) return;
    if (root.followUp || root.status !== 'sent' || !root.acceptedId || !root.sentAt || !policy.enabled || !policy.followUpDays.length || root.revision !== policy.revision || root.createdAt < policy.configuredAt || root.sourceReceivedAt < this.app.clock.now() - 28 * DAY || this.list(root.productId).some(s => s.id === root.id)) return;
    const message = this.app.sales?.messages(root.productId).find(m => m.id === root.messageId); if (!message?.leadId) return;
    if (this.list(root.productId).some(s => s.status === 'active' && (s.leadId === message.leadId || s.to === root.to))) return;
    const nextAt = root.sentAt + policy.followUpDays[0]! * DAY;
    const sequence: SalesSequence = { id: root.id, rootReplyId: root.id, lastReplyId: root.id, productId: root.productId, accountId: root.accountId, messageId: root.messageId, leadId: message.leadId, to: root.to, revision: policy.revision, delays: policy.followUpDays, completedSteps: 0, status: 'active', detail: 'Waiting for a customer reply before the next follow-up.', startedAt: root.sentAt, updatedAt: this.app.clock.now(), nextAt };
    const lead = this.lead(sequence); if (lead.value.followUpAt !== null) return;
    if (mailboxAddress(lead.value.contact) !== root.to || !['existing-conversation', 'opted-in'].includes(lead.value.permission) || ['lost', 'customer'].includes(lead.value.stage) || isSalesSuppressed(this.app, root.productId, root.to)) return;
    if (this.app.sales!.messages(root.productId).some(m => m.id !== message.id && m.receivedAt > message.receivedAt && (m.from === root.to || (m.accountId === root.accountId && m.threadId === root.threadId)))) return;
    this.app.db.transaction(() => { this.save(sequence); this.app.db.update(studioLeads).set({ value: { ...lead.value, followUpAt: nextAt } }).where(eq(studioLeads.id, lead.id)).run(); });
  }
  validate(sequence: SalesSequence, policy: ReplyPolicyState) {
    if (this.app.revenue?.purchaseForContact(sequence.productId, sequence.to)) throw new Error('A live Stripe purchase matched this contact. Automatic sales follow-ups stopped.');
    if (sequence.status !== 'active' || !policy.enabled || sequence.revision !== policy.revision || !policy.accountIds.includes(sequence.accountId)) throw new Error('The sequence policy is no longer active.');
    const message = this.app.sales?.messages(sequence.productId).find(m => m.id === sequence.messageId);
    if (!message?.body || message.receivedAt < this.app.clock.now() - 28 * DAY) throw new Error('The original conversation has expired.');
    const lead = this.lead(sequence);
    if (mailboxAddress(lead.value.contact) !== sequence.to || !['existing-conversation', 'opted-in'].includes(lead.value.permission) || ['lost', 'customer'].includes(lead.value.stage) || lead.value.followUpAt !== sequence.nextAt) throw new Error('The lead or its follow-up schedule changed.');
    if (isSalesSuppressed(this.app, sequence.productId, sequence.to)) throw new Error('The contact is suppressed.');
    if (this.app.sales!.messages(sequence.productId).some(m => m.id !== message.id && m.receivedAt > message.receivedAt && (m.from === sequence.to || (m.accountId === sequence.accountId && m.threadId === message.threadId)))) throw new Error('A newer message ended this sequence.');
    return message;
  }
  confirmed(job: SalesReply) {
    if (!job.followUp || !job.sentAt) return;
    const sequence = this.get(job.productId, job.followUp.sequenceId);
    if (sequence.status !== 'active' || sequence.completedSteps >= job.followUp.step || sequence.lastReplyId !== job.followUp.previousReplyId) return;
    const completedSteps = job.followUp.step; const nextAt = completedSteps < sequence.delays.length ? job.sentAt + sequence.delays[completedSteps]! * DAY : null;
    this.app.db.transaction(() => { this.setDue(sequence, nextAt); this.save({ ...sequence, lastReplyId: job.id, completedSteps, nextAt, status: nextAt === null ? 'completed' : 'active', detail: nextAt === null ? 'All scheduled follow-ups completed. No further messages are scheduled.' : 'Waiting for a customer reply before the next follow-up.' }); });
  }
}
