# Account sign-in

Signal supports direct browser sign-in when its provider registration is present.
The Connect button requests read access. Connection options lets the owner request
sending/publishing access before signing in. Neither action starts an operation.
The catalog distinguishes browser sign-in ready, missing Signal registration,
application passwords, and API tokens. Advanced client fields are hidden by default.

## Google

The Signal project is `signal-edge-aionx` (1028880514321). On September 18, 2026,
Gmail, YouTube Data, Analytics Admin, Analytics Data, Search Console and Google Ads
APIs were enabled successfully using the owner's authorized Cloud account.
The owner created a Desktop client in Google Auth Platform. Its ID alone is not
enough to package the token-exchange configuration; import the original JSON file.

Use `node --import tsx scripts/configure-google-app.ts <desktop-client.json>` to
prepare a build, or **Import Google setup file** in the app to configure this local
profile. The import accepts only Google Desktop credentials, rejects web/service
account credentials and alternate authorization/token endpoints, and does not log
the credentials. The local import uses OS-encrypted storage. It enables Gmail,
YouTube, Analytics and Search Console together without importing account access.
Each service requests only its own scopes; Gmail sending is explicitly optional.
Google Ads additionally requires the owner's developer token.

The build reads git-ignored `config/connection-apps.json`, validates it and writes
`out/main/connection-apps.json`. Missing configuration explicitly writes an empty
file, so an old app registration cannot survive a subsequent unconfigured build.
Only public/native Google, Microsoft, X and Reddit client registrations are
accepted. Google Desktop's client secret is part of the public native registration;
it is not a server secret. Confidential client secrets, service-account keys,
account tokens and arbitrary provider endpoints must never be bundled.

The Google account owner must complete Google's consent screen. External apps in
Testing generally have seven-day Gmail refresh authorization; production/internal
configuration and any applicable review are separate from a successful sign-in.

## Other services

| Services | Current connection path | Work outside the desktop app |
| --- | --- | --- |
| Outlook | Native browser OAuth; public client can be bundled | Register the Signal Microsoft app and permitted account types/callback |
| X, Reddit | Native browser OAuth; public/installed client can be bundled | Register Signal and obtain applicable API access |
| LinkedIn, Pinterest | Owner-configured browser OAuth or imported token | Shared distribution needs a hosted authorization service for confidential client secrets and provider-approved callbacks |
| Facebook, Instagram, Threads, TikTok | Provider-issued token | Registered provider apps, hosted OAuth/account selection and required review remain unfinished |
| Stripe | Restricted read-only API key | Owner creates the restricted key; Signal does not request payment write access |
| Bluesky, WordPress | Dedicated app password | Owner creates a revocable password |
| Resend, Brevo, Mailchimp, HubSpot, Slack, Discord, PostHog, Cloudflare, Meta Ads, Mastodon | Provider-specific token setup | Some support OAuth, but Signal's hosted OAuth integration is not yet implemented |
| Lemonade/CineGen websites | Link an already configured website key | Otherwise import the website publishing key |

Hiding client fields is not provider registration. Unconfigured providers remain
explicitly unavailable for browser sign-in; they are not marked connected.

## Shared Gmail inbox and sender aliases

**Check sender addresses** reads Gmail's send-as settings with existing read
permission. It distinguishes the primary address, accepted aliases and pending
verification. It does not change Gmail settings, enable sending, or select an alias.
Gmail aliases require both provider verification and routing in Signal before use.
Signal 0.30 supports monitoring a shared Gmail mailbox using a different verified
address per business. Overlapping whole-inbox sources remain prohibited. See
[sender selection, routing and delivery checks](gmail-aliases.md).

Live read-only checks confirmed `sales@aionx.aionapp.org` for Lemonade and
`sales@outreach.cinegenaimedia.com` for CineGen, plus Gmail sending permission.
The owner's Google connection is working; no further credential import is needed.

Both website publishing connections were linked into the owner's encrypted Signal
profile and verified using authenticated content reads on September 18, 2026.
No content was published and no operating policies were changed by that setup.

## Validation checkpoint — September 18, 2026

Signal 0.29.0 built and packaged successfully. Typecheck and lint passed; the full
suite passed 1,163 tests across 53 files. Development and packaged desktop checks
passed at 1440×900 and 720×800 with no renderer errors, including hidden developer
fields, encrypted credential persistence, business isolation, reload and disconnect.
The narrow Google setup viewport was inspected. OAuth callback/token exchange tests
use fixtures; no live Gmail consent, real mailbox access or sending was performed.
The owner's installed application was not replaced. The installer is available at
`release/Signal Setup 0.29.0.exe`. Its Google registration remains unconfigured until
the Desktop credential JSON is imported or included in a subsequent build.

## Sources

- [Google desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Manage Google OAuth clients](https://support.google.com/cloud/answer/15549257)
- [Gmail send-as listing and allowed scopes](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.settings.sendAs/list)
- [Google token expiration](https://developers.google.com/identity/protocols/oauth2)
- [Cloud IAM OAuth clients are for workforce/IAP, not Gmail desktop registration](https://docs.cloud.google.com/iam/docs/workforce-manage-oauth-app)
