import { createHash } from 'node:crypto';
import { eq, like } from 'drizzle-orm';
import type { App } from '../app.js';
import { settings } from '../db/schema.js';
import { requireProduct } from '../marketing/store.js';
import { handoffActionSchema, type HandoffAction, type HandoffSummary, type HandoffView, type SalesHandoff } from '../../shared/handoffs.js';

const PREFIX = 'sales.handoff.'; const DAY = 86400000;
type Candidate = Pick<SalesHandoff, 'kind' | 'sourceId' | 'messageId' | 'accountId' | 'contact' | 'subject' | 'detail' | 'fingerprint' | 'uncertain'> & { waiting: boolean };
export class SalesHandoffs {
  constructor(private readonly app: App) {}
  private get(id: string) { return this.app.db.select().from(settings).where(eq(settings.key, PREFIX + id)).get()?.value as SalesHandoff | undefined; }
  private put(row: SalesHandoff) { this.app.db.insert(settings).values({ key: PREFIX + row.id, value: row, updatedAt: row.updatedAt }).onConflictDoUpdate({ target: settings.key, set: { value: row, updatedAt: row.updatedAt } }).run(); }
  list(productId: string) { requireProduct(this.app, productId); return this.app.db.select().from(settings).where(like(settings.key, `${PREFIX}%`)).all().map(r => r.value as SalesHandoff).filter(r => r.productId === productId); }
  private candidates(productId: string): Candidate[] {
    const messages = this.app.sales?.messages(productId) ?? []; const replies = this.app.salesReplies?.replies(productId) ?? []; const result: Candidate[] = [];
    for (const message of messages.filter(m => m.category === 'handoff' && !m.reviewedAt && !replies.some(r => r.messageId === m.id && ['queued', 'dispatching', 'preparing', 'sent', 'handoff', 'attention'].includes(r.status)))) result.push({ kind: 'message', sourceId: message.id, messageId: message.id, accountId: message.accountId, contact: message.from, subject: message.subject, detail: message.summary || 'This incoming conversation needs an owner response.', fingerprint: `message:${message.category}`, uncertain: false, waiting: false });
    for (const reply of replies) {
      const waiting = Boolean(reply.ownerApproval && ['queued', 'dispatching'].includes(reply.status));
      const uncertain = reply.status !== 'sent' && reply.attemptedAt !== null;
      const needsOwner = reply.status === 'handoff' || (reply.status === 'attention' && (uncertain || reply.retryAt === null || reply.prepareAttempts >= 3)) || Boolean(reply.status === 'cancelled' && reply.ownerApproval);
      if (!waiting && !needsOwner) continue;
      result.push({ kind: 'reply', sourceId: reply.id, messageId: reply.messageId, accountId: reply.accountId, contact: reply.to, subject: reply.subject, detail: reply.detail, fingerprint: `reply:${reply.status}:${reply.attemptedAt ?? ''}:${reply.prepareAttempts}:${reply.ownerApproval?.approvedAt ?? ''}`, uncertain, waiting });
    }
    for (const sequence of this.app.salesReplies?.sequences.list(productId) ?? []) {
      if (sequence.status !== 'attention' || result.some(c => c.messageId === sequence.messageId)) continue;
      const message = messages.find(m => m.id === sequence.messageId);
      result.push({ kind: 'sequence', sourceId: sequence.id, messageId: sequence.messageId, accountId: sequence.accountId, contact: sequence.to, subject: message?.subject ?? 'Sales follow-up needs attention', detail: sequence.detail, fingerprint: `sequence:${sequence.completedSteps}`, uncertain: false, waiting: false });
    }
    return result;
  }
  sync() {
    const now = this.app.clock.now();
    for (const product of this.app.connections?.view().products ?? []) {
      const existing = new Map(this.list(product.id).map(row => [row.id, row])); const seen = new Set<string>();
      for (const item of this.candidates(product.id)) {
        const id = createHash('sha256').update(`${product.id}:${item.kind}:${item.sourceId}`).digest('hex'); seen.add(id); const old = existing.get(id);
        if (old?.fingerprint === item.fingerprint) continue;
        const { waiting, ...source } = item;
        this.put({ ...source, id, productId: product.id, revision: (old?.revision ?? 0) + 1, status: waiting ? 'waiting' : 'open', dueAt: item.uncertain ? now : now + 4 * 3600000, createdAt: old?.createdAt ?? now, updatedAt: now, resolution: '', history: [...(old?.history ?? []), { at: now, action: old ? 'condition-changed' : 'opened', note: waiting ? 'Owner response queued; sending has not been confirmed.' : 'Owner attention requested.' }].slice(-30) });
      }
      for (const old of existing.values()) {
        if (!seen.has(old.id)) {
          const sent = this.app.salesReplies?.replies(product.id).some(r => r.id === old.sourceId && r.status === 'sent');
          if (old.status !== 'resolved' || (old.uncertain && sent)) this.change({ ...old, uncertain: sent ? false : old.uncertain }, 'resolved', sent ? 'sent-copy-confirmed' : 'condition-cleared', sent ? 'The matching sent copy was confirmed. This is not recipient delivery or a sale.' : 'The source condition changed or was reviewed. This does not establish a sent reply.');
        }
        const current = this.get(old.id); if (!current) continue;
        if (!seen.has(old.id) && current.status === 'resolved' && current.updatedAt < now - 90 * DAY) this.app.db.delete(settings).where(eq(settings.key, PREFIX + old.id)).run();
        else if (current.history.some(h => h.note && h.at < now - 30 * DAY)) {
          this.put({ ...current, history: current.history.map(h => ({ ...h, note: h.at < now - 30 * DAY ? '' : h.note })) });
        }
      }
    }
  }
  private change(row: SalesHandoff, status: SalesHandoff['status'], action: string, note: string, dueAt = row.dueAt) {
    this.put({ ...row, status, dueAt, revision: row.revision + 1, updatedAt: this.app.clock.now(), resolution: status === 'resolved' ? action : '', history: [...row.history, { at: this.app.clock.now(), action, note }].slice(-30) });
  }
  summary(productId: string): HandoffSummary {
    const rows = this.list(productId); const open = rows.filter(r => ['open', 'snoozed'].includes(r.status));
    return { open: open.length, due: open.filter(r => r.dueAt <= this.app.clock.now()).length, waiting: rows.filter(r => r.status === 'waiting').length, uncertain: open.filter(r => r.uncertain).length };
  }
  private capabilities(row: SalesHandoff) {
    const message = this.app.sales?.messages(row.productId).find(m => m.id === row.messageId);
    const reply = this.app.salesReplies?.replies(row.productId).find(r => r.id === row.sourceId);
    const active = ['open', 'snoozed'].includes(row.status);
    const sequenceActive = !reply?.followUp || this.app.salesReplies?.sequences.list(row.productId).some(s => s.id === reply.followUp!.sequenceId && s.status === 'active');
    const uncertain = this.app.salesReplies?.replies(row.productId).some(r => r.messageId === row.messageId && r.attemptedAt !== null && r.status !== 'sent');
    return { canReply: Boolean(active && row.kind !== 'sequence' && !uncertain && message?.body && !message.automated && !message.truncated), canRetry: Boolean(active && row.kind === 'reply' && !uncertain && reply && !reply.ownerApproval && reply.ownerHandledAt === undefined && sequenceActive && reply.attemptedAt === null), canReconcile: Boolean(row.kind === 'reply' && reply?.attemptedAt !== null && reply?.attemptedAt !== undefined && reply.status !== 'sent'), messageBody: message?.body ?? '' };
  }
  view(): HandoffView {
    this.sync(); const products = this.app.connections?.view().products ?? [];
    return { offline: this.app.env.SIGNAL_OFFLINE === '1', cases: products.flatMap(p => this.list(p.id).sort((a, b) => Number(a.status === 'resolved') - Number(b.status === 'resolved') || a.dueAt - b.dueAt).slice(0, 200).map(row => ({ ...row, ...this.capabilities(row) }))), counts: products.map(p => ({ productId: p.id, summary: this.summary(p.id) })) };
  }
  async action(input: HandoffAction) {
    const action = handoffActionSchema.parse(input); this.sync();
    const row = this.list(action.productId).find(r => r.id === action.id);
    if (!row || row.revision !== action.revision) throw new Error('This handoff changed. Refresh and review its current state.');
    const flags = this.capabilities(row);
    if (action.type === 'reconcile') { if (!flags.canReconcile) throw new Error('There is no uncertain reply to reconcile.'); await this.app.salesReplies!.reconcile(row.productId, row.sourceId); }
    else {
      if (!['open', 'snoozed'].includes(row.status)) throw new Error('This handoff is already resolved or waiting for its approved response.');
      if (action.type === 'snooze') {
        if (action.until <= this.app.clock.now() || action.until > this.app.clock.now() + 7 * DAY) throw new Error('Choose a reminder within the next seven days.');
        this.change(row, 'snoozed', 'reminder-set', action.note, action.until);
      }
      if (action.type === 'resolve') {
        if (row.uncertain && action.outcome !== 'uncertainty-acknowledged') throw new Error('Reconcile this reply or explicitly acknowledge its unresolved delivery.');
        if (!row.uncertain && action.outcome === 'uncertainty-acknowledged') throw new Error('This handoff has no uncertain send.');
        this.app.db.transaction(() => { this.app.salesReplies?.holdConversation(row.productId, row.messageId); if (this.app.sales?.messages(row.productId).some(m => m.id === row.messageId)) this.app.sales.review(row.productId, row.messageId); this.change(row, 'resolved', action.outcome, action.note); });
      }
      if (action.type === 'reply') {
        if (!flags.canReply) throw new Error('This handoff cannot queue another response. Check the original mailbox and any uncertain send.');
        this.app.salesReplies!.queueOwnerReply(row.productId, row.messageId, action.body, row.kind === 'reply' ? row.sourceId : undefined);
        this.change(row, 'waiting', 'owner-response-approved', 'The exact owner-written response was queued. No sent copy is confirmed yet.');
      }
      if (action.type === 'retry') { if (!flags.canRetry) throw new Error('This handoff cannot retry AI preparation.'); await this.app.salesReplies!.retryReply(row.productId, row.sourceId); }
    }
    return this.view();
  }
}
