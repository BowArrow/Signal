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
      salesSenderEmail: 'sales@aionx.aionapp.org',
      positioning:
        'Private local AI desktop assistant for Windows 11 and Linux. Works with local files, ' +
        'screen captures and document creation. Installs and manages Ollama and models. ' +
        'Local inference works offline after setup; approved web/mail tools and licensing use the network.',
      targetBuyer:
        'Small-business owners, solo professionals and individual customers on Windows 11 or Linux ' +
        'who repeatedly read, compare or draft documents and want local AI processing. Start with ' +
        'one person and one useful document task; validate the need and hardware fit. Do not imply ' +
        'a shared team license, hosted service or enterprise deployment. Confirm workplace permission.',
      priceCents: 4900,
      currency: 'USD',
      proofPoints: [
        'Public website checked 2026-09-13: $49 perpetual license and a 14-day no-card trial',
        'Public website states no behavioral telemetry or cloud inference upload; downloads, licensing and optional approved network tools still use the network',
        'Public website states local inference works offline once models are downloaded',
        'Lemonade installs and manages Ollama and models; an existing Ollama install is not required',
        'Public website describes local file answers, screen capture, and PDF, Word, PowerPoint and Excel creation; demonstrate actual behavior before making comparative performance claims',
      ],
      // Tracked links are built from this, so a wrong value breaks attribution
      // silently rather than loudly.
      utmBase: 'https://siplemona.de',
      links: {},
    },
    {
      key: 'cinegen',
      name: 'CineGen',
      salesSenderEmail: 'sales@outreach.cinegenaimedia.com',
      positioning:
        'Browser-based AI video production workspace: storyboarding, character creation, ' +
        'video generation, timeline editing and collaborative review. The 3D scene creator is in beta.',
      targetBuyer: 'Independent video creators, small studios and teams making shorts, explainers and promotional videos.',
      priceCents: 0,
      currency: 'USD',
      proofPoints: [
        'Multi-track browser timeline with keyframes and export',
        'AI storyboarding and reusable characters',
        'Shareable collaborative review links',
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
    //
    // One quoted phrase per source, and no OR. Reddit's search scores loosely
    // rather than evaluating booleans, so `"a" OR "b"` matched almost
    // anything and dragged in r/MahjongArena, r/Mcat and r/palindromes. Every
    // search platform here has now made the same mistake look different.
    { kind: 'reddit_search', identifier: '"local llm" self:yes', displayName: 'Discover · local llm', pollIntervalSeconds: 1800, enabled: true, ignoreRobotsTxt: true, robotsExemptionReason: REDDIT_EXEMPTION },
    { kind: 'reddit_search', identifier: '"runs locally" llm self:yes', displayName: 'Discover · runs locally', pollIntervalSeconds: 1800, enabled: true, ignoreRobotsTxt: true, robotsExemptionReason: REDDIT_EXEMPTION },
    { kind: 'reddit_search', identifier: '"offline ai" self:yes', displayName: 'Discover · offline ai', pollIntervalSeconds: 3600, enabled: true, ignoreRobotsTxt: true, robotsExemptionReason: REDDIT_EXEMPTION },
    { kind: 'reddit_search', identifier: '"blocks chatgpt" self:yes', displayName: 'Discover · blocked at work', pollIntervalSeconds: 3600, enabled: true, ignoreRobotsTxt: true, robotsExemptionReason: REDDIT_EXEMPTION },
    { kind: 'reddit_search', identifier: '"privacy focused" assistant self:yes', displayName: 'Discover · privacy assistant', pollIntervalSeconds: 3600, enabled: true, ignoreRobotsTxt: true, robotsExemptionReason: REDDIT_EXEMPTION },

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

    // Open, documented APIs with no approval gate. Added deliberately after
    // Reddit's turned out to be one — a system whose critical path depends on
    // one company's discretion is a system with a single point of failure.
    //
    // Stack Exchange: `site:query`. Each site is its own community.
    { kind: 'stackexchange', identifier: 'superuser:ollama', displayName: 'Super User · ollama', pollIntervalSeconds: 3600, enabled: true, maxItemAgeHours: 2160 },
    { kind: 'stackexchange', identifier: 'superuser:local llm', displayName: 'Super User · local llm', pollIntervalSeconds: 3600, enabled: true, maxItemAgeHours: 2160 },
    { kind: 'stackexchange', identifier: 'askubuntu:ollama', displayName: 'Ask Ubuntu · ollama', pollIntervalSeconds: 7200, enabled: true, maxItemAgeHours: 2160 },
    { kind: 'stackexchange', identifier: 'unix:llama.cpp', displayName: 'Unix & Linux · llama.cpp', pollIntervalSeconds: 7200, enabled: true, maxItemAgeHours: 2160 },

    // Discourse: the identifier is the forum, optionally #category=<slug>.
    { kind: 'discourse', identifier: 'https://discuss.huggingface.co', displayName: 'HuggingFace forums', pollIntervalSeconds: 3600, enabled: true, maxItemAgeHours: 336 },

    // GitHub: the identifier is a search query. Each repo is its own community,
    // because maintainers differ wildly on tolerating a third party turning up.
    { kind: 'github', identifier: 'is:issue is:open "run offline" llm', displayName: 'GitHub · offline llm', pollIntervalSeconds: 3600, enabled: true, maxItemAgeHours: 720 },
    { kind: 'github', identifier: 'repo:ollama/ollama is:issue is:open desktop OR gui', displayName: 'GitHub · ollama ui', pollIntervalSeconds: 3600, enabled: true, maxItemAgeHours: 720 },

    // Lobsters: `newest`, or a tag.
    { kind: 'lobsters', identifier: 'ai', displayName: 'Lobsters · ai', pollIntervalSeconds: 7200, enabled: true, maxItemAgeHours: 168 },
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
