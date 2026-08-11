import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { sources, type Source } from '../db/schema.js';
import type { Clock } from '../lib/clock.js';
import { systemClock } from '../lib/clock.js';
import type { Logger } from '../lib/logger.js';
import { persistItems } from './dedup.js';
import { enqueue } from '../jobs/queue.js';
import { JOB_HYDRATE_BODY } from './hydrate.js';
import type { NormalizedItem, Poller } from './types.js';

export interface SourceIngestReport {
  readonly source: string;
  readonly kind: Source['kind'];
  readonly status: 'ok' | 'skipped' | 'error' | 'not_due';
  readonly detail?: string;
  readonly fetched: number;
  readonly inserted: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly dropped: number;
  readonly durationMs: number;
}

export interface IngestReport {
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly sources: SourceIngestReport[];
  readonly totals: { inserted: number; updated: number; unchanged: number; dropped: number };
}

export interface IngestOptions {
  /** Poll every enabled source regardless of its interval. */
  readonly force?: boolean;
  /** Restrict to one source identifier. */
  readonly only?: string;
  /**
   * Drop items already older than this. Replying to a two-year-old thread
   * helps nobody, and storing it costs a classifier call later. Items with an
   * unknown post time are kept — absence of a date is not evidence of age.
   */
  readonly maxItemAgeHours?: number;
  readonly clock?: Clock;
}

/** Split items into those worth keeping and those already too old. */
export function partitionByAge(
  items: readonly NormalizedItem[],
  now: number,
  maxAgeHours: number | undefined,
): { fresh: NormalizedItem[]; stale: NormalizedItem[] } {
  if (maxAgeHours == null) return { fresh: [...items], stale: [] };
  const cutoff = now - maxAgeHours * 3_600_000;
  const fresh: NormalizedItem[] = [];
  const stale: NormalizedItem[] = [];
  for (const item of items) {
    if (item.postedAt != null && item.postedAt < cutoff) stale.push(item);
    else fresh.push(item);
  }
  return { fresh, stale };
}

function isDue(source: Source, now: number, force: boolean): boolean {
  if (force) return true;
  if (source.lastPolledAt == null) return true;
  return now - source.lastPolledAt >= source.pollIntervalSeconds * 1000;
}

/**
 * One ingestion cycle across every enabled source.
 *
 * A single source failing must not take the cycle down — a subreddit going
 * private or a feed 500ing is normal, and the other sources should still run.
 * Failures are recorded on the source row so the dashboard can show a poller
 * that has been quietly broken for a week.
 */
