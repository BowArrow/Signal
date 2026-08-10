import type { CommunityRule, ValidatorResult } from '../db/schema.js';
import { checkDisclosure, type ProductNameCheck } from './disclosure.js';

/**
 * Everything a draft has to survive before it is allowed into the review
 * queue. A single `block` keeps it out; `warn` shows in the queue but does not
 * stop me approving it.
 *
 * Pure functions over text and already-fetched facts. No IO, no clock, no
 * database — so the rules that keep me from getting banned are cheap to test
 * exhaustively, which is the point.
 */

/** Marketing register. Not a style preference — these read as an ad. */
export const BANNED_PHRASES: readonly string[] = [
  'dive into',
  'unleash',
  'game-changing',
  'game changer',
  'revolutionary',
  'revolutionize',
  'transformative',
  'transform your',
  'optimize your workflow',
  'unlock the secrets',
  'unlock potential',
  'unlock your',
  'seamless',
  'effortlessly',
  'supercharge',
  'cutting-edge',
  'state-of-the-art',
  "in today's fast-paced",
  'look no further',
  "we've got you covered",
  'the possibilities are endless',
  'at the end of the day',
  'hope this helps',
  'let me know if this helps',
];

export interface DraftContext {
  readonly body: string;
  readonly products: readonly ProductNameCheck[];
  readonly rule: CommunityRule | null;
  readonly communityName: string;
  readonly platform: string;
  /** True when the community's rules were never confirmed by a human. */
  readonly maxChars?: number;
}

const DEFAULT_MAX_CHARS = 10_000;

function pass(rule: string, message: string): ValidatorResult {
  return { rule, state: 'pass', message };
}
function warn(rule: string, message: string): ValidatorResult {
  return { rule, state: 'warn', message };
}
function block(rule: string, message: string): ValidatorResult {
  return { rule, state: 'block', message };
}

export interface ValidationOutcome {
  readonly results: ValidatorResult[];
  readonly blocked: boolean;
  readonly productMentioned: boolean;
  readonly disclosurePresent: boolean;
  /** The first blocking message, for the disabled approve button's tooltip. */
  readonly blockReason: string | null;
}

export function validateDraft(context: DraftContext): ValidationOutcome {
  const results: ValidatorResult[] = [];
  const body = context.body ?? '';

  // — Disclosure. The one that exists to keep me honest. —
  const disclosure = checkDisclosure(body, context.products);
  results.push(
    disclosure.violation
      ? block('disclosure', disclosure.message)
      : pass('disclosure', disclosure.message),
  );

  // — Community rules must exist. Belt and braces: drafting is already gated
  //   on this upstream, so reaching here means something went wrong. —
  if (!context.rule) {
    results.push(
      block('community_rules', `No rules record for ${context.communityName} — draft withheld.`),
    );
  } else if (context.rule.selfPromo === 'forbidden' && disclosure.productMentioned) {
    results.push(
      block('community_rules', `${context.communityName} forbids self-promotion.`),
    );
  } else if (
    context.rule.selfPromo === 'designated_thread_only' &&
    disclosure.productMentioned
  ) {
    results.push(
      warn(
        'community_rules',
        `${context.communityName} only allows promotion in a designated thread. Check this is that thread before approving.`,
      ),
    );
  } else if (!context.rule.verified) {
    results.push(
      warn(
        'community_rules',
        `Rules for ${context.communityName} were read by a model and never confirmed` +
          `${context.rule.confidence != null ? ` (confidence ${context.rule.confidence.toFixed(2)})` : ''}. Worth a look before approving.`,
      ),
    );
  } else {
    results.push(
      pass('community_rules', `Rules record found and confirmed (${context.rule.selfPromo}).`),
    );
  }

  // — Flair —
  if (context.rule?.flairRequired) {
    results.push(
      warn(
        'flair',
        `Flair is required here${context.rule.flairValue ? `: ${context.rule.flairValue}` : ''}. Signal cannot set it, so set it yourself.`,
      ),
    );
  }

  // — Marketing register —
  const found = BANNED_PHRASES.filter((phrase) => body.toLowerCase().includes(phrase));
  results.push(
    found.length > 0
      ? block('register', `Marketing language: ${found.map((f) => `"${f}"`).join(', ')}.`)
      : pass('register', 'No marketing register detected.'),
  );

  // — Em-dashes. A reliable tell, and explicitly not my voice. —
  const emDashes = (body.match(/—/g) ?? []).length;
  results.push(
    emDashes > 0
      ? block('em_dash', `Contains ${emDashes} em-dash${emDashes === 1 ? '' : 'es'}. Rewrite without.`)
      : pass('em_dash', 'No em-dashes.'),
  );

  // — Substance. A one-line reply naming a product is an advert. —
  const withoutProduct = disclosure.mentioned.reduce(
    (text, name) => text.replaceAll(name, ''),
    body,
  );
  const substanceChars = withoutProduct.trim().length;
  if (disclosure.productMentioned && substanceChars < 280) {
    results.push(
      block(
        'substance',
        `Only ${substanceChars} characters of content around the product mention. Lead with the answer or drop the product.`,
      ),
    );
  } else if (body.trim().length === 0) {
    results.push(block('substance', 'The draft is empty.'));
  } else {
    results.push(pass('substance', `${body.trim().length} characters of reply.`));
  }

  // — Length —
  const maxChars = context.maxChars ?? DEFAULT_MAX_CHARS;
  if (body.length > maxChars) {
    results.push(block('length', `${body.length} characters exceeds the ${maxChars} limit.`));
  }

  // — Platform policy —
  if (context.platform === 'hn') {
    results.push(
      warn('platform', 'Hacker News is draft-only. Approving copies it; nothing is posted by API.'),
    );
  }

  // — Placeholders that escaped the prompt renderer —
  if (/\{\{\s*\w+\s*\}\}/.test(body)) {
    results.push(block('placeholder', 'The draft still contains an unrendered {{placeholder}}.'));
  }

  const blocked = results.some((r) => r.state === 'block');
  return {
    results,
    blocked,
    productMentioned: disclosure.productMentioned,
    disclosurePresent: disclosure.disclosurePresent,
    blockReason: results.find((r) => r.state === 'block')?.message ?? null,
  };
}
