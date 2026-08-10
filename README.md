# Signal

A marketing operations system for one person.

Signal watches places where my products are a genuine answer to a real
question, drafts a reply in my voice, puts it in a review queue, publishes on
approval, and tracks which posts actually produced revenue.

**It is not an auto-poster.** Every outbound message to a community I do not
own passes through human approval. That constraint is load-bearing and it is
enforced in code, not documentation.

---

## Current state — end of Phase 2

Threads are found, scored, and drafted into a review queue. Nothing publishes:
there is no publish path in the codebase yet.

| | |
| --- | --- |
| ✅ Phase 1 | Schema, config validation, seed, Reddit / HN / RSS ingestion, dedup, durable job queue, CLI, Electron shell |
| ✅ Phase 2 | Community discovery, dynamic rules fetching, four-axis scoring, drafting, disclosure validator |
| ⬜ Phase 3 | Review queue UI, Reddit publishing, link tracking, rate limits |
| ⬜ Phase 4 | Stripe attribution, metrics, weekly digest, owned-channel automation |

## Quick start

```bash
pnpm install            # also builds both native ABIs, see below
pnpm db:migrate
pnpm db:seed            # reads products and sources from signal.config.ts
pnpm signal status      # what Signal can currently do, and what it is missing

pnpm signal ingest run --force      # find threads
pnpm signal communities             # where they came from
pnpm signal rules fetch --all       # read those communities' own rules
pnpm signal score                   # four axes, tunable weights
pnpm signal draft                   # write replies for what cleared the bar
pnpm signal queue                   # what is waiting on you
```

Hacker News and RSS need no credentials, so ingestion produces real
opportunities on a fresh clone. Reddit ingestion, discovery and rules fetching
need Reddit keys; scoring and drafting need an Anthropic key. `signal status`
lists exactly what is missing rather than failing.

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
Signal checks a stored rules record. No record means the opportunity is held as
`rules_unknown` regardless of how well it scored, and no model call is made at
all. Guessing a community's policy is how you get banned from it.

**Rate limits at the publish layer.** Max replies per platform per day, a
minimum cooldown between posts in one community, and a rolling self-promo
ratio cap. Configurable, with defaults that hold. Phase 3.

**Official APIs, honored robots.txt.** Reddit and HN go through documented
APIs. RSS, the only poller that touches arbitrary hosts, goes through a
robots.txt check and a per-host rate limiter. `http.respectRobotsTxt` is typed
as `true` — Zod rejects the config if you try to set it to `false`.

Owned channels — my blog, my site, my YouTube copy, my email list — are the
exception. Full automation is fine there. Phase 4.

## Finding communities, and reading their rules

Signal is not limited to a hand-listed set of subreddits. `reddit_search`
sources search all of Reddit for a phrase, so threads arrive from communities
nobody configured. That is the point: the places worth being useful in are not
knowable in advance.

Which makes the rules registry the load-bearing part.

**Rules belong to a community, not to a source.** One search surfaces threads
from fifty subreddits, and each opportunity records which community it actually
came from. A source is how Signal looks; a community is where a reply lands.

**Rules are fetched, never hardcoded.** `pnpm signal rules fetch` pulls each
community's moderator-authored rule text from the platform's own API and stores
it verbatim. A separate pass asks a model to turn that text into a structured
policy — is promotion allowed, is there a ratio, is flair required — and that
reading is stored next to the evidence it quoted.

**Nothing is trusted until you say so.** Every fetched record is written
`verified: false`. `pnpm signal rules show r/whatever` prints the reading and
the verbatim rules side by side so you can check one against the other in a few
seconds, and `pnpm signal rules review` is the only thing that sets `verified`.

Three defences against a confident wrong reading, because this is the one place
a model's output decides whether an automated system may post somewhere:

- A permissive reading (`allowed`, `allowed_with_disclosure`) that quotes no
  supporting rule text is automatically demoted to `discouraged`. That
  combination is the shape a hallucination takes.
- Any failure — no key, a timeout, unparseable output, a schema mismatch —
  falls back to `discouraged` with confidence 0, never to something permissive.
- An unverified reading raises the Risk axis in proportion to how unsure the
  model was, so an uncertain community has to clear a higher bar.

An unverified record still allows drafting. Requiring sign-off first would
leave nothing to sign off on, and every draft needs an explicit approve
regardless. `selfPromo: 'forbidden'` and a hand-blocked community both stop
drafting outright.

```bash
pnpm signal communities --unknown        # who has no rules record
pnpm signal rules fetch --all            # fetch and read them
pnpm signal rules show r/LocalLLaMA      # reading vs verbatim rules
pnpm signal rules review r/LocalLLaMA    # confirm, or correct
pnpm signal communities block r/x -r "mods asked me to stop"
```

## Scoring

Four axes, stored separately so the weights stay tunable.

