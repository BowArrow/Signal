/**
 * Affiliation disclosure.
 *
 * The rule: if a draft names one of my products, it must also say I build it.
 * A draft that fails this does not reach the queue at all — it is not a
 * warning I can wave through, because the whole system's legitimacy rests on
 * never quietly promoting something as a disinterested party.
 *
 * Everything here is a pure function over text so it can be tested to death.
 */

/** Phrases that count as disclosing an affiliation. */
const DISCLOSURE_PATTERNS: readonly RegExp[] = [
  /\bdisclosure\b/i,
  /\bdisclaimer\b/i,
  /\bfull\s+disclosure\b/i,
  /\bi\s+(?:build|built|make|made|wrote|write|work\s+on|created|create)\s+(?:this|it|that)\b/i,
  /\bwe\s+(?:build|built|make|made|wrote|write|work\s+on|created|create)\s+(?:this|it|that)\b/i,
  /\bi'?m\s+the\s+(?:author|creator|dev|developer|founder|maker)\b/i,
  /\bmy\s+(?:product|project|tool|app|company)\b/i,
  /\bour\s+(?:product|project|tool|app|company)\b/i,
  /\bi\s+work\s+(?:at|for)\b/i,
  /\bbiased\b.{0,20}\bi\s+(?:build|made|wrote)\b/i,
];

export interface ProductNameCheck {
  readonly key: string;
  readonly name: string;
  /** Extra spellings that count as naming it. Domains, old names. */
  readonly aliases?: readonly string[];
}

export interface DisclosureResult {
  readonly productMentioned: boolean;
  readonly disclosurePresent: boolean;
  /** True when a product is named with no disclosure. Blocks the draft. */
  readonly violation: boolean;
  readonly mentioned: readonly string[];
  readonly message: string;
}

/**
 * Word-boundary match, case-insensitive, so "Lemonade" is found but
 * "lemonades" and "homemade" are not. Product names are matched as whole
 * words because a substring hit would block innocent drafts and train me to
 * ignore the validator.
 */
function namesProduct(body: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Names can contain dots (a domain) so the trailing boundary allows one.
  return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'i').test(body);
}

export function hasDisclosure(body: string): boolean {
  return DISCLOSURE_PATTERNS.some((pattern) => pattern.test(body));
}

export function checkDisclosure(
  body: string,
  productsInScope: readonly ProductNameCheck[],
): DisclosureResult {
  const mentioned: string[] = [];

  for (const product of productsInScope) {
    const terms = [product.name, ...(product.aliases ?? [])];
    if (terms.some((term) => namesProduct(body, term))) {
      mentioned.push(product.name);
    }
  }

  const productMentioned = mentioned.length > 0;
  const disclosurePresent = hasDisclosure(body);

  if (!productMentioned) {
    return {
      productMentioned: false,
      disclosurePresent,
      violation: false,
      mentioned,
      message: 'No product named, so no disclosure is required.',
    };
  }

  if (disclosurePresent) {
    return {
      productMentioned: true,
      disclosurePresent: true,
      violation: false,
      mentioned,
      message: `Discloses affiliation alongside ${mentioned.join(', ')}.`,
    };
  }

  return {
    productMentioned: true,
    disclosurePresent: false,
    violation: true,
    mentioned,
    message:
      `Names ${mentioned.join(', ')} with no disclosure line. ` +
      'Add something like "disclosure: my product" or "i build this".',
  };
}
