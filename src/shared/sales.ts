import { z } from 'zod';
import type { ConnectedAccount } from './connections.js';
import type { StudioLead } from './studio.js';

export const salesConfigSchema = z.object({ accountId: z.string().min(1).max(100), since: z.number().int().nonnegative(), autoSync: z.boolean(), aiTriage: z.boolean(), senderEmail: z.string().trim().toLowerCase().email().max(254).optional() }).strict();
export type SalesConfig = z.infer<typeof salesConfigSchema>;
export interface SalesSource extends SalesConfig {
  productId: string; mailbox: string; revision: number; cursor: string; watermark: number;
  scanUntil: number | null; lastAttemptAt: number | null; lastCompleteAt: number | null;
  status: 'idle' | 'syncing' | 'partial' | 'current' | 'attention'; detail: string;
}
export type SalesCategory = 'inquiry' | 'positive' | 'objection' | 'unsubscribe' | 'away' | 'bounce' | 'other' | 'handoff';
export interface InboxMessage {
  providerId: string; threadId: string; internetId: string; from: string; subject: string;
  body: string; receivedAt: number; automated: boolean; bounce: boolean; truncated: boolean;
  recipient?: string;
}
export interface InboxPage { messages: InboxMessage[]; next: string; scanned: number; }
export interface SalesMessage extends InboxMessage {
  id: string; productId: string; accountId: string; observedAt: number;
  category: SalesCategory | 'pending'; summary: string; evidence: string;
  leadId: string | null; reviewedAt: number | null; triageAttemptAt: number | null;
}
export interface SalesSuppression { productId: string; email: string; createdAt: number; reason: string; messageId: string | null; }
export interface SalesView {
  offline: boolean; products: { id: string; name: string; senderSuggestion?: string }[]; accounts: ConnectedAccount[];
  senders: { accountId: string; email: string; verified: boolean; primary: boolean }[];
  sources: SalesSource[]; messages: SalesMessage[]; suppressions: SalesSuppression[];
  leads: { id: string; productId: string; value: StudioLead }[];
  counts: { productId: string; pending: number; needsReview: number; messages: number }[];
}
export const salesActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('configure'), productId: z.string().min(1), value: salesConfigSchema }).strict(),
  z.object({ type: z.literal('load-senders'), productId: z.string().min(1), accountId: z.string().min(1) }).strict(),
  z.object({ type: z.literal('link-gmail'), productId: z.string().min(1), sourceProductId: z.string().min(1), accountId: z.string().min(1) }).strict(),
  z.object({ type: z.literal('sync'), productId: z.string().min(1), accountId: z.string().min(1) }).strict(),
  z.object({ type: z.literal('remove-source'), productId: z.string().min(1), accountId: z.string().min(1) }).strict(),
  z.object({ type: z.literal('triage'), productId: z.string().min(1), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal('review'), productId: z.string().min(1), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal('suppress'), productId: z.string().min(1), email: z.string().email().max(254), reason: z.string().trim().min(5).max(500) }).strict(),
  z.object({ type: z.literal('lead'), productId: z.string().min(1), id: z.string().min(1) }).strict(),
]);
export type SalesAction = z.infer<typeof salesActionSchema>;
