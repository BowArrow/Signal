import { shell, type IpcMain } from 'electron';
import { desc, eq, sql } from 'drizzle-orm';
import type { App as SignalApp } from '../../src/core/app.js';
import {
  communities,
  communityRules,
  opportunities,
  products,
  sources,
} from '../../src/core/db/schema.js';
import { resolveDatabasePath, selectNativeBinding } from '../../src/core/db/client.js';
import { runIngest } from '../../src/core/ingest/run.js';
import { queueStats } from '../../src/core/jobs/queue.js';
import { IPC, type IngestSummary, type OpportunityView, type SystemStatus } from '../../src/shared/ipc.js';

/**
 * Every channel is read-or-configure. There is deliberately no publish channel
 * here: publishing arrives in Phase 3 behind an explicit approve action, and
 * putting it anywhere the renderer can reach casually would defeat the point.
 */
export function registerHandlers(ipc: IpcMain, signal: SignalApp): void {
  ipc.handle(IPC.status, (): SystemStatus => {
    const sourceRows = signal.db.select().from(sources).all();
    // Rules belong to communities now, not sources. A source is "monitored"
    // for rules purposes when the community it points at has a record.
    const ruleRows = signal.db
      .select({ name: communities.name, platform: communities.platform })
      .from(communityRules)
      .innerJoin(communities, eq(communityRules.communityId, communities.id))
      .all();
    const withRules = new Set(ruleRows.map((r) => `${r.platform}:${r.name}`));

    const counts = signal.db
      .select({ status: opportunities.status, n: sql<number>`count(*)` })
      .from(opportunities)
      .groupBy(opportunities.status)
      .all();

    return {
      version: '0.1.0',
      capabilities: signal.capabilities.map((c) => ({
        name: c.name,
        available: c.available,
        missing: c.missing,
      })),
      sources: sourceRows.map((s) => ({
        id: s.id,
        kind: s.kind,
        displayName: s.displayName,
        identifier: s.identifier,
        enabled: s.enabled,
        pollIntervalSeconds: s.pollIntervalSeconds,
        lastPolledAt: s.lastPolledAt,
        lastPollError: s.lastPollError,
        // A search source spans many communities, so a single yes/no is
        // meaningless for it — the Phase 3 UI shows those per community.
        hasRulesRecord:
          s.kind === 'reddit_search' || withRules.has(`${s.kind}:${s.identifier.toLowerCase()}`),
      })),
      products: signal.db
        .select()
        .from(products)
        .all()
        .map((p) => ({
          id: p.id,
          key: p.key,
          name: p.name,
          priceCents: p.priceCents,
          utmBase: p.utmBase,
          utmBaseIsPlaceholder: p.utmBase.includes('example.invalid'),
        })),
      opportunityCounts: Object.fromEntries(counts.map((c) => [c.status, Number(c.n)])),
      queueStats: queueStats(signal.db),
      databasePath: resolveDatabasePath(signal.config.databaseUrl),
      runtime: {
        electron: process.versions.electron ?? 'not electron',
        node: process.versions.node,
        nativeBinding: selectNativeBinding() ?? null,
      },
      limits: {
        maxRepliesPerPlatformPerDay: signal.config.publishLimits.maxRepliesPerPlatformPerDay,
        communityCooldownDays: signal.config.publishLimits.communityCooldownDays,
        selfPromoRatioMaxPct: signal.config.publishLimits.selfPromoRatioMaxPct,
      },
    };
  });

  ipc.handle(IPC.opportunities, (_event, limit: unknown): OpportunityView[] => {
    const n = typeof limit === 'number' && limit > 0 && limit <= 500 ? Math.floor(limit) : 20;
    return signal.db
      .select({
        id: opportunities.id,
        source: sources.displayName,
        title: opportunities.title,
        url: opportunities.url,
        author: opportunities.author,
        status: opportunities.status,
        postedAt: opportunities.postedAt,
        discoveredAt: opportunities.discoveredAt,
        commentCount: opportunities.commentCount,
        platformScore: opportunities.platformScore,
        scoreTotal: opportunities.scoreTotal,
      })
      .from(opportunities)
      .innerJoin(sources, eq(opportunities.sourceId, sources.id))
      .orderBy(desc(opportunities.discoveredAt), desc(opportunities.postedAt))
      .limit(n)
      .all();
  });

  ipc.handle(IPC.ingestNow, async (): Promise<IngestSummary> => {
    const report = await runIngest(signal.db, signal.pollers, signal.logger, {
      force: true,
      maxItemAgeHours: signal.config.scoring.maxThreadAgeHours,
      clock: signal.clock,
    });
    return {
      inserted: report.totals.inserted,
      updated: report.totals.updated,
      dropped: report.totals.dropped,
      durationMs: report.finishedAt - report.startedAt,
      sources: report.sources.map((s) => ({
        source: s.source,
        status: s.status,
        inserted: s.inserted,
        detail: s.detail,
      })),
    };
  });

  ipc.handle(IPC.toggleSource, (_event, sourceId: unknown, enabled: unknown): void => {
    if (typeof sourceId !== 'string' || typeof enabled !== 'boolean') {
      throw new Error('toggleSource expects (string, boolean)');
    }
    signal.db
      .update(sources)
      .set({ enabled, updatedAt: signal.clock.now() })
      .where(eq(sources.id, sourceId))
      .run();
  });

  ipc.handle(IPC.openExternal, async (_event, url: unknown): Promise<void> => {
    if (typeof url !== 'string') throw new Error('openExternal expects a string');
    // Only ever hand the OS an http(s) URL. A file: or javascript: URL arriving
    // from the renderer would be a real problem.
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`refusing to open a ${parsed.protocol} url`);
    }
    await shell.openExternal(url);
  });
}
