/**
 * Read-only look inside the database.
 *
 * Exists so routine "what is actually in there" checks are a committed script
 * you can read and allowlist, rather than an ad-hoc `node -e` string that has
 * to be approved every single time and could contain anything.
 *
 * Opens the file read-only. It cannot modify anything.
 *
 *   node scripts/inspect.mjs                 # overview
 *   node scripts/inspect.mjs communities     # who Signal has met
 *   node scripts/inspect.mjs opportunities   # recent items
 *   node scripts/inspect.mjs rules           # rules records and confidence
 *   node scripts/inspect.mjs jobs            # queue depth
 *   node scripts/inspect.mjs llm             # recorded model calls
 */
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';

const DB_PATH = process.env.SIGNAL_DB ?? 'data/signal.db';
const BINDING = 'native/better_sqlite3-node.node';

if (!existsSync(DB_PATH)) {
  console.error(`no database at ${DB_PATH} — run: pnpm signal db migrate`);
  process.exit(1);
}

const db = new Database(DB_PATH, {
  readonly: true,
  ...(existsSync(BINDING) ? { nativeBinding: BINDING } : {}),
});

const pad = (v, n) => String(v ?? '').padEnd(n);
const num = (v, n) => String(v ?? 0).padStart(n);
const rows = (sql, ...args) => db.prepare(sql).all(...args);
const one = (sql, ...args) => db.prepare(sql).get(...args);

function overview() {
  const counts = one(`
    select
      (select count(*) from opportunities) opportunities,
      (select count(*) from communities)   communities,
      (select count(*) from community_rules) rules,
      (select count(*) from drafts)        drafts,
      (select count(*) from publications)  publications,
      (select count(*) from jobs where status = 'pending') pending_jobs`);

  console.log('\nSignal database\n');
  for (const [k, v] of Object.entries(counts)) console.log(`  ${pad(k, 16)} ${num(v, 6)}`);

  console.log('\nOpportunities by status');
  for (const r of rows('select status, count(*) n from opportunities group by status order by n desc')) {
    console.log(`  ${pad(r.status, 16)} ${num(r.n, 6)}`);
  }

  console.log('\nBy platform');
  for (const r of rows(`
    select c.platform,
           count(distinct c.id) communities,
           count(o.id) opps,
           sum(case when length(o.body) > 0 then 1 else 0 end) with_body,
           sum(o.needs_body) pending_body
    from communities c left join opportunities o on o.community_id = c.id
    group by c.platform order by opps desc`)) {
    console.log(
      `  ${pad(r.platform, 16)} ${num(r.communities, 4)} communities  ` +
        `${num(r.opps, 5)} opps  ${num(r.with_body, 5)} with body  ${num(r.pending_body, 4)} awaiting body`,
    );
  }
  console.log();
}

function communities() {
  const list = rows(`
    select c.display_name, c.platform, c.monitored, c.blocked_at,
           (select count(*) from opportunities o where o.community_id = c.id) n,
           r.self_promo, r.verified, r.confidence
    from communities c
    left join community_rules r on r.community_id = c.id
    order by n desc limit 40`);

  console.log('\n  COMMUNITY                   PLATFORM        OPPS  MON  SELF-PROMO             CONF');
  for (const r of list) {
    console.log(
      `  ${pad(r.display_name, 26)}  ${pad(r.platform, 14)}  ${num(r.n, 4)}  ` +
        `${pad(r.monitored ? 'yes' : '', 3)}  ${pad(r.blocked_at ? 'BLOCKED' : (r.self_promo ?? 'rules_unknown'), 21)}  ` +
        `${r.confidence == null ? '—' : r.confidence.toFixed(2)}`,
    );
  }
  const total = one('select count(*) n from communities').n;
  console.log(`\n  ${total} communities total\n`);
}

function opportunities() {
  const list = rows(`
    select o.title, c.display_name community, o.status, o.score_total, length(o.body) body_len
    from opportunities o left join communities c on c.id = o.community_id
    order by o.discovered_at desc, o.posted_at desc limit 25`);

  console.log('\n  TITLE                                                  COMMUNITY             STATUS      SCORE  BODY');
  for (const r of list) {
    const title = r.title.length > 52 ? `${r.title.slice(0, 51)}…` : r.title;
    console.log(
      `  ${pad(title, 53)}  ${pad(r.community, 20)}  ${pad(r.status, 10)}  ` +
        `${pad(r.score_total == null ? '—' : r.score_total.toFixed(2), 5)}  ${num(r.body_len, 5)}`,
    );
  }
  console.log();
}

function rulesRecords() {
  const list = rows(`
    select c.display_name, c.platform, r.self_promo, r.verified, r.confidence,
           r.interpreted_by, json_array_length(coalesce(r.evidence, '[]')) quotes,
           json_array_length(coalesce(r.raw_rules, '[]')) raw
    from community_rules r join communities c on c.id = r.community_id
    order by r.confidence desc nulls last limit 40`);

  console.log('\n  COMMUNITY                   SELF-PROMO             CONF  QUOTES  RAW  REVIEWED  BY');
  for (const r of list) {
    console.log(
      `  ${pad(r.display_name, 26)}  ${pad(r.self_promo, 21)}  ` +
        `${pad(r.confidence == null ? '—' : r.confidence.toFixed(2), 4)}  ${num(r.quotes, 6)}  ` +
        `${num(r.raw, 3)}  ${pad(r.verified ? 'yes' : 'no', 8)}  ${r.interpreted_by ?? ''}`,
    );
  }
  console.log();
}

function jobs() {
  console.log();
  for (const r of rows('select kind, status, count(*) n from jobs group by kind, status order by n desc')) {
    console.log(`  ${pad(r.kind, 24)} ${pad(r.status, 10)} ${num(r.n, 5)}`);
  }
  const dead = rows("select kind, last_error from jobs where status = 'dead' limit 5");
  if (dead.length) {
    console.log('\n  dead jobs:');
    for (const d of dead) console.log(`    ${d.kind}: ${String(d.last_error).slice(0, 90)}`);
  }
  console.log();
}

function llm() {
  const list = rows(`
    select task, provider, model, count(*) calls,
           sum(case when ok then 0 else 1 end) failures,
           sum(case when json_ok then 1 else 0 end) json_ok,
           sum(case when json_ok is not null then 1 else 0 end) json_judged,
           avg(latency_ms) avg_ms, sum(output_tokens) out_tokens
    from llm_calls group by task, provider, model order by calls desc`);

  if (!list.length) {
    console.log('\n  no model calls recorded yet\n');
    return;
  }
  console.log('\n  TASK             MODEL                  CALLS  FAIL  JSON OK   AVG MS  OUT TOK');
  for (const r of list) {
    const jsonRate = r.json_judged ? `${Math.round((r.json_ok / r.json_judged) * 100)}%` : '—';
    console.log(
      `  ${pad(r.task, 15)}  ${pad(r.model, 20)}  ${num(r.calls, 5)}  ${num(r.failures, 4)}  ` +
        `${pad(jsonRate, 7)}  ${num(Math.round(r.avg_ms), 6)}  ${num(r.out_tokens, 7)}`,
    );
  }
  console.log();
}

const commands = { communities, opportunities, rules: rulesRecords, jobs, llm };
const which = process.argv[2];

if (!which) overview();
else if (commands[which]) commands[which]();
else {
  console.error(`unknown section "${which}". try: ${Object.keys(commands).join(', ')}`);
  process.exitCode = 1;
}

db.close();
