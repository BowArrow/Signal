# Intent-based local sales pipeline

Open **Sales → Intent pipeline**. A lead starts with a public email, an exact intent quote and its HTTPS source. Preparation can run without starting Operations. Sending requires an individually reviewed message, the saved sending policy, running Operations and fresh mailbox checks.

This implements the supplied `signal_agentic_sales_implementation_spec.md` within Signal's existing desktop architecture. The application keeps SQLite and durable queue records instead of introducing PostgreSQL, Redis and a separate service deployment. Lead transitions use revision checks and transactions; inference has expiring leases, cancellation and bounded output retries. No database replacement or destructive migration is needed.

## What runs

| Guide area | Implementation |
| --- | --- |
| Intent ingestion | Validated manual intake and existing prospect research handoff. A business page needs a concrete intent sentence and an explicit public email. Generic company descriptions cannot become sendable cold leads. The source must contain both the exact quote and email. |
| Enrichment | Public HTTPS source read through Signal's existing bounded, SSRF-protected reader. No address guessing. Duplicates, known customers and global suppression are rejected. |
| Qualification | Stateless local call, strict JSON Schema at decoding and Zod validation on return. Code requires qualified=true, score ≥70 and a nonempty positioning angle. |
| Draft and critic | One generator plus an independent critic; at most two rewrites. Code enforces fewer than 75 body words, plain text, no first-email links, banned phrases and one final question. Required identity, mailing-address and opt-out footer are separate from the word count. Failed drafts remain editable; edits invalidate critique. |
| Sending | Existing Gmail/Outlook receipt verification, no retry after an uncertain write, per-contact deduplication, transactional reservations and policy checks. All first messages and follow-ups require exact-content human approval. |
| Deliverability | Separate sending domain, owner-recorded 14-day warmup, fresh SPF/DKIM/DMARC DNS checks, ZeroBounce recipient verification, shared mailbox rolling cap of 25 attempts and randomized 4–9-minute spacing. Existing smaller per-business limits remain in force. |
| Inbound | Persist and cancel pending outreach/replies before inference, matching contact or known thread. Standalone “stop” and explicit opt-outs suppress immediately. Pipeline classification cannot advance a meeting, checkout or sale. Interested/objection/referral drafts require human approval even if the model returns false. |
| Learning | Confirmed human-edited sends record original/final copy. With at least 20 edits, a weekly bounded local task distills 5–10 wording rules from up to 50 diffs. A failed scheduled distillation backs off for one day. Rules are untrusted style guidance, never product facts or sending authority. |
| Measurement | Per-call schema outcome, model, retry and latency; confirmed sends, positive reply rate, positioning-angle totals and live revenue attribution when present and fresh. Unknown data remains unknown. |

Lead stages are durable: DISCOVERED → ENRICHED → QUALIFIED → DRAFT_READY → OUTREACH_ACTIVE → REPLIED, with terminal and handoff states retained. Only a confirmed matching sent copy enters OUTREACH_ACTIVE. An imported, matching live payment with positive net capture can enter CLOSED_WON. A model's proposed MEETING_BOOKED or CHECKOUT_SENT value does not establish either event. Refunds and disputes affect revenue totals; a later refund does not reactivate outreach.

## Setup

1. Keep an installed local model selected under Marketing agent settings and the local OpenAI-compatible endpoint under runtime settings. The intent pipeline always uses this local endpoint, even if a campaign has a connected Codex account. It never silently falls back to a hosted model. The existing broader marketing workflows retain their provider settings.
2. Connect a dedicated Gmail or Outlook sending domain under Connections and enable monitoring in Sales setup. The product's own domain and its subdomains cannot send cold introductions. Signal does not register domains, buy inboxes or manufacture warmup activity.
3. Configure the inbox's exact sender, DKIM selector and actual warmup start in Intent pipeline → Sending readiness. Check DNS. A record check verifies published records; it does **not** prove SPF/DKIM alignment on an actual delivered message. Verify alignment in a real mailbox test before operating the inbox.
4. Supply `ZEROBOUNCE_API_KEY` to the Signal process environment or credential-vault accessor, then restart Signal. The **Verify recipient** button submits that one email to the provider and consumes its allowance. Only `valid` results without catch-all/accept-all risk are accepted. Results and DNS checks expire after 24 hours. Keys and provider error bodies are not returned to the renderer or stored in receipts.
5. Add a real intent lead. Read its evidence, qualification and proposed copy. Edit if needed, let critique rerun, verify the recipient, and approve the exact email. The preview includes the actual sending footer. Starting Operations is a separate action.

