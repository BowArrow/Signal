import cron, { type ScheduledTask } from 'node-cron';
import { eq } from 'drizzle-orm';
import type { App } from '../app.js';
import { sources } from '../db/schema.js';
import { runIngest } from '../ingest/run.js';
import {
  hydrateBody,
  isHydratePayload,
  JOB_HYDRATE_BODY,
  pendingBodies,
} from '../ingest/hydrate.js';
import { drain, enqueue, type JobHandler } from './queue.js';

export const JOB_INGEST_SOURCE = 'ingest.source';

/**
 * Cron enqueues; the worker executes. Keeping those separate is what makes the
 * system durable — if the process dies between the tick and the poll, the job
 * is already on disk and runs on the next boot.
 */
export function buildHandlers(app: App): Record<string, JobHandler> {
  return {
    [JOB_INGEST_SOURCE]: async (payload) => {
      const sourceId = (payload as { sourceId?: string } | null)?.sourceId;
      if (!sourceId) throw new Error(`${JOB_INGEST_SOURCE} payload is missing sourceId`);

      const source = app.db.select().from(sources).where(eq(sources.id, sourceId)).get();
      if (!source) throw new Error(`source ${sourceId} no longer exists`);
      if (!source.enabled) return;

      const report = await runIngest(app.db, app.pollers, app.logger, {
        only: source.identifier,
        force: true,
        maxItemAgeHours: app.config.scoring.maxThreadAgeHours,
        clock: app.clock,
      });
      const detail = report.sources[0];
      app.logger.info('ingested', {
        source: source.displayName,
        inserted: detail?.inserted ?? 0,
        updated: detail?.updated ?? 0,
        dropped: detail?.dropped ?? 0,
      });
    },

    [JOB_HYDRATE_BODY]: async (payload) => {
      if (!isHydratePayload(payload)) {
        throw new Error(`${JOB_HYDRATE_BODY} payload is malformed`);
      }
      await hydrateBody(
        app.db,
        { reddit: app.redditScraper, http: app.http },
        payload,
        app.logger,
        app.clock,
      );
    },
  };
}

export interface Scheduler {
  start(): void;
  stop(): void;
  /** Runs one tick and drains, without waiting for cron. Tests use this. */
  tickOnce(): Promise<void>;
}

/**
 * A single minute-granularity cron tick drives everything. Per-source poll
 * intervals are checked against lastPolledAt rather than encoded as separate
 * cron expressions, so changing an interval in config takes effect on the next
 * tick with no re-registration.
 */
export function createScheduler(app: App): Scheduler {
  const handlers = buildHandlers(app);
  let task: ScheduledTask | null = null;
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) {
      app.logger.debug('tick skipped, previous one still running');
      return;
    }
    running = true;
    try {
      const now = app.clock.now();
      const enabled = app.db.select().from(sources).where(eq(sources.enabled, true)).all();

      for (const source of enabled) {
        const due =
          source.lastPolledAt == null ||
          now - source.lastPolledAt >= source.pollIntervalSeconds * 1000;
        if (!due) continue;
        enqueue(
          app.db,
          JOB_INGEST_SOURCE,
          { sourceId: source.id },
          // The dedupe key means a slow poll cannot pile up behind itself.
          { dedupeKey: `${JOB_INGEST_SOURCE}:${source.id}` },
          app.clock,
        );
      }

      // Re-queue anything still waiting on a body. A hydration job can die
      // after exhausting its retries — most likely because Reddit was refusing
      // us for longer than the backoff covered — and without this the
      // opportunity would sit un-hydrated forever, invisible to scoring. The
      // dedupe key stops this from piling up duplicates.
      for (const pending of pendingBodies(app.db, 50)) {
        const permalink = new URL(pending.url).pathname;
        enqueue(
          app.db,
          JOB_HYDRATE_BODY,
          { opportunityId: pending.id, permalink, externalId: pending.id, platform: 'reddit' },
          { dedupeKey: `${JOB_HYDRATE_BODY}:${pending.id}` },
          app.clock,
        );
      }

      const result = await drain(app.db, handlers, app.logger, { clock: app.clock });
      if (result.processed || result.failed) {
        app.logger.info('queue drained', result);
      }
    } catch (err) {
      app.logger.error('scheduler tick failed', { err: err instanceof Error ? err.message : String(err) });
    } finally {
      running = false;
    }
  };

  return {
    start() {
      if (task) return;
      task = cron.schedule('* * * * *', () => void tick(), { timezone: app.config.timezone });
      app.logger.info('scheduler started', { timezone: app.config.timezone });
      void tick();
    },
    stop() {
      task?.stop();
      task = null;
      app.logger.info('scheduler stopped');
    },
    tickOnce: tick,
  };
}
