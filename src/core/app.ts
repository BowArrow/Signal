import { loadConfig, type LoadedConfig } from './config/load.js';
import { capabilities, type Capability } from './config/env.js';
import { openDatabase, type DbHandle } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { createLogger, type Logger } from './lib/logger.js';
import { HttpClient } from './lib/http.js';
import { systemClock, type Clock } from './lib/clock.js';
import { RedditClient, RedditPoller } from './ingest/reddit.js';
import { RedditSearchPoller } from './ingest/reddit-search.js';
import { RedditScrapeClient } from './ingest/reddit-scrape.js';
import { RedditPublicPoller, RedditPublicSearchPoller } from './ingest/reddit-public.js';
import { HackerNewsPoller } from './ingest/hackernews.js';
import { RssPoller } from './ingest/rss.js';
import type { Poller } from './ingest/types.js';
import { AnthropicClient, type LlmClient } from './llm/client.js';
import { OpenAiCompatibleClient } from './llm/openai-compatible.js';
import { RecordingLlmClient } from './llm/recording.js';
import {
  HackerNewsRulesFetcher,
  RedditRulesFetcher,
  RedditScrapeRulesFetcher,
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
  /** Present whether or not it is in use, so jobs can reach it. */
  readonly redditScraper: RedditScrapeClient;
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

  // Reddit's Data API is gated behind a discretionary approval and every
  // unauthenticated JSON endpoint returns 403. Where credentials exist the
  // API client is used; otherwise the public HTML path takes over, and only
  // for sources carrying a named robots exemption.
  const scrapeClient = new RedditScrapeClient(http, logger.child({ mod: 'reddit-public' }));

  const pollers: Poller[] = redditClient
    ? [
        new RedditPoller(redditClient, logger.child({ mod: 'reddit' })),
        new RedditSearchPoller(redditClient, logger.child({ mod: 'discover' })),
      ]
    : [
        new RedditPublicPoller(scrapeClient, logger.child({ mod: 'reddit-public' })),
        new RedditPublicSearchPoller(scrapeClient, logger.child({ mod: 'discover' })),
      ];

  pollers.push(
    new HackerNewsPoller(http, logger.child({ mod: 'hn' }), {
      maxAgeHours: config.scoring.maxThreadAgeHours,
    }),
    new RssPoller(http, logger.child({ mod: 'rss' })),
  );

  // One provider, chosen in config. Every call is recorded either way, which
  // is what makes swapping between them a measured decision rather than a
  // preference.
  const offline = env.SIGNAL_OFFLINE === '1';
  const baseLlm: LlmClient =
    config.llm.provider === 'openai-compatible'
      ? new OpenAiCompatibleClient(config.llm.baseUrl ?? '', logger.child({ mod: 'llm' }), {
          apiKey: env.LLM_API_KEY,
          timeoutMs: config.llm.requestTimeoutMs,
          offline,
        })
      : new AnthropicClient(env.ANTHROPIC_API_KEY, logger.child({ mod: 'llm' }), offline);

  const llm = new RecordingLlmClient(baseLlm, dbHandle.db, config.llm.provider, clock);

  const rulesFetchers = new Map<string, RulesFetcher>([
    [
      'reddit',
      // Same source of truth either way: the community's own published rules.
      redditClient
        ? new RedditRulesFetcher(redditClient)
        : new RedditScrapeRulesFetcher(scrapeClient),
    ],
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
    redditScraper: scrapeClient,
    llm,
    rulesFetchers,
    capabilities: capabilities(env),
    close: () => dbHandle.close(),
  };
}