The locally checked model was the already-installed `qwen3.5:9b` on a 10 GB RTX 3080. The supplied guide's larger-model footprints, benchmark claims and vLLM throughput estimates were not used as verified hardware promises. No model download, GPU configuration change or vLLM deployment is required by this change. The compatible client passes strict JSON Schema to chat completions; Ollama uses its native schema-valued `format` field.

## Existing work and upgrade behavior

- Existing databases, conversations, campaigns, receipt history and creative workflows remain intact.
- Queued unattempted messages without individual approval are held for review. Attempted sends remain reconciliation-only.
- Old cold drafts cannot bypass the intent, qualification or sender-readiness gates. Use the intent pipeline for new cold acquisition. Existing opt-in prospect preparation remains available, but every message now waits for approval.
- Blog/editor/community proposals remain in Drafts & suggestions. Public placement permission and publication receipts stay separate from the email pipeline.
- Suppression now applies across businesses in this local profile. The UI also supports global domain blocking. Do not use another business identity to contact an opted-out address.
- Contact data, draft text and feedback remain in this local profile. No lead list or live account state is included in GitHub or the validation fixtures.

## Boundaries still requiring external setup or evidence

There is no Phase 2 automatic-send switch in this release. The guide's first-50-lead review phase remains the enforced default; no reply-rate or critic-accuracy threshold is assumed satisfied. Closing and objection replies require human approval permanently.

The repository already contains public-source pollers and website/Mailchimp consent imports. This change connects business prospect research to intent intake; it does not claim new authenticated Reddit/GitHub subscriptions, job-board integrations or inbound signup webhooks have been deployed. A social handle or GitHub star alone supplies neither an email nor outreach permission. Existing imported contacts are preserved and not silently reenrolled in cold outreach.

Mailbox polling uses the existing Gmail/Graph implementation. Dedicated bounce/complaint webhook integration, provider-authenticated meeting receipts, and checkout event handoffs remain external integration work. Delivery reports stop pending work and require review; Signal does not label every bounce as a hard bounce or infer a spam-complaint rate from an unavailable feed.

Revenue attribution requires actual `signal_campaign` or `utm_campaign` metadata containing a confirmed outreach delivery ID, carried into the existing Stripe import. Identity matching can establish a customer; it cannot establish campaign attribution. Missing, stale, mixed-currency or unattributed revenue stays unknown. No purchases, publications or outgoing messages were executed during implementation validation.

## Validation

Validated on November 21, 2026: all 1,626 tests across 83 files passed, along with typecheck, production build and lint of every changed JavaScript/TypeScript file. The isolated UI check passed all four widths with zero renderer errors. The installed local model completed qualification, drafting and critique with valid schemas and no retries in the synthetic smoke run. This is implementation evidence, not a measured campaign conversion or model-accuracy benchmark. The installed desktop application has not been replaced by this branch.

- `pnpm typecheck`, `pnpm build`, and `pnpm exec vitest run --maxWorkers=2`.
- `tests/sales/pipeline.test.ts`: admission, transition integrity, bounded inference, critique, leases, sender gates, verification, pacing and reply routing.
- Existing Gmail/Outlook tests explicitly simulate individual approval before exercising transport, cancellation and uncertain-write recovery.
- `node --import tsx scripts/sales-pipeline-local-smoke.ts`: in-memory database, synthetic sources, actual local Ollama inference, no mailbox and no sending worker. Receipt: `output/sales-pipeline-validation/local-model.json`.
- `node scripts/sales-pipeline-ui-smoke.mjs`: isolated offline Electron profile, source/qualification visibility, preserved unsaved edits, business isolation and 390/720/1000/1440 px layouts. Receipt: `data/sales-validation-pipeline/receipt.json`.

Provider references: [Ollama structured outputs](https://github.com/ollama/ollama/blob/main/docs/capabilities/structured-outputs.mdx), [ZeroBounce validation contract](https://www.zerobounce.net/docs/email-validation-api-quickstart/v2-validate-emails), [ZeroBounce result codes](https://www.zerobounce.net/docs/email-validation-api-quickstart/v2-status-codes).
