# Signal

**Signal 0.30 adds shared Gmail business addresses.** Select a verified sender
for each business in Sales. Inbox routing, replies and outreach use that address;
ambiguous recipients stay in Gmail for manual review. See [Gmail aliases](docs/gmail-aliases.md).

**Signal 0.29 simplifies account connections.** Configured OAuth providers open
browser sign-in directly from Connect. Developer fields live under Advanced
setup; one Google Desktop credential import enables the Google services together.
The build can supply public/native app registrations, while providers still
awaiting registration are labelled explicitly. Gmail can list verified sender
aliases; Signal 0.30 adds sender selection and shared-inbox business routing.
See [connection setup and provider readiness](docs/easy-connections.md).

**Signal 0.28 ties editorial decisions to the actual copy.** The checker covers
every title, description and body passage, selects current source evidence, and
cannot substitute invented claim text for the submitted wording. Short social
writers leave verified links to Signal, and follow-up retries retain the buyer
workflow. See [copy review and model evaluation](docs/copy-review.md). Semantic
judgment remains model-dependent; this is not a guarantee of autonomous quality.
New marketing profiles select `qwen3.5:9b`; saved model choices are retained.

**Signal 0.27 uses visitor interest to guide early experiments.** Before there is
enough purchase evidence, Run can select a follow-up from repeated, attributable
GA4 engagement. Purchase evidence takes priority, exploration continues, and the
editorial reviewer checks that the follow-up adds a distinct supported action.
See [campaign selection](docs/campaign-learning.md). Live results remain unverified.

**Signal 0.26 adds local branded campaign cards.** Operations can turn reviewed
copy into a Lemonade or CineGen graphic and publish it with a Bluesky caption.
This layout option needs no ComfyUI or vision model. Saved illustration workflows
remain available. See [automatic campaign images](docs/automatic-campaign-images.md).

**Signal 0.25 carries editorial corrections between runs.** The writer can avoid
repeating rejected claims and temporarily defer research findings that repeatedly
produced unsupported copy. Feedback is business-scoped, expires after a week and
is ignored when product evidence changes. Independent review still applies. See
[campaign feedback](docs/campaign-feedback.md).

**Signal 0.24 adds X text/link publishing** with publishing-permission checks,
weighted character validation and saved receipts. Uncertain posts cannot be
resent after restart. Campaign generation now checks structural requirements
before editorial inference and constrains citations to the inspected product
source. See [X publishing](docs/x-publishing.md). Live X delivery and dependable
campaign quality remain unverified; this is not a completed autonomous-growth app.

**Signal 0.23 adds LinkedIn member publishing.** Operations can write reviewed,
tracked text/link posts through a connection granted publishing access. Durable
send records prevent resending after an uncertain response. Campaign revisions
also retain the original product evidence and change repeatedly unsupported angles.
See [LinkedIn publishing](docs/linkedin-publishing.md). Live LinkedIn delivery and
the latest model-quality check remain unverified.

**Signal 0.22 adds CPU-only local agents.** Settings can request CPU execution for
Ollama writing, research, sales and image review. Unsupported endpoints hold instead
of ignoring the setting. ComfyUI keeps its own device configuration. See
[local CPU execution](docs/local-cpu-runtime.md).

**Signal 0.21 adds website prospect ingestion alongside Mailchimp.** Sales can read
verified, explicitly opted-in requests from the prepared Lemonade/CineGen signup
flow, preserve opt-outs and recheck consent before email delivery. The desktop
installer and local validation are complete; the website changes and production
email-link setup have not been deployed. See [website requests](docs/website-prospects.md).

**Signal 0.20 adds unanswered outreach sequences.** Opted-in prospects can receive
up to two follow-ups in the original Gmail or Outlook conversation, with fresh
research, shared daily limits, stop controls and duplicate-send protection.
Replies, opt-outs and known purchases stop the sequence. See
[proactive outreach](docs/proactive-outreach.md). Provider simulations and packaged
desktop checks pass; live mailbox compatibility remains unverified.

Optional [public buyer research](docs/public-discovery.md) supplies product-scoped
Hacker News and Stack Exchange findings to campaign generation. Public API reads
work, but the final local-model relevance check remains pending after a Windows
crash. This does not import contacts or send community replies.

