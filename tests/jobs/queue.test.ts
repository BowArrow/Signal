import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { DbHandle } from '../../src/core/db/client.js';
import { jobs } from '../../src/core/db/schema.js';
import {
  claimNext,
  complete,
  drain,
  enqueue,
  fail,
  LOCK_TIMEOUT_MS,
  queueStats,
} from '../../src/core/jobs/queue.js';
import { fixedClock } from '../../src/core/lib/clock.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { testDb } from '../helpers/db.js';

describe('job queue', () => {
  let handle: DbHandle;

  beforeEach(() => {
    handle = testDb();
  });
  afterEach(() => handle.close());

  it('enqueues and claims in run order', () => {
    const clock = fixedClock(1_000);
    enqueue(handle.db, 'later', {}, { runAt: 5_000 }, clock);
    enqueue(handle.db, 'sooner', {}, { runAt: 2_000 }, clock);

    clock.set(6_000);
    expect(claimNext(handle.db, 'w1', clock)?.kind).toBe('sooner');
    expect(claimNext(handle.db, 'w1', clock)?.kind).toBe('later');
  });

  it('does not claim a job whose runAt is in the future', () => {
    const clock = fixedClock(1_000);
    enqueue(handle.db, 'future', {}, { runAt: 10_000 }, clock);
    expect(claimNext(handle.db, 'w1', clock)).toBeNull();
  });

  it('refuses a duplicate dedupe key while one is pending', () => {
    const clock = fixedClock(1_000);
    const first = enqueue(handle.db, 'poll', { id: 'a' }, { dedupeKey: 'poll:a' }, clock);
    const second = enqueue(handle.db, 'poll', { id: 'a' }, { dedupeKey: 'poll:a' }, clock);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(handle.db.select().from(jobs).all()).toHaveLength(1);
  });

  it('releases the dedupe key on completion so the next tick can re-enqueue', () => {
    const clock = fixedClock(1_000);
    const id = enqueue(handle.db, 'poll', {}, { dedupeKey: 'poll:a' }, clock);
    claimNext(handle.db, 'w1', clock);
    complete(handle.db, id as string, clock);

    expect(enqueue(handle.db, 'poll', {}, { dedupeKey: 'poll:a' }, clock)).not.toBeNull();
  });

  it('claims a job exactly once across two workers', () => {
    const clock = fixedClock(1_000);
    enqueue(handle.db, 'only-one', {}, {}, clock);

    const a = claimNext(handle.db, 'w1', clock);
    const b = claimNext(handle.db, 'w2', clock);

    expect(a).not.toBeNull();
    expect(b).toBeNull();
  });

  it('increments attempts on claim', () => {
    const clock = fixedClock(1_000);
    enqueue(handle.db, 'k', {}, {}, clock);
    expect(claimNext(handle.db, 'w1', clock)?.attempts).toBe(1);
  });

  it('reclaims a job abandoned by a dead worker', () => {
    const clock = fixedClock(1_000);
    enqueue(handle.db, 'k', {}, {}, clock);
    claimNext(handle.db, 'dead-worker', clock);

    // Still locked well inside the timeout.
    clock.advance(LOCK_TIMEOUT_MS - 1);
    expect(claimNext(handle.db, 'w2', clock)).toBeNull();

    clock.advance(2);
    const reclaimed = claimNext(handle.db, 'w2', clock);
    expect(reclaimed?.lockedBy).toBe('w2');
    expect(reclaimed?.attempts).toBe(2);
  });

  it('retries with exponential backoff below maxAttempts', () => {
    const clock = fixedClock(1_000);
    enqueue(handle.db, 'k', {}, { maxAttempts: 3 }, clock);
    const job = claimNext(handle.db, 'w1', clock);
    if (!job) throw new Error('expected a job');

    fail(handle.db, job, new Error('boom'), clock);

    const row = handle.db.select().from(jobs).get();
    expect(row?.status).toBe('pending');
    expect(row?.lastError).toContain('boom');
    // attempts is 1, so backoff is 1000 * 2^1.
    expect(row?.runAt).toBe(1_000 + 2_000);
  });

  it('marks a job dead once attempts are exhausted', () => {
    const clock = fixedClock(1_000);
    enqueue(handle.db, 'k', {}, { maxAttempts: 1 }, clock);
    const job = claimNext(handle.db, 'w1', clock);
    if (!job) throw new Error('expected a job');

    fail(handle.db, job, new Error('permanent'), clock);

    const row = handle.db.select().from(jobs).get();
    expect(row?.status).toBe('dead');
    // A dead job must not hold its dedupe key hostage forever.
    expect(row?.dedupeKey).toBeNull();
    expect(claimNext(handle.db, 'w2', clock)).toBeNull();
  });

  it('drains every due job through its handler', async () => {
    const clock = fixedClock(1_000);
    const seen: unknown[] = [];
    enqueue(handle.db, 'work', { n: 1 }, {}, clock);
    enqueue(handle.db, 'work', { n: 2 }, {}, clock);

    const result = await drain(
      handle.db,
      { work: (payload) => void seen.push(payload) },
      silentLogger,
      { clock },
    );

    expect(result).toEqual({ processed: 2, failed: 0 });
    expect(seen).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('stops at the max and leaves the rest pending', async () => {
    const clock = fixedClock(1_000);
    enqueue(handle.db, 'work', {}, {}, clock);
    enqueue(handle.db, 'work', {}, {}, clock);

    const result = await drain(handle.db, { work: () => {} }, silentLogger, { max: 1, clock });

    expect(result.processed).toBe(1);
    expect(queueStats(handle.db)['pending']).toBe(1);
  });

  it('records a handler throw as a failure without stopping the drain', async () => {
    const clock = fixedClock(1_000);
    enqueue(handle.db, 'bad', {}, { maxAttempts: 1 }, clock);
    enqueue(handle.db, 'good', {}, {}, clock);
    const good = vi.fn();

    const result = await drain(
      handle.db,
      {
        bad: () => {
          throw new Error('nope');
        },
        good,
      },
      silentLogger,
      { clock },
    );

    expect(result).toEqual({ processed: 1, failed: 1 });
    expect(good).toHaveBeenCalledOnce();
  });

  it('fails a job whose kind has no registered handler', async () => {
    const clock = fixedClock(1_000);
    enqueue(handle.db, 'unknown', {}, { maxAttempts: 1 }, clock);

    const result = await drain(handle.db, {}, silentLogger, { clock });

    expect(result).toEqual({ processed: 0, failed: 1 });
    const row = handle.db.select().from(jobs).where(eq(jobs.kind, 'unknown')).get();
    expect(row?.status).toBe('dead');
    expect(row?.lastError).toContain('no handler registered');
  });

  it('awaits an async handler before completing', async () => {
    const clock = fixedClock(1_000);
    enqueue(handle.db, 'slow', {}, {}, clock);
    let finished = false;

    await drain(
      handle.db,
      {
        slow: async () => {
          await Promise.resolve();
          finished = true;
        },
      },
      silentLogger,
      { clock },
    );

    expect(finished).toBe(true);
    expect(queueStats(handle.db)['done']).toBe(1);
  });

  it('reports counts by status', () => {
    const clock = fixedClock(1_000);
    enqueue(handle.db, 'a', {}, {}, clock);
    enqueue(handle.db, 'b', {}, {}, clock);
    claimNext(handle.db, 'w1', clock);

    expect(queueStats(handle.db)).toEqual({ pending: 1, running: 1 });
  });
});
