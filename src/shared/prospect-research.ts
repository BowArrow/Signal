import { z } from 'zod';

export const prospectResearchPolicySchema = z.object({
  enabled: z.boolean(), audience: z.string().trim().min(15).max(1500),
  queries: z.array(z.string().trim().min(8).max(250)).min(1).max(5),
  dailyDraftLimit: z.number().int().min(1).max(5),
}).strict();
export type ProspectResearchPolicy = z.infer<typeof prospectResearchPolicySchema>;
export interface ProspectResearchState extends ProspectResearchPolicy {
  productId: string; requested: boolean; lastAttemptAt: number | null; nextAt: number;
  status: 'idle' | 'queued' | 'researching' | 'ready' | 'attention'; detail: string;
  pending: string[]; queryIndex: number;
  lastSource?: string;
  requestedLeadId?: string | null;
  attempts?: { url: string; at: number }[];
}
export interface ProspectDraft {
  kind: 'business' | 'blog' | 'community';
  rulesUrl: string; rulesQuote: string; nextStep: string;
  id: string; productId: string; leadId: string | null; name: string; url: string;
  contact: string; contactSource: string; fit: string; prospectQuote: string; productQuote: string;
  productUrl: string; observedAt: number; createdAt: number; updatedAt: number;
  status: 'draft' | 'no-contact' | 'suggestion' | 'submitted' | 'rejected' | 'queued'; detail: string;
  subject: string; body: string; deliveryId?: string;
}
export interface ProspectResearchView { states: ProspectResearchState[]; drafts: ProspectDraft[]; offline: boolean; }
export const prospectResearchActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('configure'), productId: z.string(), value: prospectResearchPolicySchema }).strict(),
  z.object({ type: z.literal('research'), productId: z.string() }).strict(),
  z.object({ type: z.literal('inspect'), productId: z.string(), url: z.string().url().max(2000) }).strict(),
  z.object({ type: z.literal('draft-lead'), productId: z.string(), leadId: z.string().min(1), url: z.string().url().max(2000).optional() }).strict(),
  z.object({ type: z.literal('edit'), productId: z.string(), id: z.string(), updatedAt: z.number(), subject: z.string().trim().min(5).max(140), body: z.string().trim().min(30).max(2200) }).strict(),
  z.object({ type: z.literal('reject'), productId: z.string(), id: z.string() }).strict(),
  z.object({ type: z.literal('submitted'), productId: z.string(), id: z.string(), url: z.string().url().max(2000) }).strict(),
  z.object({ type: z.literal('approve'), productId: z.string(), id: z.string(), updatedAt: z.number(), policyRevision: z.number().int(), sender: z.string().email(), reviewed: z.literal(true) }).strict(),
]);
export type ProspectResearchAction = z.infer<typeof prospectResearchActionSchema>;
