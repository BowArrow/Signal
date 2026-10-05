# Shared Gmail business addresses

In Sales, choose the business, select its Gmail inbox, and refresh sender addresses.
Select an accepted address and save inbox monitoring. Saving verifies it with Google.
For another business, use the existing Gmail account button to reuse its connection,
then select a different address. Credentials remain encrypted in the local profile.

The owner's verified assignments are:

| Business | Sender |
| --- | --- |
| Lemonade | sales@aionx.aionapp.org |
| CineGen | sales@outreach.cinegenaimedia.com |

These are suggested selections, not automatic permission to send. Existing monitoring
keeps its previous settings until edited. A whole-inbox source cannot overlap another
business using the same mailbox; edit that source to select an address first.

Signal queries the selected recipient and validates message headers. Only messages
with exactly one matching To recipient and no Cc or Bcc recipients qualify. Ambiguous
messages remain available in Gmail for manual review. Older saved messages without
recipient evidence cannot trigger automatic replies under an alias source.

Replies and outreach use the selected From address. Before sending, Signal verifies
that the alias remains accepted by Google. Removing an alias or changing the source
blocks queued sends. An uncertain send can still be reconciled by reading its sent
copy, without resending. Existing sending policies and opt-outs still apply; saving
an inbox does not enable automatic delivery.

Live read-only verification on September 18, 2026 confirmed both aliases and Gmail
sending permission. No live email was sent during validation.

Signal 0.30.0 passed typecheck, lint and all 1,181 tests across 54 files. Development
and packaged Sales/Connections checks passed at 1440 by 900 and 720 by 800 with no
renderer exceptions; the sender selector and Google setup views were inspected.
The installer is `release/Signal Setup 0.30.0.exe`. The installed app was not replaced
while the owner was connecting accounts.

References: [Gmail sender settings](https://developers.google.com/workspace/gmail/api/guides/alias_and_signature_settings)
and [Gmail API filtering](https://developers.google.com/workspace/gmail/api/guides/filtering).
