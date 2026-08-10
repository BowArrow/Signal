import { loadConfig, type LoadedConfig } from './config/load.js';
import { capabilities, type Capability } from './config/env.js';
import { openDatabase, type DbHandle } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { createLogger, type Logger } from './lib/logger.js';
import { HttpClient } from './lib/http.js';
import { systemClock, type Clock } from './lib/clock.js';
import { RedditClient, RedditPoller } from './ingest/reddit.js';
import { RedditSearchPoller } from './ingest/reddit-search.js';
import { HackerNewsPoller } from './ingest/hackernews.js';
import { RssPoller } from './ingest/rss.js';
import type { Poller } from './ingest/types.js';
import { AnthropicClient, type LlmClient } from './llm/client.js';
import {
  HackerNewsRulesFetcher,
  RedditRulesFetcher,
  type RulesFetcher,
} from './rules/fetch.js';

/**
 * One place that builds the whole engine from config. The CLI and the Electron
 * main process both call this, so there is exactly one wiring diagram and no
 * chance of the two diverging.
 */
export interface App {
  readonly config: LoadedConfig['config'];
  readonly env: LoadedConfig['env'];
  readonly db: DbHandle['db'];
  readonly dbHandle: DbHandle;
  readonly logger: Logger;
  readonly http: HttpClient;
  readonly clock: Clock;
  readonly pollers: Poller[];
  readonly llm: LlmClient;
  readonly rulesFetchers: Map<string, RulesFetcher>;
  readonly capabilities: Capability[];
  close(): void;
}

export interface CreateAppOptions {
  /** Overrides signal.config.ts and SIGNAL_DATABASE_URL. Tests use this. */
  readonly databaseUrl?: string;
  readonly migrate?: boolean;
  readonly clock?: Clock;
  readonly logger?: Logger;
}

export function createApp(options: CreateAppOptions = {}): App {
  const { config, env } = loadConfig();
  const logger = options.logger ?? createLogger(config.logLevel);
  const clock = options.clock ?? systemClock;

  const dbHandle = openDatabase(options.databaseUrl ?? config.databaseUrl);
  if (options.migrate !== false) {
    runMigrations(dbHandle.db);
  }

  const http = new HttpClient(
    config.http,
    logger.child({ mod: 'http' }),
    fetch,
    env.SIGNAL_OFFLINE === '1',
  );

  // A poller with no credentials is constructed anyway and reports itself as
  // unavailable. The alternative — omitting it — makes a dark source look like
  // a configuration error instead of a missing key.
  const redditClient =
    env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET
      ? new RedditClient(
          http,
          {
            clientId: env.REDDIT_CLIENT_ID,
            clientSecret: env.REDDIT_CLIENT_SECRET,
            username: env.REDDIT_USERNAME,
            password: env.REDDIT_PASSWORD,
          },
          logger.child({ mod: 'reddit' }),
        )
      : null;

  const pollers: Poller[] = [
    new RedditPoller(redditClient, logger.child({ mod: 'reddit' })),
    new RedditSearchPoller(redditClient, logger.child({ mod: 'discover' })),
    new HackerNewsPoller(http, logger.child({ mod: 'hn' }), {
      maxAgeHours: config.scoring.maxThreadAgeHours,
    }),
    new RssPoller(http, logger.child({ mod: 'rss' })),
  ];

  const llm = new AnthropicClient(
    env.ANTHROPIC_API_KEY,
    logger.child({ mod: 'llm' }),
    env.SIGNAL_OFFLINE === '1',
  );

  const rulesFetchers = new Map<string, RulesFetcher>([
    ['reddit', new RedditRulesFetcher(redditClient)],
    ['hn', new HackerNewsRulesFetcher()],
  ]);

  return {
    config,
    env,
    db: dbHandle.db,
    dbHandle,
    logger,
    http,
    clock,
    pollers,
    llm,
    rulesFetchers,
    capabilities: capabilities(env),
    close: () => dbHandle.close(),
  };
}
