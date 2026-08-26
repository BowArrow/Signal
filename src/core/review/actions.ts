import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  communities,
  drafts,
  links,
  opportunities,
  products,
  publications,
  sources,
  type Community,
  type Draft,
  type Product,
} from '../db/schema.js';
import { newId } from '../lib/id.js';
import type { Clock } from '../lib/clock.js';
import { systemClock } from '../lib/clock.js';
import type { Logger } from '../lib/logger.js';
import type { PublishLimits } from '../config/schema.js';
import { getRule } from '../rules/registry.js';
import { validateDraft } from '../guardrails/validators.js';
import { checkLimits, type LimitCheck } from '../publish/rate-limit.js';
import { selectPublisher, type Publisher } from '../publish/publisher.js';
import { attachToPublication, createLink, substituteLink, trackedUrl } from '../links/tracked.js';

/**
 * What happens when you approve a draft.
 *
 * The important property: nothing here trusts what was decided at drafting
 * time. Validators run again on the body as it stands now — which may be text
 * you edited — and the limits run against the database as it is at this
 * moment, not as it was when the draft was written. A draft approved three
 * days after it was generated must obey today's cooldown, not the one that
 * applied when the model wrote it.
 */

export const REJECTION_REASONS = [
  'Product named too early',
  'Marketing register',
  'Numbers I cannot verify',
  'Thread already answered',
  'Wrong community',
  'Not worth replying to',
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

export interface ReviewContext {
  readonly limits: PublishLimits;
  readonly timeZone: string;
  readonly trackingOrigin: string;
  readonly publishers: readonly Publisher[];
  readonly manual: Publisher;
}

export interface ApproveResult {
  readonly ok: boolean;
  readonly publicationId?: string;
  readonly method?: 'api' | 'manual';
  readonly body?: string;
  readonly note?: string;
  readonly trackedUrl?: string | null;
  /** Set when approval was refused, naming what stopped it. */
  readonly blockedBy?: string;
  readonly checks?: LimitCheck[];
  readonly warnings?: string[];
  /** Whether the body as it stands names a product. Drives the ratio. */
  readonly promotional?: boolean;
}

interface LoadedDraft {
  readonly draft: Draft;
  readonly opportunity: typeof opportunities.$inferSelect;
  readonly community: Community | null;
  readonly product: Product | null;
  readonly platform: string;
}

function load(db: Db, draftId: string): LoadedDraft | null {
  const draft = db.select().from(drafts).where(eq(drafts.id, draftId)).get();
  if (!draft) return null;

  const opportunity = db
    .select()
    .from(opportunities)
    .where(eq(opportunities.id, draft.opportunityId))
    .get();
  if (!opportunity) return null;

  const community = opportunity.communityId
    ? (db.select().from(communities).where(eq(communities.id, opportunity.communityId)).get() ?? null)
    : null;

  const product = draft.productId
    ? (db.select().from(products).where(eq(products.id, draft.productId)).get() ?? null)
    : null;

  const source = db.select().from(sources).where(eq(sources.id, opportunity.sourceId)).get();

  return {
    draft,
    opportunity,
    community,
    product,
    platform: community?.platform ?? source?.kind ?? 'reddit',
  };
}

/** The text that would actually be posted: your edit if you made one. */
export function finalBody(draft: Draft): string {
  return draft.humanEditedBody ?? draft.generatedBody;
}

/**
 * Re-validate and re-check limits without publishing anything.
 *
 * What the queue calls to decide whether the approve button is enabled, and
 * why it is not.
 */
export function previewApproval(
  db: Db,
  draftId: string,
  context: ReviewContext,
  clock: Clock = systemClock,
): ApproveResult {
  const loaded = load(db, draftId);
  if (!loaded) return { ok: false, blockedBy: 'draft not found' };

  const { draft, community, product } = loaded;
  const body = finalBody(draft);
  const rule = community ? (getRule(db, community.id) ?? null) : null;

  const validation = validateDraft({
    body,
    products: db
      .select()
      .from(products)
      .all()
      .map((p) => ({ key: p.key, name: p.name })),
    rule,
    communityName: community?.displayName ?? 'unknown community',
    platform: loaded.platform,
  });

  if (validation.blocked) {
    return {
      ok: false,
      blockedBy: validation.blockReason ?? 'a validator blocked this draft',
      warnings: validation.results.filter((r) => r.state === 'warn').map((r) => r.message),
    };
  }

  const verdict = checkLimits(
    db,
    context.limits,
    {
      platform: loaded.platform as never,
      communityId: community?.id ?? null,
      communityName: community?.displayName ?? 'unknown community',
      // What matters is whether the text as it stands names a product, not
      // what the model intended when it wrote it.
      promotional: validation.productMentioned,
      communityRatioCapPct: rule?.selfPromoRatioMaxPct,
      timeZone: context.timeZone,
    },
    clock,
  );

  const warnings = validation.results.filter((r) => r.state === 'warn').map((r) => r.message);
  if (!verdict.allowed) {
    return {
      ok: false,
      blockedBy: verdict.blockedBy?.message ?? 'a publish limit blocked this',
      checks: verdict.checks,
      warnings,
      promotional: validation.productMentioned,
    };
  }

  void product;
  return {
    ok: true,
    checks: verdict.checks,
    warnings,
    body,
    promotional: validation.productMentioned,
  };
}

/**
 * Approve and publish.
 *
 * Order matters: everything that can refuse runs before anything is written,
 * so a refusal leaves no half-finished publication behind.
 */
export async function approve(
  db: Db,
  draftId: string,
  context: ReviewContext,
  logger: Logger,
  clock: Clock = systemClock,
): Promise<ApproveResult> {
  const preview = previewApproval(db, draftId, context, clock);
  if (!preview.ok) return preview;

  const loaded = load(db, draftId);
  if (!loaded) return { ok: false, blockedBy: 'draft not found' };
  const { draft, opportunity, community, product } = loaded;

  let body = finalBody(draft);
  let linkId: string | null = null;
  let tracked: string | null = null;

  // A tracked link only exists if the draft actually carried the product's
  // URL. Nothing is injected that a human did not already approve.
  if (product) {
    const candidate = createLink(db, product, community, loaded.platform, clock);
    const substitution = substituteLink(body, product, trackedUrl(context.trackingOrigin, candidate.id));
    if (substitution.substituted) {
      body = substitution.body;
      linkId = candidate.id;
      tracked = trackedUrl(context.trackingOrigin, candidate.id);
    } else {
      // Nothing to swap, so the link record would be an orphan.
      db.delete(links).where(eq(links.id, candidate.id)).run();
      if (substitution.mentionWithoutLink) {
        logger.warn('draft names the product but carries no link — this reply cannot be attributed', {
          draft: draftId,
        });
      }
    }
  }

  const { publisher, fellBack } = selectPublisher(
    loaded.platform as never,
    context.publishers,
    context.manual,
  );

  let outcome;
  try {
    outcome = await publisher.publish({
      platform: loaded.platform as never,
      community,
      body,
      targetUrl: opportunity.url,
      targetExternalId: opportunity.externalId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('publish failed', { draft: draftId, error: message });
    return { ok: false, blockedBy: message };
  }

  const now = clock.now();
  const publicationId = newId();

  db.transaction((tx) => {
    tx.insert(publications)
      .values({
        id: publicationId,
        draftId: draft.id,
        sourceId: opportunity.sourceId,
        communityId: community?.id ?? null,
        platform: loaded.platform as never,
        method: outcome.method,
        externalPostId: outcome.externalPostId,
        externalUrl: outcome.externalUrl,
        publishedAt: now,
        linkId,
        postedBody: body,
        // Read from the text that actually went out, not from what the model
        // claimed it would write. This is what the ratio counts.
        promotional: preview.promotional === true,
        createdAt: now,
      })
      .run();

    tx.update(drafts)
      .set({ status: 'published', updatedAt: now })
      .where(eq(drafts.id, draft.id))
      .run();

    tx.update(opportunities)
      .set({
        status: 'published',
        statusReason: `published to ${community?.displayName ?? 'unknown'} (${outcome.method})`,
        updatedAt: now,
      })
      .where(eq(opportunities.id, opportunity.id))
      .run();
  });

  if (linkId) attachToPublication(db, linkId, publicationId);

  logger.info('published', {
    draft: draftId,
    community: community?.displayName,
    method: outcome.method,
    tracked: tracked ?? 'none',
  });

  return {
    ok: true,
    publicationId,
    method: outcome.method,
    body,
    note: fellBack ? `${outcome.note} — ${fellBack}` : outcome.note,
    trackedUrl: tracked,
    ...(preview.warnings ? { warnings: preview.warnings } : {}),
  };
}

export function reject(
  db: Db,
  draftId: string,
  reason: RejectionReason | string,
  note: string | undefined,
  clock: Clock = systemClock,
): boolean {
  const draft = db.select().from(drafts).where(eq(drafts.id, draftId)).get();
  if (!draft) return false;
  const now = clock.now();

  db.transaction((tx) => {
    tx.update(drafts)
      .set({
        status: 'rejected',
        rejectionReason: reason,
        rejectionNote: note ?? null,
        updatedAt: now,
      })
      .where(eq(drafts.id, draftId))
      .run();

    // Rejected is terminal for the opportunity too. A poller re-seeing the
    // thread must not put it back in the queue tomorrow.
    tx.update(opportunities)
      .set({ status: 'rejected', statusReason: `rejected: ${reason}`, updatedAt: now })
      .where(eq(opportunities.id, draft.opportunityId))
      .run();
  });

  return true;
}

/**
 * Records an edit without publishing.
 *
 * The generated body is never overwritten: the learning loop needs to compare
 * what the model wrote against what you were willing to send.
 */
export function editDraft(
  db: Db,
  draftId: string,
  body: string,
  clock: Clock = systemClock,
): boolean {
  const draft = db.select().from(drafts).where(eq(drafts.id, draftId)).get();
  if (!draft) return false;

  db.update(drafts)
    .set({
      humanEditedBody: body === draft.generatedBody ? null : body,
      updatedAt: clock.now(),
    })
    .where(eq(drafts.id, draftId))
    .run();
  return true;
}