| Axis | Where it comes from |
| --- | --- |
| **Contribution** | Model. Can I add benchmarks, architecture detail, a hard-won gotcha, independent of any product? Carries the most weight |
| **Intent** | Model. Is this person actively trying to solve a problem right now? |
| **Fit** | Model. Semantic match against one product's positioning. Records which product matched |
| **Risk** | **Computed, not classified.** Community policy, thread age, cooldown, self-promo ratio, and how unverified the rules reading is |

Risk is deliberately not a model judgement. It decides how likely a reply is to
get punished, and that must not depend on a prompt edit or a bad JSON parse.
Every input is a fact already in the database and the same inputs always give
the same number. Its factors combine sub-additively, so three mild risks do not
add up to certainty, but any single disqualifying factor pins it at 1.

The total is a weighted sum with risk subtracting, normalised by the positive
weight mass — so turning every slider down does not silently empty the queue.
The weight set is fingerprinted onto each score, which makes every cached total
identifiably stale when you retune rather than quietly wrong.

```bash
pnpm signal scoring                              # current weights
pnpm signal scoring set --contribution 0.5       # tune at runtime
pnpm signal score --all                          # rescore against new weights
```

Config supplies the defaults; a row in `settings` overrides it. The
"contribution must be the largest positive weight" rule applies to runtime
overrides too, so it cannot be dodged through the dashboard.

Below the threshold there is no draft and no second model call.

**One honest caveat.** The self-promo ratio currently counts only publications
Signal knows about. Comments you write by hand are invisible to it, so the
denominator is too small and the ratio reads worse than reality. Reading your
real comment history from the Reddit API is the fix and it lands with
publishing in Phase 3. Until then the number errs toward caution, which is the
right direction to be wrong in.

## Drafting

Prompts live in `src/prompts/` as versioned markdown, never as string literals.
Each draft records the prompt version that produced it, so the learning loop
can tell a prompt change from a model change.

The reply prompt leads with one instruction: answer the question completely,
whether or not they ever click a link. It carries an explicit "omit the
product" option and is told that taking it is a good outcome. The product
instruction is derived from the community's own policy rather than left to the
model's judgement — a community that forbids promotion produces a prompt that
forbids it.

Then the validators, which are pure functions and tested to death. Any single
`block` keeps the draft out of the queue:

- **Disclosure** — a product named without "I build this" is blocked. Every
  product is checked, not just the matched one, so a draft about Lemonade that
  name-drops CineGen still needs to disclose. Matching is whole-word, because a
  false positive trains you to click past the validator.
- **Community rules** — no record, or promotion where it is forbidden.
- **Register** — the banned marketing phrases, and em-dashes.
- **Substance** — a product mention with under 280 characters of actual answer
  around it is an advert, not a contribution.
- **Placeholder** — an unrendered `{{...}}` that escaped the prompt renderer.

A blocked draft is still written to the database with its validator results.
The pattern in what gets blocked is what tells me the prompt is wrong, and
throwing it away would hide that.

`src/prompts/voice.md` is fed into every drafting call. It currently has no
samples, and drafting warns about that every time — the model can be told to be
plain a hundred ways and still write like a landing page.

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
| `pnpm signal communities [--unknown]` | Communities met, and their rules state |
| `pnpm signal rules fetch [--all] [-c <community>]` | Fetch and read community rules |
| `pnpm signal rules show <community>` | The reading and the verbatim rules |
| `pnpm signal rules review <community>` | Confirm a reading, or correct it |
| `pnpm signal score [--all] [--dry-run]` | Score on four axes |
| `pnpm signal scoring [set --contribution 0.5]` | Inspect or tune the weights |
| `pnpm signal draft [--note "..."] [--dry-run]` | Write replies |
| `pnpm signal queue` | Drafts waiting on you |
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

298 tests as of Phase 2. Weighted towards the places where being wrong is
expensive rather than towards line count:

- **Disclosure and validators** (59) — every phrasing that counts as a
  disclosure, and every false positive that must not fire.
- **Risk** (21) — policy ordering, cooldown, ratio caps including a community's
  own stricter cap, sub-additive combination, and determinism.
- **Rules gate** (20) — no record means no draft and no model call; permissive
  readings without evidence get demoted; every failure path lands on
  `discouraged`; only `markReviewed` sets `verified`.
- **Scoring and drafting pipelines** (52) — run against a scripted model, so
  the full path is exercised with no key and no network.
- **Ingestion, queue, robots, config** (146) from Phase 1.

Coverage thresholds are deliberately uneven. Scoring, validators, rate limiting
and attribution matching carry a hard floor, because those are the four places
where a silent bug either costs money or gets the account banned.

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
- **Nothing is seeded with researched rules, on purpose.** The obvious way to
  build the registry was to look up r/LocalLLaMA's rules and hardcode them. The
  sources I could reach for that were Reddit-marketing SEO sites, not the
  subreddits themselves, and a ban-risk guardrail should not rest on those. So
  Signal fetches each community's own published rules instead. The registry is
  empty until `rules fetch` runs, and that is the correct state.
- **Every fetched reading needs your eyes once.** `rules show` puts the model's
  reading next to the verbatim rules for exactly this reason. It takes a few
  seconds per community and it is the difference between a guardrail and a
  guess.
