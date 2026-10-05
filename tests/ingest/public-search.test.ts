import { expect, it, vi } from 'vitest';
import { HttpClient } from '../../src/core/lib/http.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { HackerNewsPoller } from '../../src/core/ingest/hackernews.js';
import { StackExchangePoller } from '../../src/core/ingest/stackexchange.js';
import type { Source } from '../../src/core/db/schema.js';

const source = (identifier = 'local assistant'): Source => ({ id: 'test', kind: 'hn', identifier, displayName: 'Test', enabled: false, pollIntervalSeconds: 3600, ignoreRobotsTxt: false, robotsExemptionReason: null, maxItemAgeHours: 336, discovered: true, discoveredVia: null, lastPolledAt: null, lastPollError: null, createdAt: 0, updatedAt: 0 });
const http = (transport: typeof fetch, retries = 0) => new HttpClient({ userAgent: 'Signal-test', minRequestIntervalMs: 0, requestTimeoutMs: 10000, maxRetries: retries, respectRobotsTxt: true }, silentLogger, transport);
it('uses recent HN API search with the source age window and no redirects', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1789700000000);
  try {
  const transport = vi.fn<typeof fetch>(async () => Response.json({ hits: [{ objectID: '123', author: 'test-user', title: 'How do I compare documents?', story_text: 'Useful question', created_at_i: Math.floor(Date.now() / 1000) }] }));
  const result = await new HackerNewsPoller(http(transport), silentLogger, { maxAgeHours: 72 }).poll(source());
  expect(result.items).toHaveLength(1); const url = new URL(String(transport.mock.calls[0]![0])); expect(url.hostname).toBe('hn.algolia.com'); expect(url.searchParams.get('numericFilters')).toBe('created_at_i>' + Math.floor((Date.now() - 336 * 3600000) / 1000)); expect(transport.mock.calls[0]![1]?.redirect).toBe('error');
  } finally { now.mockRestore(); }
});
it('honors Stack Exchange method backoff across different and concurrent queries', async () => {
  const transport = vi.fn<typeof fetch>(async () => Response.json({ items: [], backoff: 120, quota_remaining: 100 }));
  const reader = new StackExchangePoller(http(transport), silentLogger);
  const results = await Promise.allSettled([reader.poll(source('video:editing')), reader.poll(source('softwarerecs:editor'))]);
  expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected']); expect(transport).toHaveBeenCalledOnce();
});
it('uses exact phrases for Operations research without changing configured ingestion searches', async () => {
  const transport = vi.fn<typeof fetch>(async () => Response.json({ hits: [] })); const reader = new HackerNewsPoller(http(transport), silentLogger);
  await reader.poll({ ...source('video editing'), discoveredVia: 'operations-research' });
  const url = new URL(String(transport.mock.calls[0]![0])); expect(url.searchParams.get('query')).toBe('"video editing"'); expect(url.searchParams.get('advancedSyntax')).toBe('true'); expect(url.searchParams.get('hitsPerPage')).toBe('100');
});
it('does not repeat identical Stack Exchange queries within a minute', async () => {
  const transport = vi.fn<typeof fetch>(async () => Response.json({ items: [], quota_remaining: 100 })); const reader = new StackExchangePoller(http(transport), silentLogger);
  await reader.poll(source('video:editing')); await expect(reader.poll(source('video:editing'))).rejects.toThrow('cooldown'); expect(transport).toHaveBeenCalledOnce();
});
it('backs off exhausted Stack Exchange quota and observes backoff even on API errors', async () => {
  for (const response of [{ items: [], quota_remaining: 0 }, { error_message: 'Try later', backoff: 60 }]) {
    const transport = vi.fn<typeof fetch>(async () => Response.json(response)); const reader = new StackExchangePoller(http(transport), silentLogger);
    await reader.poll(source('video:editing')).catch(() => {}); await expect(reader.poll(source('ai:assistant'))).rejects.toThrow('cooldown'); expect(transport).toHaveBeenCalledOnce();
  }
});
it('requests Stack Exchange bodies and bounded dates', async () => {
  const transport = vi.fn<typeof fetch>(async () => Response.json({ items: [{ question_id: 123, title: 'How to edit?', body: '<p>Editing question</p>', creation_date: Math.floor(Date.now() / 1000) }], quota_remaining: 100 }));
  const result = await new StackExchangePoller(http(transport), silentLogger).poll(source('video:editing'));
  const url = new URL(String(transport.mock.calls[0]![0])); expect(url.searchParams.get('filter')).toBe('withbody'); expect(url.searchParams.get('q')).toBe('editing'); expect(url.searchParams.get('site')).toBe('video'); expect(url.searchParams.has('fromdate')).toBe(true); expect(result.items[0]?.body).toBe('Editing question');
});
it('cancels an active public request without retries', async () => {
  let started!: () => void; const ready = new Promise<void>(r => { started = r; });
  const transport = vi.fn<typeof fetch>(async (_url, init) => new Promise((_resolve, reject) => { started(); init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }); }));
  const controller = new AbortController(); const pending = new HackerNewsPoller(http(transport, 3), silentLogger).poll(source(), controller.signal); await ready; controller.abort(); await expect(pending).rejects.toThrow(); expect(transport).toHaveBeenCalledOnce();
});
it('rejects oversized or malformed search results rather than reporting empty success', async () => {
  for (const body of [{ hits: [], extra: 'x'.repeat(2000001) }, { unexpected: [] }]) {
    const transport = vi.fn<typeof fetch>(async () => Response.json(body)); await expect(new HackerNewsPoller(http(transport), silentLogger).poll(source())).rejects.toThrow();
  }
});
