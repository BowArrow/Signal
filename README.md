# Signal

A local-first marketing and sales workspace for running a small business's growth work from one desktop app.

Signal brings product research, campaign drafts, creative production, prospect conversations, and campaign measurement into an Electron workspace. It can use local models or a configured cloud provider, with separate policies for reviewed community replies and automated business activity.

[Quick start](#quick-start) · [Features](#features) · [Configuration](#configuration) · [Development](#development) · [Documentation](#documentation)

| At a glance | Details |
| --- | --- |
| Version | `0.53.0` in [package.json](package.json) |
| Interface | Electron desktop app and a CLI for the core engine |
| Stack | TypeScript, React, SQLite, Drizzle, Electron Vite |
| AI | Signal-managed Ollama, configured GPT, and an OpenAI-compatible or Anthropic community pipeline |
| Included business profiles | Lemonade and CineGen; customize [signal.config.ts](signal.config.ts) for your products |
| Project status | Active development. Provider setup, live delivery validation, and model quality vary by feature. |

## Features

| Workspace | What you can do | Guide |
| --- | --- | --- |
| Operations | Research current product information, prepare and review campaigns, run configured activities, and inspect delivery receipts. | [Operating guide](docs/autonomous-operation.md), [readiness](docs/run-readiness.md) |
| Growth workspace and Growth lab | Brief campaigns, explore all 19 Bullseye channels, shortlist experiments, and record acquisition cost and audience fit. | [Workspace setup](docs/signal-0.3.md), [Growth lab](docs/growth-lab.md) |
| Sales | Manage prospects, triage Gmail or Outlook conversations, prepare replies, run permitted follow-ups, and hand decisions back to the owner. | [Sales inbox](docs/sales-inbox.md), [handoffs](docs/sales-handoffs.md) |
| Prospect research | Inspect public business, blog, and community pages; prepare proposals with source evidence and an explicit next step. | [Prospect research](docs/prospect-research-0.48.md) |
| Creative studio | Connect local ComfyUI image/video workflows and produce campaign media. Branded campaign cards work without ComfyUI. | [Campaign images](docs/automatic-campaign-images.md), [video production](docs/marketing-research/video-production.md) |
| Connections | Link business accounts, select verified Gmail sender aliases, and check provider readiness. | [Connection setup](docs/easy-connections.md), [Gmail aliases](docs/gmail-aliases.md) |
| Analytics and Revenue | Read GA4 campaign engagement and Stripe payment/refund evidence within each business's scope. | [Analytics](docs/campaign-analytics.md), [Revenue](docs/revenue-sync.md) |
| Community review queue | Discover threads, inspect community rules, score opportunities, and review drafted replies. | [Community workflow](#community-workflow) |
| Background operation | Close to the tray, configure login startup and sleep prevention, and recover the managed local runtime. | [Background operation](docs/background-operation.md) |

### Publishing and outreach

| Destination or activity | Supported workflow | Requirement or boundary |
| --- | --- | --- |
| Connected websites | Publish articles through the prepared business integration. | Requires the matching website setup and operating policy. See [website publishing](docs/WEBSITE-PUBLISHING.md). |
| Bluesky | Publish reviewed text/image campaigns and eligible public replies. | Saved policies, conversation checks, and delivery limits apply. See [completion contract](docs/signal-completion-contract.md). |
| LinkedIn | Publish member text/link posts. | Requires publishing access; see [setup and validation limits](docs/linkedin-publishing.md). |
| X | Publish text/link posts with weighted character checks and saved receipts. | Requires publishing access; see [setup and validation limits](docs/x-publishing.md). |
| Facebook Pages | Publish Page text/link posts. | Personal profiles, ads, and video uploads are outside this adapter. See [Facebook publishing](docs/facebook-publishing.md). |
| Gmail and Outlook | Send eligible replies and opted-in outreach under a business policy. | Sending limits, consent checks, suppression, and uncertain-send recovery apply. See [outreach](docs/proactive-outreach.md). |
| Researched cold introductions | Prepare a business email for individual approval. | Approval covers one exact introduction, without enrolling the recipient in automated follow-ups. See [prospect research](docs/prospect-research-0.48.md). |
| Hacker News and community proposals | Prepare copy for review and permitted submission. | Hacker News remains draft-only. Blog/forum proposals may require a manual handoff. |

A connected account or generated draft does not establish successful delivery. Inspect the saved receipt for an outbound action and the linked guide for its validation history. Model review can still miss unsupported claims; campaign effectiveness and a complete autonomous customer-acquisition cycle remain unproven.

## Quick start

### Requirements

| Requirement | Used for |
| --- | --- |
| Node.js 20+ and pnpm | Installing dependencies, running the CLI, and developing the desktop app |
| Native build tools when required | Compiling `better-sqlite3` if a matching prebuilt binary is unavailable |
| A configured model | Research, scoring, drafting, and review; selected separately for desktop agents and the community CLI |
| Provider accounts | Only the integrations you choose to use |

From the repository root:

```bash
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm signal status
pnpm dev
```

`pnpm install` builds separate SQLite bindings for Node and Electron. On Windows PowerShell, use `pnpm.cmd` if script execution policy blocks `pnpm`.

Before seeding your own workspace, edit the products, sources, and timezone in [signal.config.ts](signal.config.ts). The included profiles are configured for Lemonade and CineGen. Seeding synchronizes those entries to the database.

### First desktop session

| Step | Where | Action |
| --- | --- | --- |
| 1 | Settings | Start the managed local runtime or configure GPT, then select the required models. |
| 2 | Connections | Link the accounts needed for your chosen activities and check their readiness. |
| 3 | Growth workspace | Select a business and prepare a campaign brief or review existing materials. |
| 4 | Sales | Configure inboxes, prospect sources, consent records, and reply/outreach policies if needed. |
| 5 | Operations | Review missing requirements, select activities and destinations, save the operating policy, and Run. |
| 6 | Analytics and Revenue | Select the relevant GA4 property and Stripe products to inspect results. |

Desktop Operations runs while Signal is running, including supported tray operation. The CLI worker runs the core scheduler and Growth lab jobs; it does not replace every desktop integration.

## Configuration

| Location | What belongs there |
| --- | --- |
| [signal.config.ts](signal.config.ts) | Product positioning, source selection, timezone, community model settings, scoring weights, and publishing limits |
| [.env.example](.env.example) → `.env` | Optional credentials and local overrides; `.env` is ignored by Git |
| Desktop Settings | Agent models, local runtime controls, and background behavior |
| Desktop Connections | Business account credentials and provider setup; the desktop uses OS-encrypted credential storage |
| [src/prompts/voice.md](src/prompts/voice.md) | Your writing samples for community drafts; the checked-in file still needs real examples |

### Models

| Workflow | Configuration | Check |
| --- | --- | --- |
| Desktop marketing, sales, and creative review | Settings: managed Ollama or configured GPT, with task-specific model choices | Inspect runtime/model readiness in Settings and Operations |
| Community classification, drafting, and rules interpretation | `llm` in `signal.config.ts`: OpenAI-compatible endpoint or Anthropic | `pnpm signal llm check` |
| Community model diagnostics | Recorded latency, token throughput, and structured-output results | `pnpm signal llm stats` |
| Local image/video generation | Saved ComfyUI workflows and their required models | [Creative setup](docs/automatic-campaign-images.md) |

The community configuration selects each task separately:

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

Replace the endpoint and model names with models your runtime serves. Setting these names does not download them. Local compatible endpoints generally need no API key; authenticated endpoints can use `LLM_API_KEY`.

CPU execution is available for supported Ollama tasks. ComfyUI has separate device settings. See [local CPU execution](docs/local-cpu-runtime.md).

### Environment variables

Credentials are optional at startup. Missing credentials disable the affected capability. Copy `.env.example` to `.env` when needed, and inspect `pnpm signal status` alongside the desktop's connection checks.

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Community model calls when the Anthropic provider is selected |
| `LLM_API_KEY` | Authentication for an OpenAI-compatible community endpoint, if required |
| `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` | Authenticated Reddit API reads |
| `REDDIT_USERNAME`, `REDDIT_PASSWORD` | Reddit publishing credentials, in addition to the client credentials |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe integration and webhook verification |
| `SIGNAL_EDGE_PROJECT_ID`, `SIGNAL_EDGE_PULL_TOKEN` | Pulling attribution data from the Firebase edge service |
| `SIGNAL_BACKUP_PASSPHRASE` | Encrypted SQLite backup; minimum 16 characters |
| `SIGNAL_DATABASE_URL` | Override the database path, for example for a scratch workspace |
| `SIGNAL_OFFLINE` | Set to `1` for the engine's offline mode |

The repository also has public-page Reddit ingestion and explicit source-level robots exemptions in `signal.config.ts`. Review that source configuration before enabling ingestion; the older API-only description does not describe every configured source.

## Community workflow

The community pipeline finds threads, scores their relevance, and prepares replies for review. Hacker News and RSS reads need no credentials. Model-dependent steps require a reachable configured provider.

```bash
pnpm signal ingest run --force
pnpm signal communities
pnpm signal rules fetch --all
pnpm signal score
pnpm signal draft
pnpm signal queue
```

### Rules and review

| Check | Behavior |
| --- | --- |
| Community rules | Store the community's published rules and the model's interpretation together. A missing record holds the opportunity as `rules_unknown`. |
| Human verification | Fetched interpretations start unverified. Use `rules show` to compare the interpretation with the source and `rules review` to confirm or correct it. |
| Interpretation failure | Missing evidence, invalid output, or a failed interpretation falls back to a discouraged policy. |
| Draft eligibility | Unverified rules can still allow drafting with increased risk. Forbidden promotion and manually blocked communities stop drafting. |
| Disclosure and substance | Validators check product disclosure, community policy, writing style, substantive answers, and unrendered placeholders. Blocked drafts retain their results for diagnosis. |
| Approval | Community drafts enter the review workflow. Separately configured business publishing and eligible Bluesky replies follow their own operating policies. |

```bash
pnpm signal communities --unknown
pnpm signal rules show r/LocalLLaMA
pnpm signal rules review r/LocalLLaMA
pnpm signal communities block r/x -r "mods asked me to stop"
```

### Scoring

| Axis | Source | Question |
| --- | --- | --- |
| Contribution | Model | Can the reply add useful information independently of a product mention? |
| Intent | Model | Is the person actively trying to solve a problem? |
| Fit | Model | Does one product match the problem? |
| Risk | Computed from stored facts | Do community policy, thread age, cooldown, self-promotion ratio, or uncertain rules make replying unsuitable? |

Contribution must remain the largest positive weight. Risk subtracts from the total; opportunities below the threshold do not proceed to drafting. The self-promotion ratio only includes publications Signal knows about, so manual activity can be missing.

```bash
pnpm signal scoring
pnpm signal scoring set --contribution 0.5
pnpm signal score --all
```

## Development

### Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start Electron with renderer hot reload |
| `pnpm build` | Bundle the main process, preload, and renderer into `out/` |
| `pnpm package` | Build a distributable into `release/` |
| `pnpm typecheck` | Check TypeScript |
| `pnpm lint` | Run ESLint |
| `pnpm test` | Run the Vitest suite |
| `pnpm test:coverage` | Run tests with coverage |
| `pnpm db:generate` | Generate a migration after editing the schema |
| `pnpm db:migrate` / `pnpm db:seed` | Apply migrations / synchronize configuration to the database |
| `pnpm signal status` | Inspect capabilities, sources, products, and queue depth |
| `pnpm signal opportunities [-n 20] [-s status]` | List discovered opportunities |
| `pnpm signal worker [--once]` | Run the core scheduler and Growth lab jobs without a window |
| `pnpm growth:smoke` / `pnpm growth:ui` | Run the dedicated Growth lab checks |
| `pnpm rebuild:native` | Rebuild SQLite bindings for both Node and Electron |

Tests cover ingestion, rules, scoring, drafting, connections, operations, sales, creative workflows, and delivery behavior. Provider simulations and UI fixtures do not establish live delivery or real model quality; those checks are recorded separately in the feature guides.

### Project structure

| Path | Responsibility |
| --- | --- |
| [src/core/](src/core/) | Application services, configuration, database, ingestion, scheduling, model clients, and business workflows |
| [src/cli/](src/cli/) | Command-line access to the core engine |
| [src/shared/](src/shared/) | Shared types, business rules, and IPC contracts |
| [src/prompts/](src/prompts/) | Versioned prompt templates and writing samples |
| [electron/main/](electron/main/) | Desktop lifecycle, privileged integrations, and IPC handlers |
| [electron/preload/](electron/preload/) | Bridge between the main process and isolated renderer |
| [electron/renderer/](electron/renderer/) | React screens and the Nocturne interface |
| [edge/](edge/) | Firebase click redirects and Stripe webhook integration |
| [tests/](tests/) and [scripts/](scripts/) | Automated tests, smoke checks, build helpers, and operational utilities |
| [docs/](docs/) | Setup guides, feature boundaries, research, and release notes |
| [research/](research/) | Experimental image and video code, separate from production capability claims |
| [design-ref/](design-ref/) and [build/](build/) | Design references and packaged application icons |
| `data/` and `output/` | Local databases, model downloads, validation artifacts, and generated exports; ignored by Git |

The core engine is shared by the CLI and desktop. SQLite stores application records and the durable job queue; `node-cron` schedules work. Interface styling follows the tokens in [design-ref/nocturne.css](design-ref/nocturne.css).

### Native SQLite bindings

Node and Electron require different native ABIs. [scripts/rebuild-native.mjs](scripts/rebuild-native.mjs) builds both into `native/`, and the database client selects the correct binary at runtime. Installation runs this automatically.

After upgrading Node, Electron, or `better-sqlite3`, run:

```bash
pnpm rebuild:native
```

The script rejects byte-identical Node and Electron binaries, which indicate that one rebuild did not run correctly.

### Headless worker

The repository includes a Docker setup for the core worker:

```bash
docker build -t signal .
docker run -v signal-data:/data --env-file .env signal
```

Create `.env` before using `--env-file`. Keep the `/data` volume persistent: it holds the SQLite database, queue, and attribution history. Desktop account connections and creative runtimes require their own setup.

## Documentation

| Topic | Read more |
| --- | --- |
| Operations and completion criteria | [Operating guide](docs/autonomous-operation.md), [completion contract](docs/signal-completion-contract.md), [Run readiness](docs/run-readiness.md) |
| Account setup | [Account map](docs/account-connections.md), [connection setup](docs/easy-connections.md), [Gmail aliases](docs/gmail-aliases.md) |
| Campaign quality | [Copy review](docs/copy-review.md), [editorial feedback](docs/campaign-feedback.md), [campaign learning](docs/campaign-learning.md) |
| Prospect sources | [CSV imports](docs/prospect-import.md), [Mailchimp sources](docs/prospect-sources.md), [website requests](docs/website-prospects.md), [public discovery](docs/public-discovery.md) |
| Sales automation | [Gmail replies](docs/sales-replies.md), [Outlook replies](docs/outlook-replies.md), [follow-up sequences](docs/sales-sequences.md), [owner handoffs](docs/sales-handoffs.md) |
| Measurement | [GA4 campaigns](docs/campaign-analytics.md), [Stripe revenue](docs/revenue-sync.md) |
| Research | [Growth research report](docs/marketing-research/Signal-Growth-Research.pdf), [image experiments](research/image_refinement/README.md), [video experiments](research/video_density/README.md) |
| Release and validation history | [Release notes and feature guides](docs/), [marketing activity](docs/marketing-activity-0.47.md), [prospect research](docs/prospect-research-0.48.md) |

Release notes describe what was checked at the time of each change. Local validation artifacts under `data/` and generated reports under `output/` are excluded from Git and will not be present in a fresh clone.