**Signal 0.19 lets Run operate Sales, prospect ingestion or reporting without a
publishing account.** Operations shows the configured activities and missing
connections, checks only the operation's required models, and supports cancelling
startup. See [Run readiness](docs/run-readiness.md).

Run also supports automatic Mailchimp prospect ingestion. It reads your
selected business audience, imports eligible subscribers, applies opt-outs and
checks current consent before linked email delivery. See
[automatic prospect sources](docs/prospect-sources.md).

Signal also supports previewed CSV prospect imports with consent records,
deduplication, opt-out handling and Stripe customer matching. See
[prospect imports](docs/prospect-import.md).

Run can research, prepare,
review and send one initial Gmail or Outlook message to an opted-in pipeline
lead, with a separate outreach policy and daily limit. Replies enter Sales;
known purchases and opt-outs stop new attempts. See
[proactive outreach](docs/proactive-outreach.md) for setup and current limits.

**Signal 0.15 connected purchases to the next action.** Read-only Stripe scans can
match existing leads by email and stop automatic sales follow-ups after a purchase.
Operations records its campaign-selection evidence, builds on repeated attributed
payments when enough observations exist, and preserves exploration cycles. These
are bounded decisions, not proof of marketing effectiveness. See
[revenue matching](docs/revenue-sync.md) and [campaign learning](docs/campaign-learning.md).

**Signal 0.14 connected local image production to Operations.** Choose a saved
ComfyUI image workflow for Bluesky campaigns. Run researches and reviews copy,
renders an illustration, reviews its pixels, revises unsuitable compositions,
and delivers the approved image with the post. Settings supports a separate
local image-review model. ComfyUI starts without opening a browser. See
[image setup, tested models and limitations](docs/automatic-campaign-images.md).

**Signal 0.13 adds owner handoffs.** Sales now collects conversations that need
your decision, with reminders and recorded outcomes. Approve one exact response
for Run, reconcile an uncertain send, or take over the conversation and stop its
follow-ups. See [the handoff workflow](docs/sales-handoffs.md).

**Signal 0.12 adds Outlook sales replies and follow-ups.** Microsoft inboxes can
use the same research, editorial review and scoped reply policies as Gmail.
Signal records an immutable draft ID before sending and confirms the matching
Sent Items copy. See [Outlook permissions and delivery recovery](docs/outlook-replies.md).

**Signal 0.11 adds GA4 campaign measurement.** Link Google Analytics in Connections
and choose a property in Analytics. Running operations refresh a hostname-scoped
30-day campaign report hourly. Marketing agents receive its results, freshness
and reporting limitations, separately from Stripe payment evidence. See
[analytics setup and limits](docs/campaign-analytics.md).

**Signal 0.10 adds background operation and runtime recovery.** Settings now
controls closing to the system tray, optional login startup and idle-sleep
prevention. Active local operations recover their installed Ollama runtime;
generation waits when the required models are unavailable. Tray controls reopen,
pause or quit Signal. See [background setup and validation](docs/background-operation.md).

**Signal 0.9 adds sales follow-up sequences.** Configure up to three follow-ups
after a confirmed Gmail answer. Each step researches and reviews a fresh reply,
checks the conversation again, and shares the business's sending limit. Customer
replies, opt-outs and pipeline changes stop the sequence. Timing and progress
appear in Sales. See [sequence setup and limits](docs/sales-sequences.md).

**Signal 0.8 adds automatic Gmail replies.** Enable monitoring, triage and a
business-specific reply policy, then Run Operations. The agent researches current
product facts, drafts and reviews answers to new buying inquiries, and sends
eligible replies under daily limits. Each attempted send is recorded before the
request; uncertain sends are reconciled without resending. See
[Gmail reply setup and limits](docs/sales-replies.md).

**Signal 0.7 adds the Sales inbox.** Monitor Gmail or Outlook, triage incoming
conversations with the configured local/GPT model, match buying inquiries to the
lead pipeline, and stop follow-ups on replies or opt-outs. See
[Sales setup and execution boundaries](docs/sales-inbox.md). Outlook sending is
available from 0.12; broader lifecycle outreach remains in progress.

