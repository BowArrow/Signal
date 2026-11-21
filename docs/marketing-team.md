# Marketing team

Open **Marketing team** in the sidebar, choose a business and save one campaign brief. Lemonade is the initial focus. The team uses the business's connected Codex account when available, otherwise its configured marketing model.

Seven specialists prepare buyer research, a measurable zero-cash experiment, finished copy, a creative brief, a placement plan, a sales playbook and a measurement review. They run in dependency order through Signal's existing durable task queue. This keeps local inference serialized and lets each specialist inspect earlier deliverables. These are separate role executions with a bounded tool loop, not seven simultaneous model processes.

The reference was Riley Brown's [Codex: Build Your Full AI Marketing Team (Agents + Skills)](https://www.youtube.com/watch?v=sL_KBnYB17I&t=462s). Its transcript was reviewed through vidIQ. The implementation adapts its source grounding, specialist handoffs and editable outputs to Signal's acquisition and revenue workflows. It does not install the video's plugins or imply that Signal inherits this developer session's connected apps.

## Campaign workflow

1. Enter the objective, audience, offer, constraints and optional source links. Starting a campaign authorizes internal research and preparation while Signal is open.
2. Inspect each specialist's output and source receipts. Product inspection runs before research; current sources take precedence over old saved pricing. Web search uses the existing SearXNG/public Brave research path. Search results are leads to inspect, not proof of buying intent.
3. Use **Request changes** to rerun a role and its downstream work. Earlier completed roles remain saved. Previous content drafts remain in Content & responses for audit; the team packet identifies its current draft IDs.
4. Review the destinations, daily limits, operating mode and duration, then choose **Approve & start campaign** once. This immediately starts Operations for that campaign. It researches, drafts, humanizes, independently checks claims and campaign fit, queues and delivers within the saved policy. Existing permitted email replies and opted-in follow-ups continue automatically. Cold introductions still use their existing individual-approval policy; this button does not expand it. Creative scripts still need an enabled rendering workflow.
5. Preserve the campaign link's `utm_campaign` value in the approved placement. The existing website/checkout integration must preserve that value into payment metadata. Signal recognizes team campaign IDs in GA4 and Stripe imports only for the matching business.
6. Campaign publications link their Operations delivery IDs automatically. You can also link an existing confirmed publication receipt. Only same-business receipts created after the campaign are eligible, and one receipt cannot be linked to multiple team campaigns.
7. Review automatically refreshed Analytics and Revenue results. Existing Operations learning selects subsequent work using observed outcomes, while independent review checks that it still serves the approved campaign. Publication, website sessions and payments remain separate observations. Missing or stale evidence is **Unknown**. Payment totals use the complete ledger, exclude test transactions and disputes, and account for refunds in the business currency. Attribution is association, not proof of causation.

## Persistence and execution

Runs, assignments, revisions and evidence are saved under `marketing.team.run.*` and `marketing.team.task.*` in SQLite settings. Existing `growth_tasks` provide leases, cancellation and crash recovery. No schema migration or operating-system scheduled task is introduced. The owner-disabled Alex production worker is unchanged.

A business can have one unfinished campaign. Completed roles hand off automatically; a blocked or failed role stops downstream scheduling and exposes a retry or revision. Pausing cancels queued/running task ownership, so late model responses cannot commit a team deliverable. A request already sent to the model may finish before the shared worker is free. Resuming queues a fresh task for the unfinished role. Interruptions are visible failures, not silent replays.

Each specialist gets at most four model turns and two read actions per turn. Connected Codex shares the existing 20-call daily per-business allowance. Hitting a provider or daily limit leaves a retryable failure. Existing generic automatic marketing and mission reviews wait while a team packet or its execution is unfinished. Campaign publishing and eligible Sales tasks can use connected Codex when the local runtime is unavailable, sharing that same allowance. Once approved, subsequent operating cycles retry within their saved cadence; provider limits never grant extra usage.

The team tool allowlist is limited to product/source reads, search, saved signals and memory, campaign/account metadata and Demo Studio status. Only copy and sales roles may save drafts, through the existing draft validation. Agents cannot create sending authority, change budgets, alter automation, execute native commands or call external plugins. Source text is untrusted evidence; malformed contracts and invented receipt IDs are rejected. Packet approval also checks that its current draft has not been edited or rejected since the team prepared it.

## Verification

- `tests/growth/marketing-team.test.ts`: queue handoffs, business isolation, cancellation, revisions, source failures, blocked work, offline behavior, Codex routing and attributed collections.
- `tests/operations/analytics.test.ts` and `revenue.test.ts`: team attribution through actual import services, including cross-business rejection.
- `node scripts/team-ui-smoke.mjs`: isolated Electron profile; seven roles, persistent review and offline activation blocking, unknown outcomes, business switching and 390/720/1000/1440 widths.
- `scripts/marketing-team-run.ts`: bounded live Lemonade run using an explicitly selected database under `data/team-validation`. It never starts publishing, mail or recurring workers. Set `SIGNAL_TEAM_DATABASE` and run `node --import tsx scripts/marketing-team-run.ts`. This consumes the connected Codex allowance.

Preparation alone does not establish a live acquisition system or sales. Current source access, account permissions, delivery receipts and fresh analytics/payment imports still determine what can be executed and measured.

## Approve-once execution

Approval records a policy snapshot, operation revision, start time and expiry. Repeated approval requests are idempotent. Saved campaign context and handoffs accompany publishing and customer-email work. Humanizer v3.1.0 guidance is bundled in `src/core/marketing/humanizer.ts`; writers self-edit, preserve supported facts and disclosures, and get automatic correction feedback from independent review. It does not invent a human identity.

Pause stops the campaign; Resume restores the same unexpired scope. Changing Operations settings detaches that scope. Revising a role pauses execution and requires a fresh campaign approval. Expiry prevents new sends even during a long model call. Reopening Signal resumes saved approved work, subject to current account access and limits. No OS scheduled worker is installed or re-enabled. Uncertain provider writes retain their existing reconciliation rules and are never blindly resent.

The UI shows concrete delivery failures and worker errors. New spending, new accounts, account access failures and out-of-scope commitments require owner attention. Configured accounts and source availability are checked at activation. No campaign is approved as part of installing this feature.

## Campaign control room (0.58)

The main campaign view combines a worker heartbeat, current task or waiting reason, next step, dated activity, confirmed publications, attribution metrics and an inline editor. The worker records a heartbeat every five seconds while Signal is open; a missing or stale heartbeat never proves the team is working. Tasks and tool receipts are joined through campaign assignments, including autonomous operation tasks. Completed acquisition checks appear as research outcomes rather than publications. The receipt queue includes copy and evidence. Business-wide research, email policies and Codex usage are explicitly separate from campaign-attributed results.

Edit the objective, audience, offer, constraints and references with **Edit campaign brief**. Saving pauses execution, cancels stale task ownership and replans all seven specialists. **Edit destinations & cadence** changes selected accounts, rolling daily publication limit, interval and duration. It preserves specialist artifacts and pauses execution for approval of the changed scope. Both editors reject stale revisions and retain typed text across activity polling. Account access and policy validation still apply.

The UI has offline integration tests for persisted brief and scope edits, unsaved text across polling, business isolation, and four window widths. Backend tests cover campaign task isolation, stale heartbeat, no-fit research status, stale editors and scope changes without lost specialist work.
