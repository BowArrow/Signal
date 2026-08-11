import { type Command } from 'commander';
import { eq } from 'drizzle-orm';
import { createApp } from '../../core/app.js';
import { drafts, opportunities } from '../../core/db/schema.js';
import { runScoring } from '../../core/scoring/run.js';
import { runDrafting } from '../../core/draft/run.js';
import { resolveScoring, setThreshold, setWeights } from '../../core/scoring/weights.js';
import { scoringWeightsSchema } from '../../core/config/schema.js';
import { bold, cyan, dim, green, heading, magenta, red, table, yellow } from '../format.js';

function bar(value: number, width = 10): string {
  const filled = Math.round(value * width);
  return `${'█'.repeat(filled)}${dim('░'.repeat(width - filled))}`;
}

export function registerPipelineCommands(program: Command): void {
  program
    .command('score')
    .description('score unscored opportunities on four axes')
    .option('-n, --limit <count>', 'how many to score', '25')
    .option('--all', 'rescore everything, not just what is new or stale')
    .option('--dry-run', 'print the scores without writing them')
    .action(async (opts: { limit: string; all?: boolean; dryRun?: boolean }) => {
      const app = createApp();
      const readiness = app.llm.available();
      if (!readiness.ready) {
        console.error(`\n${red('✗')} scoring needs a model: ${readiness.reason}\n`);
        app.close();
        process.exitCode = 1;
        return;
      }

      const report = await runScoring(
        app.db,
        app.llm,
        {
          classifierModel: app.config.llm.models.classify,
          weights: app.config.scoring.weights,
          threshold: app.config.scoring.threshold,
          maxThreadAgeHours: app.config.scoring.maxThreadAgeHours,
          cooldownDays: app.config.publishLimits.communityCooldownDays,
          ratioCapPct: app.config.publishLimits.selfPromoRatioMaxPct,
          ratioWindow: app.config.publishLimits.selfPromoRatioWindow,
        },
        app.logger,
        {
          limit: Number.parseInt(opts.limit, 10) || 25,
          ...(opts.all == null ? {} : { all: opts.all }),
          ...(opts.dryRun == null ? {} : { dryRun: opts.dryRun }),
          clock: app.clock,
        },
      );

      console.log(heading(`Scored ${report.scored.length} · threshold ${report.threshold.toFixed(2)}`));
      console.log(
        table(
          [...report.scored].sort((a, b) => b.total - a.total),
          [
            { header: 'title', value: (r) => r.title, max: 48 },
            { header: 'community', value: (r) => cyan(r.community), max: 20 },
            { header: 'contrib', align: 'right', value: (r) => r.axes.contribution.toFixed(2) },
            { header: 'intent', align: 'right', value: (r) => dim(r.axes.intent.toFixed(2)) },
            { header: 'fit', align: 'right', value: (r) => dim(r.axes.fit.toFixed(2)) },
            { header: 'risk', align: 'right', value: (r) => dim(r.axes.risk.toFixed(2)) },
            {
              header: 'total',
              align: 'right',
              value: (r) => (r.total >= report.threshold ? green(r.total.toFixed(2)) : dim(r.total.toFixed(2))),
            },
            { header: 'product', value: (r) => (r.product ? magenta(r.product) : dim('—')) },
            {
              header: 'status',
              value: (r) =>
                r.status === 'scored'
                  ? green(r.status)
                  : r.status === 'rules_unknown'
                    ? red(r.status)
                    : dim(r.status),
            },
          ],
        ),
      );

      const counts = Object.entries(report.counts)
        .map(([k, v]) => `${k} ${bold(String(v))}`)
        .join('   ');
      console.log(`\n  ${counts}${report.failed.length ? `   ${red(`failed ${report.failed.length}`)}` : ''}`);
      if (opts.dryRun) console.log(dim('  dry run — nothing written'));

      const unknown = report.counts['rules_unknown'] ?? 0;
      if (unknown > 0) {
        console.log(
          dim(`\n  ${unknown} held for missing rules. pnpm signal rules fetch --all`),
        );
      }
      console.log();
      app.close();
    });

  program
    .command('draft')
    .description('write replies for opportunities that cleared the threshold')
    .option('-n, --limit <count>', 'how many to draft', '5')
    .option('-o, --only <opportunityId>', 'draft one specific opportunity')
    .option('--note <note>', 'extra instruction appended to the prompt')
    .option('--dry-run', 'print the drafts without writing them')
    .action(async (opts: { limit: string; only?: string; note?: string; dryRun?: boolean }) => {
      const app = createApp();
      const readiness = app.llm.available();
      if (!readiness.ready) {
        console.error(`\n${red('✗')} drafting needs a model: ${readiness.reason}\n`);
        app.close();
        process.exitCode = 1;
        return;
      }

      const report = await runDrafting(
        app.db,
        app.llm,
        {
          draftModel: app.config.llm.models.draft,
          maxOutputTokens: app.config.llm.maxOutputTokens,
        },
        app.logger,
        {
          limit: Number.parseInt(opts.limit, 10) || 5,
          ...(opts.only == null ? {} : { only: opts.only }),
          ...(opts.note == null ? {} : { regenerateNote: opts.note }),
          ...(opts.dryRun == null ? {} : { dryRun: opts.dryRun }),
          clock: app.clock,
        },
      );

      for (const draft of report.drafted) {
        console.log(heading(draft.title));
        console.log(
          `  ${cyan(draft.community)}  ` +
            (draft.mentionsProduct ? magenta('mentions product') : dim('product omitted')) +
            (draft.blocked ? `  ${red('BLOCKED')}` : `  ${green('queued')}`),
        );
        if (draft.omitReason) console.log(dim(`  omitted because: ${draft.omitReason}`));
        console.log();
        for (const line of draft.body.split('\n')) console.log(`  ${line}`);
        if (draft.blocked) console.log(`\n  ${red('✗')} ${draft.blockReason}`);
        for (const warning of draft.warnings) console.log(`  ${yellow('!')} ${warning}`);
        console.log();
      }

      for (const skip of report.skipped) console.log(`  ${dim('○')} ${dim(skip.reason)}`);
      for (const fail of report.failed) console.log(`  ${red('✗')} ${fail.id}: ${fail.error}`);

      const queued = report.drafted.filter((d) => !d.blocked).length;
      console.log(
        `\n  ${bold(String(queued))} queued, ${report.drafted.length - queued} blocked, ` +
          `${report.skipped.length} skipped${opts.dryRun ? dim('  (dry run — nothing written)') : ''}\n`,
      );
      app.close();
    });

  program
    .command('queue')
    .description('drafts waiting on your review')
    .action(() => {
      const app = createApp();
      const rows = app.db
        .select({
          id: drafts.id,
          title: opportunities.title,
          url: opportunities.url,
          body: drafts.generatedBody,
          blocked: drafts.blocked,
          mentions: drafts.productMentioned,
          total: opportunities.scoreTotal,
        })
        .from(drafts)
        .innerJoin(opportunities, eq(drafts.opportunityId, opportunities.id))
        .where(eq(drafts.status, 'pending'))
        .all()
        .filter((r) => !r.blocked);

      console.log(heading(`${rows.length} drafts waiting`));
      if (rows.length === 0) {
        console.log(dim('  Nothing above threshold with a rules record. Run score, then draft.\n'));
      }
      for (const row of rows) {
        console.log(`  ${bold(row.title)}  ${dim(`${row.total?.toFixed(2) ?? '—'}`)}`);
        console.log(`  ${dim(row.url)}`);
        console.log();
        for (const line of row.body.split('\n')) console.log(`    ${line}`);
        console.log(`\n  ${dim('─'.repeat(60))}\n`);
      }
      console.log(
        dim('  Approving and publishing arrive in Phase 3. Nothing here has been sent.\n'),
      );
      app.close();
    });

  // ────────────────────────────────────────────────────────── scoring ──

  const scoring = program.command('scoring').description('inspect and tune the weights');

  scoring
    .command('show', { isDefault: true })
    .description('current weights and threshold')
    .action(() => {
      const app = createApp();
      const resolved = resolveScoring(app.db, {
        weights: app.config.scoring.weights,
        threshold: app.config.scoring.threshold,
      });

      console.log(heading('Scoring weights'));
      for (const [axis, value] of Object.entries(resolved.weights)) {
        const label = axis.padEnd(13);
        console.log(`  ${label} ${bar(value)} ${value.toFixed(2)}${axis === 'risk' ? dim('  (subtracts)') : ''}`);
      }
      console.log(`\n  threshold     ${bar(resolved.threshold)} ${resolved.threshold.toFixed(2)}`);
      console.log(dim(`  weight set    ${resolved.hash}\n`));
      app.close();
    });

  scoring
    .command('set')
    .description('override a weight or the threshold at runtime')
    .option('--contribution <n>')
    .option('--intent <n>')
    .option('--fit <n>')
    .option('--risk <n>')
    .option('--threshold <n>')
    .action((opts: Record<string, string | undefined>) => {
      const app = createApp();
      const current = resolveScoring(app.db, {
        weights: app.config.scoring.weights,
        threshold: app.config.scoring.threshold,
      });

      const next = { ...current.weights };
      for (const axis of ['contribution', 'intent', 'fit', 'risk'] as const) {
        const raw = opts[axis];
        if (raw != null) next[axis] = Number.parseFloat(raw);
      }

      const parsed = scoringWeightsSchema.safeParse(next);
      if (!parsed.success) {
        console.error(`\n${red('✗')} ${parsed.error.issues.map((i) => i.message).join('; ')}\n`);
        app.close();
        process.exitCode = 1;
        return;
      }

      setWeights(app.db, parsed.data, app.clock.now());
      if (opts['threshold'] != null) {
        setThreshold(app.db, Number.parseFloat(opts['threshold']), app.clock.now());
      }

      console.log(
        `${green('✓')} weights updated. Existing totals are now stale — ` +
          dim('pnpm signal score --all'),
      );
      app.close();
    });
}
