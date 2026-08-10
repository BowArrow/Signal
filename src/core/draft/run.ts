import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  communities,
  drafts,
  opportunities,
  products,
  type Opportunity,
  type Product,
} from '../db/schema.js';
import { newId } from '../lib/id.js';
import type { Clock } from '../lib/clock.js';
import { systemClock } from '../lib/clock.js';
import type { Logger } from '../lib/logger.js';
import type { LlmClient } from '../llm/client.js';
import { canDraftFor } from '../rules/registry.js';
import { validateDraft } from '../guardrails/validators.js';
import { generateReply } from './generate.js';

export interface DraftOptions {
  readonly limit?: number;
  /** Draft this one opportunity, whatever its status. */
  readonly only?: string;
  readonly regenerateNote?: string;
  readonly clock?: Clock;
  readonly dryRun?: boolean;
}

export interface DraftedOne {
  readonly opportunityId: string;
  readonly draftId: string | null;
  readonly title: string;
  readonly community: string;
  readonly body: string;
  readonly mentionsProduct: boolean;
  readonly omitReason: string | null;
  readonly blocked: boolean;
  readonly blockReason: string | null;
  readonly warnings: string[];
}

export interface DraftReport {
  readonly drafted: DraftedOne[];
  readonly skipped: { readonly id: string; readonly reason: string }[];
  readonly failed: { readonly id: string; readonly error: string }[];
  readonly durationMs: number;
}

function productFor(db: Db, opportunity: Opportunity): Product | null {
  if (!opportunity.matchedProductId) return null;
  return db.select().from(products).where(eq(products.id, opportunity.matchedProductId)).get() ?? null;
}

/**
 * Generates replies for opportunities that cleared the threshold.
 *
 * A blocked draft is still written to the database, with its validator results
 * attached, but it never reaches the queue. Keeping it matters: the pattern in
 * what gets blocked is what tells me the prompt is wrong, and throwing it away
 * would hide that.
 */
export async function runDrafting(
  db: Db,
  llm: LlmClient,
  config: { draftModel: string; maxOutputTokens: number },
  logger: Logger,
  options: DraftOptions = {},
): Promise<DraftReport> {
  const clock = options.clock ?? systemClock;
  const started = clock.now();

  const pending = options.only
    ? [db.select().from(opportunities).where(eq(opportunities.id, options.only)).get()].filter(
        (row): row is Opportunity => row != null,
      )
    : db
        .select()
        .from(opportunities)
        .where(inArray(opportunities.status, ['scored']))
        .limit(options.limit ?? 10)
        .all();

  const drafted: DraftedOne[] = [];
  const skipped: { id: string; reason: string }[] = [];
  const failed: { id: string; error: string }[] = [];

  const allProducts = db.select().from(products).all();

  for (const row of pending) {
    const community = row.communityId
      ? db.select().from(communities).where(eq(communities.id, row.communityId)).get() ?? null
      : null;

    // The gate. No rules record, no draft — checked here as well as at
    // scoring, because scoring may have run before the rules were fetched.
    const gate = canDraftFor(db, community, clock);
    if (!gate.allowed) {
      skipped.push({ id: row.id, reason: gate.reason });
      if (!options.dryRun) {
        db.update(opportunities)
          .set({ status: gate.status, statusReason: gate.reason, updatedAt: clock.now() })
          .where(eq(opportunities.id, row.id))
          .run();
      }
      continue;
    }
    if (!community) continue;

    try {
      const product = productFor(db, row);
      const generated = await generateReply(
        llm,
        config.draftModel,
        config.maxOutputTokens,
        row,
        community,
        gate.rule,
        product,
        logger,
        clock.now(),
        options.regenerateNote,
      );

      const validation = validateDraft({
        body: generated.reply.body,
        // Every product is checked, not just the matched one. A draft for
        // Lemonade that name-drops CineGen still needs a disclosure.
        products: allProducts.map((p) => ({ key: p.key, name: p.name })),
        rule: gate.rule,
        communityName: community.displayName,
        platform: community.platform,
      });

      let draftId: string | null = null;
      if (!options.dryRun) {
        draftId = newId();
        const now = clock.now();
        db.insert(drafts)
          .values({
            id: draftId,
            opportunityId: row.id,
            productId: generated.productId,
            promptVersion: generated.promptVersion,
            generatedBody: generated.reply.body,
            humanEditedBody: null,
            disclosurePresent: validation.disclosurePresent,
            productMentioned: validation.productMentioned,
            validatorResults: validation.results,
            blocked: validation.blocked,
            status: 'pending',
            ...(options.regenerateNote ? { regenerateNote: options.regenerateNote } : {}),
            createdAt: now,
            updatedAt: now,
          })
          .run();

        // Only an unblocked draft moves the opportunity into the queue.
        db.update(opportunities)
          .set({
            status: validation.blocked ? 'drafted' : 'queued',
            statusReason: validation.blocked
              ? `draft blocked: ${validation.blockReason ?? 'validator'}`
              : 'awaiting your review',
            updatedAt: now,
          })
          .where(eq(opportunities.id, row.id))
          .run();
      }

      drafted.push({
        opportunityId: row.id,
        draftId,
        title: row.title,
        community: community.displayName,
        body: generated.reply.body,
        mentionsProduct: generated.reply.mentionsProduct,
        omitReason: generated.reply.omitReason,
        blocked: validation.blocked,
        blockReason: validation.blockReason,
        warnings: validation.results.filter((r) => r.state === 'warn').map((r) => r.message),
      });

      if (validation.blocked) {
        logger.warn('draft blocked by a validator', {
          opportunity: row.id,
          reason: validation.blockReason,
        });
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error('drafting failed', { opportunity: row.id, error });
      failed.push({ id: row.id, error });
    }
  }

  return { drafted, skipped, failed, durationMs: clock.now() - started };
}
