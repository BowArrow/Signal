# Codex revenue mission

My marketer can connect to the installed, signed-in Codex through its supported stdio app-server protocol. Signal checks the account and model catalog, then verifies access with an actual completed reply before saving a connection for the selected business. It does not read or copy Codex credentials. `SIGNAL_CODEX_EXECUTABLE` can select an installed executable; Windows also discovers the VS Code extension binary and PATH executables.

The requested Lemonade mission is **$100,000 USD in new collected revenue, October 13 through December 31, 2026, America/Los_Angeles**. The ending timestamp is exclusive January 1, 2027 local midnight, accounting for daylight saving time. Collections mean live captured USD payments less refunds, with disputed payments held out. This is not profit, net-of-tax accounting revenue or spendable cash. Other currencies remain excluded and no exchange rates are invented.

The main process scores the complete payment ledger. It never sums the renderer's 300-row preview. A complete, recent live scan covering the whole mission window is required to verify the score; missing, incomplete and stale evidence remains provisional. Saved payments are deduplicated by account and payment ID. Campaign attribution is not inferred.

## Daily work

While Signal is running, an active mission requests one review every 24 hours. Codex receives the saved goal, mission score, recent conversation, product facts and current business context. It can inspect sources and save customer-facing drafts. A draft awaiting review holds subsequent automatic reviews. A manual **Review our next move** action can request another review. Pausing daily reviews cancels a queued scheduled review and stops future scheduling. It does not pause other separately authorized Operations or change their permissions.

Guide questions and mission reviews use Codex for the connected business. Other workloads keep their configured runtime. Codex guide work has its own queue selection and can run when Ollama is unavailable. The shared worker still serializes work and respects active media jobs.

Signal supplies context each turn rather than importing this developer chat or transferring its identity. Threads are ephemeral; durable mission memory, messages, drafts and receipts live in Signal's database. The current integration is a Codex-backed marketing workflow, not a copy of a particular chat session.

## Execution boundary

Codex produces Signal's action contract. Signal validates and executes those actions through the existing coaching tool allowlist. Native shell, applications, plugins, multi-agent tools, web search and inherited MCP connections are disabled for the model process. The thread uses a read-only sandbox and the client rejects native tool requests. Signal's own research tools supply sources. Failed, cancelled, disconnected and incomplete turns remain failures.

The existing coaching boundary prohibits publication, sending, spending, paid generation and changes to automation. Prepared work goes to the existing review screens. Existing authorized operating policies remain separate. The mission adds no advertising budget, price change, discount or customer commitment. Each business is limited to 20 Codex inference calls per UTC day; Codex account usage limits also apply.

## Verification

`tests/growth/codex-client.test.ts` exercises protocol order, tool refusal, process cleanup, cancellation, failure and offline behavior. `tests/growth/revenue-mission.test.ts` covers the score, full-ledger counts, calendar boundaries, scheduling, business isolation, queue routing and call limits. `scripts/guide-ui-smoke.mjs` checks mission persistence, unknown-score treatment and four widths with an isolated offline profile.

Official integration reference: [Codex App Server](https://learn.chatgpt.com/docs/app-server).
