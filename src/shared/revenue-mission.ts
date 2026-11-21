import { z } from 'zod';
import type { RevenuePayment, RevenueState } from './revenue.js';

export const revenueMissionSchema = z.object({
  targetCents: z.number().int().positive().max(100000000000),
  currency: z.literal('usd'),
  startsAt: z.number().int().nonnegative(),
  endsAt: z.number().int().positive(), // exclusive: local midnight after the final day
  timezone: z.literal('America/Los_Angeles'),
  active: z.boolean(),
}).strict().refine(v => v.endsAt > v.startsAt, 'The deadline must follow the start.');
export type RevenueMission = z.infer<typeof revenueMissionSchema>;
export const LEMONADE_MISSION: RevenueMission = {
  targetCents: 10000000, currency: 'usd', startsAt: Date.parse('2026-10-13T00:00:00-07:00'),
  endsAt: Date.parse('2027-01-01T00:00:00-08:00'), timezone: 'America/Los_Angeles', active: true,
};
export interface MissionScore {
  observedCents: number; remainingCents: number; payments: number; excludedCurrency: number; disputedCents: number;
  verified: boolean; detail: string; checkedAt: number | null; daysLeft: number; requiredDailyCents: number; reached: boolean;
}
export interface MissionView {
  productId: string; value: RevenueMission; score: MissionScore;
  lastTaskId: string | null; nextReviewAt: number | null; waitingForReview: boolean;
}
/** Score the full ledger, never the renderer's last 300 payments. */
export function scoreMission(mission: RevenueMission, productId: string, state: RevenueState | undefined, ledger: RevenuePayment[], now: number): MissionScore {
  const rows = new Map<string, RevenuePayment>();
  for (const p of ledger) {
    if (p.productId !== productId || !p.live || p.accountId !== state?.accountId || p.createdAt < mission.startsAt || p.createdAt >= mission.endsAt || p.createdAt > now) continue;
    const key = `${p.accountId}:${p.id}`;
    if ((rows.get(key)?.observedAt ?? -1) <= p.observedAt) rows.set(key, p);
  }
  let observedCents = 0; let payments = 0; let excludedCurrency = 0; let disputedCents = 0;
  for (const p of rows.values()) {
    if (p.currency.toLowerCase() !== mission.currency) { excludedCurrency++; continue; }
    const net = Math.max(0, p.captured - p.refunded);
    if (p.disputed) { disputedCents += net; continue; }
    observedCents += net; if (net > 0) payments++;
  }
  const checkedAt = state?.lastCompleteAt ?? null;
  const verified = Boolean(state?.live && state.status === 'current' && state.since <= mission.startsAt && checkedAt !== null && checkedAt >= Math.min(now, mission.endsAt) - 24 * 3600000 && checkedAt <= now);
  const detail = !state?.live ? 'Connect live Stripe revenue to establish the score.' : state.since > mission.startsAt ? 'Revenue history starts after the mission. Extend it to include the full mission.' : !verified ? 'Refresh revenue to verify the score. Saved payments are provisional.' : 'Live captured USD payments, less refunds; disputed payments are held out. This measures collections, not profit or spendable cash.';
  const daysLeft = Math.max(0, Math.ceil((mission.endsAt - Math.max(now, mission.startsAt)) / 86400000));
  const remainingCents = Math.max(0, mission.targetCents - observedCents);
  return { observedCents, remainingCents, payments, excludedCurrency, disputedCents, verified, detail, checkedAt, daysLeft, requiredDailyCents: daysLeft ? Math.ceil(remainingCents / daysLeft) : 0, reached: verified && remainingCents === 0 };
}
