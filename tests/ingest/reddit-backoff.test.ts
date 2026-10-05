import { describe, expect, it } from 'vitest';
import { RedditScrapeClient } from '../../src/core/ingest/reddit-scrape.js';
import { HttpClient, HttpError } from '../../src/core/lib/http.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { fixedClock } from '../../src/core/lib/clock.js';

/**
 * Reading Reddit from public pages is a decision taken knowingly, and the
 * thing at risk is the identity the whole system exists to build reputation
 * for. A 429 is Reddit asking us to stop; retrying through one is how a
 * scraper becomes a blocked IP. These tests exist because backing off is the
 * part that must not quietly regress.
 */

const HTTP_OPTIONS = {
  userAgent: 'signal-test/0.1 (+https://siplemona.de)',
  minRequestIntervalMs: 0,
  requestTimeoutMs: 1000,
  maxRetries: 0,
  respectRobotsTxt: true as const,
};

/** A fetch that always refuses with the given status. */
function refusing(status: number): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response('blocked', { status, statusText: status === 429 ? 'Too Many Requests' : 'Forbidden' }),
    )) as unknown as typeof fetch;
}

function counting(status: number): { fetch: typeof fetch; calls: () => number } {
  let calls = 0;
  const fn = (() => {
    calls += 1;
    return Promise.resolve(new Response('blocked', { status }));
  }) as unknown as typeof fetch;
  return { fetch: fn, calls: () => calls };
}

function client(fetchFn: typeof fetch, now = 1_000_000) {
  const clock = fixedClock(now);
  const http = new HttpClient(HTTP_OPTIONS, silentLogger, fetchFn);
  // Zero pacing here: the real twelve seconds is asserted separately, and
  // waiting it out per request would make this suite take minutes.
  return { client: new RedditScrapeClient(http, silentLogger, clock, 0), clock };
}

describe('RedditScrapeClient backoff', () => {
  it('paces requests far slower than the http default', () => {
    // Four seconds drew 429s once a hydration backlog drained back to back.
    expect(RedditScrapeClient.MIN_INTERVAL_MS).toBeGreaterThanOrEqual(10_000);
  });

  it('is available before anything has gone wrong', () => {
    const { client: c } = client(refusing(200));
    expect(c.available().ready).toBe(true);
  });

  it('translates a 429 into a block rather than a generic failure', async () => {
    const { client: c } = client(refusing(429));
    await expect(c.listing('LocalLLaMA')).rejects.toThrow(/429/);
  });

  it('stays available after one or two refusals', async () => {
    const { client: c } = client(refusing(429));
    await c.listing('a').catch(() => undefined);
    expect(c.available().ready).toBe(true);
    await c.listing('b').catch(() => undefined);
    expect(c.available().ready).toBe(true);
  });

  it('stands down after three consecutive refusals', async () => {
    const { client: c } = client(refusing(429));
    for (let i = 0; i < 3; i += 1) await c.listing('a').catch(() => undefined);

    const readiness = c.available();
    expect(readiness.ready).toBe(false);
    expect(readiness.reason).toContain('standing down');
  });

  it('stops sending requests entirely while standing down', async () => {
    const { fetch: fetchFn, calls } = counting(429);
    const { client: c } = client(fetchFn);

    for (let i = 0; i < 3; i += 1) await c.listing('a').catch(() => undefined);
    const afterPause = calls();

    // Further attempts must be refused locally. Sending them anyway is the
    // exact behaviour that earned the block.
    for (let i = 0; i < 5; i += 1) await c.listing('a').catch(() => undefined);
    expect(calls()).toBe(afterPause);
  });

  it('lifts the stand-down once the window elapses', async () => {
    const { client: c, clock } = client(refusing(429));
    for (let i = 0; i < 3; i += 1) await c.listing('a').catch(() => undefined);
    expect(c.available().ready).toBe(false);

    clock.advance(16 * 60_000);
    expect(c.available().ready).toBe(true);
  });

  it('escalates when refusals continue after a stand-down', async () => {
    const { client: c, clock } = client(refusing(429));
    for (let i = 0; i < 3; i += 1) await c.listing('a').catch(() => undefined);

    clock.advance(16 * 60_000);
    await c.listing('a').catch(() => undefined);

    // A fourth refusal after waiting means the first pause was not enough.
    expect(c.available().ready).toBe(false);
    clock.advance(16 * 60_000);
    expect(c.available().ready).toBe(false);
  });

  it('treats a 403 the same as a 429', async () => {
    const { client: c } = client(refusing(403));
    for (let i = 0; i < 3; i += 1) await c.listing('a').catch(() => undefined);
    expect(c.available().ready).toBe(false);
  });

  it('resumes on demand, for when the block is known to have lifted', async () => {
    const { client: c } = client(refusing(429));
    for (let i = 0; i < 3; i += 1) await c.listing('a').catch(() => undefined);
    c.resume();
    expect(c.available().ready).toBe(true);
  });

  it('a success clears the streak, so scattered refusals never accumulate', async () => {
    let succeed = false;
    const fetchFn = (() =>
      Promise.resolve(
        succeed
          ? new Response('<html></html>', { status: 200 })
          : new Response('blocked', { status: 429 }),
      )) as unknown as typeof fetch;
    const { client: c } = client(fetchFn);

    await c.listing('a').catch(() => undefined);
    await c.listing('a').catch(() => undefined);

    succeed = true;
    await c.listing('a');

    succeed = false;
    await c.listing('a').catch(() => undefined);
    await c.listing('a').catch(() => undefined);

    // Two before the success plus two after is four refusals, but never three
    // in a row, so this is a flaky host rather than a message to stop.
    expect(c.available().ready).toBe(true);
  });
});

describe('HttpError', () => {
  it('carries the status so callers can tell refusal from failure', () => {
    const err = new HttpError('429 Too Many Requests', 429, 'https://x.test');
    expect(err.status).toBe(429);
  });
});
