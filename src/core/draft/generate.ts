import { z } from 'zod';
import { extractJson, type LlmClient } from '../llm/client.js';
import { loadPrompt, loadVoice } from '../prompts/loader.js';
import type { Community, CommunityRule, Opportunity, Product } from '../db/schema.js';
import type { Logger } from '../lib/logger.js';

export const replySchema = z
  .object({
    body: z.string().min(1),
    mentionsProduct: z.boolean().catch(false),
    omitReason: z.string().nullable().catch(null),
  })
  .strip();

export type Reply = z.infer<typeof replySchema>;

export interface GenerateResult {
  readonly reply: Reply;
  readonly promptVersion: string;
  /** Null when the draft deliberately omits the product. */
  readonly productId: string | null;
  readonly voiceSamples: number;
}

/**
 * Describes what the community expects, in the prompt's own words, so the
 * model writes for the room rather than for a generic forum.
 */
export function describeNorms(community: Community, rule: CommunityRule | null): string {
  if (!rule) return 'unknown — no rules record';
  const parts: string[] = [];

  switch (rule.selfPromo) {
    case 'allowed':
      parts.push('self-promotion is allowed here');
      break;
    case 'allowed_with_disclosure':
      parts.push('self-promotion is allowed if you disclose that you built it');
      break;
    case 'discouraged':
      parts.push(
        'self-promotion is discouraged; answer first and only mention the product if it is genuinely the answer',
      );
      break;
    case 'designated_thread_only':
      parts.push(
        'promotion is only allowed in a designated thread, so assume you cannot mention the product at all',
      );
      break;
    case 'draft_only':
      parts.push('a human will paste this by hand');
      break;
    case 'forbidden':
      parts.push('self-promotion is forbidden — do not mention the product under any circumstances');
      break;
  }

  if (rule.selfPromoRatioMaxPct != null) {
    parts.push(`the community states a ${rule.selfPromoRatioMaxPct}% self-promotion cap`);
  }
  if (rule.notes) parts.push(rule.notes);

  return `${community.displayName}: ${parts.join('; ')}`;
}

function describeProduct(product: Product | null): string {
  if (!product) return '(no product matched this thread)';
  return [
    `name: ${product.name}`,
    `what it is: ${product.positioning}`,
    `who it is for: ${product.targetBuyer}`,
    product.priceCents > 0
      ? `price: $${(product.priceCents / 100).toFixed(0)} one-time`
      : 'price: not published',
    `claims you may make (and no others): ${product.proofPoints.join('; ') || 'none recorded'}`,
  ].join('\n');
}

/**
 * How hard to push the product, derived from the community's own policy
 * rather than left to the model's judgement. A community that forbids
 * promotion gets an instruction that forbids it, not a hint.
 */
export function productInstruction(rule: CommunityRule | null, product: Product | null): string {
  if (!product) {
    return 'No product matched this thread. Write a purely technical reply and mention nothing.';
  }
  if (!rule || rule.selfPromo === 'forbidden' || rule.selfPromo === 'designated_thread_only') {
    return (
      'Do NOT mention the product. This community does not permit it here. Write the reply as ' +
      'a pure contribution and set mentionsProduct to false.'
    );
  }
  return (
    'If, and only if, the product is genuinely relevant to what this person asked, mention it in ' +
    'a single sentence at the very end. It must include a plain disclosure that you build it — ' +
    'the words "disclosure: my product" or "i build this" are both fine. If mentioning it would ' +
    'be a stretch, omit it entirely, set mentionsProduct to false, and say why in omitReason. ' +
    'Omitting is a good outcome and is often the right call.'
  );
}

function ageLabel(opportunity: Opportunity, now: number): string {
  const posted = opportunity.postedAt ?? opportunity.discoveredAt;
  const hours = Math.max(0, now - posted) / 3_600_000;
  if (hours < 1) return `${Math.round(hours * 60)} minutes`;
  if (hours < 48) return `${Math.round(hours)} hours`;
  return `${Math.round(hours / 24)} days`;
}

export async function generateReply(
  llm: LlmClient,
  model: string,
  maxTokens: number,
  opportunity: Opportunity,
  community: Community,
  rule: CommunityRule | null,
  product: Product | null,
  logger: Logger,
  now: number,
  regenerateNote?: string | undefined,
): Promise<GenerateResult> {
  const prompt = loadPrompt('reply', 1);
  const voice = loadVoice();

  if (!voice.hasSamples) {
    // Worth saying out loud every time. Without samples the model falls back
    // to its own register, which is exactly the register we are trying to
    // avoid, and no amount of prompt wording substitutes for examples.
    logger.warn('voice.md has no samples — drafts will not sound like you', {
      file: 'src/prompts/voice.md',
    });
  }

  let rendered = prompt.render({
    voice: voice.text,
    community: community.displayName,
    communityNorms: describeNorms(community, rule),
    author: opportunity.author ?? 'unknown',
    age: ageLabel(opportunity, now),
    title: opportunity.title,
    body: opportunity.body || '(no body — link post)',
    product: describeProduct(product),
    productInstruction: productInstruction(rule, product),
  });

  if (regenerateNote) {
    // Appended rather than templated in, so a regeneration note cannot
    // restructure the prompt or displace the rules above it.
    rendered += `\n\n## Additional instruction for this attempt\n\n${regenerateNote}\n`;
  }

  const result = await llm.complete({
    model,
    prompt: rendered,
    maxTokens,
    prefill: '{',
    task: 'draft',
    expectsJson: true,
    // Some variation is wanted here; two regenerations should differ.
    temperature: 0.7,
  });

  const parsed = replySchema.safeParse(extractJson(result.text));
  if (!parsed.success) {
    throw new Error(
      `drafting returned an unusable response: ${parsed.error.issues
        .map((i) => `${i.path.join('.')} ${i.message}`)
        .join('; ')}`,
    );
  }

  return {
    reply: parsed.data,
    promptVersion: prompt.version,
    // The product is attached only if the model actually named it. Recording
    // a product on a draft that never mentions it would corrupt the
    // attribution and the digest.
    productId: parsed.data.mentionsProduct && product ? product.id : null,
    voiceSamples: voice.sampleCount,
  };
}
