# Sales follow-up sequences

Signal can continue an unanswered Gmail or Outlook buying conversation after the first
confirmed reply. Each business has its own timing, contacts and delivery limits.
The existing [sales reply setup](sales-replies.md) is required.

In Sales, enable **Follow up when a buyer has not replied**, enter the days to
wait after each confirmed message, and save the reply policy. Saving pauses
Operations. Run enables that policy, including follow-ups. An empty schedule
means no automatic follow-ups; upgrading from 0.8 keeps follow-ups disabled.

For example, `2, 5` waits two days after the initial answer, then five days after
the first follow-up. The schedule supports one to three steps, each one to 14
days apart, with at most 21 days total. Intervals are business settings, not a
claim that one timing is optimal for every offer or customer.

## Enrollment and stopping

Only confirmed initial replies sent under the current policy can enroll. The
original message must be a buying inquiry associated with an eligible lead.
Signal permits one active sequence per contact within a business. Existing
manual follow-up dates are preserved; they prevent automatic enrollment.

The next due date appears in the lead pipeline. Signal owns that date only while
it matches the sequence's date. Changing or clearing it stops the sequence and
preserves the owner's replacement. Changing the lead to customer/lost, changing
its address or contact permission, or suppressing it also stops the sequence.

Any newer incoming message from that contact in the business's monitored inbox
records stops the old sequence, even before AI triage. A newer message in the
original thread also stops it, including a bounce, manual sent message or draft.
An unanswered billing/support handoff does not become a sales follow-up.

Use **Stop sequence** in Sales to end future steps. Cancellation of a queued
follow-up also stops its sequence. Saving a new reply policy stops old sequences
instead of silently applying new timing. Pause suspends new sends while keeping
the sequence and its due date. It cannot retract a request already accepted by
the mailbox. A stopped sequence remains stopped when an uncertain send is reconciled.

These rules depend on available evidence. Pipeline customer status currently
comes from the saved lead record; Stripe revenue totals do not identify a
particular buyer automatically. Live customer/checkout identity matching remains
part of the full sales operation's remaining work.

## Execution and delivery

When due, Signal reads current product facts and generates a concise follow-up
using the previous answer as context. A separate editorial pass requires exact
supporting quotes. Each step has a stable ID, a durable queue record and its own
send attempt. A failed preparation can retry within the existing three-attempt
limit; a send attempt is never repeated automatically.

Before submission, Signal requires fresh inbox monitoring and retrieves the full
mailbox conversation. It checks the original incoming message plus every earlier Signal
sent copy, comparing their addresses, headers and content digests. Missing,
changed or trashed earlier messages prevent a new send. Any additional thread
activity prevents sending, so an owner can take over the conversation manually.

The next interval starts only after confirming the matching sent copy. An
uncertain send holds the sequence at its current step until reconciliation.
Replaying reconciliation cannot advance twice. All replies and follow-ups share
the business and per-contact daily caps. Freshness checks, daily capacity, app
availability and editorial approval can delay a scheduled step.

Sequences expire when their original conversation is older than 28 days. Reply
and source text still expire after 30 days; delivery audit metadata is retained.
The final step completes the sequence without scheduling further messages.

## Research and verification

Thread continuity uses Google's documented [thread retrieval and reply headers](https://developers.google.com/workspace/gmail/api/guides/threads)
and [full-thread retrieval](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/get).
Mailbox connection is separate from [sender authentication and delivery requirements](https://support.google.com/mail/answer/81126).

Tests exercise a complete two-follow-up sequence, due dates, fresh research,
sent-copy continuity, new inbound messages, owner pipeline edits, stopping,
policy changes, business isolation and uncertain-send restart recovery.
`pnpm exec tsx scripts/sales-reply-local-smoke.ts Lemonade` and the same command
with `CineGen` use the installed local model and live public product sites with
intercepted mailbox transport. Both completed an initial answer and a follow-up
with `gemma4:e4b` on September 16, 2026. These are narrow integration checks,
not a broad accuracy benchmark. No real email was sent.

Real OAuth grants, mailbox delivery and commercial results remain unverified.
Proactive opted-in outreach and broader lifecycle campaigns remain separate work.
Signal 0.13 adds [owner handoff management](sales-handoffs.md): taking over or
approving one exact response stops the conversation's follow-ups, including when
an older uncertain send is confirmed later.

The final 0.9 validation passed typecheck, lint, 632 tests, and packaged Sales,
Connections and Operations checks at desktop and narrow widths. The installer
is `release/Signal Setup 0.9.0.exe`; it has not replaced the owner's installed app.
