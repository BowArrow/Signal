# Sales owner handoffs

Signal 0.13 adds **Sales > Needs you** for conversations the agent cannot finish.
Lemonade and CineGen have separate queues. Each case shows the original message,
the reason for attention, a reminder, and a local decision history. Operations
shows the counts, and the system tray shows how many reminders are due.

## Using the queue

- Set a reminder for four hours or tomorrow, or use the API to choose a time
  within seven days. Reminders persist across restarts.
- Record that you answered in the original mailbox or that no response is
  needed, with a short explanation. This stops the associated follow-ups.
  Your report does not create a delivery receipt or a sale.
- Retry AI preparation when the original unattempted reply is still eligible.
  Normal transient preparation failures get their bounded automatic retries
  before entering the owner queue.
- Reconcile an uncertain attempt by reading the mailbox. An uncertain attempt
  cannot queue another reply. You can explicitly acknowledge the unresolved
  delivery with a note; its attempt and receipt identifiers remain available.
- Write and approve one exact response when the original conversation can still
  accept a reply. The preview includes the Signal footer and fixes the recipient.
  Approval queues the displayed text without asking the model to rewrite it.

An approved response uses the enabled business reply policy and sends only while
Operations is running. Approval expires after 24 hours. Inbox freshness, complete
source text, opt-out suppression, account permissions, the sending delay, daily
limits, and provider conversation checks still apply. The source must be a human
message within 30 days. Policy changes or expired approval require review again.
The owner can answer a triaged handoff or an existing customer without relabeling
them as a new sales inquiry.

Taking over stops follow-ups for that message. The one approved answer never
starts another sequence. This also applies when an older uncertain send is only
confirmed after you take over: its receipt updates, but automation stays stopped.
Gmail uses matching sent-message confirmation; Outlook uses its saved immutable
draft ID and Sent Items confirmation. Neither establishes recipient delivery.

## Persistence and boundaries

Case changes require the current revision, so a stale window cannot silently
resolve a changed case. Repeated mailbox checks do not reopen the same acknowledged
condition. A materially changed source state can reopen it. A confirmed sent copy
closes the pending response case.

History is bounded to 30 entries, with note text removed after 30 days. Closed
case records expire after 90 days when their underlying condition is gone;
metadata is retained while needed to prevent the same acknowledged condition
from reopening. The inbox and reply audit have their own retention policies.
Case contact, subject and diagnostic details are local data, not encrypted vault
credentials. Agents receive counts, not the owner's private notes or message text
from this queue.

Reminders appear inside Signal and its tray while the app is running. They do
not send email, push notifications, or create tasks in an external CRM.

## Research and validation

The queue's due-work, snooze and completion behavior draws on the documented
[Dynamics sales work list](https://learn.microsoft.com/en-us/dynamics365/sales/prioritize-sales-pipeline-through-work-list)
and [HubSpot ticket workflow](https://knowledge.hubspot.com/help-desk/manage-tickets-in-help-desk).
The exact-approval and receipt rules are Signal's implementation decisions.

`tests/sales/handoffs.test.ts` covers restart persistence, revision checks,
business isolation, owner approval, expiry, suppression, tampered text,
uncertain sends, note retention, and late receipt recovery. Gmail and Outlook
transport tests exercise the approved response without contacting real mailboxes.
`scripts/handoffs-ui-smoke.mjs` exercises the desktop workflow in an isolated
offline profile with synthetic messages and no sending.
