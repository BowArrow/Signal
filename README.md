# Signal

A marketing operations system for one person.

Signal watches places where my products are a genuine answer to a real
question, drafts a reply in my voice, puts it in a review queue, publishes on
approval, and tracks which posts actually produced revenue.

**It is not an auto-poster.** Every outbound message to a community I do not
own passes through human approval. That constraint is load-bearing and it is
enforced in code, not documentation.

---

## Current state — end of Phase 1

Ingestion works end to end. Nothing is scored, nothing is drafted, and no
message has ever left the machine.

| | |
| --- | --- |
| ✅ Phase 1 | Schema, config validation, seed, Reddit / HN / RSS ingestion, dedup, durable job queue, CLI, Electron shell |
| ⬜ Phase 2 | Scoring, drafting, disclosure validator, community rules registry |
| ⬜ Phase 3 | Review queue UI, Reddit publishing, link tracking, rate limits |
| ⬜ Phase 4 | Stripe attribution, metrics, weekly digest, owned-channel automation |

## Quick start

```bash
pnpm install            # also builds both native ABIs, see below
pnpm db:migrate
pnpm db:seed            # reads products and sources from signal.config.ts
pnpm signal status      # what Signal can currently do, and what it is missing
pnpm signal ingest run --force
pnpm signal opportunities -n 20
```

Hacker News and RSS need no credentials, so that sequence produces real
opportunities on a fresh clone. The six subreddits stay dark until Reddit keys
are in `.env`, and `signal status` says so plainly rather than failing.

Then the app:

```bash
pnpm dev                # Electron, with renderer HMR
```

## The guardrails

These are properties of the system, not settings.

**No autonomous posting to third-party communities.** Reddit, HN, Discord, X,
forums — every draft lands in the review queue. There is no config flag that
turns this off, and there is no IPC channel the renderer could use to publish
without an approve action in the main process.

**Hacker News is draft-only, permanently.** Signal surfaces the thread and
writes the comment. I paste it myself. There is no HN publish path in the
codebase.

**One identity per platform.** The schema has no accounts table. It cannot
express a second persona. If a feature seems to need one, that is a signal to
stop and talk, not to add a column.

**Disclosure is mandatory.** A draft that names a product without a disclosure
line is blocked by a validator before it reaches the queue. Phase 2.

**No rules record, no draft.** Before anything is generated for a community,
Signal checks a stored rules record: is self-promo allowed, is there a ratio
requirement, is flair required. No record means the opportunity is held as
`rules_unknown` regardless of how well it scored. Guessing a subreddit's
policy is how you get banned from it.

**Rate limits at the publish layer.** Max replies per platform per day, a
minimum cooldown between posts in one community, and a rolling self-promo
ratio cap. Configurable, with defaults that hold. Phase 3.

**Official APIs, honored robots.txt.** Reddit and HN go through documented
APIs. RSS, the only poller that touches arbitrary hosts, goes through a
robots.txt check and a per-host rate limiter. `http.respectRobotsTxt` is typed
as `true` — Zod rejects the config if you try to set it to `false`.

Owned channels — my blog, my site, my YouTube copy, my email list — are the
exception. Full automation is fine there. Phase 4.

## Architecture

```
signal.config.ts        one config file, Zod-validated at boot, fails loudly
src/
  core/                 the engine — no Electron, no DOM, no React
    config/             schema, env, capability reporting
    db/                 Drizzle schema, migrations, client, seed
    ingest/             normalize, dedup, reddit / hackernews / rss, runner
    jobs/               durable SQLite-backed queue and the cron scheduler
    lib/                clock, logger, rate-limited HTTP with robots.txt
  cli/                  the same engine, no window
  shared/               the typed IPC contract
  prompts/              versioned prompt templates and voice.md
electron/
  main/                 owns the database, the pollers, and every credential
  preload/              the only bridge, contextIsolation on
  renderer/             React + the Nocturne design system. Reads only.
edge/                   Firebase: click redirects and the Stripe webhook
design-ref/             the design comp and stylesheet, for reference
```

The engine in `src/core` knows nothing about Electron. The CLI and the desktop
app are two front ends over one `createApp()`, so there is a single wiring
diagram and no chance of the two drifting.

**Runtime:** Node 20+, TypeScript strict (plus `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`).
**Database:** SQLite via better-sqlite3 and Drizzle. One file, easy to back up.
Only `text` / `integer` / `real` columns, timestamps as epoch milliseconds,
JSON as text, every query through the query builder — so moving to Postgres
means swapping imports in `src/core/db/schema.ts`, not rewriting the app.
**Jobs:** a durable queue in the same SQLite file, driven by `node-cron`. No
Redis, no BullMQ. Cron enqueues, a worker executes, so a crash between the two
loses nothing.
**LLM:** Anthropic SDK. Prompts live in `src/prompts/` as versioned files,
never as inline string literals.