**Signal 0.6 adds Revenue.** Scope a connected Stripe account to each business's
products, synchronize captured payments and reported refunds, and feed verified
campaign identifiers into the agent's commercial evidence. Snapshots distinguish
test/live mode and currencies; they never become spendable cash automatically.
See [revenue setup, coverage and deployment boundaries](docs/revenue-sync.md).

**Signal 0.5 adds Operations.** Select a business and publishing destinations,
save an operating policy, and Run the agent through current-site research,
editorial review, durable delivery and publication receipts. Website articles
and Bluesky text posts are the first delivery adapters. See the
[operating guide and full autonomy completion audit](docs/autonomous-operation.md).
Proactive sales outreach, remaining channel delivery, media orchestration and
automatic revenue reconciliation are still in progress.

**Signal 0.4 adds account connections.** Link business inboxes, social/video
profiles, email delivery, websites, checkout, analytics, CRM/community tools,
and advertising accounts per business. See the [account map, setup steps, and
automation boundaries](docs/account-connections.md). Credentials use OS-encrypted
storage; setup checks account reads and does not activate outbound campaigns.

**Signal 0.3 adds the growth and creative workspaces.** Use the existing Lemonade
and CineGen profiles to brief campaigns, generate materials, review copy, track
customer conversations, and record sales. Settings supports Signal-managed
Ollama or GPT with an encrypted API key. Creative studio connects local ComfyUI
image/video workflows. See the [setup and validation notes](docs/signal-0.3.md)
and the [cited research report](docs/marketing-research/Signal-Growth-Research.pdf).

**Growth lab is implemented.** Research, campaign-writing,
opportunity and analysis agents support Traction's Bullseye workflow: all 19
channels, a shortlist of three affordable experiments, measured acquisition
cost and audience fit, and one evidence-supported core channel. The desktop
includes the Bullseye board, experiment results, growth digest and local runtime
controls. See [Growth lab setup and scope](docs/growth-lab.md).

Run `pnpm dev` and open **Settings** to start the local runtime or configure GPT.
Then open **Growth workspace**. Scheduled agents run while the desktop
app or `pnpm signal worker` is open. Campaign publication and automatic payment
ingestion remain external integrations; generated assets are reviewable drafts,
and recorded experiment measurements drive the results views.

A marketing operations system for one person.

Signal watches places where my products are a genuine answer to a real
question, drafts a reply in my voice, puts it in a review queue, publishes on
approval, and tracks which posts actually produced revenue.

**It is not an auto-poster.** Every outbound message to a community I do not
own passes through human approval. That constraint is load-bearing and it is
enforced in code, not documentation.

---

## Community pipeline background

Threads are found, scored, and drafted into a review queue. The review UI and
manual publication workflow are implemented. The phase notes below describe the
original community pipeline roadmap; Growth lab's current scope is documented above.

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

## Which model runs this

Set in `signal.config.ts` under `llm`, per task:

```ts
llm: {
  provider: 'openai-compatible',        // or 'anthropic'
  baseUrl: 'http://localhost:8080/v1',
  models: {
    classify: 'muse-glimmer-30b',
    draft: 'muse-glimmer-30b',
    'interpret-rules': 'muse-glimmer-30b',
  },
}
```

`openai-compatible` is the chat-completions shape that llama.cpp's
`llama-server`, vLLM, LM Studio and Ollama's compat endpoint all speak, which
is how a local model gets used here. No API key is sent unless `LLM_API_KEY`
is set, because local runtimes generally don't want one.

The three tasks are configured separately on purpose, because they fail
differently. A bad classification wastes a slot in the queue. A bad draft
wastes a review. A bad rules reading gets the account banned — though that one
degrades safely: unparseable output and schema mismatches both land on
`discouraged` with confidence 0, so a weaker model becomes more cautious rather
than more dangerous.

**Every call is recorded**, so choosing between models is a measurement rather
than an impression:

```bash
pnpm signal llm check      # is it reachable, and does it serve these models
pnpm signal llm stats      # latency, tok/s, and JSON compliance per task
```

The column that matters for a smaller model is `json ok`. The whole pipeline
depends on structured output, and holding that contract is usually what a
smaller model gives out on first — not reasoning quality. Below 95% the stats
command says so and suggests moving that one task rather than all three.

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
