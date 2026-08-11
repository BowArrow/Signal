import { z } from 'zod';

/**
 * The shape of signal.config.ts. Everything here is validated at boot and the
 * process exits on a violation — a half-configured marketing system posting to
 * real communities is worse than one that refuses to start.
 */

export const scoringWeightsSchema = z
  .object({
    /**
     * Can I add real technical substance here (benchmarks, architecture
     * detail, a hard-won gotcha) independent of the product? This is the axis
     * that reflects what actually works, so it carries the most weight.
     */
    contribution: z.number().min(0).max(1),
    /** Is this person actively trying to solve a problem a product solves? */
    intent: z.number().min(0).max(1),
    /** Semantic match against one product's positioning. */
    fit: z.number().min(0).max(1),
    /** Community rules, thread age, karma requirements. Subtracts. */
    risk: z.number().min(0).max(1),
  })
  .strict()
  .refine((w) => w.contribution >= w.intent && w.contribution >= w.fit, {
    message:
      'scoring.weights.contribution must be the largest positive weight. ' +
      'Contribution-led posting is the thing that has actually worked; if you ' +
      'want to demote it, change this refinement deliberately.',
  });

export const scoringSchema = z
  .object({
    weights: scoringWeightsSchema,
    /** Below this total, the opportunity auto-expires and is never shown. */
    threshold: z.number().min(0).max(1),
    /** Opportunities older than this are not worth replying to. */
    maxThreadAgeHours: z.number().int().positive(),
    /** Opportunities stay in the DB this long before being pruned. */
    retentionDays: z.number().int().positive(),
  })
  .strict();

export const publishLimitsSchema = z
  .object({
    /** Hard cap on replies per platform per calendar day (local time). */
    maxRepliesPerPlatformPerDay: z.number().int().min(1).max(50),
    /** Minimum days between two posts by me in the same community. */
    communityCooldownDays: z.number().int().min(0).max(365),
    /**
     * My promotional posts must stay under this share of my total activity in
     * a given community, as a percentage.
     */
    selfPromoRatioMaxPct: z.number().min(1).max(100),
    /** How many recent posts the ratio is computed over. */
    selfPromoRatioWindow: z.number().int().min(5).max(500),
  })
  .strict();

export const sourceKindSchema = z.enum([
  'reddit',
  'reddit_search',
  'hn',
  'rss',
  'stackexchange',
  'discourse',
  'github',
  'lobsters',
  'discord',
  'x',
]);
export type SourceKind = z.infer<typeof sourceKindSchema>;

export const sourceConfigSchema = z
  .object({
    kind: sourceKindSchema,
    /** Subreddit name without the r/, HN query string, or feed URL. */
    identifier: z.string().min(1),
    displayName: z.string().min(1),
    pollIntervalSeconds: z.number().int().min(60),
    enabled: z.boolean().default(true),
    /**
     * Fetch this source even where robots.txt disallows it.
     *
     * There is deliberately no global switch for this — `http.respectRobotsTxt`
     * is still typed as the literal true. The exemption has to be named per
     * source, it is logged at boot, and `signal status` lists every source
     * carrying it. The point is that turning it on is a visible, deliberate
     * act rather than a config flag someone flips and forgets.
     *
     * Requires `robotsExemptionReason`, so the record says why.
     */
    ignoreRobotsTxt: z.boolean().default(false),
    robotsExemptionReason: z.string().min(10).optional(),
    /**
     * Overrides scoring.maxThreadAgeHours for this source.
     *
     * Platforms have very different half-lives. A three-day-old Reddit thread
     * is a graveyard, but a Stack Exchange question with no accepted answer is
     * worth answering months later and stays useful to everyone who finds it
     * afterwards. One global cutoff silently discards the second kind.
     */
    maxItemAgeHours: z.number().int().positive().optional(),
  })
  .strict()
  .refine((s) => !s.ignoreRobotsTxt || s.robotsExemptionReason != null, {
    message:
      'a source with ignoreRobotsTxt must also carry robotsExemptionReason — ' +
      'if the exemption is worth taking it is worth writing down why',
    path: ['robotsExemptionReason'],
  });

