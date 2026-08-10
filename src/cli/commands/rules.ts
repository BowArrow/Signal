import { type Command } from 'commander';
import { asc, eq, sql } from 'drizzle-orm';
import { createApp } from '../../core/app.js';
import { communities, communityRules, opportunities } from '../../core/db/schema.js';
import { blockCommunity, findCommunity, unblockCommunity } from '../../core/communities/registry.js';
import { getRule, isStale, markReviewed, refreshRules } from '../../core/rules/registry.js';
import { bold, cyan, dim, green, heading, red, relativeTime, table, yellow } from '../format.js';

function policyColor(policy: string, verified: boolean): string {
  if (!verified) return yellow(policy);
  if (policy === 'forbidden') return red(policy);
  return green(policy);
}

export function registerRulesCommands(program: Command): void {
  const communitiesCmd = program
    .command('communities')
    .alias('comm')
    .description('places Signal has met, and what it knows about their rules');

  communitiesCmd
    .command('list', { isDefault: true })
    .description('every community, with its rules state')
    .option('--unknown', 'only communities with no rules record')
    .action((opts: { unknown?: boolean }) => {
      const app = createApp();

      const rows = app.db
        .select({
          id: communities.id,
          displayName: communities.displayName,
          platform: communities.platform,
          firstSeenAt: communities.firstSeenAt,
          blockedAt: communities.blockedAt,
          selfPromo: communityRules.selfPromo,
          verified: communityRules.verified,
          confidence: communityRules.confidence,
          fetchedAt: communityRules.fetchedAt,
          ruleId: communityRules.id,
          opportunities: sql<number>`(
            select count(*) from ${opportunities}
            where ${opportunities.communityId} = ${communities.id}
          )`,
        })
        .from(communities)
        .leftJoin(communityRules, eq(communityRules.communityId, communities.id))
        .orderBy(asc(communities.displayName))
        .all()
        .filter((r) => (opts.unknown ? r.ruleId == null : true));

      console.log(heading(`${rows.length} communities`));
      console.log(
        table(rows, [
          { header: 'community', value: (r) => cyan(r.displayName), max: 28 },
          { header: 'opps', align: 'right', value: (r) => dim(String(r.opportunities)) },
          {
            header: 'self-promo',
            value: (r) =>
              r.blockedAt
                ? red('blocked')
                : r.selfPromo
                  ? policyColor(r.selfPromo, r.verified ?? false)
                  : red('rules_unknown'),
          },
          {
            header: 'conf',
            align: 'right',
            value: (r) => dim(r.confidence == null ? '—' : r.confidence.toFixed(2)),
          },
          {
            header: 'reviewed',
            value: (r) => (r.verified ? green('yes') : r.ruleId ? yellow('no') : dim('—')),
          },
          { header: 'fetched', align: 'right', value: (r) => dim(relativeTime(r.fetchedAt)) },
        ]),
      );

      const unknown = rows.filter((r) => r.ruleId == null && !r.blockedAt).length;
      if (unknown > 0) {
        console.log(
          `\n  ${yellow(String(unknown))} without a rules record. Nothing is drafted for those.` +
            `\n  ${dim('pnpm signal rules fetch --all')}\n`,
        );
      } else {
        console.log();
      }
      app.close();
    });

  communitiesCmd
    .command('block <community>')
    .description('never draft for this community again')
    .requiredOption('-r, --reason <reason>', 'why')
    .action((name: string, opts: { reason: string }) => {
      const app = createApp();
      const community = findCommunity(app.db, 'reddit', name.replace(/^r\//, ''));
      if (!community) {
        console.error(`${red('✗')} no community called "${name}"`);
        app.close();
        process.exitCode = 1;
        return;
      }
      blockCommunity(app.db, community.id, opts.reason, app.clock);
      console.log(`${green('✓')} ${community.displayName} blocked: ${opts.reason}`);
      app.close();
    });

  communitiesCmd
    .command('unblock <community>')
    .description('undo a block')
    .action((name: string) => {
      const app = createApp();
      const community = findCommunity(app.db, 'reddit', name.replace(/^r\//, ''));
      if (!community) {
        console.error(`${red('✗')} no community called "${name}"`);
        app.close();
        process.exitCode = 1;
        return;
      }
      unblockCommunity(app.db, community.id, app.clock);
      console.log(`${green('✓')} ${community.displayName} unblocked`);
      app.close();
    });

  // ──────────────────────────────────────────────────────────── rules ──

  const rules = program.command('rules').description('fetch, read and confirm community rules');

  rules
    .command('fetch')
    .description('pull rules from the platform and have a model read them')
    .option('-c, --community <name>', 'just this one')
    .option('--all', 'every community that has no record or a stale one')
    .option('--force', 'refetch even records that are current')
    .action(async (opts: { community?: string; all?: boolean; force?: boolean }) => {
      const app = createApp();

      const all = app.db.select().from(communities).all();
      const targets = opts.community
        ? all.filter(
            (c) =>
              c.name === opts.community?.replace(/^r\//, '').toLowerCase() ||
              c.displayName.toLowerCase() === opts.community?.toLowerCase(),
          )
        : all.filter((c) => {
            if (c.blockedAt) return false;
            const rule = getRule(app.db, c.id);
            if (!rule) return true;
            return opts.force === true || isStale(rule, app.clock);
          });

      if (targets.length === 0) {
        console.log(dim('\n  nothing to fetch — every community has a current rules record\n'));
        app.close();
        return;
      }

      console.log(heading(`Fetching rules for ${targets.length} communities`));

      for (const community of targets) {
        const fetcher = app.rulesFetchers.get(community.platform);
        if (!fetcher) {
          console.log(`  ${dim('○')} ${community.displayName}  ${dim('no fetcher for this platform')}`);
          continue;
        }

        const outcome = await refreshRules(
          app.db,
          community,
          fetcher,
          app.llm,
          app.config.anthropic.classifierModel,
          app.logger,
          app.clock,
        );

        if (outcome.status === 'written' && outcome.interpretation) {
          const i = outcome.interpretation;
          console.log(
            `  ${green('●')} ${cyan(community.displayName)}  ${policyColor(i.selfPromo, false)}  ` +
              dim(`confidence ${i.confidence.toFixed(2)}, ${i.evidence.length} quotes, unverified`),
          );
        } else {
          console.log(
            `  ${outcome.status === 'error' ? red('✗') : dim('○')} ${community.displayName}  ${dim(outcome.detail ?? '')}`,
          );
        }
      }

      console.log(
        `\n  ${dim('Every record is written unverified. Read the evidence before trusting it:')}\n` +
          `  ${dim('pnpm signal rules show <community>')}\n`,
      );
      app.close();
    });

  rules
    .command('show <community>')
    .description('the verbatim rules and the reading of them, side by side')
    .action((name: string) => {
      const app = createApp();
      const community = findCommunity(app.db, 'reddit', name.replace(/^r\//, ''))
        ?? findCommunity(app.db, 'hn', name);
      if (!community) {
        console.error(`${red('✗')} no community called "${name}"`);
        app.close();
        process.exitCode = 1;
        return;
      }

      const rule = getRule(app.db, community.id);
      if (!rule) {
        console.log(`\n  ${red('no rules record')} for ${community.displayName}.`);
        console.log(dim(`  pnpm signal rules fetch -c ${name}\n`));
        app.close();
        return;
      }

      console.log(heading(community.displayName));
      console.log(`  ${bold('reading')}`);
      console.log(`    self-promo      ${policyColor(rule.selfPromo, rule.verified)}`);
      console.log(`    ratio cap       ${rule.selfPromoRatioMaxPct ?? dim('not stated')}`);
      console.log(`    flair required  ${rule.flairRequired ? yellow(rule.flairValue ?? 'yes') : dim('no')}`);
      console.log(`    min karma / age ${rule.minKarma ?? dim('—')} / ${rule.minAccountAgeDays ?? dim('—')}`);
      console.log(`    confidence      ${rule.confidence?.toFixed(2) ?? dim('—')}  ${dim(rule.interpretedBy ?? '')}`);
      console.log(
        `    reviewed        ${rule.verified ? green('yes, by you') : yellow('NO — a model read this and nobody checked it')}`,
      );
      if (rule.notes) console.log(`    notes           ${rule.notes}`);

      if (rule.evidence && rule.evidence.length > 0) {
        console.log(`\n  ${bold('quoted as evidence')}`);
        for (const quote of rule.evidence) console.log(`    ${dim('"')}${quote}${dim('"')}`);
      } else {
        console.log(`\n  ${yellow('no evidence quoted')} — treat the reading above with suspicion`);
      }

      console.log(`\n  ${bold('rules as the community published them')}  ${dim(rule.sourceUrl ?? '')}`);
      for (const raw of rule.rawRules ?? []) {
        console.log(`\n    ${cyan(raw.shortName)}`);
        for (const line of (raw.description || '').split('\n')) {
          if (line.trim()) console.log(`      ${dim(line.trim())}`);
        }
      }

      console.log(`\n  ${dim(`confirm with: pnpm signal rules review ${name}`)}\n`);
      app.close();
    });

  rules
    .command('review <community>')
    .description('confirm the reading is right, optionally correcting it')
    .option('-p, --self-promo <policy>', 'override the policy')
    .option('-n, --notes <notes>', 'override the notes')
    .action((name: string, opts: { selfPromo?: string; notes?: string }) => {
      const app = createApp();
      const community =
        findCommunity(app.db, 'reddit', name.replace(/^r\//, '')) ?? findCommunity(app.db, 'hn', name);
      if (!community) {
        console.error(`${red('✗')} no community called "${name}"`);
        app.close();
        process.exitCode = 1;
        return;
      }

      markReviewed(
        app.db,
        community.id,
        {
          ...(opts.selfPromo ? { selfPromo: opts.selfPromo as never } : {}),
          ...(opts.notes ? { notes: opts.notes } : {}),
        },
        app.clock,
      );
      console.log(`${green('✓')} ${community.displayName} marked reviewed`);
      app.close();
    });
}
