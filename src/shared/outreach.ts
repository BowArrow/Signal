import { z } from 'zod';

export const outreachPolicySchema = z.object({ enabled: z.boolean(), accountId: z.string().max(200), objective: z.string().trim().min(10).max(1500), mailingAddress: z.string().trim().max(500), dailyLimit: z.number().int().min(1).max(10), delayMinutes: z.number().int().min(5).max(120), followUpDays: z.array(z.number().int().min(2).max(14)).max(2).default([]) }).strict().refine(p => !p.enabled || Boolean(p.accountId), 'Choose a monitored sending inbox.').refine(p => !p.enabled || (p.mailingAddress.length >= 10 && !/^(?:mailto:|https?:)/i.test(p.mailingAddress) && !z.string().email().safeParse(p.mailingAddress).success), 'Enter a physical business mailing address or registered PO box, not an email address or website.').refine(p => p.followUpDays.reduce((a, b) => a + b, 0) <= 21, 'Follow-up delays must total at most 21 days.');
export type OutreachPolicy = z.input<typeof outreachPolicySchema>;
export interface OutreachPolicyState extends z.output<typeof outreachPolicySchema> { productId: string; revision: number; configuredAt: number; }
export interface OutreachJob {
  coldApproval?: { draftId: string; approvedAt: number; sourceUrl: string; contactSource: string };
  mailbox?: string;
  providerInternetId?: string;
  followUp?: { rootId: string; previousId: string; step: number; threadId: string; inReplyTo: string; references: string[] };
  followUpsStopped?: { at: number; reason: string };
  id: string; productId: string; leadId: string; accountId: string; revision: number;
  from: string; to: string; subject: string; body: string; bodyHash: string; internetId: string;
  leadFingerprint: string;
  status: 'preparing' | 'queued' | 'dispatching' | 'sent' | 'attention' | 'cancelled';
  detail: string; createdAt: number; updatedAt: number; dueAt: number;
  attemptedAt: number | null; acceptedId: string | null; sentAt: number | null;
  threadId: string | null; checkedAt: number | null; reconciliationChecks: number;
  prepareAttempts: number; retryAt: number | null;
  feedback?: string;
  evidence: { url: string; quote: string; observedAt: number }[];
}
export interface OutreachSequenceView { productId: string; rootId: string; to: string; completedSteps: number; totalSteps: number; nextAt: number | null; status: 'waiting' | 'completed' | 'stopped' | 'attention'; detail: string; }
export interface OutreachView { policies: OutreachPolicyState[]; jobs: OutreachJob[]; sequences?: OutreachSequenceView[]; offline: boolean; }
export const outreachActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('configure'), productId: z.string(), value: outreachPolicySchema }).strict(),
  z.object({ type: z.literal('prepare'), productId: z.string(), leadId: z.string() }).strict(),
  z.object({ type: z.literal('cancel'), productId: z.string(), id: z.string() }).strict(),
  z.object({ type: z.literal('reconcile'), productId: z.string(), id: z.string() }).strict(),
  z.object({ type: z.literal('stop-followups'), productId: z.string(), id: z.string() }).strict(),
]);
export type OutreachAction = z.infer<typeof outreachActionSchema>;