export const productConfigSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9-]+$/, 'product key must be lowercase kebab-case'),
    name: z.string().min(1),
    positioning: z.string().min(1),
    targetBuyer: z.string().min(1),
    priceCents: z.number().int().min(0),
    currency: z.string().length(3),
    proofPoints: z.array(z.string()),
    /** Where a tracked link ultimately lands. UTM params are appended here. */
    utmBase: z.string().url(),
    links: z.record(z.string(), z.string().url()).default({}),
  })
  .strict();

/**
 * The three jobs a model does here. Kept separate because they fail
 * differently: a bad classification wastes a slot in the queue, a bad draft
 * wastes a review, and a bad rules reading gets the account banned.
 */
export const llmTaskSchema = z.enum(['classify', 'draft', 'interpret-rules']);
export type LlmTask = z.infer<typeof llmTaskSchema>;

export const llmSchema = z
  .object({
    /**
     * `anthropic` uses the SDK. `openai-compatible` is the de facto standard
     * spoken by llama.cpp's server, vLLM, LM Studio and Ollama's compat
     * endpoint — which is how a local model gets used here.
     */
    provider: z.enum(['anthropic', 'openai-compatible']),
    /** Required for openai-compatible. Ignored by the Anthropic provider. */
    baseUrl: z.string().url().optional(),
    /** Per task, so one can move to a local model without moving all three. */
    models: z
      .object({
        classify: z.string().min(1),
        draft: z.string().min(1),
        'interpret-rules': z.string().min(1),
      })
      .strict(),
    maxOutputTokens: z.number().int().positive(),
    /** A local model on a big context can be slow. Give it room. */
    requestTimeoutMs: z.number().int().positive().default(120_000),
  })
  .strict()
  .refine((c) => c.provider !== 'openai-compatible' || c.baseUrl != null, {
    message: 'provider "openai-compatible" needs a baseUrl, e.g. http://localhost:8080/v1',
    path: ['baseUrl'],
  });

export const httpSchema = z
  .object({
    /**
     * Reddit requires a descriptive, unique User-Agent. Anonymous or
     * impersonating agents get rate-limited hard or blocked outright.
     */
    userAgent: z.string().min(10),
    /** Minimum milliseconds between requests to the same host. */
    minRequestIntervalMs: z.number().int().min(0),
    requestTimeoutMs: z.number().int().positive(),
    maxRetries: z.number().int().min(0).max(10),
    /** Honor robots.txt on anything that is not an official API. */
    respectRobotsTxt: z.literal(true),
  })
  .strict();

export const attributionSchema = z
  .object({
    /** Last-touch window. A click older than this attributes nothing. */
    windowDays: z.number().int().min(1).max(365),
    /** Public origin serving /r/:linkId. Must be reachable from anywhere. */
    trackingOrigin: z.string().url(),
  })
  .strict();

export const signalConfigSchema = z
  .object({
    /** SQLite file path, or a postgres:// URL once you outgrow one machine. */
    databaseUrl: z.string().min(1),
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    timezone: z.string().min(1),
    scoring: scoringSchema,
    publishLimits: publishLimitsSchema,
    products: z.array(productConfigSchema).min(1),
    sources: z.array(sourceConfigSchema),
    llm: llmSchema,
    http: httpSchema,
    attribution: attributionSchema,
  })
  .strict()
  .superRefine((cfg, ctx) => {
    const productKeys = new Set<string>();
    for (const p of cfg.products) {
      if (productKeys.has(p.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['products'],
          message: `duplicate product key "${p.key}"`,
        });
      }
      productKeys.add(p.key);
    }

    const sourceKeys = new Set<string>();
    for (const s of cfg.sources) {
      const key = `${s.kind}:${s.identifier}`;
      if (sourceKeys.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sources'],
          message: `duplicate source "${key}"`,
        });
      }
      sourceKeys.add(key);
    }
  });

/** The validated, defaults-applied shape everything downstream consumes. */
export type SignalConfig = z.infer<typeof signalConfigSchema>;

/**
 * What signal.config.ts is written against: the same shape, but with
 * defaulted fields optional. Authoring against the output type would force
 * every source to spell out `ignoreRobotsTxt: false`, which is noise that
 * makes the handful of real exemptions harder to spot.
 */
export type SignalConfigInput = z.input<typeof signalConfigSchema>;
export type ProductConfig = z.infer<typeof productConfigSchema>;
export type SourceConfig = z.infer<typeof sourceConfigSchema>;
export type ScoringWeights = z.infer<typeof scoringWeightsSchema>;
export type PublishLimits = z.infer<typeof publishLimitsSchema>;
