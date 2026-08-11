import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/**
 * Signal's schema.
 *
 * Portability rule: only text / integer / real columns, timestamps as integer
 * epoch milliseconds, JSON as text. Every query goes through the Drizzle query
 * builder rather than raw SQL. Moving to Postgres then means swapping the
 * imports in this one file, not rewriting the application.
 *
 * Guardrail note, stated once and enforced throughout: there is no account or
 * identity table. A platform has exactly one identity — mine — and it comes
 * from .env. The schema cannot express a second persona, which is the point.
 */

const now = sql`(unixepoch() * 1000)`;

const id = () => text('id').primaryKey();
const createdAt = () => integer('created_at').notNull().default(now);
const updatedAt = () => integer('updated_at').notNull().default(now);

// ───────────────────────────────────────────────────────── products ──

export const products = sqliteTable(
  'products',
  {
    id: id(),
    /** Stable lowercase key, e.g. "lemonade". Matches signal.config.ts. */
    key: text('key').notNull(),
    name: text('name').notNull(),
    positioning: text('positioning').notNull(),
    targetBuyer: text('target_buyer').notNull(),
    priceCents: integer('price_cents').notNull(),
    currency: text('currency').notNull(),
    /** JSON string[]. Specific claims the drafter is allowed to make. */
    proofPoints: text('proof_points', { mode: 'json' }).$type<string[]>().notNull(),
    /** JSON Record<string,string>. Docs, changelog, repo. */
    links: text('links', { mode: 'json' }).$type<Record<string, string>>().notNull(),
    /** Destination a tracked link resolves to before UTM params are appended. */
    utmBase: text('utm_base').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('products_key_idx').on(t.key)],
);

// ────────────────────────────────────────────────────────── sources ──

export const SOURCE_KINDS = [
  /** One subreddit's /new listing. */
  'reddit',
  /**
   * A site-wide Reddit search. This is the discovery engine: it surfaces
   * threads from communities Signal has never heard of, which is how new
   * places to be useful get found instead of hand-listed.
   */
  'reddit_search',
  'hn',
  'rss',
  'discord',
  'x',
] as const;
export type SourceKindValue = (typeof SOURCE_KINDS)[number];

