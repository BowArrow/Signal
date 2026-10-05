import { clipboard, type IpcMain } from 'electron';
import { asc, desc, eq, sql } from 'drizzle-orm';
import type { App as SignalApp } from '../../src/core/app.js';
import {
  communities,
  communityRules,
  drafts,
  opportunities,
  products,
} from '../../src/core/db/schema.js';
import { resolveScoring, setThreshold, setWeights } from '../../src/core/scoring/weights.js';
import { scoringWeightsSchema } from '../../src/core/config/schema.js';
import { blockCommunity } from '../../src/core/communities/registry.js';
import { markReviewed } from '../../src/core/rules/registry.js';
import {
  approve,
  editDraft,
  finalBody,
  previewApproval,
  reject,
  type ReviewContext,
} from '../../src/core/review/actions.js';
import {
  HackerNewsPublisher,
  ManualPublisher,
  RedditApiPublisher,
  selectPublisher,
} from '../../src/core/publish/publisher.js';
import {
  IPC,
  type ApproveOutcome,
  type CommunityView,
  type QueueItemView,
  type ScoringView,
} from '../../src/shared/ipc.js';

const AXIS_LABELS: Record<string, string> = {
  contribution: 'Contribution',
  intent: 'Intent',
  fit: 'Fit',
  risk: 'Risk',
};

/**
 * The review half of the bridge.
 *
 * Every decision that could put text in front of strangers is made here, in
 * the main process, against the database as it stands. The renderer sends a
 * draft id and receives a verdict; it is never trusted to have checked
 * anything itself, which is why a UI bug cannot publish.
 */
