import { z } from 'zod';

export function replyAccountCanSend(account: { provider: string; grantedScopes: readonly string[] }) {
  if (account.provider === 'gmail') return account.grantedScopes.some(scope => ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.modify', 'https://mail.google.com/'].includes(scope));
  if (account.provider === 'outlook') return ['Mail.ReadWrite', 'Mail.Send'].every(permission => account.grantedScopes.some(scope => scope === permission || scope === `https://graph.microsoft.com/${permission}`));
  return false;
}
export const ownerReplySchema = z.string().trim().min(20).max(3600);
export function ownerReplyText(body: string, business: string) { return `${ownerReplySchema.parse(body)}\n\n${business} team - sent with Signal`; }

export const replyPolicySchema = z.object({ enabled: z.boolean(), accountIds: z.array(z.string().min(1)).max(3), dailyLimit: z.number().int().min(1).max(20), delayMinutes: z.number().int().min(1).max(120), followUpDays: z.array(z.number().int().min(1).max(14)).max(3).default([]) }).strict().refine(p => !p.enabled || p.accountIds.length > 0, 'Select at least one Gmail or Outlook inbox.').refine(p => p.followUpDays.reduce((a, b) => a + b, 0) <= 21, 'Follow-up delays must total at most 21 days.');
export type ReplyPolicy = z.input<typeof replyPolicySchema>;
export interface ReplyPolicyState extends z.output<typeof replyPolicySchema> { productId: string; revision: number; configuredAt: number; }
export interface SalesSequence {
  id: string; productId: string; accountId: string; messageId: string; leadId: string; to: string;
  rootReplyId: string; lastReplyId: string; revision: number; delays: number[]; completedSteps: number;
  status: 'active' | 'stopped' | 'completed' | 'attention'; detail: string;
  startedAt: number; updatedAt: number; nextAt: number | null;
}
export interface SalesReply {
  mailbox?: string;
  id: string; productId: string; accountId: string; messageId: string; revision: number;
  from: string; to: string; threadId: string; inReplyTo: string; subject: string; body: string; bodyHash: string;
  sourceBody: string; sourceProviderId: string; sourceReceivedAt: number; internetId: string;
  status: 'preparing' | 'queued' | 'dispatching' | 'sent' | 'attention' | 'handoff' | 'cancelled';
  detail: string; createdAt: number; updatedAt: number; dueAt: number;
  attemptedAt: number | null; acceptedId: string | null; sentAt: number | null;
  checkedAt: number | null; reconciliationChecks: number;
  prepareAttempts: number; retryAt: number | null;
  ownerApproval?: { approvedAt: number; bodyHash: string };
  ownerHandledAt?: number;
  followUp?: { sequenceId: string; step: number; previousReplyId: string };
  evidence: { url: string; quote: string; observedAt: number }[];
}
export interface ReplyView { policies: ReplyPolicyState[]; replies: SalesReply[]; sequences: SalesSequence[]; offline: boolean; }
export const replyActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('configure'), productId: z.string().min(1), value: replyPolicySchema }).strict(),
  z.object({ type: z.literal('prepare'), productId: z.string().min(1), messageId: z.string().min(1) }).strict(),
  z.object({ type: z.literal('cancel'), productId: z.string().min(1), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal('reconcile'), productId: z.string().min(1), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal('retry-reply'), productId: z.string().min(1), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal('stop-sequence'), productId: z.string().min(1), id: z.string().min(1) }).strict(),
]);
export type ReplyAction = z.infer<typeof replyActionSchema>;
