import { z } from 'zod';
import { extractJson, type LlmClient } from '../llm/client.js';
import { loadPrompt } from '../prompts/loader.js';
import type { Opportunity, Product } from '../db/schema.js';
import type { Logger } from '../lib/logger.js';

/**
 * The three judgement axes. Risk is computed separately and deliberately does
 * not come from here — see risk.ts.
 */
export const classificationSchema = z
  .object({
    contribution: z.number().min(0).max(1),
    intent: z.number().min(0).max(1),
    fit: z.number().min(0).max(1),
    /** Product key, or null when nothing genuinely fits. */
    product: z.string().nullable().catch(null),
    rationale: z.string().default(''),
  })
  .strip();

export type Classification = z.infer<typeof classificationSchema>;

export interface ClassifyResult {
  readonly classification: Classification;
  readonly matchedProductId: string | null;
  readonly promptVersion: string;
}

function describeProducts(products: readonly Product[]): string {
  return products
    .map(
      (p) =>
        `- key: ${p.key}\n  name: ${p.name}\n  what it is: ${p.positioning}\n` +
        `  who buys it: ${p.targetBuyer}\n  proof points: ${p.proofPoints.join('; ') || 'none recorded'}`,
    )
    .join('\n');
}

function ageLabel(opportunity: Opportunity, now: number): string {
  const posted = opportunity.postedAt ?? opportunity.discoveredAt;
  const hours = Math.max(0, now - posted) / 3_600_000;
  if (hours < 1) return `${Math.round(hours * 60)} minutes`;
  if (hours < 48) return `${Math.round(hours)} hours`;
  return `${Math.round(hours / 24)} days`;
}

/**
 * One model call per opportunity, scoring three axes at once.
 *
 * Batched into a single call on purpose: three separate calls would triple the
 * cost of the most frequently executed LLM operation in the system, and the
 * axes are correlated enough that the model benefits from judging them
 * together.
 */
export async function classify(
  llm: LlmClient,
  model: string,
  opportunity: Opportunity,
  community: string,
  products: readonly Product[],
  logger: Logger,
  now: number,
): Promise<ClassifyResult> {
  const prompt = loadPrompt('classify', 1);
  const rendered = prompt.render({
    products: describeProducts(products),
    community,
    age: ageLabel(opportunity, now),
    title: opportunity.title,
    body: opportunity.body || '(no body — link post)',
  });

  const result = await llm.complete({
    model,
    prompt: rendered,
    maxTokens: 500,
    prefill: '{',
    // Triage should be repeatable. The same thread on two days should not
    // land on different sides of the threshold because of sampling.
    temperature: 0,
  });

  const parsed = classificationSchema.safeParse(extractJson(result.text));
  if (!parsed.success) {
    throw new Error(
      `classifier returned an unusable response: ${parsed.error.issues
        .map((i) => `${i.path.join('.')} ${i.message}`)
        .join('; ')}`,
    );
  }

  const classification = parsed.data;

  // A hallucinated product key must not silently become a null match that
  // later reads as "the model chose to omit the product".
  let matchedProductId: string | null = null;
  if (classification.product) {
    const match = products.find((p) => p.key === classification.product);
    if (match) {
      matchedProductId = match.id;
    } else {
      logger.warn('classifier named a product that does not exist', {
        named: classification.product,
        opportunity: opportunity.id,
      });
    }
  }

  return { classification, matchedProductId, promptVersion: prompt.version };
}