export const sources = sqliteTable(
  'sources',
  {
    id: id(),
    kind: text('kind').$type<SourceKindValue>().notNull(),
    /**
     * Subreddit name without r/, a search query, or a feed URL. What this
     * means depends on the kind — see the poller.
     */
    identifier: text('identifier').notNull(),
    displayName: text('display_name').notNull(),
    pollIntervalSeconds: integer('poll_interval_seconds').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    /**
     * Whether this source may be fetched where robots.txt disallows it.
     *
     * Stored rather than read from config at call time so the exemption is
     * visible in the database, listed by `signal status`, and enforceable at
     * the point of the request. There is no global override — see
     * sourceConfigSchema.
     */
    ignoreRobotsTxt: integer('ignore_robots_txt', { mode: 'boolean' }).notNull().default(false),
    /** Why the exemption was taken. Required whenever the flag is set. */
    robotsExemptionReason: text('robots_exemption_reason'),
    /**
     * True when Signal proposed this source itself rather than reading it from
     * signal.config.ts. Discovered sources arrive disabled: finding a promising
     * community is a suggestion, not a decision.
     */
    discovered: integer('discovered', { mode: 'boolean' }).notNull().default(false),
    /** Which source surfaced it, for auditing a discovery chain. */
    discoveredVia: text('discovered_via'),
    lastPolledAt: integer('last_polled_at'),
    lastPollError: text('last_poll_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('sources_kind_identifier_idx').on(t.kind, t.identifier)],
);

// ────────────────────────────────────────────────────── communities ──

/**
 * A place with its own rules: a subreddit, a forum, Hacker News.
 *
 * Deliberately separate from `sources`. A source is how Signal looks — a
 * subreddit listing, a site-wide search, an RSS feed. A community is where a
 * reply would actually land. One search source surfaces threads from dozens of
 * communities, and it is the community whose rules decide whether a draft is
 * allowed to exist.
 */
export const communities = sqliteTable(
  'communities',
  {
    id: id(),
    platform: text('platform').$type<SourceKindValue>().notNull(),
    /** Canonical name on the platform: "LocalLLaMA", or "news" for HN. */
    name: text('name').notNull(),
    displayName: text('display_name').notNull(),
    url: text('url'),
    description: text('description'),
    subscribers: integer('subscribers'),
    /** Whether Signal polls this community directly, vs only meeting it in search. */
    monitored: integer('monitored', { mode: 'boolean' }).notNull().default(false),
    firstSeenAt: integer('first_seen_at').notNull().default(now),
    /** Set when a human has explicitly said no. Nothing is drafted here again. */
    blockedAt: integer('blocked_at'),
    blockedReason: text('blocked_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('communities_platform_name_idx').on(t.platform, t.name)],
);

// ────────────────────────────────────────────────── community rules ──

/**
 * What a community permits. No record means no draft: the opportunity is held
 * as rules_unknown regardless of how well it scored. Guessing a subreddit's
 * self-promo policy is how you get banned from it.
 */
export const SELF_PROMO_POLICIES = [
  'allowed',
  'allowed_with_disclosure',
  'discouraged',
  'designated_thread_only',
  'forbidden',
  /** Signal drafts it, I paste it. Hacker News is permanently this. */
  'draft_only',
] as const;
export type SelfPromoPolicy = (typeof SELF_PROMO_POLICIES)[number];

/** One verbatim rule as the platform published it. Never paraphrased. */
export interface RawRule {
  readonly shortName: string;
  readonly description: string;
  readonly kind?: string;
}

export const communityRules = sqliteTable(
  'community_rules',
  {
    id: id(),
    communityId: text('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),

    // — What the platform actually said —
    /**
     * The rules exactly as fetched, before anyone interpreted them. This is
     * the evidence. Every structured field below is a reading of this, and
     * when the two disagree this wins.
     */
    rawRules: text('raw_rules', { mode: 'json' }).$type<RawRule[]>(),
    rawSidebar: text('raw_sidebar'),
    /** Where the raw text came from, so a claim can always be traced. */
    sourceUrl: text('source_url'),
    fetchedAt: integer('fetched_at'),

    // — The reading of it —
    selfPromo: text('self_promo').$type<SelfPromoPolicy>().notNull(),
    /** Community's own stated ratio cap as a percentage, when it states one. */
    selfPromoRatioMaxPct: real('self_promo_ratio_max_pct'),
    flairRequired: integer('flair_required', { mode: 'boolean' }).notNull().default(false),
    flairValue: text('flair_value'),
    minAccountAgeDays: integer('min_account_age_days'),
    minKarma: integer('min_karma'),
    notes: text('notes'),
    /** The rule text the interpretation leaned on, quoted. Shown at review. */
    evidence: text('evidence', { mode: 'json' }).$type<string[]>(),
    /** Which model and prompt produced the reading, or 'human'. */
    interpretedBy: text('interpreted_by'),
    /** The model's own confidence, 0..1. Low confidence is surfaced, not hidden. */
    confidence: real('confidence'),

    // — Whether a human has signed off —
    /**
     * False means nobody has checked this reading against the real sidebar.
     * An unverified record is still enough to draft — refusing would make
     * discovery useless — but the queue shows it and the digest nags.
     * `selfPromo: 'forbidden'` is honoured either way.
     */
    verified: integer('verified', { mode: 'boolean' }).notNull().default(false),
    lastReviewedAt: integer('last_reviewed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('community_rules_community_idx').on(t.communityId)],
);

// ──────────────────────────────────────────────────── opportunities ──

export const OPPORTUNITY_STATUSES = [
  /** Ingested, not yet scored. */
  'new',
  /** Scored and above threshold, waiting on a draft. */
  'scored',
  /** Above threshold but the community has no rules record. No draft made. */
  'rules_unknown',
  'drafted',
  'queued',
  'approved',
  'published',
  'rejected',
  /** Below threshold, or too old. Never shown in the queue. */
  'expired',
  /** Its source was disabled. */
  'paused',
] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export const opportunities = sqliteTable(
  'opportunities',
  {
    id: id(),
    /** Which poller found it. */
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    /**
     * Where a reply would land. Not derivable from sourceId: a site-wide
     * search surfaces threads from dozens of communities, and it is this one
     * whose rules decide whether a draft may exist.
     */
    communityId: text('community_id').references(() => communities.id, { onDelete: 'set null' }),
    /** Platform's own id: a Reddit fullname, an HN object id, an RSS guid. */
    externalId: text('external_id').notNull(),
    url: text('url').notNull(),
    author: text('author'),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    /** When the item was posted on the platform, not when we saw it. */
    postedAt: integer('posted_at'),
    discoveredAt: integer('discovered_at').notNull().default(now),
    commentCount: integer('comment_count'),
    /** The platform's own score: Reddit upvotes, HN points. */
    platformScore: integer('platform_score'),
    /**
     * True when the body has not been fetched yet.
     *
     * Old Reddit's listing pages carry titles but lazy-load post bodies, so a
     * scraped text post arrives without one. Scoring skips these rather than
     * judging a thread on its title alone — a hydration job fills them in
     * shortly after ingest.
     */
    needsBody: integer('needs_body', { mode: 'boolean' }).notNull().default(false),

    // Score axes stored raw and separately so weights stay tunable. The total
    // is a cached convenience — recompute it whenever weights change.
    scoreContribution: real('score_contribution'),
    scoreIntent: real('score_intent'),
    scoreFit: real('score_fit'),
    scoreRisk: real('score_risk'),
    scoreTotal: real('score_total'),
    /** Which weight set produced scoreTotal, so stale totals are detectable. */
    scoreWeightsHash: text('score_weights_hash'),
    scoredAt: integer('scored_at'),
    /** Which product the Fit axis matched, if any. */
    matchedProductId: text('matched_product_id').references(() => products.id, {
      onDelete: 'set null',
    }),
    /** Why the classifier scored it this way. Kept for prompt debugging. */
    scoreRationale: text('score_rationale'),

    status: text('status').$type<OpportunityStatus>().notNull().default('new'),
    statusReason: text('status_reason'),
    /** The untouched payload from the platform, for reprocessing. */
    raw: text('raw', { mode: 'json' }).$type<unknown>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Dedup key. Two pollers racing on the same item must collide here rather
    // than produce a duplicate row.
    uniqueIndex('opportunities_source_external_idx').on(t.sourceId, t.externalId),
    index('opportunities_status_idx').on(t.status),
    index('opportunities_discovered_idx').on(t.discoveredAt),
    index('opportunities_score_total_idx').on(t.scoreTotal),
    index('opportunities_community_idx').on(t.communityId),
  ],
);

// ─────────────────────────────────────────────────────────── drafts ──

export const DRAFT_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'published',
  /** Replaced by a regeneration. Kept, because the learning loop reads it. */
  'superseded',
] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export interface ValidatorResult {
  readonly rule: string;
  readonly state: 'pass' | 'warn' | 'block';
  readonly message: string;
}

export const drafts = sqliteTable(
  'drafts',
  {
    id: id(),
    opportunityId: text('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    /** Null when the draft deliberately omits any product mention. */
    productId: text('product_id').references(() => products.id, { onDelete: 'set null' }),
    /** e.g. "reply.v4" — the file in src/prompts that produced this. */
    promptVersion: text('prompt_version').notNull(),
    /** What the model wrote. Never overwritten; the learning loop needs it. */
    generatedBody: text('generated_body').notNull(),
    /** What I changed it to. Null means I did not touch it. */
    humanEditedBody: text('human_edited_body'),
    /** Does the body carry a disclosure line? A validator, not a hint. */
    disclosurePresent: integer('disclosure_present', { mode: 'boolean' }).notNull(),
    /** Does the body name the product at all? */
    productMentioned: integer('product_mentioned', { mode: 'boolean' }).notNull(),
    validatorResults: text('validator_results', { mode: 'json' })
      .$type<ValidatorResult[]>()
      .notNull(),
    /** True if any validator returned "block". Publishing checks this again. */
    blocked: integer('blocked', { mode: 'boolean' }).notNull(),
    status: text('status').$type<DraftStatus>().notNull().default('pending'),
    /** One of a fixed set of reasons, fed back into the weekly digest. */
    rejectionReason: text('rejection_reason'),
    rejectionNote: text('rejection_note'),
    /** Free-text note appended to the prompt on a regeneration. */
    regenerateNote: text('regenerate_note'),
    /** Which draft this one replaced. */
    supersedesDraftId: text('supersedes_draft_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('drafts_opportunity_idx').on(t.opportunityId),
    index('drafts_status_idx').on(t.status),
  ],
);

// ───────────────────────────────────────────────────── publications ──

export const PUBLISH_METHODS = [
  /** Posted by Signal through an official API, after I approved it. */
  'api',
  /** Copied to my clipboard; I pasted it and marked it posted. HN, always. */
  'manual',
] as const;
export type PublishMethod = (typeof PUBLISH_METHODS)[number];

export const publications = sqliteTable(
  'publications',
  {
    id: id(),
    draftId: text('draft_id')
      .notNull()
      .references(() => drafts.id, { onDelete: 'cascade' }),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    /**
     * Where it was actually posted. The cooldown and the self-promo ratio are
     * both per-community, so this is the column those checks read — not
     * sourceId, which only says how the thread was found.
     */
    communityId: text('community_id').references(() => communities.id, { onDelete: 'set null' }),
    platform: text('platform').$type<SourceKindValue>().notNull(),
    method: text('method').$type<PublishMethod>().notNull(),
    /** The comment id the platform gave back. Null for a manual paste. */
    externalPostId: text('external_post_id'),
    externalUrl: text('external_url'),
    publishedAt: integer('published_at').notNull(),
    /** The tracked short link that went out in the body, if one did. */
    linkId: text('link_id'),
    /** The exact text that was posted, after any edits I made. */
    postedBody: text('posted_body').notNull(),
    /** Did this publication mention a product? Drives the ratio check. */
    promotional: integer('promotional', { mode: 'boolean' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('publications_source_idx').on(t.sourceId),
    index('publications_community_idx').on(t.communityId),
    index('publications_published_at_idx').on(t.publishedAt),
    index('publications_platform_idx').on(t.platform),
  ],
);

// ───────────────────────────────────────────────── links and clicks ──

/**
 * Every outbound link is a record, not a URL. The short id resolves
 * server-side, so a link already sitting in a Reddit comment keeps working
 * when the destination or the tracking domain changes.
 */
export const links = sqliteTable(
  'links',
  {
    /** The short id that appears in /r/:linkId. */
    id: id(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    /** Null until the draft this link belongs to is actually published. */
    publicationId: text('publication_id'),
    destinationUrl: text('destination_url').notNull(),
    utmSource: text('utm_source').notNull(),
    utmMedium: text('utm_medium').notNull(),
    utmCampaign: text('utm_campaign').notNull(),
    utmContent: text('utm_content'),
    createdAt: createdAt(),
  },
  (t) => [index('links_publication_idx').on(t.publicationId)],
);

export const clicks = sqliteTable(
  'clicks',
  {
    id: id(),
    linkId: text('link_id')
      .notNull()
      .references(() => links.id, { onDelete: 'cascade' }),
    clickedAt: integer('clicked_at').notNull(),
    /** The cookie value set on the redirect. What a conversion matches on. */
    cookieId: text('cookie_id'),
    /** Salted hash, never a raw address. This is someone else's IP. */
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    referer: text('referer'),
    createdAt: createdAt(),
  },
  (t) => [
    index('clicks_link_idx').on(t.linkId),
    index('clicks_cookie_idx').on(t.cookieId),
    index('clicks_clicked_at_idx').on(t.clickedAt),
  ],
);

// ────────────────────────────────────────────────────────── metrics ──

/**
 * Time-series rows, appended and never overwritten. Seeing that a comment went
 * to 180 upvotes and then got buried is information; a single current-value
 * column throws it away.
 */
export const metrics = sqliteTable(
  'metrics',
  {
    id: id(),
    publicationId: text('publication_id')
      .notNull()
      .references(() => publications.id, { onDelete: 'cascade' }),
    capturedAt: integer('captured_at').notNull(),
    upvotes: integer('upvotes'),
    comments: integer('comments'),
    clicks: integer('clicks'),
    /** Whatever else the platform returned, kept verbatim. */
    raw: text('raw', { mode: 'json' }).$type<unknown>(),
    createdAt: createdAt(),
  },
  (t) => [
    index('metrics_publication_idx').on(t.publicationId),
    index('metrics_captured_at_idx').on(t.capturedAt),
  ],
);

// ────────────────────────────────────────────────────── conversions ──

export const ATTRIBUTION_METHODS = [
  /** A tracked click inside the window, most recent one wins. */
  'last_touch_click',
  /** No click found. Not a guess — an explicit absence. */
  'unattributed',
  /** I attached it by hand in the dashboard. */
  'manual',
] as const;
export type AttributionMethod = (typeof ATTRIBUTION_METHODS)[number];

export const conversions = sqliteTable(
  'conversions',
  {
    id: id(),
    /** Order id from the processor. Unique, so webhook replays are idempotent. */
    externalOrderId: text('external_order_id').notNull(),
    processor: text('processor').notNull(),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull(),
    occurredAt: integer('occurred_at').notNull(),
    productId: text('product_id').references(() => products.id, { onDelete: 'set null' }),
    attributedPublicationId: text('attributed_publication_id').references(
      () => publications.id,
      { onDelete: 'set null' },
    ),
    attributionMethod: text('attribution_method').$type<AttributionMethod>().notNull(),
    /** The click that won attribution, for auditing the match. */
    attributedClickId: text('attributed_click_id'),
    cookieId: text('cookie_id'),
    raw: text('raw', { mode: 'json' }).$type<unknown>(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('conversions_external_order_idx').on(t.externalOrderId),
    index('conversions_publication_idx').on(t.attributedPublicationId),
    index('conversions_occurred_at_idx').on(t.occurredAt),
  ],
);

// ───────────────────────────────────────────────── content calendar ──

export const contentCalendar = sqliteTable(
  'content_calendar',
  {
    id: id(),
    /** blog | youtube | changelog | email | launch */
    channel: text('channel').notNull(),
    productId: text('product_id').references(() => products.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    slug: text('slug'),
    /** idea | drafted | approved | scheduled | published */
    status: text('status').notNull().default('idea'),
    scheduledFor: integer('scheduled_for'),
    publishedAt: integer('published_at'),
    /** Path to the MDX file under content/, once one exists. */
    bodyPath: text('body_path'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('content_calendar_status_idx').on(t.status)],
);

// ───────────────────────────────────────────────────── job queue ──

export const JOB_STATUSES = ['pending', 'running', 'done', 'failed', 'dead'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * A durable queue in the same SQLite file. Not Redis, not BullMQ. It survives
 * a restart, which is the only property that actually matters for a system
 * polling on a fifteen-minute cadence.
 */
export const jobs = sqliteTable(
  'jobs',
  {
    id: id(),
    kind: text('kind').notNull(),
    payload: text('payload', { mode: 'json' }).$type<unknown>(),
    /** Not before this time. */
    runAt: integer('run_at').notNull(),
    status: text('status').$type<JobStatus>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    lockedAt: integer('locked_at'),
    lockedBy: text('locked_by'),
    lastError: text('last_error'),
    /**
     * Optional dedup key. Claiming a job with a key already pending is a
     * no-op, so a cron tick that fires twice does not double-poll a source.
     */
    dedupeKey: text('dedupe_key'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('jobs_status_run_at_idx').on(t.status, t.runAt),
    uniqueIndex('jobs_dedupe_idx').on(t.dedupeKey),
  ],
);

// ──────────────────────────────────────────────────────── llm calls ──

/**
 * One row per model call.
 *
 * Exists to answer a question that cannot be answered by opinion: is a local
 * 30B good enough for these three jobs? Latency and token counts say what it
 * costs; `jsonOk` says whether it can hold a structured-output contract, which
 * is the thing a smaller model actually tends to fail at. Swapping providers
 * without this would be a vibe rather than a decision.
 */
export const llmCalls = sqliteTable(
  'llm_calls',
  {
    id: id(),
    /** classify | draft | interpret-rules */
    task: text('task').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    ok: integer('ok', { mode: 'boolean' }).notNull(),
    /**
     * Whether the response parsed as the JSON the prompt asked for. Null when
     * the call did not complete, or did not expect JSON.
     */
    jsonOk: integer('json_ok', { mode: 'boolean' }),
    latencyMs: integer('latency_ms').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [index('llm_calls_task_idx').on(t.task), index('llm_calls_created_idx').on(t.createdAt)],
);

export type LlmCall = typeof llmCalls.$inferSelect;

// ───────────────────────────────────────────────────────── settings ──

/**
 * Values the dashboard can change at runtime: scoring weights, threshold,
 * publish limits. signal.config.ts supplies the defaults; a row here overrides
 * it. Config stays the floor, the UI stays live.
 */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
  updatedAt: updatedAt(),
});

// ────────────────────────────────────────────────────────── exports ──

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
export type Community = typeof communities.$inferSelect;
export type NewCommunity = typeof communities.$inferInsert;
export type CommunityRule = typeof communityRules.$inferSelect;
export type NewCommunityRule = typeof communityRules.$inferInsert;
export type Opportunity = typeof opportunities.$inferSelect;
export type NewOpportunity = typeof opportunities.$inferInsert;
export type Draft = typeof drafts.$inferSelect;
export type NewDraft = typeof drafts.$inferInsert;
export type Publication = typeof publications.$inferSelect;
export type NewPublication = typeof publications.$inferInsert;
export type Link = typeof links.$inferSelect;
export type NewLink = typeof links.$inferInsert;
export type Click = typeof clicks.$inferSelect;
export type NewClick = typeof clicks.$inferInsert;
export type Metric = typeof metrics.$inferSelect;
export type NewMetric = typeof metrics.$inferInsert;
export type Conversion = typeof conversions.$inferSelect;
export type NewConversion = typeof conversions.$inferInsert;
export type ContentCalendarItem = typeof contentCalendar.$inferSelect;
export type NewContentCalendarItem = typeof contentCalendar.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
