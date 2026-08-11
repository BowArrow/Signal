import { z } from 'zod';
import { extractJson, type LlmClient } from '../llm/client.js';
import { loadPrompt } from '../prompts/loader.js';
import { SELF_PROMO_POLICIES, type Community, type SelfPromoPolicy } from '../db/schema.js';
import type { FetchedRules } from './fetch.js';
import type { Logger } from '../lib/logger.js';

/**
 * Turns fetched rule text into a structured policy.
 *
 * This is the one place where a model's output decides whether an automated
 * system may post somewhere, so it is fenced in hard: the schema is strict,
 * anything unparseable falls back to the most restrictive reading, and the
 * result is always written unverified with the sentences it relied on
 * attached, so a human can check the reading against the evidence in seconds.
 */

export const interpretationSchema = z
  .object({
    selfPromo: z.enum(SELF_PROMO_POLICIES),
    selfPromoRatioMaxPct: z.number().min(0).max(100).nullable().catch(null),
    flairRequired: z.boolean().catch(false),
    flairValue: z.string().min(1).nullable().catch(null),
    minAccountAgeDays: z.number().int().min(0).nullable().catch(null),
    minKarma: z.number().int().nullable().catch(null),
    evidence: z.array(z.string()).default([]),
    confidence: z.number().min(0).max(1),
    notes: z.string().nullable().catch(null),
  })
  .strip();

export type Interpretation = z.infer<typeof interpretationSchema>;

/**
 * What we assume when we cannot read the rules. `discouraged` rather than
 * `forbidden`: forbidden would be a claim we cannot support, and
 * `discouraged` still forces answer-first behaviour and a high risk score
 * without pretending to know something we don't.
 */
export function cautiousDefault(reason: string): Interpretation {
  return {
    selfPromo: 'discouraged',
    selfPromoRatioMaxPct: null,
    flairRequired: false,
    flairValue: null,
    minAccountAgeDays: null,
    minKarma: null,
    evidence: [],
    confidence: 0,
    notes: `Could not interpret this community's rules: ${reason}. Treated as discouraged until reviewed.`,
  };
}

function formatRules(fetched: FetchedRules): string {
  if (fetched.rules.length === 0) return '(the platform published no rules)';
  return fetched.rules
    .map((r, i) => `${i + 1}. ${r.shortName}\n${r.description || '(no description given)'}`)
    .join('\n\n');
}

export interface InterpretResult {
  readonly interpretation: Interpretation;
  /** The model and prompt that produced it, recorded on the row. */
  readonly interpretedBy: string;
}

export async function interpretRules(
  llm: LlmClient,
  model: string,
  community: Community,
  fetched: FetchedRules,
  logger: Logger,
): Promise<InterpretResult> {
  const prompt = loadPrompt('interpret-rules', 1);

  if (fetched.empty) {
    return {
      interpretation: cautiousDefault('the community publishes no rules and no sidebar text'),
      interpretedBy: 'fallback',
    };
  }

  const rendered = prompt.render({
    community: community.displayName,
    rules: formatRules(fetched),
    sidebar: fetched.sidebar ?? '(none)',
  });

  let raw: string;
  try {
    const result = await llm.complete({
      model,
      prompt: rendered,
      maxTokens: 1200,
      prefill: '{',
      task: 'interpret-rules',
      expectsJson: true,
      // Reading rules is not a creative task.
      temperature: 0,
    });
    raw = result.text;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn('rules interpretation call failed', { community: community.displayName, reason });
    return { interpretation: cautiousDefault(reason), interpretedBy: 'fallback' };
  }

  const parsed = interpretationSchema.safeParse(safeJson(raw));
  if (!parsed.success) {
    logger.warn('rules interpretation did not match the schema', {
      community: community.displayName,
      issues: parsed.error.issues.map((i) => i.path.join('.')).join(','),
    });
    return {
      interpretation: cautiousDefault('the model returned a response that did not match the schema'),
      interpretedBy: 'fallback',
    };
  }

  const interpretation = withoutUnsupportedClaims(parsed.data, logger, community);
  return { interpretation, interpretedBy: `${prompt.version}:${model}` };
}

function safeJson(raw: string): unknown {
  try {
    return extractJson(raw);
  } catch {
    return null;
  }
}

/**
 * A permissive reading with no quoted evidence is the dangerous combination:
 * it is the shape a hallucination takes. Demote it rather than trust it.
 */
function withoutUnsupportedClaims(
  interpretation: Interpretation,
  logger: Logger,
  community: Community,
): Interpretation {
  const permissive: SelfPromoPolicy[] = ['allowed', 'allowed_with_disclosure'];
  if (permissive.includes(interpretation.selfPromo) && interpretation.evidence.length === 0) {
    logger.warn('demoting an unsupported permissive reading', {
      community: community.displayName,
      claimed: interpretation.selfPromo,
    });
    return {
      ...interpretation,
      selfPromo: 'discouraged',
      confidence: Math.min(interpretation.confidence, 0.3),
      notes:
        (interpretation.notes ? `${interpretation.notes} ` : '') +
        `Model claimed "${interpretation.selfPromo}" but quoted no supporting rule text, so this was demoted to discouraged.`,
    };
  }
  return interpretation;
}
