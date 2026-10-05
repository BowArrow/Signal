import { z } from 'zod';

const id = z.string().regex(/^\d{10}$/);
export const paidSearchPolicySchema = z.object({
  accountId: z.string().min(1), customerId: id, loginCustomerId: z.union([id, z.literal('')]).default(''),
  capCents: z.number().int().min(100).max(50000), maxCpcCents: z.number().int().min(1).max(5000),
  billingReservePct: z.number().int().min(0).max(100), durationDays: z.number().int().min(3).max(14),
}).strict().refine(p => p.maxCpcCents <= p.capCents, 'The click bid cannot exceed the campaign total.');
export type PaidSearchPolicy = z.infer<typeof paidSearchPolicySchema>;
export interface PaidSearchSettings extends PaidSearchPolicy { productId: string; revision: number; }
const asset = (max: number) => z.object({ text: z.string().trim().min(3).max(max), sourceQuote: z.string().trim().min(15).max(1000) }).strict();
export const searchCreativeSchema = z.object({
  title: z.string().trim().min(5).max(80), rationale: z.string().trim().min(30).max(1200),
  keywords: z.array(z.string().trim().min(3).max(80).regex(/^[\p{L}\p{N} -]+$/u)).min(3).max(10),
  headlines: z.array(asset(30)).length(3), descriptions: z.array(asset(90)).length(2),
}).strict();
export type SearchCreative = z.infer<typeof searchCreativeSchema>;
export interface SearchRun { name: string; startDateTime: string; endDateTime: string; timeZone: string; resource?: string; }
export interface PaidSearchJob {
  id: string; productId: string; taskId: string; creative: SearchCreative; settings: PaidSearchSettings;
  destination: string; sourceUrl: string; sourceText: string; createdAt: number; updatedAt: number;
  status: 'draft' | 'approved' | 'provisioning' | 'paused' | 'activating' | 'active' | 'stopping' | 'closed' | 'attention';
  detail: string; approvedAt: number | null; fundingRevision: number | null; run?: SearchRun;
  stopRequested: boolean; checkedAt: number | null; costCents: number; clicks: number; impressions: number;
  activationAttempted: boolean; liabilityCents: number; settledAt?: number;
}
export interface PaidSearchView {
  settings: PaidSearchSettings[]; jobs: PaidSearchJob[];
  accounts: { id: string; productId: string; label: string; status: string }[];
}
export const paidSearchActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('configure'), productId: z.string(), value: paidSearchPolicySchema }).strict(),
  z.object({ type: z.literal('prepare'), productId: z.string() }).strict(),
  z.object({ type: z.literal('approve'), productId: z.string(), id: z.string(), reviewed: z.literal(true) }).strict(),
  z.object({ type: z.literal('stop'), productId: z.string(), id: z.string() }).strict(),
  z.object({ type: z.literal('sync'), productId: z.string(), id: z.string() }).strict(),
  z.object({ type: z.literal('settle'), productId: z.string(), id: z.string(), finalCents: z.number().int().min(0).max(1000000), invoiceReference: z.string().trim().min(5).max(120) }).strict(),
]);
export type PaidSearchAction = z.infer<typeof paidSearchActionSchema>;
