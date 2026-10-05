# Automatic sales replies

Signal 0.13 adds [owner handoffs and exact response approval](sales-handoffs.md)
for conversations the agent cannot finish. Owner-approved responses use the
delivery checks below without AI rewriting and never restart follow-ups.

Signal supports Gmail and, from 0.12, Outlook replies to incoming buying inquiries. Configure each
business separately in **Sales**, then use **Run** in Operations. This is a
supported part of the autonomous operation; broader lifecycle campaigns
and the remaining publishing destinations are still being implemented.

Signal 0.9 adds optional [follow-up sequences](sales-sequences.md) after a confirmed answer. Their timing is configured with the reply policy, and replies and follow-ups share its daily limits.

For Outlook, use the [Microsoft permissions and delivery recovery guide](outlook-replies.md).
The eligibility and review rules below apply to both providers; the single-request
Gmail sending mechanics below are replaced by Outlook's saved draft and send flow.

## Setup

1. In Connections, select Lemonade or CineGen and authorize its Gmail or Outlook account
   through OAuth with both mailbox reading and sending permission. The provider
   must return the sending scope. Imported tokens with unknown scopes cannot
   enable automatic replies; reconnect through OAuth.
2. In Sales, configure that inbox with automatic monitoring and AI triage.
3. Enable automatic replies, select the inbox, and set the daily limit and delay.
   Defaults are five replies daily and a five-minute delay. Limits allow up to
   20 per business per day and at most three per contact per day.
4. Save the reply policy. Saving pauses Operations and cancels unattempted work
   from the old policy. Run starts the enabled policy. Operations currently also
   requires a configured website or Bluesky publishing destination.

New incoming inquiries, positive replies and buying objections are eligible
after triage links them to a lead with an existing conversation or opt-in. Only
messages received after saving the policy, within the last three days, qualify.
Historical backfills do not cause automatic sends. Customer/lost leads, reviewed
messages, suppressed contacts, automated messages, truncated text and owner
handoffs are excluded. This does not start cold outreach or newsletters.

## How a reply runs

The agent reads the current product homepage, drafts a direct answer, and runs
a separate review against the same source. Exact supporting quotes must exist
in that source. Unsupported questions are held for the owner. Replies include
an AI-assistant signature and a reply-to-stop instruction. Inbox suppression
persists independently of message retention.

Before sending, Signal requires a recent complete inbox sync and re-reads the
original Gmail thread. It checks sender, recipient, subject, original body and
message ID. Group conversations, changed reply addresses, list mail, and newer
thread activity, including manual drafts, are held. A stable Message-ID and
thread headers link the generated reply to the original conversation.

Signal saves a send attempt before making the POST request. If Gmail accepts it,
Signal saves the returned ID and verifies the matching sent copy, including
recipients, thread, headers and a body digest. A confirmed sent copy establishes
Gmail acceptance; it does not establish recipient delivery, reading, or a sale.

A failed or interrupted send remains uncertain and is never automatically
resent. While running, Signal checks uncertain delivery every five minutes for
up to 12 checks. **Check delivery** also works while paused. Uncertainty reserves
daily capacity. This conservative behavior includes HTTP errors: an owner may
need to inspect Gmail when no matching sent copy can be found.

Failed preparation retries at ten-minute intervals, up to three attempts, when
the inquiry remains eligible. Stale inboxes and full daily capacity leave queued
work waiting. Pause aborts active work and prevents new sends, but cannot retract
a request Gmail already accepted. Cancellation cannot erase an attempted send.

Reply and source text expire after 30 days. Address/thread/receipt metadata,
body digest and public source quotes remain in the local delivery audit so
uncertain sends can still be checked. This audit is separate from inbox message
retention. Credentials remain in the encrypted connection vault.

## Research and verification

The implementation uses Google's [MIME and base64URL sending contract](https://developers.google.com/workspace/gmail/api/guides/sending),
[threading requirements](https://developers.google.com/workspace/gmail/api/guides/threads),
and [message queries](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list).

Run `pnpm exec vitest run tests/sales/replies.test.ts` for simulated transport
coverage. It exercises generation/review, delivery, restart, uncertainty,
reconciliation, Pause/cancel races, fresh inbox checks, changed threads, quotas,
scope and retention. `pnpm exec tsx scripts/sales-reply-local-smoke.ts` uses an
already-installed local model and live public product research with a synthetic
mailbox. It never loads owner credentials or sends real email. The Sales desktop
smoke script checks the policy and reply UI in an isolated offline profile.

Real OAuth grants and real mailbox delivery require configured accounts and
remain unverified. A local model smoke test is a narrow integration check, not
an accuracy guarantee for arbitrary customer conversations.

The September 16, 2026 local check passed with `gemma4:e4b`: a synthetic buying
question became an inquiry, the reply passed review with four exact public-site
quotes, and one intercepted send was confirmed without duplication. The full
suite passed 620 tests; packaged Sales policy/cancellation checks passed at
desktop and narrow widths. Installer: `release/Signal Setup 0.8.0.exe`.
