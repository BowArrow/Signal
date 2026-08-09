import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { DbHandle } from '../../src/core/db/client.js';
import { opportunities } from '../../src/core/db/schema.js';
import { persistItems } from '../../src/core/ingest/dedup.js';
import { partitionByAge } from '../../src/core/ingest/run.js';
import type { NormalizedItem } from '../../src/core/ingest/types.js';
import { fixedClock } from '../../src/core/lib/clock.js';
import { insertSource, testDb } from '../helpers/db.js';

function item(overrides: Partial<NormalizedItem> = {}): NormalizedItem {
  return {
    externalId: 't3_abc',
    url: 'https://www.reddit.com/r/LocalLLaMA/comments/abc/',
    author: 'someone',
    title: 'VRAM sizing',
    body: 'what is the arithmetic',
    postedAt: 1_700_000_000_000,
    commentCount: 4,
    platformScore: 10,
    truncated: false,
    raw: { kind: 't3' },
    ...overrides,
  };
}

describe('persistItems', () => {
  let handle: DbHandle;

  beforeEach(() => {
    handle = testDb();
  });
  afterEach(() => handle.close());

  it('inserts a new item as status "new"', () => {
    const source = insertSource(handle);
    const clock = fixedClock(5_000);

    const result = persistItems(handle.db, source, [item()], clock);

    expect(result).toMatchObject({ inserted: 1, updated: 0, unchanged: 0 });
    const row = handle.db.select().from(opportunities).get();
    expect(row?.status).toBe('new');
    expect(row?.discoveredAt).toBe(5_000);
    expect(row?.externalId).toBe('t3_abc');
  });

  it('does not duplicate on a second sighting', () => {
    const source = insertSource(handle);
    persistItems(handle.db, source, [item()], fixedClock(1_000));
    const second = persistItems(handle.db, source, [item()], fixedClock(2_000));

    expect(second).toMatchObject({ inserted: 0, unchanged: 1 });
    expect(handle.db.select().from(opportunities).all()).toHaveLength(1);
  });

  it('collapses duplicates inside a single batch', () => {
    const source = insertSource(handle);
    const result = persistItems(
      handle.db,
      source,
      [item({ commentCount: 1 }), item({ commentCount: 9 })],
      fixedClock(1_000),
    );

    expect(result.inserted).toBe(1);
    // Last one in the batch wins.
    expect(handle.db.select().from(opportunities).get()?.commentCount).toBe(9);
  });

  it('treats the same external id under two sources as two opportunities', () => {
    const a = insertSource(handle, { identifier: 'LocalLLaMA', displayName: 'r/LocalLLaMA' });
    const b = insertSource(handle, { identifier: 'ollama', displayName: 'r/ollama' });

    persistItems(handle.db, a, [item()], fixedClock(1_000));
    persistItems(handle.db, b, [item()], fixedClock(1_000));

    expect(handle.db.select().from(opportunities).all()).toHaveLength(2);
  });

  it('refreshes volatile counts without touching discovery time', () => {
    const source = insertSource(handle);
    persistItems(handle.db, source, [item({ commentCount: 4, platformScore: 10 })], fixedClock(1_000));
    const result = persistItems(
      handle.db,
      source,
      [item({ commentCount: 41, platformScore: 128 })],
      fixedClock(9_000),
    );

    expect(result).toMatchObject({ inserted: 0, updated: 1 });
    const row = handle.db.select().from(opportunities).get();
    expect(row?.commentCount).toBe(41);
    expect(row?.platformScore).toBe(128);
    expect(row?.discoveredAt).toBe(1_000);
  });

  it('sends an edited post back for rescoring', () => {
    const source = insertSource(handle);
    persistItems(handle.db, source, [item()], fixedClock(1_000));

    handle.db
      .update(opportunities)
      .set({ status: 'scored', scoreTotal: 0.8, scoredAt: 1_500 })
      .run();

    persistItems(handle.db, source, [item({ body: 'edited: here is more detail' })], fixedClock(2_000));

    const row = handle.db.select().from(opportunities).get();
    expect(row?.status).toBe('new');
    expect(row?.scoreTotal).toBeNull();
    expect(row?.scoredAt).toBeNull();
  });

  it('does not rescore when only the comment count moved', () => {
    const source = insertSource(handle);
    persistItems(handle.db, source, [item()], fixedClock(1_000));
    handle.db.update(opportunities).set({ status: 'scored', scoreTotal: 0.8 }).run();

    persistItems(handle.db, source, [item({ commentCount: 99 })], fixedClock(2_000));

    const row = handle.db.select().from(opportunities).get();
    expect(row?.status).toBe('scored');
    expect(row?.scoreTotal).toBe(0.8);
  });

  it.each(['approved', 'published', 'rejected'] as const)(
    'never resurrects an opportunity already %s',
    (status) => {
      const source = insertSource(handle);
      persistItems(handle.db, source, [item()], fixedClock(1_000));
      handle.db.update(opportunities).set({ status }).run();

      // A poller re-seeing a rejected thread must not put it back in the queue
      // every fifteen minutes.
      const result = persistItems(
        handle.db,
        source,
        [item({ body: 'the author edited it', commentCount: 500 })],
        fixedClock(2_000),
      );

      expect(result).toMatchObject({ inserted: 0, updated: 0, unchanged: 1 });
      const row = handle.db.select().from(opportunities).get();
      expect(row?.status).toBe(status);
      expect(row?.body).toBe('what is the arithmetic');
    },
  );

  it('returns the row ids for both inserts and repeats', () => {
    const source = insertSource(handle);
    const first = persistItems(handle.db, source, [item()], fixedClock(1_000));
    const second = persistItems(handle.db, source, [item()], fixedClock(2_000));
    expect(second.ids).toEqual(first.ids);
  });

  it('handles an empty batch without opening a pointless write', () => {
    const source = insertSource(handle);
    expect(persistItems(handle.db, source, [], fixedClock(1_000))).toMatchObject({
      inserted: 0,
      updated: 0,
      unchanged: 0,
    });
  });

  it('cascades away when its source is deleted', () => {
    const source = insertSource(handle);
    persistItems(handle.db, source, [item()], fixedClock(1_000));
    handle.raw.prepare('delete from sources where id = ?').run(source.id);
    expect(handle.db.select().from(opportunities).all()).toHaveLength(0);
  });

  it('keeps rows for two different external ids', () => {
    const source = insertSource(handle);
    persistItems(
      handle.db,
      source,
      [item({ externalId: 't3_a' }), item({ externalId: 't3_b' })],
      fixedClock(1_000),
    );
    expect(handle.db.select().from(opportunities).all()).toHaveLength(2);
  });

  it('stores the raw payload for later reprocessing', () => {
    const source = insertSource(handle);
    persistItems(handle.db, source, [item({ raw: { deep: { value: 7 } } })], fixedClock(1_000));
    const row = handle.db
      .select()
      .from(opportunities)
      .where(eq(opportunities.externalId, 't3_abc'))
      .get();
    expect(row?.raw).toEqual({ deep: { value: 7 } });
  });
});

describe('partitionByAge', () => {
  const now = 1_700_000_000_000;

  it('keeps everything when no cutoff is configured', () => {
    const { fresh, stale } = partitionByAge([item({ postedAt: 0 })], now, undefined);
    expect(fresh).toHaveLength(1);
    expect(stale).toHaveLength(0);
  });

  it('drops an item older than the cutoff', () => {
    const old = item({ externalId: 'old', postedAt: now - 100 * 3_600_000 });
    const recent = item({ externalId: 'recent', postedAt: now - 2 * 3_600_000 });
    const { fresh, stale } = partitionByAge([old, recent], now, 72);
    expect(fresh.map((i) => i.externalId)).toEqual(['recent']);
    expect(stale.map((i) => i.externalId)).toEqual(['old']);
  });

  it('keeps an item with an unknown post time — absence of a date is not age', () => {
    const { fresh } = partitionByAge([item({ postedAt: null })], now, 72);
    expect(fresh).toHaveLength(1);
  });

  it('keeps an item exactly on the boundary', () => {
    const { fresh } = partitionByAge([item({ postedAt: now - 72 * 3_600_000 })], now, 72);
    expect(fresh).toHaveLength(1);
  });
});
