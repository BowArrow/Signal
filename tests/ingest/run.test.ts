import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { DbHandle } from '../../src/core/db/client.js';
import { opportunities, sources, type Source } from '../../src/core/db/schema.js';
import { runIngest } from '../../src/core/ingest/run.js';
import type { Poller, PollResult } from '../../src/core/ingest/types.js';
import { fixedClock } from '../../src/core/lib/clock.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { insertSource, testDb } from '../helpers/db.js';

function stubPoller(
  kind: Source['kind'],
  poll: (source: Source) => Promise<PollResult>,
  ready = true,
): Poller {
  return {
    kind,
    poll,
    available: () => (ready ? { ready: true } : { ready: false, reason: 'no credentials' }),
  };
}

const emptyResult: PollResult = { items: [], skipped: [] };

function oneItem(externalId: string, postedAt: number | null = null): PollResult {
  return {
    items: [
      {
        externalId,
        url: `https://example.test/${externalId}`,
        community: { platform: 'hn', name: 'news', displayName: 'Hacker News' },
        author: 'someone',
        title: `Item ${externalId}`,
        body: 'body',
        postedAt,
        commentCount: null,
        platformScore: null,
        truncated: false,
        raw: {},
      },
    ],
    skipped: [],
  };
}

describe('runIngest', () => {
  let handle: DbHandle;

  beforeEach(() => {
    handle = testDb();
  });
  afterEach(() => handle.close());

  it('polls a source that has never been polled', async () => {
    const source = insertSource(handle, { kind: 'hn', identifier: 'q', displayName: 'HN q' });
    const poll = vi.fn().mockResolvedValue(oneItem('a'));

    const report = await runIngest(handle.db, [stubPoller('hn', poll)], silentLogger, {
      clock: fixedClock(10_000),
    });

    expect(poll).toHaveBeenCalledOnce();
    expect(report.sources[0]).toMatchObject({ status: 'ok', inserted: 1 });
    expect(report.totals.inserted).toBe(1);
    void source;
  });

  it('skips a source that is not due yet', async () => {
    const clock = fixedClock(100_000);
    insertSource(handle, {
      kind: 'hn',
      identifier: 'q',
      displayName: 'HN q',
      pollIntervalSeconds: 600,
      lastPolledAt: clock.now() - 60_000,
    });
    const poll = vi.fn().mockResolvedValue(emptyResult);

    const report = await runIngest(handle.db, [stubPoller('hn', poll)], silentLogger, { clock });

    expect(poll).not.toHaveBeenCalled();
    expect(report.sources[0]?.status).toBe('not_due');
    expect(report.sources[0]?.detail).toContain('next poll in');
  });

  it('force overrides the interval', async () => {
    const clock = fixedClock(100_000);
    insertSource(handle, {
      kind: 'hn',
      identifier: 'q',
      displayName: 'HN q',
      pollIntervalSeconds: 600,
      lastPolledAt: clock.now(),
    });
    const poll = vi.fn().mockResolvedValue(emptyResult);

    await runIngest(handle.db, [stubPoller('hn', poll)], silentLogger, { force: true, clock });

    expect(poll).toHaveBeenCalledOnce();
  });

  it('ignores a disabled source entirely', async () => {
    insertSource(handle, { kind: 'hn', identifier: 'q', displayName: 'HN q', enabled: false });
    const poll = vi.fn().mockResolvedValue(emptyResult);

    const report = await runIngest(handle.db, [stubPoller('hn', poll)], silentLogger, {
      force: true,
      clock: fixedClock(1_000),
    });

    expect(poll).not.toHaveBeenCalled();
    expect(report.sources).toHaveLength(0);
  });

  it('reports a poller without credentials as skipped, with the reason', async () => {
    insertSource(handle, { kind: 'reddit' });
    const poll = vi.fn();

    const report = await runIngest(
      handle.db,
      [stubPoller('reddit', poll, false)],
      silentLogger,
      { force: true, clock: fixedClock(1_000) },
    );

    expect(poll).not.toHaveBeenCalled();
    expect(report.sources[0]).toMatchObject({ status: 'skipped', detail: 'no credentials' });
  });

  it('reports a source kind with no registered poller', async () => {
    insertSource(handle, { kind: 'discord', identifier: 'c1', displayName: '#general' });

    const report = await runIngest(handle.db, [], silentLogger, {
      force: true,
      clock: fixedClock(1_000),
    });

    expect(report.sources[0]?.status).toBe('skipped');
    expect(report.sources[0]?.detail).toContain('no poller registered');
  });

  it('keeps going when one source throws, and records the error on the row', async () => {
    const bad = insertSource(handle, { kind: 'reddit', identifier: 'bad', displayName: 'r/bad' });
    insertSource(handle, { kind: 'hn', identifier: 'good', displayName: 'HN good' });
    const clock = fixedClock(50_000);

    const report = await runIngest(
      handle.db,
      [
        stubPoller('reddit', () => Promise.reject(new Error('403 Forbidden'))),
        stubPoller('hn', () => Promise.resolve(oneItem('a'))),
      ],
      silentLogger,
      { force: true, clock },
    );

    expect(report.sources.find((s) => s.source === 'r/bad')?.status).toBe('error');
    expect(report.sources.find((s) => s.source === 'HN good')?.status).toBe('ok');
    expect(report.totals.inserted).toBe(1);

    const row = handle.db.select().from(sources).where(eq(sources.id, bad.id)).get();
    expect(row?.lastPollError).toContain('403 Forbidden');
    expect(row?.lastPolledAt).toBe(50_000);
  });

  it('clears a previous error after a successful poll', async () => {
    const source = insertSource(handle, {
      kind: 'hn',
      identifier: 'q',
      displayName: 'HN q',
      lastPollError: 'earlier failure',
    });

    await runIngest(handle.db, [stubPoller('hn', () => Promise.resolve(emptyResult))], silentLogger, {
      force: true,
      clock: fixedClock(1_000),
    });

    expect(handle.db.select().from(sources).where(eq(sources.id, source.id)).get()?.lastPollError).toBeNull();
  });

  it('drops items past the age cutoff and says so', async () => {
    insertSource(handle, { kind: 'hn', identifier: 'q', displayName: 'HN q' });
    const now = 1_700_000_000_000;
    const clock = fixedClock(now);

    const report = await runIngest(
      handle.db,
      [
        stubPoller('hn', () =>
          Promise.resolve({
            items: [
              ...oneItem('fresh', now - 3_600_000).items,
              ...oneItem('ancient', now - 400 * 24 * 3_600_000).items,
            ],
            skipped: [],
          }),
        ),
      ],
      silentLogger,
      { force: true, maxItemAgeHours: 72, clock },
    );

    expect(report.sources[0]).toMatchObject({ inserted: 1, dropped: 1 });
    expect(report.sources[0]?.detail).toContain('past the age cutoff');
    const rows = handle.db.select().from(opportunities).all();
    expect(rows.map((r) => r.externalId)).toEqual(['fresh']);
  });

  it('restricts to one source with --only, matching identifier or display name', async () => {
    insertSource(handle, { kind: 'hn', identifier: 'alpha', displayName: 'HN alpha' });
    insertSource(handle, { kind: 'hn', identifier: 'beta', displayName: 'HN beta' });
    const poll = vi.fn().mockResolvedValue(emptyResult);

    const byIdentifier = await runIngest(handle.db, [stubPoller('hn', poll)], silentLogger, {
      force: true,
      only: 'alpha',
      clock: fixedClock(1_000),
    });
    expect(byIdentifier.sources).toHaveLength(1);

    const byDisplayName = await runIngest(handle.db, [stubPoller('hn', poll)], silentLogger, {
      force: true,
      only: 'HN beta',
      clock: fixedClock(1_000),
    });
    expect(byDisplayName.sources[0]?.source).toBe('HN beta');
  });

  it('counts items the poller itself dropped', async () => {
    insertSource(handle, { kind: 'hn', identifier: 'q', displayName: 'HN q' });

    const report = await runIngest(
      handle.db,
      [
        stubPoller('hn', () =>
          Promise.resolve({ items: [], skipped: [{ externalId: 'x', reason: 'dead story' }] }),
        ),
      ],
      silentLogger,
      { force: true, clock: fixedClock(1_000) },
    );

    expect(report.sources[0]).toMatchObject({ dropped: 1, fetched: 1, inserted: 0 });
  });
});
