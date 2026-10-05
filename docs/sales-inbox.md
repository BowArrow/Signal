# Sales inbox and automatic triage

Signal 0.7 adds durable inbox ingestion and triage to the existing lead pipeline.
This is a necessary part of the full autonomous sales goal: agents need to know
when someone replies or asks to stop before scheduling more outreach. Signal 0.8
adds a separate [automatic Gmail reply policy](sales-replies.md) for composition,
sending and sent-copy reconciliation. Inbox monitoring alone does not send mail.
Signal 0.9 adds [Gmail follow-up sequences](sales-sequences.md). Signal 0.12 extends replies and follow-ups to [Outlook](outlook-replies.md). Broader lifecycle outreach remains unfinished.

## Set up a business inbox

1. In Connections, link and verify Gmail/Google Workspace or Outlook/Microsoft
   365 for the correct business. Read permission is sufficient for this workflow.
2. Open Sales, select Lemonade or CineGen, and add that inbox. Use separate
   mailboxes for separate businesses. Multiple inboxes per business are supported;
   a verified primary mailbox identity cannot be assigned more than once.
3. Choose a history start within the last 90 days. The default is seven days.
   Enable automatic monitoring if it should run with Operations.
4. Optionally enable AI triage. The selected local/GPT model receives individual
   subjects and body text for classification. This setting starts disabled.
5. Save and Sync inbox. Large histories require additional pages. While the
   business's Operations policy runs, Signal continues pages and checks new mail
   about every two minutes. Stop monitoring removes this schedule without
   deleting conversations, leads, suppression records or the account connection.

Operations Pause aborts in-flight Sales reads and model work. Source edits and
removal discard late results. Manual sync and triage remain available while an
operation is paused. Signal and the computer must stay running; this is not a
hosted inbox worker.

## What happens to a message

Each received message is stored under its account and provider message ID.
Pages and cursors commit together. A failed page keeps the last committed cursor;
restart resumes the same history window. A one-minute overlap catches boundary
messages without creating duplicate leads or repeatedly clearing follow-ups.

A newly observed human reply from the exact email address of an existing lead
clears its follow-up date when the message is newer than the lead record. It
advances discovered/contacted leads to replied and preserves later stages.
Historical backfills do not reset newer manually scheduled work on replay.

Explicit opt-out wording in the new authored text suppresses that sender for
the business. Quoted history is excluded from the simple wording check where its
boundary can be recognized. AI can also identify opt-outs with a supporting
quotation. Suppression clears matching follow-ups and sets do-not-contact;
Studio edits, including CLI edits, cannot silently override the suppression.
Suppression persists after source removal and message retention expiry. There is
no automatic re-enrollment or suppression-release flow in this version.

AI labels inquiry, positive reply, objection, opt-out, absence, delivery failure,
unrelated mail, or handoff. Its evidence must quote the saved subject/body exactly.
Buying inquiries can create a pipeline lead or attach to an existing one. New
leads are marked replied/existing-conversation, which records the inbound
conversation; it does not establish newsletter opt-in, qualification, verified
sender identity, or a purchase. Billing/refund complaints, suspicious messages
and uncertainty are assigned for human attention. Incomplete message text cannot
automatically create an AI-classified sales lead. Classifications can be wrong;
review the original mailbox when context or attachments matter.

Automated/list messages and delivery reports do not create sales leads. A bounce
report is not automatically applied to its apparent sender: the actual failed
recipient and delivery status still need reconciliation. Known automated mail
does not clear a lead's follow-up merely because it arrived.

## Data and provider boundaries

- Gmail uses bounded `users.messages.list` requests and `messages.get?format=full`.
  It excludes sent, draft, spam and trash messages, including a second label check
  after retrieval. Archived received mail remains eligible.
- Outlook uses `/v1.0/me/messages`, immutable IDs, a received-date window, and
  explicit fields. Junk, deleted, sent and draft folders are excluded. Continuation
  URLs must remain on the fixed Graph origin and `/v1.0/me/messages` path.
- Both readers use GET requests, reject redirects, bound responses to 2 MB, and
  recheck account/configuration authorization before requests and before commit.
  They do not mark mail read, change folders, send messages or fetch attachments.
- Plain text is preferred. HTML fallback is reduced to inert text; no remote
  images, scripts or links are loaded. Text is capped at 12,000 characters per
  message; incomplete bodies are flagged. Large/unsupported messages can stop a
  page and require attention rather than being silently counted as read.
- Message bodies and AI summaries are stored in the local SQLite profile, not
  the encrypted credential vault. Bodies/evidence expire after 30 days and
  message records after 90 days, when Signal next runs its retention pass.
  Leads and suppression records remain. Backups and the provider's original
  mailbox have their own retention; this cleanup does not erase those copies.
- At most 10,000 retained message records per business are ingested. The UI shows
  the most recent 300 per business, with counts over the retained records.
- The general marketing agent receives only product-scoped counts and source
  freshness, not email bodies or addresses. The separate triage call receives
  the individual email only when AI triage is enabled. Existing GPT call limits
  and local runtime settings apply. Credentials never enter model input.
- This is received-date polling, not a full mailbox replica or history/delta
  synchronization. Old imported messages outside the history window, deep
  folder changes, edits/deletions, aliases, shared mailboxes and messages manually
  sent by a person are not reconciled into a complete conversation ledger yet.

## Research and validation

The implementation follows Google's documented message-list/query behavior and
full-message retrieval, and Microsoft's pagination, folder and immutable-ID
contracts. The parser accepts text or HTML because Graph responses may vary by
operation and preference handling. Source material is treated as data, not
instructions:

- [Gmail list messages](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list)
- [Gmail get a message](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get)
- [Gmail message resource](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages)
- [RFC 2047 encoded email headers](https://www.rfc-editor.org/rfc/rfc2047)
- [Microsoft list messages](https://learn.microsoft.com/en-us/graph/api/user-list-messages?view=graph-rest-1.0)
- [Microsoft immutable IDs](https://learn.microsoft.com/en-us/graph/outlook-immutable-id)
- [Microsoft mail folders](https://learn.microsoft.com/en-us/graph/api/resources/mailfolder?view=graph-rest-1.0)

Automated tests exercise read-only requests, business isolation, pagination and
restart, duplicated pages, failed pages, reply follow-up cancellation, persistent
suppression, owner-review/Pause races, grounded AI output, HTML/attachment
handling, retention, per-business UI limits and offline behavior. Desktop checks use an
isolated offline database and synthetic conversations. Real Gmail/Outlook grants
and live mailbox reads remain unverified until accounts are configured.

Run `pnpm exec vitest run tests/sales/inbox.test.ts`, `pnpm typecheck`,
`pnpm lint`, `pnpm build`, and `node scripts/sales-ui-smoke.mjs`. The desktop
script also accepts the packaged Signal executable path. The optional
`pnpm exec tsx scripts/sales-local-smoke.ts` runs synthetic messages through the
already-installed local model in an in-memory database; it never calls a real
mailbox or sends mail, and stops only the runtime server it starts itself.

The installed `gemma4:e4b` model passed the live local smoke check on September
16, 2026: a buying inquiry became an inbound lead, while a refund complaint and
an instruction to export customer data/API keys were classified for handoff.
These three synthetic examples verify the integrated local path, not a broad
accuracy benchmark or real-mailbox authorization.
