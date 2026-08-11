import { z } from 'zod';

/**
 * Secrets live here, in .env — never in signal.config.ts, which is committed.
 *
 * Every credential is optional so the whole engine runs offline against
 * fixtures. What a missing credential does is disable one capability loudly,
 * not fail at boot: you should be able to run ingestion tests on a laptop with
 * no keys and get a clear message about which pollers stayed dark.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    /** Overrides signal.config.ts databaseUrl. Useful for tests and Docker. */
    SIGNAL_DATABASE_URL: z.string().min(1).optional(),

    // — Models —
    ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-').optional(),
    /**
     * Bearer token for an openai-compatible server. Usually unset: a local
     * runtime does not want one, and some reject the header outright.
     */
    LLM_API_KEY: z.string().min(1).optional(),

    // — Reddit: a "script" type app registered at reddit.com/prefs/apps —
    REDDIT_CLIENT_ID: z.string().min(1).optional(),
    REDDIT_CLIENT_SECRET: z.string().min(1).optional(),
    /** The one identity. There is deliberately no support for a second. */
    REDDIT_USERNAME: z.string().min(1).optional(),
    REDDIT_PASSWORD: z.string().min(1).optional(),

    // — Optional source credentials —
    /** Raises the Stack Exchange quota from 300/day to 10,000. Not required. */
    STACKEXCHANGE_KEY: z.string().min(1).optional(),
    /** Raises GitHub search from 10 to 30 requests a minute. Not required. */
    GITHUB_TOKEN: z.string().min(1).optional(),

    // — Stripe (Phase 4) —
    STRIPE_SECRET_KEY: z.string().min(1).optional(),
    STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),

    // — Firebase edge (Phase 4): pulling clicks and conversions back down —
    SIGNAL_EDGE_PROJECT_ID: z.string().min(1).optional(),
    SIGNAL_EDGE_PULL_TOKEN: z.string().min(1).optional(),
    /** Passphrase for the encrypted SQLite backup pushed to Cloud Storage. */
    SIGNAL_BACKUP_PASSPHRASE: z.string().min(16).optional(),

    /**
     * Set to "1" to make every outbound network call fail instead of hitting a
     * real API. Tests set this; you can set it while tuning prompts.
     */
    SIGNAL_OFFLINE: z.enum(['0', '1']).default('0'),
  })
  .passthrough();

export type Env = z.infer<typeof envSchema>;

export interface Capability {
  readonly name: string;
  readonly available: boolean;
  readonly missing: readonly string[];
}

/**
 * What the process can actually do given the credentials present. The CLI and
 * the Electron window both print this so a dark poller is never a mystery.
 */
export function capabilities(env: Env): Capability[] {
  const need = (name: string, keys: (keyof Env)[]): Capability => {
    const missing = keys.filter((k) => env[k] == null).map(String);
    return { name, available: missing.length === 0, missing };
  };

  return [
    need('reddit:read', ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET']),
    need('reddit:publish', [
      'REDDIT_CLIENT_ID',
      'REDDIT_CLIENT_SECRET',
      'REDDIT_USERNAME',
      'REDDIT_PASSWORD',
    ]),
    // Hacker News ingestion uses the public Algolia search API, which needs no
    // key. Publishing to HN is not a capability and never will be.
    { name: 'hn:read', available: true, missing: [] },
    { name: 'rss:read', available: true, missing: [] },
    need('llm:score', ['ANTHROPIC_API_KEY']),
    need('llm:draft', ['ANTHROPIC_API_KEY']),
    need('stripe:webhook', ['STRIPE_WEBHOOK_SECRET']),
    need('edge:pull', ['SIGNAL_EDGE_PROJECT_ID', 'SIGNAL_EDGE_PULL_TOKEN']),
    need('backup:encrypt', ['SIGNAL_BACKUP_PASSPHRASE']),
  ];
}

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment:\n${detail}`);
  }
  return parsed.data;
}
