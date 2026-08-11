#!/usr/bin/env node
import { Command } from 'commander';
import { desc, eq, sql } from 'drizzle-orm';
import { createApp } from '../core/app.js';
import { seed } from '../core/db/seed.js';
import { opportunities, sources, products } from '../core/db/schema.js';
import { runIngest } from '../core/ingest/run.js';
import { createScheduler } from '../core/jobs/scheduler.js';
import { queueStats } from '../core/jobs/queue.js';
import { registerRulesCommands } from './commands/rules.js';
import { registerPipelineCommands } from './commands/pipeline.js';
import { bold, cyan, dim, green, heading, magenta, red, relativeTime, table, yellow } from './format.js';

const program = new Command();

program
  .name('signal')
  .description('Signal — find threads worth answering, draft a reply, wait for your approval.')
  .version('0.1.0');

// ─────────────────────────────────────────────────────────────── db ──

const db = program.command('db').description('database lifecycle');

db.command('migrate')
  .description('apply pending migrations')
  .action(() => {
    const app = createApp({ migrate: true });
    console.log(green('✓') + ' migrations applied');
    app.close();
  });

db.command('seed')
  .description('sync products and sources from signal.config.ts (idempotent)')
  .action(() => {
    const app = createApp();
    const result = seed(app.db, app.config, app.logger);
    console.log(
      `${green('✓')} products ${result.productsInserted} new, ${result.productsUpdated} updated` +
        (result.productsRetired ? yellow(`, ${result.productsRetired} retired`) : '') +
        `  ·  sources ${result.sourcesInserted} new, ${result.sourcesUpdated} updated` +
        (result.sourcesRetired ? yellow(`, ${result.sourcesRetired} retired`) : ''),
    );
    if (result.productsRetired || result.sourcesRetired) {
      console.log(
        dim('  Retired means disabled, not deleted — existing history still references it.'),
      );
    }
    console.log(
      dim(
        '  Communities and their rules are not seeded from config. Signal meets a\n' +
          '  community when it ingests something from it, then fetches that\n' +
          "  community's own published rules: pnpm signal rules fetch --all",
      ),
    );
    app.close();
  });

// ─────────────────────────────────────────────────────────── ingest ──

const ingest = program.command('ingest').description('pull new items from sources');

ingest
  .command('run', { isDefault: true })
  .description('run one ingestion cycle')
  .option('-f, --force', 'poll every enabled source, ignoring its interval')
  .option('-o, --only <identifier>', 'restrict to one source')
  .action(async (opts: { force?: boolean; only?: string }) => {
    const app = createApp();
    const report = await runIngest(app.db, app.pollers, app.logger, {
      ...(opts.force == null ? {} : { force: opts.force }),
      ...(opts.only == null ? {} : { only: opts.only }),
      maxItemAgeHours: app.config.scoring.maxThreadAgeHours,
      clock: app.clock,
    });

    console.log(heading('Ingest'));
    console.log(
      table(report.sources, [
        { header: 'source', value: (r) => r.source, max: 30 },
        { header: 'status', value: (r) => statusColor(r.status) },
        { header: 'new', align: 'right', value: (r) => (r.inserted ? green(String(r.inserted)) : dim('0')) },
        { header: 'upd', align: 'right', value: (r) => String(r.updated) },
        { header: 'same', align: 'right', value: (r) => dim(String(r.unchanged)) },
        { header: 'dropped', align: 'right', value: (r) => dim(String(r.dropped)) },
        { header: 'note', value: (r) => dim(r.detail ?? ''), max: 70 },
      ]),
    );
    console.log(
      `\n  ${bold(String(report.totals.inserted))} new opportunities in ` +
        `${((report.finishedAt - report.startedAt) / 1000).toFixed(1)}s\n`,
    );
    app.close();
  });

// ────────────────────────────────────────────────── opportunities ──

program
  .command('opportunities')
  .alias('opps')
  .description('list recently discovered opportunities')
  .option('-n, --limit <count>', 'how many to show', '20')
  .option('-s, --status <status>', 'filter by status')
  .action((opts: { limit: string; status?: string }) => {
    const app = createApp();
    const limit = Number.parseInt(opts.limit, 10) || 20;

    const base = app.db
      .select({
        title: opportunities.title,
        url: opportunities.url,
        author: opportunities.author,
        status: opportunities.status,
        discoveredAt: opportunities.discoveredAt,
        postedAt: opportunities.postedAt,
        comments: opportunities.commentCount,
        score: opportunities.platformScore,
        total: opportunities.scoreTotal,
        source: sources.displayName,
      })
      .from(opportunities)
      .innerJoin(sources, eq(opportunities.sourceId, sources.id))
      // Everything in one ingest batch shares a discoveredAt, so break the tie
      // on when the thread was actually posted rather than leaving it to SQLite.
      .orderBy(desc(opportunities.discoveredAt), desc(opportunities.postedAt))
      .limit(limit);

    const rows = opts.status
      ? base.where(eq(opportunities.status, opts.status as never)).all()
      : base.all();

    console.log(heading(`Last ${rows.length} opportunities`));
    console.log(
      table(rows, [
        { header: 'source', value: (r) => cyan(r.source), max: 24 },
        { header: 'title', value: (r) => r.title, max: 62 },
        { header: 'age', align: 'right', value: (r) => dim(relativeTime(r.postedAt ?? r.discoveredAt)) },
        { header: 'pts', align: 'right', value: (r) => dim(String(r.score ?? '—')) },
        { header: 'cmts', align: 'right', value: (r) => dim(String(r.comments ?? '—')) },
        { header: 'score', align: 'right', value: (r) => (r.total == null ? dim('—') : r.total.toFixed(2)) },
        { header: 'status', value: (r) => statusColor(r.status) },
      ]),
    );
    console.log();
    app.close();
  });

