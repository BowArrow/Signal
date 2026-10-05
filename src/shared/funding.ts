import { z } from 'zod';
const cents = z.number().int().min(0).max(100_000_000);
export const fundingPolicySchema = z.object({ enabled: z.boolean(), reinvestPct: z.number().int().min(0).max(100), operatingReservePct: z.number().int().min(0).max(100), reserveCents: cents, capCents: cents, holdDays: z.number().int().min(7).max(90) }).strict();
export type FundingPolicy = z.infer<typeof fundingPolicySchema>;
export interface FundingState extends FundingPolicy { productId: string; currency: string; revenueRevision: number; revision: number; configuredAt: number; }
export interface FundingView {
  remaining?: { spentCents: number; committedCents: number; availableCents: number };
  productId: string; currency: string; policy: FundingState | null;
  eligibleCents: number; allocationCents: number; eligiblePayments: number;
  heldPayments: number; unknownPayments: number; excludedPayments: number;
  blockers: string[]; observedAt: number | null;
}
