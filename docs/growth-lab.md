# Growth lab

Signal runs a local Bullseye workflow for the products in `signal.config.ts`.
The supplied Traction excerpt contains the 19-channel overview and the Bullseye
chapter (book pages 19–26; PDF pages 24–31). The implementation adapts the method;
the book's prose is not bundled, and document text is not executable instruction.

## Start

Open **Signal** from the desktop or Start menu. The Windows installer is
`release/Signal Setup 0.2.0.exe`; the executable is also available directly at
`release/win-unpacked/Signal.exe`. Packaged builds use `%APPDATA%/Signal/signal.db`.
On this machine, the prepared growth plans were copied into that database during
installation. Development commands still use the separate workspace database.

1. Start Ollama with `ollama serve`, or start a compatible local server.
2. Open Signal (or run `pnpm dev` for development), open **Growth lab → Goals & runtime**, choose a model served
   by your runtime, save, then **Check saved runtime**. The tested default on
   this machine is `gemma4:e4b` for research/writing/analysis and
   `qwen2.5-coder:7b` for opportunity scoring/replies, served at
   `http://127.0.0.1:11434/v1`. Each role can use a different installed model.
3. Set a real customer target, affordable test budget, maximum customer
   acquisition cost, test duration, and minimum sample size. Initial values
   are editable planning assumptions, not a spending authorization.
4. Choose **Research all 19 channels**. Work is durable and runs one local
   task at a time. Review hypotheses in the Bullseye board and drafts in
   **Local agents**. The activity panel shows queue status, elapsed time, errors,
   and completion. Once all ideas are ready, **Refresh all 19 channels** runs a
   new pass while keeping existing ideas available until replacements validate.
5. Enable scheduled cycles to keep research, campaign preparation, the
   opportunity pipeline, and analysis moving while Signal is open. The
   headless `pnpm signal worker` runs the same growth engine.

Growth runtime settings are stored in SQLite and are independent of the older
`llm` configuration used by standalone `score` and `draft` commands. The growth
opportunity agent uses the local model selected in Growth lab. Only loopback
endpoints are accepted, with no remote fallback or cloud credential forwarding.
Ollama's compatible endpoint is documented at
<https://docs.ollama.com/api/openai-compatibility>.

## What is automated

- **Research:** one bounded hypothesis per channel, informed by the configured
  product positioning, proof points, and up to 12 matched opportunities already
  discovered by Signal. Costs, reachable customers, and confidence are estimates.
  This is synthesis of local evidence, not a claim that a live web survey ran.
- **Planning:** with automatic planning enabled, all 19 channels are considered
  before up to three affordable ideas are shortlisted. Model confidence ranks
  untested ideas; only recorded outcomes qualify a core channel. If all completed
  tests miss their thresholds, the next cycle chooses untested affordable ideas.
- **Campaign writing:** prepares channel-specific content, pitches, ad variants,
  emails or tool briefs, each linked to a persistent experiment. Founder
  disclosure, a valid campaign URL and absence of placeholder content are checked.
  Copy the output from Local agents for editing and execution.
- **Opportunity processing:** each task fetches community rules, scores one
  opportunity, or drafts one reply. Existing rule and disclosure checks apply;
  replies enter the existing review queue.
- **Analysis:** writes memos from real measurements and deterministic test
  evaluations. The Growth digest shows the latest completed memo and its date.

Every generative task validates its output, allows one correction attempt, and
records model and latency telemetry. A failed task remains visible and retryable.
Cancellation aborts the current local model request and prevents its output from
being committed. A lease prevents two workers sharing a database from claiming
the same task. Interrupted work becomes a visible failure after ten minutes.

## Running experiments

Shortlisting creates a planned experiment and snapshots its goal thresholds.
When the shortlist is full, opening another channel shows the three occupied
slots with removal controls. Running tests need recorded results before their
channel can be removed. Removing a slot preserves its drafts and history.
The campaign writer then prepares its first asset. **Start test clock** records
the start and expected end date; it does not buy ads, publish, or contact anyone.
At most three experiments may run at once. The app does not assume an elapsed
deadline means a successful or failed test.

Record cumulative visitors, leads, paying customers, actual spend, revenue,
audience fit, and the source of the measurement. Saving replaces previous totals
rather than adding them twice. Corrections can revoke a previously promising
channel. New goal settings apply to future experiments; existing thresholds are
kept so a test cannot be declared successful by moving its goalposts.

CAC = actual spend / paying customers. With no customers, CAC is unknown, not
zero. A promising test needs the minimum visitors and customers, acceptable CAC,
and good audience fit. This is directional evidence, not statistical proof or a
guarantee of scale. Reachable customer volume is shown as an estimate for review.

UTM links go directly to each product's configured domain and carry the experiment
ID. They work without the unfinished edge redirect service. They identify a
campaign in analytics; they do not themselves collect clicks or payments.

## Boundaries and remaining integrations

Campaign assets are local drafts. Signal does not autonomously send outreach,
publish campaigns, buy advertising, deploy a free tool, or run an event. Existing
community approval behavior is preserved. Owned-site and email-provider publishing
adapters are not connected. Stripe/click ingestion remains the separate, unfinished
edge integration; experiment results currently come from recorded measurements.
The UI states this explicitly. Review product claims and copy before publication.

Automatic planning does not start test clocks or manufacture outcomes. Scheduled
cycles pause when the app and headless worker are closed. Disabling scheduling
stops new cycles; cancel already queued tasks in Local agents if needed.

## Commands and validation

```sh
pnpm signal growth check
pnpm signal growth status
pnpm signal growth research lemonade
pnpm signal growth research cinegen
pnpm signal growth run --max 3
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm growth:smoke          # real local model, isolated test database
pnpm growth:ui             # built Electron app, isolated DB/profile, offline
```

The UI smoke checks real preload/IPC, navigation, queue persistence, runtime
failure states and 1440/720-pixel viewports. Screenshots and test databases are
written under ignored `data/growth-validation/`. Packaged builds include only
runtime bundles, required dependencies and the Electron SQLite binary; local
databases, reference documents, credentials and validation artifacts are excluded.
Installed builds store their database in Electron's per-user application folder.