export async function runIngest(
  db: Db,
  pollers: readonly Poller[],
  logger: Logger,
  options: IngestOptions = {},
): Promise<IngestReport> {
  const clock = options.clock ?? systemClock;
  const startedAt = clock.now();
  const byKind = new Map(pollers.map((p) => [p.kind, p]));
  const reports: SourceIngestReport[] = [];

  const rows = db.select().from(sources).where(eq(sources.enabled, true)).all();
  const targets = options.only
    ? rows.filter((s) => s.identifier === options.only || s.displayName === options.only)
    : rows;

  if (options.only && targets.length === 0) {
    logger.warn('no enabled source matched', { only: options.only });
  }

  for (const source of targets) {
    const began = clock.now();
    const base = { source: source.displayName, kind: source.kind, durationMs: 0 };

    if (!isDue(source, began, options.force ?? false)) {
      reports.push({
        ...base,
        status: 'not_due',
        detail: `next poll in ${Math.ceil(
          (source.pollIntervalSeconds * 1000 - (began - (source.lastPolledAt ?? 0))) / 1000,
        )}s`,
        fetched: 0,
        inserted: 0,
        updated: 0,
        unchanged: 0,
        dropped: 0,
      });
      continue;
    }

    const poller = byKind.get(source.kind);
    if (!poller) {
      reports.push({
        ...base,
        status: 'skipped',
        detail: `no poller registered for kind "${source.kind}"`,
        fetched: 0,
        inserted: 0,
        updated: 0,
        unchanged: 0,
        dropped: 0,
      });
      continue;
    }

    // A poller that reads pages rather than an API only runs for a source
    // carrying a named robots exemption. Checked here as well as in the
    // HttpClient, so a misconfigured source fails with an explanation rather
    // than a RobotsDisallowedError from three layers down.
    if (poller.requiresRobotsExemption?.() && !source.ignoreRobotsTxt) {
      reports.push({
        ...base,
        status: 'skipped',
        detail:
          'this poller reads public pages rather than an API, so the source needs ' +
          'ignoreRobotsTxt with a stated reason in signal.config.ts',
        fetched: 0,
        inserted: 0,
        updated: 0,
        unchanged: 0,
        dropped: 0,
      });
      continue;
    }

    const readiness = poller.available();
    if (!readiness.ready) {
      reports.push({
        ...base,
        status: 'skipped',
        ...(readiness.reason == null ? {} : { detail: readiness.reason }),
        fetched: 0,
        inserted: 0,
        updated: 0,
        unchanged: 0,
        dropped: 0,
      });
      continue;
    }

    try {
      const result = await poller.poll(source);
      // A per-source window wins over the global one: see sourceConfigSchema.
      const ageWindow = source.maxItemAgeHours ?? options.maxItemAgeHours;
      const { fresh, stale } = partitionByAge(result.items, clock.now(), ageWindow);

      // Scraped Reddit text posts arrive without a body — the listing page
      // does not carry one. Mark them, then queue a fetch each.
      const pending = (result as {
        pendingBodies?: { externalId: string; permalink: string; platform?: 'reddit' | 'discourse' }[];
      })
        .pendingBodies;
      const needsBody = new Set((pending ?? []).map((p) => p.externalId));

      const persisted = persistItems(db, source, fresh, clock, needsBody);

      if (pending?.length) {
        const byExternalId = new Map(
          fresh.map((item, index) => [item.externalId, persisted.ids[index]]),
        );
        let queued = 0;
        for (const entry of pending) {
          const opportunityId = byExternalId.get(entry.externalId);
          if (!opportunityId) continue;
          const created = enqueue(
            db,
            JOB_HYDRATE_BODY,
            {
              opportunityId,
              permalink: entry.permalink,
              externalId: entry.externalId,
              platform: entry.platform ?? 'reddit',
            },
            { dedupeKey: `${JOB_HYDRATE_BODY}:${opportunityId}` },
            clock,
          );
          if (created) queued += 1;
        }
        if (queued) logger.debug('queued body fetches', { source: source.displayName, queued });
      }

      db.update(sources)
        .set({ lastPolledAt: clock.now(), lastPollError: null, updatedAt: clock.now() })
        .where(eq(sources.id, source.id))
        .run();

      reports.push({
        ...base,
        status: 'ok',
        ...(stale.length ? { detail: `${stale.length} past the age cutoff` } : {}),
        fetched: result.items.length + result.skipped.length,
        inserted: persisted.inserted,
        updated: persisted.updated,
        unchanged: persisted.unchanged,
        dropped: result.skipped.length + stale.length,
        durationMs: clock.now() - began,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('source poll failed', { source: source.displayName, err: message });

      db.update(sources)
        .set({ lastPolledAt: clock.now(), lastPollError: message, updatedAt: clock.now() })
        .where(eq(sources.id, source.id))
        .run();

      reports.push({
        ...base,
        status: 'error',
        detail: message,
        fetched: 0,
        inserted: 0,
        updated: 0,
        unchanged: 0,
        dropped: 0,
        durationMs: clock.now() - began,
      });
    }
  }

  const totals = reports.reduce(
    (acc, r) => ({
      inserted: acc.inserted + r.inserted,
      updated: acc.updated + r.updated,
      unchanged: acc.unchanged + r.unchanged,
      dropped: acc.dropped + r.dropped,
    }),
    { inserted: 0, updated: 0, unchanged: 0, dropped: 0 },
  );

  return { startedAt, finishedAt: clock.now(), sources: reports, totals };
}
