import type { SignalConfigInput } from './src/core/config/schema.js';

/**
 * The one config file. Validated with Zod at boot; the process exits on a
 * violation. Secrets do not live here — they live in .env. This file is
 * committed, so treat everything in it as public.
 */
/**
 * Why Reddit is read from public pages rather than its API.
 *
 * Stated once, referenced by every Reddit source, and printed at every
 * seed. An exemption nobody is reminded of is one nobody reconsiders.
 */
const REDDIT_EXEMPTION =
  'Reddit gated its Data API behind discretionary approval and 403s every unauthenticated JSON endpoint. Casey chose to read public HTML instead, knowingly and against the ToS guardrail in his own original spec. Paced at 4s between requests.';

const config: SignalConfigInput = {
  // A single file, easy to back up. Swap to a postgres:// URL and the Drizzle
  // layer changes dialect without a schema rewrite.
  databaseUrl: 'file:./data/signal.db',
  logLevel: 'info',
  timezone: 'America/New_York',

  scoring: {
    weights: {
      // Contribution carries the most weight on purpose. A post with real
      // benchmark data has outperformed a launch post by an order of
      // magnitude, so the scorer optimizes for "can I actually help here"
      // rather than "can I mention a product here".
      contribution: 0.4,
      intent: 0.25,
      fit: 0.25,
      risk: 0.1,
    },
    threshold: 0.55,
    // A thread older than three days is a graveyard. Replying there costs an
    // LLM call and buys nothing.
    maxThreadAgeHours: 72,
    retentionDays: 90,
  },

  publishLimits: {
    maxRepliesPerPlatformPerDay: 6,
    communityCooldownDays: 7,
    selfPromoRatioMaxPct: 10,
    selfPromoRatioWindow: 30,
  },

  products: [
    {
      key: 'lemonade',
      name: 'Lemonade',
      positioning:
        'Privacy-first local AI desktop assistant. Ollama-powered, zero telemetry, ' +
        'runs fully offline. No account, no cloud round-trip, works with the network off.',
      targetBuyer:
        'People who already run local models, are privacy-motivated, or are blocked ' +
        'from cloud AI by employer policy.',
      priceCents: 4900,
      currency: 'USD',
      proofPoints: [
        'One-time $49, no subscription',
        'Zero telemetry — no socket opens that you did not ask for',
        'Works with the network interface down',
        'Sits on top of an existing Ollama install rather than bundling its own runtime',
      ],
      // Tracked links are built from this, so a wrong value breaks attribution
      // silently rather than loudly.
      utmBase: 'https://siplemona.de',
      links: {},
    },
    {
      key: 'cinegen',
      name: 'CineGen',
      positioning:
        'AI video production platform. 3D Gaussian splat rendering with audio-reactive ' +
        'effects, aimed at people producing music videos and visualizers.',
      targetBuyer: 'Music video and visualizer creators, indie artists.',
      priceCents: 0,
      currency: 'USD',
      proofPoints: [
        '3D Gaussian splat rendering',
        'Audio-reactive parameter drives',
      ],
      utmBase: 'https://cinegenaimedia.com',
      links: {},
    },
  ],

  sources: [
    // Poll intervals are deliberately unequal. A fast-moving sub where a good
    // answer has to land early is worth checking often; a slow one is not.
    { kind: 'reddit', identifier: 'LocalLLaMA', displayName: 'r/LocalLLaMA', pollIntervalSeconds: 900, enabled: true, ignoreRobotsTxt: true, robotsExemptionReason: REDDIT_EXEMPTION },
    { kind: 'reddit', identifier: 'ollama', displayName: 'r/ollama', pollIntervalSeconds: 1800, enabled: true, ignoreRobotsTxt: true, robotsExemptionReason: REDDIT_EXEMPTION },
    { kind: 'reddit', identifier: 'privacy', displayName: 'r/privacy', pollIntervalSeconds: 1800, enabled: true, ignoreRobotsTxt: true, robotsExemptionReason: REDDIT_EXEMPTION },
    { kind: 'reddit', identifier: 'selfhosted', displayName: 'r/selfhosted', pollIntervalSeconds: 1800, enabled: true, ignoreRobotsTxt: true, robotsExemptionReason: REDDIT_EXEMPTION },
    { kind: 'reddit', identifier: 'generative', displayName: 'r/generative', pollIntervalSeconds: 3600, enabled: true, ignoreRobotsTxt: true, robotsExemptionReason: REDDIT_EXEMPTION },
    { kind: 'reddit', identifier: 'SideProject', displayName: 'r/SideProject', pollIntervalSeconds: 21600, enabled: true, ignoreRobotsTxt: true, robotsExemptionReason: REDDIT_EXEMPTION },
    // Discovery. These search all of Reddit rather than one subreddit, so they
    // turn up threads in communities that are not listed above — which is the
    // point. Anything they find is held at rules_unknown until that
    // community's rules have been fetched and read.
    { kind: 'reddit_search', identifier: '"local llm" self:yes', displayName: 'Discover · local llm', pollIntervalSeconds: 1800, enabled: true, ignoreRobotsTxt: true, robotsExemptionReason: REDDIT_EXEMPTION },
    { kind: 'reddit_search', identifier: 'ollama help self:yes', displayName: 'Discover · ollama help', pollIntervalSeconds: 1800, enabled: true, ignoreRobotsTxt: true, robotsExemptionReason: REDDIT_EXEMPTION },
    { kind: 'reddit_search', identifier: '"offline ai" OR "runs offline" self:yes', displayName: 'Discover · offline ai', pollIntervalSeconds: 3600, enabled: true, ignoreRobotsTxt: true, robotsExemptionReason: REDDIT_EXEMPTION },
    { kind: 'reddit_search', identifier: '"blocks chatgpt" OR "cant use chatgpt at work" self:yes', displayName: 'Discover · blocked at work', pollIntervalSeconds: 3600, enabled: true, ignoreRobotsTxt: true, robotsExemptionReason: REDDIT_EXEMPTION },

    // Read-only via the Algolia search API. There is no publish path for HN
    // and there will not be one.
    //
    // One precise phrase per source. Algolia's `query` is full-text relevance,
    // not boolean — "a OR b" matches documents containing the word "or", which
    // is how you end up ingesting two-year-old threads about nothing.
    { kind: 'hn', identifier: '"local llm"', displayName: 'Hacker News · local llm', pollIntervalSeconds: 600, enabled: true },
    { kind: 'hn', identifier: 'ollama', displayName: 'Hacker News · ollama', pollIntervalSeconds: 600, enabled: true },
    { kind: 'hn', identifier: '"gaussian splatting"', displayName: 'Hacker News · splats', pollIntervalSeconds: 3600, enabled: true },
    { kind: 'hn', identifier: '"audio reactive"', displayName: 'Hacker News · audio reactive', pollIntervalSeconds: 3600, enabled: true },
  ],

  llm: {
    // Point this at the Lemonade runtime serving Glimmer. Any server speaking
    // the OpenAI chat-completions shape works — llama.cpp's llama-server,
    // vLLM, LM Studio, Ollama's compat endpoint.
    //
    // Switch to 'anthropic' and drop baseUrl to go back to the hosted models;
    // every call is recorded either way, so `signal llm stats` compares them
    // on latency, tokens and JSON compliance rather than on impressions.
    provider: 'openai-compatible',
    baseUrl: 'http://localhost:8080/v1',
    models: {
      // Whatever name the server reports. `signal llm check` lists them.
      classify: 'muse-glimmer-30b',
      draft: 'muse-glimmer-30b',
      'interpret-rules': 'muse-glimmer-30b',
    },
    maxOutputTokens: 2048,
    // A 30B on local hardware is far slower than a hosted API, and a drafting
    // call with the whole voice file in context is not a quick one.
    requestTimeoutMs: 180_000,
  },

  http: {
    // Reddit wants a descriptive, unique agent. A generic or spoofed one gets
    // throttled hard.
    userAgent: 'windows:com.aionx.signal:v0.1.0 (by /u/OutdatedMemeKing)',
    minRequestIntervalMs: 1200,
    requestTimeoutMs: 15_000,
    maxRetries: 3,
    respectRobotsTxt: true,
  },

  attribution: {
    windowDays: 30,
    // Firebase Hosting on signal-edge-aionx. Swap for a custom domain later —
    // a link already in the wild keeps working because the redirect record
    // lives server-side, not in the URL.
    trackingOrigin: 'https://signal-edge-aionx.web.app',
  },
};

export default config;
