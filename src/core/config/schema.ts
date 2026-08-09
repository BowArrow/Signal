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

export const sourceKindSchema = z.enum(['reddit', 'hn', 'rss', 'discord', 'x']);
export type SourceKind = z.infer<typeof sourceKindSchema>;

export const sourceConfigSchema = z
  .object({
    kind: sourceKindSchema,
    /** Subreddit name without the r/, HN query string, or feed URL. */
    identifier: z.string().min(1),
    displayName: z.string().min(1),
    pollIntervalSeconds: z.number().int().min(60),
    enabled: z.boolean().default(true),
  })
  .strict();

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

export const anthropicSchema = z
  .object({
    /** Drafting model. Quality matters more than cost on this call. */
    draftModel: z.string().min(1),
    /** Scoring classifier. Runs on every opportunity, so cost matters. */
    classifierModel: z.string().min(1),
    maxOutputTokens: z.number().int().positive(),
  })
  .strict();

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
    anthropic: anthropicSchema,
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

export type SignalConfig = z.infer<typeof signalConfigSchema>;
export type ProductConfig = z.infer<typeof productConfigSchema>;
export type SourceConfig = z.infer<typeof sourceConfigSchema>;
export type ScoringWeights = z.infer<typeof scoringWeightsSchema>;
export type PublishLimits = z.infer<typeof publishLimitsSchema>;