### The native module split

`better-sqlite3` is native, and Electron and Node ship different ABIs.
Building it for one breaks the other. Rather than have you rebuild every time
you switch between `pnpm dev` and `pnpm test`, `scripts/rebuild-native.mjs`
builds it twice into `native/`, and `src/core/db/client.ts` picks the right
binary at runtime. It runs automatically on `pnpm install`.

Re-run it after upgrading Node, Electron, or better-sqlite3:

```bash
pnpm rebuild:native
```

It will refuse to finish if the two binaries come out byte-identical, which
means one of the rebuilds silently did nothing.

## Environment variables

Copy `.env.example` to `.env`. Everything is optional; a missing credential
disables one capability loudly instead of failing at boot. Run
`pnpm signal status` to see the current picture.

| Variable | Needed for |
| --- | --- |
| `ANTHROPIC_API_KEY` | Scoring and drafting (Phase 2) |
| `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` | Reading subreddits |
| `REDDIT_USERNAME`, `REDDIT_PASSWORD` | Publishing to Reddit (Phase 3) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Conversion attribution (Phase 4) |
| `SIGNAL_EDGE_PROJECT_ID`, `SIGNAL_EDGE_PULL_TOKEN` | Pulling clicks down from Firebase (Phase 4) |
| `SIGNAL_BACKUP_PASSPHRASE` | Encrypted SQLite backup. 16 chars minimum |
| `SIGNAL_DATABASE_URL` | Overrides the config's database path |
| `SIGNAL_OFFLINE` | `1` makes every outbound request fail. Useful while tuning prompts |

Reddit credentials come from a **script**-type app at
<https://www.reddit.com/prefs/apps>. Also set `http.userAgent` in
`signal.config.ts` to include your real username — Reddit throttles generic
user agents hard.

## Commands

| | |
| --- | --- |
| `pnpm dev` | Electron app with renderer HMR |
| `pnpm build` | Bundle main, preload and renderer into `out/` |
| `pnpm package` | Build a distributable into `release/` |
| `pnpm signal status` | Capabilities, sources, products, queue depth |
| `pnpm signal ingest run [--force] [--only <source>]` | One ingestion cycle |
| `pnpm signal opportunities [-n 20] [-s status]` | Recent opportunities |
| `pnpm signal worker [--once]` | The scheduler, headless |
| `pnpm db:generate` | Generate a migration after editing the schema |
| `pnpm db:migrate` / `pnpm db:seed` | Apply migrations / sync config to the DB |
| `pnpm typecheck` `pnpm lint` `pnpm test` | Must all be clean before a phase ends |
| `pnpm rebuild:native` | Rebuild both native ABIs |

## Tests

```bash
pnpm test
pnpm test:coverage
```

123 tests as of Phase 1, covering entity decoding and HTML flattening,
per-platform normalization, dedup and the never-resurrect-a-rejected-thread
rule, the age cutoff, the job queue's claim/retry/dead-letter behaviour,
robots.txt parsing, and config validation.

Coverage thresholds are deliberately uneven. Scoring, validators, rate
limiting and attribution matching carry a hard floor, because those are the
four places where a silent bug either costs money or gets the account banned.

## Deploying headless

`pnpm dev` is the normal way to run this. For a machine you would rather leave
switched on:

```bash
docker build -t signal .
docker run -v signal-data:/data --env-file .env signal
```

The SQLite file lives on the mounted volume. Mount something real — losing it
loses the queue and the attribution history.

## Design

The interface follows **Nocturne**, imported from the Claude Design project in
`design-ref/`. `design-ref/nocturne.css` is the source of truth: take every
colour, font, space, radius and shadow from a token, never a raw value.

The window has no native title bar. Chromium paints the minimise/maximise/close
buttons itself as a flat rectangle in a colour it cannot read from CSS, so the
first 56px of the page is held at exactly `--color-bg` and the accent bloom
fades in below it. That is why the background gradient on `.main` looks odd in
isolation.

## Open questions

Things I need from Casey before later phases:

- **Real product domains.** The `utmBase` values in `signal.config.ts` are
  `example.invalid` placeholders. Tracked links are built from them, so a wrong
  value breaks attribution quietly. `pnpm signal status` flags them in yellow.
- **`src/prompts/voice.md` is a template.** It needs 5–10 real past posts. It
  is the highest-leverage file in the repo and no amount of prompt engineering
  substitutes for it.
- **Reddit's current API terms.** The OAuth flow, the script-app grant and the
  rate-limit headers are implemented as documented, but I have not verified
  today's terms. Confirm before switching Reddit ingestion on.
- **Which communities to seed rules for.** Phase 2 researches the real rules
  per community and records the sidebar URL each value came from, with an
  `unverified` flag until you confirm it.
