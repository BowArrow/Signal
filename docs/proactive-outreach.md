# Proactive outreach and follow-ups

Signal can start a new sales conversation with an existing opted-in lead through
Gmail or Outlook. This is a separate policy in Sales, enabled only when the owner
configures it and starts Operations. Configure automatic replies separately to
continue the conversation after a prospect answers. Optional unanswered-outreach
sequences can send up to two follow-ups in the original email conversation.

## Setup

1. Connect a dedicated business Gmail or Outlook inbox with reading and sending
   access. Outlook also needs Mail.ReadWrite to create its durable draft.
2. Enable automatic monitoring and AI triage for that inbox in Sales. A complete
   inbox scan no older than five minutes is required before preparation/sending.
3. Add leads in Growth workspace → Lead pipeline. Record their source and actual
   permission. Initial outreach requires `opted-in`, a valid email, and a stage of
   discovered, qualified or trial. Unknown permission and an existing conversation
   do not qualify for this new-conversation workflow. The agent never invents opt-in.
4. Configure an outreach objective, sending inbox, business mailing address,
   delay of 5–120 minutes and limit of 1–10 outreach emails per rolling day.
   Initial emails and follow-ups share that limit. Optionally enable one or two
   follow-ups, each 2–14 days after the preceding confirmed send, totaling at most
   21 days. Existing policies default to no follow-ups.
5. Save, then Run Operations. Run shows the enabled outreach limit alongside its
   other activities. Saving settings pauses Run and cancels unattempted outreach.

## Behavior

The worker researches the current product site, drafts one practical first task,
and independently reviews the draft against source excerpts. Fixed checks reject
header injection, misleading reply prefixes, external links, placeholders,
unsupported absolute privacy promises and internal drafting instructions. The
finished message receives a tracked product link, business identity, AI disclosure,
promotional identification, the configured mailing address and reply-to-stop
instructions. Relevant lead context and public product text go to the selected
local or GPT provider. Tokens and mailbox credentials never enter model input.

The app makes at most three automatic preparation attempts for a still-eligible
contact; explicit model holds need owner review. The same normalized email has one
durable outreach identity per business, even if duplicate lead rows exist or the
sender changes. A prior attempted send cannot be prepared or sent again. A cancelled,
unattempted message can be prepared again only by an explicit owner action.

Before any write, Signal checks the current policy, Run state, recipient, lead
details, source freshness, opt-out state, known purchases, evidence age and daily
capacity. It also searches the actual mailbox for prior conversations: Gmail uses
participant queries; Outlook uses documented participant search. A match holds
the lead for the existing conversation. These searches depend on provider indexing;
an empty result cannot prove that no recent activity exists anywhere.

Gmail sends a single-recipient MIME message with a stable Message-ID. Outlook first
creates a MIME draft, saves its immutable identifier and verifies the unchanged
draft before sending. A send is complete only after its exact sent copy is read
back. A lost response is reconciled without sending again. If Outlook creates a
draft but its response is lost, the app never sends it; the owner may find an
orphaned draft in the mailbox. Cancelling or pausing cannot recall an accepted send.

Confirmed messages move eligible leads to Contacted without changing permission.
Incoming answers enter the existing Sales triage/reply workflow. Opt-outs remain
suppressed, and a matching live Stripe purchase cancels unattempted outreach.
Known customers are excluded even after refunds. Confirmed outreach IDs are valid
Stripe campaign references; metadata must reach Checkout for attribution to work.
This does not infer campaign causality or deploy checkout integration changes.

Email bodies and evidence expire locally after 30 days. Recipient, hash, status
and delivery identifiers remain to prevent duplicates and support reconciliation.
Outreach and reply daily limits are separate. This is low-volume, recorded-opt-in
outreach, not bulk campaigns, lead scraping, purchased lists, or consent discovery.

## Unanswered follow-ups

Unanswered follow-ups require the original policy revision, unchanged opted-in
contact, confirmed sent history and a fresh monitored inbox. Enabling follow-ups
does not enroll older initial emails. Each step gets new product research and an
independent review, distinct copy, the original subject and conversation, and the
same disclosure, opt-out and attribution controls as the initial email. The next
delay starts after the preceding send is confirmed, including when Run was paused.
The sequence expires 30 days after the original send.

Gmail checks the full original thread and participant search before sending.
Outlook verifies each earlier sent copy, creates a MIME reply draft, checks its
recipient/body/thread and searches participants again before sending. Any extra
mailbox activity holds the follow-up. Replies, opt-outs, purchases, contact or
policy changes stop the sequence; owners can also stop it from Sales. An uncertain
attempt remains available for reconciliation after a sequence is stopped. Sequence
progress and the next eligible time are shown in Sales; sending still depends on
Run, the send delay, current checks and shared daily capacity.

## Research and verification

- [Gmail sending guide](https://developers.google.com/workspace/gmail/api/guides/sending):
  MIME/base64url transport and direct sending.
- [Gmail threads](https://developers.google.com/workspace/gmail/api/guides/threads):
  matching subject, thread ID and reply/reference headers for conversation continuity.
- [Microsoft create reply](https://learn.microsoft.com/en-us/graph/api/message-createreply?view=graph-rest-1.0):
  a reply draft using MIME headers/body, followed by separate send and readback.
- [Microsoft create message](https://learn.microsoft.com/en-us/graph/api/user-post-messages?view=graph-rest-1.0)
  and [send message](https://learn.microsoft.com/en-us/graph/api/message-send?view=graph-rest-1.0):
  draft creation and separate send action; acknowledgment is not delivery proof.
- [Microsoft message search](https://learn.microsoft.com/en-us/graph/search-query-parameter):
  participant-based mailbox searches without unsupported recipient collection filters.
- [FTC commercial-email guidance](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business):
  truthful headers/subjects, identification, mailing address and opt-out handling
  informed the message controls. These controls do not establish jurisdiction-wide
  compliance or verify an imported permission record.

`tests/sales/outreach.test.ts` uses intercepted Gmail and Outlook transports for
research/review/queue/send/reconciliation, mailbox activity, opt-out, purchase,
capacity, duplicate contacts, changed copy, pause, retry, crash recovery and
retention. `tests/sales/outreach-followups.test.ts` covers complete two-step sequences,
shared capacity, pause/delay handling, policy changes, purchase stops and uncertain
sends with intercepted providers. `scripts/outreach-ui-smoke.mjs` uses an isolated
offline desktop profile and software rendering, including follow-up settings,
sequence progress and stopping. Live Gmail/Outlook follow-up compatibility and
deliverability remain unverified; strict provider readback holds mismatching drafts.
`scripts/outreach-local-smoke.ts` uses real local inference and public product
research with synthetic contacts and intercepted Gmail transport. None sends real
email, verifies deliverability or proves customer acquisition.
