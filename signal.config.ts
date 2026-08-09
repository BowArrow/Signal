import type { SignalConfig } from './src/core/config/schema.js';

/**
 * The one config file. Validated with Zod at boot; the process exits on a
 * violation. Secrets do not live here — they live in .env. This file is
 * committed, so treat everything in it as public.
 */
const config: SignalConfig = {
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
      // TODO(casey): replace with the real Lemonade domain before Phase 3.
      // Tracked links are built from this, so a wrong value breaks attribution
      // silently rather than loudly.
      utmBase: 'https://example.invalid/lemonade',
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
      // TODO(casey): real domain.
      utmBase: 'https://example.invalid/cinegen',
      links: {},
    },
    {
      key: 'sunshore',
      name: 'Sunshore',
      positioning:
        'AI agents for business automation. Self-hostable, aimed at ops workflows that ' +
        'small teams currently do by hand.',
      targetBuyer: 'SMB operations teams.',
      priceCents: 0,
      currency: 'USD',
      proofPoints: ['Self-hosted deployment supported'],
      // TODO(casey): real domain.
      utmBase: 'https://example.invalid/sunshore',
      links: {},
    },
  ],

  sources: [
    // Poll intervals are deliberately unequal. A fast-moving sub where a good
    // answer has to land early is worth checking often; a slow one is not.
    { kind: 'reddit', identifier: 'LocalLLaMA', displayName: 'r/LocalLLaMA', pollIntervalSeconds: 900, enabled: true },
    { kind: 'reddit', identifier: 'ollama', displayName: 'r/ollama', pollIntervalSeconds: 1800, enabled: true },
    { kind: 'reddit', identifier: 'privacy', displayName: 'r/privacy', pollIntervalSeconds: 1800, enabled: true },
    { kind: 'reddit', identifier: 'selfhosted', displayName: 'r/selfhosted', pollIntervalSeconds: 1800, enabled: true },
    { kind: 'reddit', identifier: 'generative', displayName: 'r/generative', pollIntervalSeconds: 3600, enabled: true },
    { kind: 'reddit', identifier: 'SideProject', displayName: 'r/SideProject', pollIntervalSeconds: 21600, enabled: true },
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

  anthropic: {
    draftModel: 'claude-sonnet-5',
    // Runs on every ingested item, so it needs to be cheap.
    classifierModel: 'claude-haiku-4-5-20251001',
    maxOutputTokens: 2048,
  },

  http: {
    // Reddit wants a descriptive, unique agent. A generic or spoofed one gets
    // throttled hard.
    userAgent: 'windows:com.aionx.signal:v0.1.0 (by /u/CHANGE_ME)',
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
