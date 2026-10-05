import { z } from 'zod';
import { fundingPolicySchema, type FundingView } from './funding.js';
// Stripe allows owner-supplied product IDs. Treat them as opaque identifiers,
// not as necessarily having the automatically generated prod_ prefix.
export const stripeProductIdSchema = z.string().min(1).max(255).refine(value => [...value].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127), 'Invalid Stripe product ID');
export const revenueConfigSchema = z.object({ accountId: z.string().min(1), stripeProductIds: z.array(stripeProductIdSchema).min(1).max(30), since: z.number().int().nonnegative(), live: z.boolean() }).strict();
export type RevenueConfig = z.infer<typeof revenueConfigSchema>;
export interface RevenueState extends RevenueConfig {
  productId: string; revision: number; cursor: string; scanStartedAt: number | null;
  lastAttemptAt: number | null; lastCompleteAt: number | null; scanned: number; excluded: number;
  status: 'idle' | 'syncing' | 'partial' | 'current' | 'attention'; detail: string;
}
export interface RevenuePayment {
  settlement?: { id: string; currency: string; amount: number; fee: number; net: number; availableAt: number; status: 'pending' | 'available'; tax: number };
  id: string; productId: string; accountId: string; live: boolean; currency: string;
  captured: number; refunded: number; disputed: boolean; createdAt: number; observedAt: number;
  campaignId: string | null; attribution: 'matched' | 'unknown' | 'none';
  contactHash?: string | null; contactMatch?: 'missing' | 'conflicting' | 'available';
  matchedLeadCount?: number;
}
export interface RevenueTotals { currency: string; live: boolean; payments: number; captured: number; refunded: number; disputedPayments: number; attributedPayments: number; }
export interface RevenueView {
  funding?: FundingView[];
  offline: boolean;
  products: { id: string; name: string }[];
  accounts: { id: string; productId: string; label: string; status: string }[];
  states: RevenueState[]; payments: RevenuePayment[];
  totals: { productId: string; rows: RevenueTotals[] }[];
}
export const revenueActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('funding'), productId: z.string(), value: fundingPolicySchema }).strict(),
  z.object({ type: z.literal('configure'), productId: z.string(), value: revenueConfigSchema }).strict(),
  z.object({ type: z.literal('sync'), productId: z.string() }).strict(),
  z.object({ type: z.literal('catalog'), productId: z.string(), accountId: z.string() }).strict(),
]);
export type RevenueAction = z.infer<typeof revenueActionSchema>;
export interface RevenueResult { view: RevenueView; catalog?: { id: string; name: string }[]; }
