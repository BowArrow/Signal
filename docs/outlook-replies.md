# Outlook sales replies

Signal 0.12 extends the existing [sales reply policy](sales-replies.md) and
[follow-up sequences](sales-sequences.md) to Outlook and Microsoft 365 inboxes.
Use the business's own connected mailbox. Shared/delegated mailbox sending and
other Microsoft cloud regions are not part of this adapter.

## Connect and run

In Connections, authorize Outlook through the configured Microsoft desktop
OAuth app and select sending permission. Reply delivery requires both
`Mail.ReadWrite` and `Mail.Send`, in addition to the existing account/read grant.
Previously linked read-only accounts need a new grant. Tenant consent policy
may require the account administrator. Imported tokens without returned scope
metadata cannot enable the policy.

In Sales, enable automatic monitoring and AI triage, select that Outlook inbox
for replies, and choose the delay, daily limit and optional follow-up days.
Save the policy, then Run Operations. The existing requirement for a configured
website or Bluesky publishing destination still applies to starting Operations.
An account connection alone does not enable replies.

Only eligible new buying conversations received after policy configuration are
answered. Research, independent editorial review, exact supporting quotations,
AI identification, suppression, contact limits and pipeline safeguards are shared
with Gmail. Historical backfills, group conversations and owner handoffs do not
start automatic replies. Follow-ups require confirmed earlier sent copies.

## Delivery and recovery

Signal first reads the full bounded conversation and verifies the original
message, recipient scope and any earlier sequence messages. It holds mail with
changed reply addresses, delegated senders, list/automatic headers or new human
activity. A conversation requiring more than 100 messages is held for review.

The adapter creates a MIME reply draft with the reviewed plain-text body. Before
that request, Signal durably reserves the entire reply operation. It saves the
returned immutable draft ID before making another request. It rechecks the
conversation, draft contents, account and running policy before sending.

A send acknowledgement is not delivery confirmation. Signal retrieves the same
ID and requires a non-draft copy in Sent Items, matching conversation, recipients,
sender, subject, reply header and body digest. The provider may assign its own
Internet Message-ID; reconciliation uses the saved immutable ID. It does not
prove recipient delivery, reading, qualification or a sale.

An interrupted operation may leave an unsent draft. If the draft-creation response
was lost, this worker never reached the send step. If sending was attempted,
its outcome can remain uncertain until Sent Items catches up. Neither case
causes another automatic creation or send attempt for that reply. **Check delivery**
performs reads only; a draft is never counted as sent or automatically resumed.
Inspect Outlook before manually sending or deleting an unresolved draft.

Pausing or changing policy between draft creation and send prevents the subsequent
send request. Once a request is accepted by Microsoft, Pause cannot retract it.
Uncertain operations reserve daily capacity and follow-ups do not advance until
the sent copy is confirmed. Stopping a sequence remains effective even if a late
receipt confirms a previously attempted message.

All authenticated requests are pinned to `graph.microsoft.com/v1.0/me` and include
the immutable-ID preference. No provider continuation link is followed by the
delivery adapter. Credentials remain in the main process. Source disconnection,
identity changes, malformed responses and failed network requests stop progress;
provider exception bodies are not copied into the delivery record.

## Verification

`tests/sales/outlook-replies.test.ts` covers real service orchestration with a
simulated Graph transport: durable ordering, response loss, eventual Sent Items,
changed recipient/body/draft, extra attachments, policy/pause/opt-out races,
business isolation, scopes, complete sequences and stopped or uncertain steps.
The existing Gmail tests remain in place.

`node --import tsx scripts/sales-reply-local-smoke.ts Lemonade outlook` and the
equivalent `CineGen outlook` command use installed local inference and real public
product research while intercepting every mailbox operation. No owner credential
is loaded and no real email is sent. Each run exercises an initial reply and one
follow-up with supporting evidence and simulated Sent Items receipts.

The packaged UI check accepts the executable path followed by `outlook` to seed
an isolated Outlook fixture. It verifies selection of an eligible inbox, enabling
and saving its reply policy, follow-up timing, source edits, business isolation
and offline write blocking. Real Microsoft OAuth consent and customer delivery
remain unverified by these fixtures.

## API references

- [Create a reply draft](https://learn.microsoft.com/en-us/graph/api/message-createreply?view=graph-rest-1.0): MIME input and Mail.ReadWrite permission.
- [Send a draft](https://learn.microsoft.com/en-us/graph/api/message-send?view=graph-rest-1.0): Mail.Send and asynchronous acknowledgement.
- [Immutable Outlook IDs](https://learn.microsoft.com/en-us/graph/outlook-immutable-id): stable draft-to-Sent-Items lookup and eventual availability.
- [Get a message](https://learn.microsoft.com/en-us/graph/api/message-get?view=graph-rest-1.0): selected message fields and body format.
- [List messages](https://learn.microsoft.com/en-us/graph/api/user-list-messages?view=graph-rest-1.0): bounded filtered conversation reads.

Reviewed September 17, 2026.
