# Signal 0.31 — shared AIonX accounts and live lead capture

Installed and reopened on September 18, 2026. Connections now supports account
renaming and linking a social account to another business. Linked businesses use
one encrypted credential and refresh session while retaining separate campaign
settings. Removing one link preserves the remaining businesses' access.

The owner's YouTube, Bluesky, LinkedIn, X and Facebook Page connections are named
AIonX and linked to both Lemonade and CineGen. The existing X connection was
reauthorized successfully with `tweet.write`, retaining its ID. No Direct Messages
scope was granted and no test post was sent. X posting upgrades reject a different
account or a grant missing posting permission without replacing the old login.

Both website signup pages and prospect APIs are deployed:

- https://siplemona.de/get-started
- https://cinegenaimedia.com/get-started

Live read-only checks confirmed the visitor script matches the source, policy and
authenticated prospect endpoints respond, unauthenticated metadata is protected,
and both forms render at desktop and mobile widths. Actual verification-email
delivery and a completed production visitor opt-in were not tested. Deployment
and rollback details are in `website-prospects.md`.

Validation: 1,192 tests across 54 files; typecheck and lint; Connections UI checks
in development, packaged and installed 0.31 at 1440x900 and 720x800, including
cross-business rename, shared-account explanation, X authorization action,
encrypted credentials, disconnection and business isolation.

This release does not enable operating policies or send outreach. Website sources
still need to be selected in Sales. Automatic social publishing currently supports
Bluesky, LinkedIn and X; sharing Facebook and YouTube logins does not add publishing
adapters for them. This is a completed connection/deployment milestone, not
completion of the overall autonomous-growth goal.