// ─────────────────────────────────────────────────────────── status ──

program
  .command('status')
  .description('what Signal can currently do, and what it is missing')
  .action(() => {
    const app = createApp();

    console.log(heading('Capabilities'));
    for (const cap of app.capabilities) {
      const mark = cap.available ? green('●') : dim('○');
      const note = cap.available ? '' : dim(`  needs ${cap.missing.join(', ')}`);
      console.log(`  ${mark} ${cap.name}${note}`);
    }

    const counts = app.db
      .select({ status: opportunities.status, n: sql<number>`count(*)` })
      .from(opportunities)
      .groupBy(opportunities.status)
      .all();

    console.log(heading('Opportunities'));
    if (counts.length === 0) console.log(dim('  none yet — run `pnpm signal ingest run --force`'));
    for (const c of counts) console.log(`  ${statusColor(c.status).padEnd(24)} ${bold(String(c.n))}`);

    const srcRows = app.db.select().from(sources).all();
    console.log(heading('Sources'));
    console.log(
      table(srcRows, [
        { header: 'source', value: (s) => (s.enabled ? cyan(s.displayName) : dim(s.displayName)), max: 30 },
        { header: 'kind', value: (s) => dim(s.kind) },
        { header: 'every', align: 'right', value: (s) => dim(`${Math.round(s.pollIntervalSeconds / 60)}m`) },
        { header: 'last poll', align: 'right', value: (s) => dim(relativeTime(s.lastPolledAt)) },
        // Listed rather than buried in config, so an exemption stays visible
        // to whoever runs this next.
        { header: 'robots', value: (s) => (s.ignoreRobotsTxt ? yellow('exempt') : dim('honored')) },
        { header: 'error', value: (s) => (s.lastPollError ? red(s.lastPollError) : ''), max: 40 },
      ]),
    );

    const exempt = srcRows.filter((s) => s.ignoreRobotsTxt);
    if (exempt.length > 0) {
      console.log(
        `\n  ${yellow(`${exempt.length} sources bypass robots.txt`)}  ` +
          dim(exempt[0]?.robotsExemptionReason ?? ''),
      );
    }

    const prodRows = app.db.select().from(products).all();
    console.log(heading('Products'));
    console.log(
      table(prodRows, [
        { header: 'key', value: (p) => (p.enabled ? magenta(p.key) : dim(p.key)) },
        { header: 'name', value: (p) => (p.enabled ? p.name : dim(`${p.name}  retired`)) },
        { header: 'price', align: 'right', value: (p) => (p.priceCents ? `$${(p.priceCents / 100).toFixed(0)}` : dim('—')) },
        {
          header: 'utm base',
          value: (p) =>
            // A placeholder only matters for a product still in play.
            p.enabled && p.utmBase.includes('example.invalid')
              ? yellow(`${p.utmBase}  ← placeholder`)
              : dim(p.utmBase),
          max: 60,
        },
      ]),
    );

    console.log(heading('Job queue'));
    const stats = queueStats(app.db);
    console.log(
      Object.keys(stats).length === 0
        ? dim('  empty')
        : '  ' + Object.entries(stats).map(([k, v]) => `${k} ${bold(String(v))}`).join('   '),
    );
    console.log();
    app.close();
  });

// ────────────────────────────────────────────────────────── worker ──

program
  .command('worker')
  .description('run the scheduler in the foreground (Ctrl-C to stop)')
  .option('--once', 'run a single tick and exit')
  .action(async (opts: { once?: boolean }) => {
    const app = createApp();
    const scheduler = createScheduler(app);

    if (opts.once) {
      await scheduler.tickOnce();
      app.close();
      return;
    }

    scheduler.start();
    const shutdown = (): void => {
      scheduler.stop();
      app.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

registerRulesCommands(program);
registerPipelineCommands(program);

// ──────────────────────────────────────────────────────────────────────

function statusColor(status: string): string {
  switch (status) {
    case 'ok':
    case 'queued':
    case 'published':
      return green(status);
    case 'error':
      return red(status);
    case 'rules_unknown':
      return red(status);
    case 'rejected':
    case 'skipped':
      return yellow(status);
    case 'expired':
    case 'not_due':
    case 'paused':
      return dim(status);
    default:
      return status;
  }
}

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    console.error(`\n${red('✗')} ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  }
}

void main();
