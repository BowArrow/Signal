import { z } from 'zod';

export const analyticsConfigSchema = z.object({ accountId: z.string().min(1), propertyId: z.string().regex(/^[1-9][0-9]{0,19}$/) }).strict();
export type AnalyticsConfig = z.infer<typeof analyticsConfigSchema>;
export interface AnalyticsState extends AnalyticsConfig {
  productId: string; hostname: string; revision: number;
  status: 'idle' | 'syncing' | 'current' | 'limited' | 'attention';
  lastAttemptAt: number | null; lastCompleteAt: number | null; detail: string;
}
export interface AnalyticsMetrics { sessions: number; engagedSessions: number; keyEvents: number; ecommercePurchases: number; purchaseRevenue: number; }
export interface AnalyticsRow extends AnalyticsMetrics { campaignId: string | null; attribution: 'matched' | 'unknown' | 'none'; }
export const FUNNEL_EVENTS = ['download_requested', 'generate_lead', 'sign_up', 'begin_checkout', 'product_activation'] as const;
export type FunnelEvent = typeof FUNNEL_EVENTS[number];
export interface FunnelRow { event: FunnelEvent; count: number; campaignId: string | null; attribution: AnalyticsRow['attribution']; }
export interface FunnelSnapshot { status: 'available' | 'unavailable'; rows: FunnelRow[]; limitations: string[]; }
export function analyticsTotals(rows: AnalyticsRow[]): AnalyticsMetrics {
  return rows.reduce((sum, row) => ({ sessions: sum.sessions + row.sessions, engagedSessions: sum.engagedSessions + row.engagedSessions, keyEvents: sum.keyEvents + row.keyEvents, ecommercePurchases: sum.ecommercePurchases + row.ecommercePurchases, purchaseRevenue: sum.purchaseRevenue + row.purchaseRevenue }), { sessions: 0, engagedSessions: 0, keyEvents: 0, ecommercePurchases: 0, purchaseRevenue: 0 });
}
export interface AnalyticsSnapshot {
  productId: string; accountId: string; propertyId: string; hostname: string;
  startDate: string; endDate: string; timeZone: string; currencyCode: string; observedAt: number;
  limitations: string[]; rows: AnalyticsRow[];
  funnel?: FunnelSnapshot;
}
export interface AnalyticsView {
  offline: boolean; products: { id: string; name: string }[];
  accounts: { id: string; productId: string; label: string; status: string }[];
  states: AnalyticsState[]; snapshots: AnalyticsSnapshot[];
}
export const analyticsActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('configure'), productId: z.string(), value: analyticsConfigSchema }).strict(),
  z.object({ type: z.literal('sync'), productId: z.string() }).strict(),
  z.object({ type: z.literal('remove'), productId: z.string() }).strict(),
]);
export type AnalyticsAction = z.infer<typeof analyticsActionSchema>;