export function registerReviewHandlers(ipc: IpcMain, signal: SignalApp): void {
  const reviewContext = (): ReviewContext => ({
    limits: signal.config.publishLimits,
    timeZone: signal.config.timezone,
    trackingOrigin: signal.config.attribution.trackingOrigin,
    publishers: [
      new RedditApiPublisher(
        signal.env.REDDIT_USERNAME != null && signal.env.REDDIT_PASSWORD != null,
      ),
      new HackerNewsPublisher(),
    ],
    manual: new ManualPublisher((text) => clipboard.writeText(text)),
  });

  ipc.handle(IPC.communities, (): CommunityView[] =>
    signal.db
      .select({
        id: communities.id,
        platform: communities.platform,
        displayName: communities.displayName,
        monitored: communities.monitored,
        blockedAt: communities.blockedAt,
        blockedReason: communities.blockedReason,
        selfPromo: communityRules.selfPromo,
        ratioCapPct: communityRules.selfPromoRatioMaxPct,
        flairRequired: communityRules.flairRequired,
        verified: communityRules.verified,
        confidence: communityRules.confidence,
        evidence: communityRules.evidence,
        rawRules: communityRules.rawRules,
        sourceUrl: communityRules.sourceUrl,
        fetchedAt: communityRules.fetchedAt,
        opportunities: sql<number>`(
          select count(*) from ${opportunities}
          where ${opportunities.communityId} = ${communities.id}
        )`.as('opportunity_count'),
      })
      .from(communities)
      .leftJoin(communityRules, eq(communityRules.communityId, communities.id))
      .orderBy(desc(sql`opportunity_count`), asc(communities.displayName))
      .all()
      .map((r) => ({
        id: r.id,
        platform: r.platform,
        displayName: r.displayName,
        monitored: r.monitored,
        blocked: r.blockedAt != null,
        blockedReason: r.blockedReason,
        opportunities: Number(r.opportunities),
        selfPromo: r.selfPromo,
        ratioCapPct: r.ratioCapPct,
        flairRequired: r.flairRequired ?? false,
        verified: r.verified ?? false,
        confidence: r.confidence,
        evidence: r.evidence ?? [],
        rawRuleCount: (r.rawRules ?? []).length,
        sourceUrl: r.sourceUrl,
        fetchedAt: r.fetchedAt,
      })),
  );

  const scoringView = (): ScoringView => {
    const resolved = resolveScoring(signal.db, {
      weights: signal.config.scoring.weights,
      threshold: signal.config.scoring.threshold,
    });
    const counts = signal.db
      .select({ status: opportunities.status, n: sql<number>`count(*)` })
      .from(opportunities)
      .groupBy(opportunities.status)
      .all();
    const by = (status: string): number =>
      Number(counts.find((c) => c.status === status)?.n ?? 0);

    return {
      weights: resolved.weights,
      threshold: resolved.threshold,
      hash: resolved.hash,
      counts: {
        scored: by('scored') + by('drafted') + by('queued'),
        expired: by('expired'),
        rulesUnknown: by('rules_unknown'),
        unscored: by('new'),
      },
    };
  };

  ipc.handle(IPC.scoring, (): ScoringView => scoringView());

  ipc.handle(IPC.setScoring, (_e, next: unknown): ScoringView => {
    const payload = next as { weights?: unknown; threshold?: unknown } | null;
    const now = signal.clock.now();

    if (payload?.weights != null) {
      // The config refinement applies here too, so contribution cannot be
      // demoted below intent or fit by dragging a slider.
      const parsed = scoringWeightsSchema.safeParse(payload.weights);
      if (!parsed.success) {
        throw new Error(parsed.error.issues.map((i) => i.message).join('; '));
      }
      setWeights(signal.db, parsed.data, now);
    }
    if (typeof payload?.threshold === 'number') {
      const t = payload.threshold;
      if (t < 0 || t > 1) throw new Error('threshold must be between 0 and 1');
      setThreshold(signal.db, t, now);
    }
    return scoringView();
  });

  ipc.handle(IPC.queue, (): QueueItemView[] => {
    const resolved = resolveScoring(signal.db, {
      weights: signal.config.scoring.weights,
      threshold: signal.config.scoring.threshold,
    });
    const context = reviewContext();

    const rows = signal.db
      .select({
        draft: drafts,
        opportunity: opportunities,
        community: communities,
        rule: communityRules,
        productName: products.name,
      })
      .from(drafts)
      .innerJoin(opportunities, eq(drafts.opportunityId, opportunities.id))
      .leftJoin(communities, eq(opportunities.communityId, communities.id))
      .leftJoin(communityRules, eq(communityRules.communityId, communities.id))
      .leftJoin(products, eq(drafts.productId, products.id))
      .where(eq(drafts.status, 'pending'))
      .orderBy(desc(opportunities.scoreTotal))
      .all();

    return rows.map((row) => {
      const preview = previewApproval(signal.db, row.draft.id, context, signal.clock);
      const platform = row.community?.platform ?? 'reddit';
      const { publisher } = selectPublisher(platform, context.publishers, context.manual);

      const axes = (['contribution', 'intent', 'fit', 'risk'] as const).map((key) => ({
        key,
        label: AXIS_LABELS[key] ?? key,
        value:
          key === 'contribution'
            ? (row.opportunity.scoreContribution ?? 0)
            : key === 'intent'
              ? (row.opportunity.scoreIntent ?? 0)
              : key === 'fit'
                ? (row.opportunity.scoreFit ?? 0)
                : (row.opportunity.scoreRisk ?? 0),
        weight: resolved.weights[key],
      }));

      return {
        draftId: row.draft.id,
        opportunityId: row.opportunity.id,
        title: row.opportunity.title,
        url: row.opportunity.url,
        author: row.opportunity.author,
        threadBody: row.opportunity.body,
        community: row.community?.displayName ?? 'unknown community',
        platform,
        postedAt: row.opportunity.postedAt,
        promptVersion: row.draft.promptVersion,
        body: finalBody(row.draft),
        edited: row.draft.humanEditedBody != null,
        total: row.opportunity.scoreTotal,
        axes,
        product: row.productName ?? null,
        validators: row.draft.validatorResults,
        limits: preview.checks ?? [],
        blockedBy: preview.ok ? null : (preview.blockedBy ?? 'blocked'),
        warnings: preview.warnings ?? [],
        publishMethod: publisher === context.manual ? 'manual' : 'api',
        rules: {
          selfPromo: row.rule?.selfPromo ?? null,
          ratioCapPct: row.rule?.selfPromoRatioMaxPct ?? null,
          flairRequired: row.rule?.flairRequired ?? false,
          verified: row.rule?.verified ?? false,
          reviewedAt: row.rule?.lastReviewedAt ?? null,
        },
      };
    });
  });

  ipc.handle(IPC.approve, async (_e, draftId: unknown): Promise<ApproveOutcome> => {
    if (typeof draftId !== 'string') throw new Error('approve expects a draft id');
    const result = await approve(signal.db, draftId, reviewContext(), signal.logger, signal.clock);
    return {
      ok: result.ok,
      ...(result.method ? { method: result.method } : {}),
      ...(result.body ? { body: result.body } : {}),
      ...(result.note ? { note: result.note } : {}),
      ...(result.trackedUrl !== undefined ? { trackedUrl: result.trackedUrl } : {}),
      ...(result.blockedBy ? { blockedBy: result.blockedBy } : {}),
    };
  });

  ipc.handle(IPC.reject, (_e, draftId: unknown, reason: unknown, note: unknown): void => {
    if (typeof draftId !== 'string' || typeof reason !== 'string') {
      throw new Error('reject expects (draftId, reason)');
    }
    reject(
      signal.db,
      draftId,
      reason,
      typeof note === 'string' && note.length > 0 ? note : undefined,
      signal.clock,
    );
  });

  ipc.handle(IPC.editDraft, (_e, draftId: unknown, body: unknown): void => {
    if (typeof draftId !== 'string' || typeof body !== 'string') {
      throw new Error('editDraft expects (draftId, body)');
    }
    editDraft(signal.db, draftId, body, signal.clock);
  });

  ipc.handle(IPC.reviewRules, (_e, communityId: unknown, selfPromo: unknown): void => {
    if (typeof communityId !== 'string') throw new Error('reviewRules expects a community id');
    markReviewed(
      signal.db,
      communityId,
      typeof selfPromo === 'string' ? { selfPromo: selfPromo as never } : {},
      signal.clock,
    );
  });

  ipc.handle(IPC.blockCommunity, (_e, communityId: unknown, reason: unknown): void => {
    if (typeof communityId !== 'string' || typeof reason !== 'string') {
      throw new Error('blockCommunity expects (communityId, reason)');
    }
    blockCommunity(signal.db, communityId, reason, signal.clock);
  });

  ipc.handle(IPC.copyToClipboard, (_e, text: unknown): void => {
    if (typeof text !== 'string') throw new Error('copy expects a string');
    clipboard.writeText(text);
  });
}
