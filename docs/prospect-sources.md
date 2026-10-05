# Automatic prospect sources

Signal 0.18 can keep a business pipeline current from a selected Mailchimp
audience while Operations runs. This connects existing signup collection to
initial outreach, monitored replies and Stripe purchase matching. It does not
find new people by itself or establish that a campaign produced a sale.

## Setup

1. Connect Mailchimp in Connections using its Marketing API key. Signal stores
   the credential in the existing credential vault. The key's data-center suffix
   determines the fixed Mailchimp API origin.
2. In Sales, choose Lemonade or CineGen, then load audiences under Automatic
   prospect source. Select the audience for that business and confirm its consent
   applies to that business.
3. If contacts have marketing permission fields, enter the ID of the relevant
   email marketing permission. These IDs appear in the member API's
   `marketing_permissions` records. Signal requires exactly one matching enabled
   field. A blank selection excludes contacts with permission fields.
4. Enable the source and save. Saving pauses the operation. Sync manually to
   inspect the result, or use Run to continue automatic ingestion. Configure the
   separate outreach policy and a monitored Gmail/Outlook inbox to send initial
   messages. Ingestion itself sends no email.

Only `subscribed` members with `consents_to_one_to_one_messaging: true` qualify
for initial import. A newsletter subscription alone does not qualify. Missing
consent is treated as unavailable, never inferred by a model. Members without
marketing permission fields still need that explicit one-to-one consent.

## Pipeline behavior

New eligible addresses become opted-in leads; known Stripe purchasers become
customers. Source and observed consent are recorded locally. The API's opt-in
timestamp is included when supplied, otherwise its absence is recorded. Existing
lead stage, permission and notes stay unchanged. Imports deduplicate normalized
email addresses within the selected business.

Unsubscribed or cleaned addresses create a persistent business suppression and
stop matching follow-ups, including existing pipeline contacts. Later subscribed
status does not erase that suppression. Pending, transactional or archived
members are not imported as prospects. A pending member can be imported after
eligible consent appears in a later scan.

Before an email write to a linked contact, Signal reads that member again and
requires current eligible consent. This applies to initial outreach, replies and
follow-ups. Outlook repeats the check before sending its created draft. Missing
members, changed/disabled sources, missing account access or revoked consent hold
delivery. A late opt-out can leave an unsent Outlook draft; its receipt remains
available for reconciliation and no new draft is created automatically.

A temporary 429, server failure, timeout or network failure before any initial
outreach write permits another preparation attempt after ten minutes, with at
most three preparation attempts. A known or uncertain write is never retried by
this recovery path. Source-reading failures retry after five minutes. Permission
denials and credential failures need owner attention.

## Checkpoints and limits

Reads use GET only against the verified business connection, reject redirects,
limit response size to 2 MB and time out after 30 seconds. Credentials do not
enter pipeline records or model input. No audience updates, campaign sends or
webhook registrations occur. The key itself may allow writes at Mailchimp;
Signal's ingestion adapter implements only reads.

Each scan processes 100 records per page, up to 10,000 changed records. Each page
and checkpoint commit atomically. Interrupted scans resume at the last saved
offset. New scans use a fixed upper time boundary and a two-minute overlap with
the previous completion watermark. Five-minute polling runs only while the
business operation is running; manual page reads are available while paused.

Offset pagination is not a transactional snapshot. Concurrent edits or removals
can shift records. Signal deduplicates observations and performs a full refresh
daily to revisit omissions. Per-contact delivery checks remain necessary even
after a completed scan. Larger audiences, accounts with over 100 audiences, or
invalid API responses show attention rather than a misleading complete result.
For initial use, select a focused audience within these limits.

Contact/source links remain local so previously imported contacts retain their
delivery checks across restarts and source edits. Changing or disabling the
source therefore holds automatic emails to those contacts. With GPT selected,
lead information used by a later outreach task goes to the configured OpenAI
account. The audience import uses no model.

This has been tested with intercepted provider responses and isolated desktop
profiles. Live Mailchimp account access, real customer consent records and live
delivery remain unverified. Other CRM providers, direct website signup ingestion
and new-prospect discovery remain outstanding.

## Research

- [Mailchimp member API](https://mailchimp.com/developer/marketing/api/list-members/list-members-info/)
- [Official member response schema](https://api.mailchimp.com/schema/3.0/Definitions/Lists/Members/Response.json)
- [Official member query schema](https://api.mailchimp.com/schema/3.0/Paths/Lists/Members/Collection.json)
- [Mailchimp pagination and fields](https://mailchimp.com/developer/marketing/docs/methods-parameters/)
- [Mailchimp audiences](https://mailchimp.com/developer/marketing/api/lists/get-lists-info/)

These define the status and consent fields, email-hash member identity,
`since_last_changed`/`before_last_changed` filters and offset/count pagination.
Signal's consent policy, retry limits and refresh cadence are application design
choices, not Mailchimp delivery or legal guarantees.
