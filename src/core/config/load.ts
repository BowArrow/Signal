import { config as loadDotenv } from 'dotenv';
// Static, not dynamic: the bundler needs to see this edge so signal.config.ts
// ends up inside the packaged Electron main bundle.
import rawConfig from '../../../signal.config.js';
import { signalConfigSchema, type SignalConfig } from './schema.js';
import { loadEnv, type Env } from './env.js';

export interface LoadedConfig {
  readonly config: SignalConfig;
  readonly env: Env;
}

let cached: LoadedConfig | null = null;

/**
 * Formats a Zod failure as something you can act on at 2am, rather than a
 * stack trace. Config problems are the most common way this system breaks and
 * the cheapest to make legible.
 */
function formatIssues(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues
    .map((i) => `  signal.config.ts → ${i.path.map(String).join('.') || '(root)'}\n      ${i.message}`)
    .join('\n');
}

export function validateConfig(raw: unknown): SignalConfig {
  const parsed = signalConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Signal refused to start: signal.config.ts is invalid.\n${formatIssues(parsed.error.issues)}`,
    );
  }
  return parsed.data;
}

/**
 * Validates signal.config.ts and .env, then caches the result. Throws on
 * anything invalid. Nothing else in the system reads process.env directly.
 */
export function loadConfig(options: { reload?: boolean } = {}): LoadedConfig {
  if (cached && !options.reload) return cached;

  loadDotenv({ quiet: true });
  const env = loadEnv();
  const config = validateConfig(rawConfig);

  // The env override wins so Docker and tests can point at another database
  // file without editing committed config.
  const resolved: SignalConfig = env.SIGNAL_DATABASE_URL
    ? { ...config, databaseUrl: env.SIGNAL_DATABASE_URL }
    : config;

  cached = { config: resolved, env };
  return cached;
}

/** Test helper. Never call this from application code. */
export function __setConfigForTests(loaded: LoadedConfig | null): void {
  cached = loaded;
}
