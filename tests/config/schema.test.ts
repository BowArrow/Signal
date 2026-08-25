import { describe, expect, it } from 'vitest';
import { validateConfig } from '../../src/core/config/load.js';
import { capabilities, loadEnv } from '../../src/core/config/env.js';
import baseConfig from '../../signal.config.js';

type Draft = Record<string, unknown>;

/** A clone so a test mutation cannot leak into the next test. */
function withConfig(mutate: (draft: Draft) => void): unknown {
  const draft = structuredClone(baseConfig) as unknown as Draft;
  mutate(draft);
  return draft;
}

/** Narrow a draft branch to something Object.assign will accept. */
function branch(draft: Draft, key: string): object {
  return draft[key] as object;
}

describe('signal.config.ts', () => {
  it('the committed config is valid', () => {
    expect(() => validateConfig(baseConfig)).not.toThrow();
  });

  it('rejects an unknown top-level key rather than silently ignoring it', () => {
    // A typo'd key is worse than a missing one: the system runs with a default
    // you did not intend.
    expect(() => validateConfig(withConfig((d) => Object.assign(d, { scorring: {} })))).toThrow(
      /signal\.config\.ts/,
    );
  });

  it('refuses to demote the contribution weight below intent or fit', () => {
    expect(() =>
      validateConfig(
        withConfig((d) => {
          Object.assign(branch(d, 'scoring'), { weights: { contribution: 0.1, intent: 0.5, fit: 0.3, risk: 0.1 } });
        }),
      ),
    ).toThrow(/contribution must be the largest/);
  });

  it('rejects a weight outside 0..1', () => {
    expect(() =>
      validateConfig(
        withConfig((d) => {
          Object.assign(branch(d, 'scoring'), { weights: { contribution: 1.4, intent: 0.2, fit: 0.2, risk: 0.1 } });
        }),
      ),
    ).toThrow();
  });

  it('rejects a duplicate product key', () => {
    expect(() =>
      validateConfig(
        withConfig((d) => {
          const products = d['products'] as unknown as unknown[];
          products.push(structuredClone(products[0]));
        }),
      ),
    ).toThrow(/duplicate product key/);
  });

  it('rejects a duplicate source', () => {
    expect(() =>
      validateConfig(
        withConfig((d) => {
          const sources = d['sources'] as unknown as unknown[];
          sources.push(structuredClone(sources[0]));
        }),
      ),
    ).toThrow(/duplicate source/);
  });

  it('rejects a product key that is not kebab-case', () => {
    expect(() =>
      validateConfig(
        withConfig((d) => {
          (d['products'] as unknown as { key: string }[])[0]!.key = 'Lemonade Pro';
        }),
      ),
    ).toThrow(/kebab-case/);
  });

  it('rejects a non-url utmBase, because a bad one breaks attribution silently', () => {
    expect(() =>
      validateConfig(
        withConfig((d) => {
          (d['products'] as unknown as { utmBase: string }[])[0]!.utmBase = 'lemonade.app';
        }),
      ),
    ).toThrow();
  });

  it('rejects a poll interval under a minute', () => {
    expect(() =>
      validateConfig(
        withConfig((d) => {
          (d['sources'] as unknown as { pollIntervalSeconds: number }[])[0]!.pollIntervalSeconds = 5;
        }),
      ),
    ).toThrow();
  });

  it.each(['hn', 'stackexchange', 'reddit_search'])(
    'rejects a boolean OR in a %s search query',
    (kind) => {
      // Made this mistake on all three platforms in turn. Each time it looked
      // like the source was simply finding nothing, or — worse on Reddit —
      // quietly matched the word "or" and filled the queue with r/palindromes.
      expect(() =>
        validateConfig(
          withConfig((d) => {
            (d['sources'] as unknown as unknown[]).push({
              kind,
              identifier: '"local llm" OR ollama',
              displayName: 'noisy',
              pollIntervalSeconds: 3600,
              enabled: true,
              ...(kind === 'reddit_search'
                ? { ignoreRobotsTxt: true, robotsExemptionReason: 'a stated reason goes here' }
                : {}),
            });
          }),
        ),
      ).toThrow(/booleans/);
    },
  );

  it('allows OR on a platform whose search actually supports it', () => {
    expect(() =>
      validateConfig(
        withConfig((d) => {
          (d['sources'] as unknown as unknown[]).push({
            kind: 'github',
            identifier: 'is:issue is:open offline OR airgapped',
            displayName: 'github or',
            pollIntervalSeconds: 3600,
            enabled: true,
          });
        }),
      ),
    ).not.toThrow();
  });

  it('has no off switch for robots.txt', () => {
    expect(() =>
      validateConfig(
        withConfig((d) => {
          Object.assign(branch(d, 'http'), { respectRobotsTxt: false });
        }),
      ),
    ).toThrow();
  });

  it('caps replies per platform per day at a sane number', () => {
    expect(() =>
      validateConfig(
        withConfig((d) => {
          Object.assign(branch(d, 'publishLimits'), { maxRepliesPerPlatformPerDay: 500 });
        }),
      ),
    ).toThrow();
  });

  it('names the offending path in the error message', () => {
    try {
      validateConfig(withConfig((d) => Object.assign(d, { timezone: 42 })));
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(String(err)).toContain('timezone');
      expect(String(err)).toContain('signal.config.ts');
    }
  });
});

describe('capabilities', () => {
  it('reports read-only sources as always available', () => {
    const caps = capabilities(loadEnv({ NODE_ENV: 'test' }));
    expect(caps.find((c) => c.name === 'hn:read')?.available).toBe(true);
    expect(caps.find((c) => c.name === 'rss:read')?.available).toBe(true);
  });

  it('names the missing variables rather than just failing', () => {
    const caps = capabilities(loadEnv({ NODE_ENV: 'test' }));
    const reddit = caps.find((c) => c.name === 'reddit:read');
    expect(reddit?.available).toBe(false);
    expect(reddit?.missing).toEqual(['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET']);
  });

  it('separates reading Reddit from posting to it', () => {
    const env = loadEnv({ NODE_ENV: 'test', REDDIT_CLIENT_ID: 'a', REDDIT_CLIENT_SECRET: 'b' });
    const caps = capabilities(env);
    expect(caps.find((c) => c.name === 'reddit:read')?.available).toBe(true);
    expect(caps.find((c) => c.name === 'reddit:publish')?.available).toBe(false);
  });

  it('rejects an Anthropic key that is not one', () => {
    expect(() => loadEnv({ NODE_ENV: 'test', ANTHROPIC_API_KEY: 'hunter2' })).toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });

  it('rejects a backup passphrase too short to be worth anything', () => {
    expect(() => loadEnv({ NODE_ENV: 'test', SIGNAL_BACKUP_PASSPHRASE: 'short' })).toThrow();
  });
});
