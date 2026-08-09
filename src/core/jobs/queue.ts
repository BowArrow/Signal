import { and, asc, eq, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { jobs, type Job } from '../db/schema.js';
import { newId } from '../lib/id.js';
import type { Clock } from '../lib/clock.js';
import { systemClock } from '../lib/clock.js';
import type { Logger } from '../lib/logger.js';

/**
 * A durable queue in the same SQLite file. No Redis, no BullMQ.
 *
 * The only property that actually matters here is surviving a restart: Signal
 * polls on a fifteen-minute cadence and drafts a handful of replies a day.
 * Anything more elaborate would be infrastructure for its own sake.
 */

export interface EnqueueOptions {
  readonly runAt?: number;
  readonly maxAttempts?: number;
  /**
   * Claiming a job with a dedupe key already pending is a no-op, so a cron
   * tick firing twice does not double-poll a source.
   */
  readonly dedupeKey?: string;
}

export type JobHandler = (payload: unknown, job: Job) => Promise<void> | void;

/** How long a claimed job may sit before another worker may steal it back. */
export const LOCK_TIMEOUT_MS = 10 * 60 * 1000;

export function enqueue(
  db: Db,
  kind: string,
  payload: unknown,
  options: EnqueueOptions = {},
  clock: Clock = systemClock,
): string | null {
  const now = clock.now();

  if (options.dedupeKey) {
    const existing = db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.dedupeKey, options.dedupeKey), eq(jobs.status, 'pending')))
      .get();
    if (existing) return null;
  }

  const id = newId();
  db.insert(jobs)
    .values({
      id,
      kind,
      payload,
      runAt: options.runAt ?? now,
      maxAttempts: options.maxAttempts ?? 3,
      status: 'pending',
      dedupeKey: options.dedupeKey ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

/**
 * Atomically takes the next due job. The UPDATE ... WHERE id = (SELECT ...)
 * shape is what makes this safe: SQLite serializes writers, so two workers
 * cannot both claim the same row.
 */
export function claimNext(db: Db, workerId: string, clock: Clock = systemClock): Job | null {
  const now = clock.now();
  const staleBefore = now - LOCK_TIMEOUT_MS;

  return db.transaction((tx) => {
    const candidate = tx
      .select()
      .from(jobs)
      .where(
        and(
          lte(jobs.runAt, now),
          or(
            eq(jobs.status, 'pending'),
            // Reclaim a job whose worker died mid-flight.
            and(eq(jobs.status, 'running'), lte(jobs.lockedAt, staleBefore)),
          ),
        ),
      )
      .orderBy(asc(jobs.runAt), asc(jobs.createdAt))
      .limit(1)
      .get();

    if (!candidate) return null;

    const claimed = tx
      .update(jobs)
      .set({
        status: 'running',
        lockedAt: now,
        lockedBy: workerId,
        attempts: candidate.attempts + 1,
        updatedAt: now,
      })
      .where(and(eq(jobs.id, candidate.id), eq(jobs.status, candidate.status)))
      .returning()
      .get();

    return claimed ?? null;
  });
}

export function complete(db: Db, jobId: string, clock: Clock = systemClock): void {
  const now = clock.now();
  db.update(jobs)
    .set({ status: 'done', lockedAt: null, lockedBy: null, lastError: null, updatedAt: now })
    // A completed job releases its dedupe key so the next cron tick can
    // enqueue the same work again.
    .where(eq(jobs.id, jobId))
    .run();
  db.update(jobs).set({ dedupeKey: null }).where(eq(jobs.id, jobId)).run();
}

export function fail(db: Db, job: Job, error: unknown, clock: Clock = systemClock): void {
  const now = clock.now();
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const exhausted = job.attempts >= job.maxAttempts;

  if (exhausted) {
    db.update(jobs)
      .set({
        status: 'dead',
        lastError: message,
        lockedAt: null,
        lockedBy: null,
        dedupeKey: null,
        updatedAt: now,
      })
      .where(eq(jobs.id, job.id))
      .run();
    return;
  }

  // Exponential backoff, capped. A source that is down stays down for a while.
  const backoff = Math.min(30 * 60 * 1000, 1000 * 2 ** job.attempts);
  db.update(jobs)
    .set({
      status: 'pending',
      lastError: message,
      lockedAt: null,
      lockedBy: null,
      runAt: now + backoff,
      updatedAt: now,
    })
    .where(eq(jobs.id, job.id))
    .run();
}

export interface WorkerOptions {
  readonly workerId?: string;
  /** Stop after this many jobs. Undefined drains the queue. */
  readonly max?: number;
  readonly clock?: Clock;
}

/**
 * Drains due jobs one at a time. Single-threaded on purpose: nothing Signal
 * does benefits from concurrency, and serial execution means a rate-limited
 * API is never hit by two jobs at once.
 */
export async function drain(
  db: Db,
  handlers: Record<string, JobHandler>,
  logger: Logger,
  options: WorkerOptions = {},
): Promise<{ processed: number; failed: number }> {
  const clock = options.clock ?? systemClock;
  const workerId = options.workerId ?? `worker-${process.pid}`;
  let processed = 0;
  let failed = 0;

  for (;;) {
    if (options.max != null && processed >= options.max) break;
    const job = claimNext(db, workerId, clock);
    if (!job) break;

    const handler = handlers[job.kind];
    if (!handler) {
      logger.error('no handler for job kind', { kind: job.kind, jobId: job.id });
      fail(db, job, new Error(`no handler registered for job kind "${job.kind}"`), clock);
      failed += 1;
      continue;
    }

    try {
      await handler(job.payload, job);
      complete(db, job.id, clock);
      processed += 1;
      logger.debug('job done', { kind: job.kind, jobId: job.id, attempt: job.attempts });
    } catch (err) {
      fail(db, job, err, clock);
      failed += 1;
      logger.error('job failed', {
        kind: job.kind,
        jobId: job.id,
        attempt: job.attempts,
        of: job.maxAttempts,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { processed, failed };
}

export function queueStats(db: Db): Record<string, number> {
  const rows = db
    .select({ status: jobs.status, count: sql<number>`count(*)` })
    .from(jobs)
    .groupBy(jobs.status)
    .all();
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.count)]));
}
