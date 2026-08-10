import type { CommunityRule, Opportunity, SelfPromoPolicy } from '../db/schema.js';

/**
 * The risk axis is computed, not classified.
 *
 * The other three axes ask a model for a judgement. This one decides how
 * likely a reply is to get punished, and that must not depend on a model's
 * mood, a prompt edit, or a bad JSON parse. Every input is a fact already in
 * the database, and the same inputs always produce the same number.
 *
 * Higher is riskier. Risk subtracts from the total.
 */

export interface RiskInputs {
  readonly rule: CommunityRule | null;
  /** Milliseconds since the thread was posted. Null when unknown. */
  readonly threadAgeMs: number | null;
  /** Days since I last posted in this community. Null if never. */
  readonly daysSinceLastPostHere: number | null;
  /** My promotional share of activity in this community, 0..1. Null if unknown. */
  readonly selfPromoRatio: number | null;
  /** True when a reply would name a product. Unknown at scoring time; assume yes. */
  readonly promotional?: boolean;
  readonly cooldownDays: number;
  readonly ratioCapPct: number;
  readonly maxThreadAgeHours: number;
}

export interface RiskBreakdown {
  readonly total: number;
  readonly factors: readonly { readonly name: string; readonly value: number; readonly why: string }[];
}

/** How much each self-promo policy contributes on its own. */
const POLICY_RISK: Record<SelfPromoPolicy, number> = {
  allowed: 0.0,
  allowed_with_disclosure: 0.05,
  discouraged: 0.35,
  designated_thread_only: 0.6,
  // A draft is never generated for a forbidden community, but if one somehow
  // reaches scoring the number should say so unambiguously.
  forbidden: 1.0,
  // Not risky to draft — Signal simply never publishes it via an API.
  draft_only: 0.1,
};

const HOUR_MS = 3_600_000;

export function scoreRisk(inputs: RiskInputs): RiskBreakdown {
  const factors: { name: string; value: number; why: string }[] = [];
  const promotional = inputs.promotional ?? true;

  // — Community policy —
  if (!inputs.rule) {
    // No rules record. Drafting is blocked upstream, so this is belt and
    // braces: if it ever reaches scoring, treat it as maximally risky.
    factors.push({ name: 'no_rules_record', value: 1, why: 'no rules record for this community' });
  } else if (promotional) {
    const policyRisk = POLICY_RISK[inputs.rule.selfPromo];
    factors.push({
      name: 'self_promo_policy',
      value: policyRisk,
      why: `community policy is ${inputs.rule.selfPromo}`,
    });

    // An unverified reading is itself a risk: nobody has checked it against
    // the real sidebar, so the policy above might be wrong.
    if (!inputs.rule.verified) {
      const confidence = inputs.rule.confidence ?? 0.3;
      const uncertainty = Math.max(0, 1 - confidence) * 0.25;
      factors.push({
        name: 'unverified_rules',
        value: uncertainty,
        why: `rules reading is unverified (confidence ${confidence.toFixed(2)})`,
      });
    }

    if (inputs.rule.flairRequired) {
      factors.push({
        name: 'flair_required',
        value: 0.1,
        why: `flair required${inputs.rule.flairValue ? `: ${inputs.rule.flairValue}` : ''}`,
      });
    }
  }

  // — Thread age — a late reply is buried, which wastes the effort more than
  // it risks a ban, but it belongs on the same axis: don't bother.
  if (inputs.threadAgeMs != null) {
    const hours = inputs.threadAgeMs / HOUR_MS;
    const fraction = Math.min(1, hours / inputs.maxThreadAgeHours);
    // Squared, so the first day costs little and the third costs a lot.
    const ageRisk = fraction * fraction * 0.5;
    if (ageRisk > 0.01) {
      factors.push({
        name: 'thread_age',
        value: ageRisk,
        why: `thread is ${Math.round(hours)}h old`,
      });
    }
  }

  // — Cooldown — posting again too soon in one place is what reads as spam.
  if (promotional && inputs.daysSinceLastPostHere != null) {
    if (inputs.daysSinceLastPostHere < inputs.cooldownDays) {
      const remaining = inputs.cooldownDays - inputs.daysSinceLastPostHere;
      const severity = Math.min(1, remaining / Math.max(1, inputs.cooldownDays));
      factors.push({
        name: 'cooldown',
        value: severity * 0.7,
        why: `last posted here ${inputs.daysSinceLastPostHere}d ago, cooldown is ${inputs.cooldownDays}d`,
      });
    }
  }

  // — Ratio — approaching the cap should cost something before it blocks.
  if (promotional && inputs.selfPromoRatio != null) {
    const capFraction = inputs.ratioCapPct / 100;
    const effectiveCap = Math.min(
      capFraction,
      // The community's own stated cap wins when it is stricter than ours.
      inputs.rule?.selfPromoRatioMaxPct != null
        ? inputs.rule.selfPromoRatioMaxPct / 100
        : capFraction,
    );
    if (effectiveCap > 0) {
      const usage = inputs.selfPromoRatio / effectiveCap;
      if (usage >= 1) {
        factors.push({
          name: 'ratio_exceeded',
          value: 1,
          why: `self-promo ratio ${(inputs.selfPromoRatio * 100).toFixed(0)}% is over the ${(effectiveCap * 100).toFixed(0)}% cap`,
        });
      } else if (usage > 0.7) {
        factors.push({
          name: 'ratio_near_cap',
          value: (usage - 0.7) / 0.3 * 0.4,
          why: `self-promo ratio ${(inputs.selfPromoRatio * 100).toFixed(0)}% is close to the ${(effectiveCap * 100).toFixed(0)}% cap`,
        });
      }
    }
  }

  // Combine as "probability at least one thing goes wrong" rather than a sum.
  // Three mild risks should not add up to certainty, and any single factor at
  // 1.0 should pin the total at 1.0 — which this does.
  const total = factors.reduce((acc, f) => acc + (1 - acc) * clamp01(f.value), 0);

  return { total: clamp01(total), factors };
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Convenience for the common case of scoring a stored opportunity. */
export function threadAgeMs(opportunity: Opportunity, now: number): number | null {
  const posted = opportunity.postedAt ?? opportunity.discoveredAt;
  return posted == null ? null : Math.max(0, now - posted);
}
