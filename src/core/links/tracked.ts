import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { links, type Community, type Link, type Product } from '../db/schema.js';
import { newLinkId } from '../lib/id.js';
import type { Clock } from '../lib/clock.js';
import { systemClock } from '../lib/clock.js';

/**
 * Every outbound link is a record, not a URL.
 *
 * The short id resolves server-side, so a link already sitting in a Reddit
 * comment keeps working when the destination changes, the tracking domain
 * moves, or the UTM scheme is revised. A raw UTM-tagged URL pasted into a
 * comment is permanent in a way that a redirect is not.
 */

export interface UtmParams {
  readonly utmSource: string;
  readonly utmMedium: string;
  readonly utmCampaign: string;
  readonly utmContent?: string | undefined;
}

/**
 * UTM values are lowercased and stripped of anything that would need escaping.
 * Analytics tools treat `Reddit` and `reddit` as different sources and will
 * happily split one campaign across three rows.
 */
export function utmSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^r\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function utmFor(community: Community | null, platform: string): UtmParams {
  return {
    utmSource: utmSlug(platform),
    // Everything Signal posts is a comment or reply, never a standalone post.
    utmMedium: 'comment',
    utmCampaign: community ? utmSlug(community.name) : 'unattributed',
  };
}

/**
 * The URL that actually appears in the comment: short, on the tracking origin,
 * carrying no parameters. The UTM tags live on the record and are applied at
 * redirect time.
 */
export function trackedUrl(trackingOrigin: string, linkId: string): string {
  return `${trackingOrigin.replace(/\/+$/, '')}/r/${linkId}`;
}

/** Where the redirect ultimately sends someone, UTM tags applied. */
export function destinationWithUtm(link: Pick<Link, 'destinationUrl' | 'utmSource' | 'utmMedium' | 'utmCampaign' | 'utmContent' | 'publicationId'>): string {
  const url = new URL(link.destinationUrl);
  url.searchParams.set('utm_source', link.utmSource);
  url.searchParams.set('utm_medium', link.utmMedium);
  url.searchParams.set('utm_campaign', link.utmCampaign);
  if (link.utmContent) url.searchParams.set('utm_content', link.utmContent);
  // The publication id is what makes attribution unambiguous rather than
  // inferred from a campaign name that several posts might share.
  if (link.publicationId) url.searchParams.set('pub', link.publicationId);
  return url.toString();
}

export function createLink(
  db: Db,
  product: Product,
  community: Community | null,
  platform: string,
  clock: Clock = systemClock,
): Link {
  const utm = utmFor(community, platform);
  const row: Link = {
    id: newLinkId(),
    productId: product.id,
    // Filled in once the reply is actually published. A link created for a
    // draft that gets rejected simply never acquires one.
    publicationId: null,
    destinationUrl: product.utmBase,
    utmSource: utm.utmSource,
    utmMedium: utm.utmMedium,
    utmCampaign: utm.utmCampaign,
    utmContent: null,
    createdAt: clock.now(),
  };
  db.insert(links).values(row).run();
  return row;
}

export function attachToPublication(db: Db, linkId: string, publicationId: string): void {
  db.update(links).set({ publicationId }).where(eq(links.id, linkId)).run();
}

/**
 * Swaps the product's own URL in a draft for the tracked one.
 *
 * Only ever substitutes a link the draft already contains. Injecting one the
 * model did not write would change the text after review, and a bare product
 * mention with no link is a perfectly good reply — often a better one.
 */
export interface SubstitutionResult {
  readonly body: string;
  readonly substituted: boolean;
  /** True when the product is named but no link was present to replace. */
  readonly mentionWithoutLink: boolean;
}

export function substituteLink(
  body: string,
  product: Product,
  replacement: string,
): SubstitutionResult {
  let host: string;
  try {
    host = new URL(product.utmBase).host.replace(/^www\./, '');
  } catch {
    return { body, substituted: false, mentionWithoutLink: false };
  }

  // Matches the bare host and any full URL on it, with or without a scheme,
  // stopping at whitespace or a closing bracket so trailing punctuation in a
  // sentence is left alone.
  //
  // Both boundaries matter. Without the lookbehind, `notsiplemona.decoy.test`
  // contains `siplemona.de` and we would rewrite a link to somebody else's
  // site; without the lookahead, `siplemona.decoy.test` does the same.
  // The right boundary has to tell a dot that continues a domain from a dot
  // that ends a sentence: reject `siplemona.decoy.test`, keep the full stop in
  // `it is at siplemona.de.`
  const pattern = new RegExp(
    `(?<![\\w.-])(?:https?://)?(?:www\\.)?${host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` +
      `(?![\\w-])(?!\\.[a-z0-9])(?:/[^\\s)\\]]*)?`,
    'gi',
  );

  const substituted = pattern.test(body);
  pattern.lastIndex = 0;
  const next = substituted ? body.replace(pattern, replacement) : body;

  return {
    body: next,
    substituted,
    mentionWithoutLink:
      !substituted && new RegExp(`(?<![\\w-])${product.name}(?![\\w-])`, 'i').test(body),
  };
}
