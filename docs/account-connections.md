# Signal account connections

Updated September 18, 2026 for Signal 0.24. Open **Connections**, select **Lemonade** or **CineGen**, and connect only the accounts that business will actually use. The same provider can have multiple business-scoped connections, including multiple inboxes. Credentials stay in OS-encrypted files; SQLite and agent-visible state contain only account metadata.

Operations now includes [X text/link publishing](x-publishing.md) with a granted
`tweet.write` connection. Read-only X accounts remain unavailable as destinations.

In 0.21, the existing website connection can also read verified website prospect
and consent records when separately enabled in Sales. The new website API and
email-link signup page require deployment first. Mailchimp and website sources
can run side by side. See [website requests](website-prospects.md).

## What accounts are needed?

The minimum useful account set is a business inbox, the selected acquisition channels, an owned website, the actual checkout account, and traffic/product measurement. A newsletter delivery account becomes useful when there is an opted-in audience. CRM, community bots, DNS management, and paid advertising are optional. These are categories and alternatives, not a requirement to subscribe to every service.

| Account type | Supported connections | What the account contributes |
| --- | --- | --- |
| Business inbox | Gmail / Google Workspace; Outlook / Microsoft 365 | Customer replies, sales conversations, follow-ups |
| Social and video | LinkedIn; X; Facebook Pages; Instagram professional; Threads; YouTube; TikTok; Pinterest Business; Reddit; Bluesky; Mastodon | Access to the chosen audiences and distribution identities |
| Email delivery | Resend; Brevo; Mailchimp | Authenticated sender domains, newsletters, lifecycle campaigns |
| Owned website | Existing Lemonade and CineGen publishing APIs; WordPress | Landing content and product articles |
| Checkout | Stripe | Payment and refund evidence; distinguish test from live mode |
| Traffic and activation | Google Analytics 4; Google Search Console; PostHog Cloud | Campaign traffic, search visibility, activation and retention |
| CRM and owned communities | HubSpot; Discord bot; Slack bot | Contact pipeline and communities you manage |
| Paid acquisition | Google Ads; Meta Ads | Optional experiments after billing and explicit budget configuration |
| Domain infrastructure | Cloudflare DNS | Domain visibility and sender-authentication setup context |

Your existing local model/ComfyUI runtimes need no social account. GPT continues to use its separate API-key setting. A domain registrar and web-hosting account may also be needed operationally, but Signal does not require their administrative credentials to write marketing materials or link the listed services.

For the two existing businesses, begin with their actual inboxes, their existing website credentials, their checkout account, and their analytics. Add the channels selected by the growth experiments. Domain, brand, account identity, and tracking configuration should all agree before sending traffic to an offer.

## What was implemented

GA4 now also has an ongoing [campaign reporting workflow](campaign-analytics.md).
Choose the property's numeric ID in Analytics. Operations refreshes a completed
30-day report hourly, with exact website-hostname filtering, scoped campaign
matching and visible reporting limitations. It does not install website tracking.

The business-specific setup checklist shows nine account categories and whether accounts are missing, saved but need checking, or have verified read access. Select a category to see its provider options. Each provider card and setup form also states whether automatic publishing, revenue sync, or only account reads are currently implemented. These describe software capabilities; they do not certify the account's write permissions or enable an operation.

The screen contains 28 provider connectors with provider-specific instructions, credential types, permissions and restrictions. It supports local browser OAuth, imported user/API tokens, and dedicated app passwords. OAuth is implemented for Google services, Microsoft, LinkedIn, X, Reddit and Pinterest, subject to the provider accepting the registered desktop callback. Bluesky app-password login exchanges the password for a refreshable session; the password itself is not retained.

Connection checks make authenticated identity or resource-list requests. Gmail and Outlook additionally offer previews of the ten most recent inbox subjects and senders, without marking messages read. Resource previews show the provider's accessible channels, properties, domains, ad accounts, zones or contact sample where available. They are bounded samples, not an ongoing data synchronization.

Tokens with an expiry and a usable refresh token renew when needed. Refresh-token rotation is persisted, concurrent refreshes share one request, and an unauthorized read may retry once after renewal. Imported access tokens do not acquire refresh capability: supply an expiry when known and reconnect when the provider revokes or expires them. The UI distinguishes saved credentials, verified read access, attention required, and expiry.

Disconnect removes the local account and its encrypted token. It does not delete campaign history or revoke the developer app's entire grant remotely. If you want to invalidate the provider grant or API key everywhere, revoke it in the provider dashboard as well. Removing one business connection does not delete another business's connection to the same provider.

The marketing agent can list only its own business's accounts and request bounded read previews. It cannot obtain tokens. Data returned by accounts is treated as untrusted reference material. A verified website connection can supply the credential used by the existing product-scoped `blog.read` / `blog.save` tools; existing publication authorization still applies.

## Connecting accounts

1. Choose the business and provider in Connections. Name the account so its intended role is clear, such as “Lemonade sales inbox.”
2. When the provider says **Browser sign-in ready**, click **Connect** and authorize in your browser. Use **Connection options** to request sending/publishing access. If registration is missing, the screen says so explicitly; developer setup is under **Advanced setup**. One Google Desktop JSON import configures Gmail, YouTube, Analytics and Search Console together. Google Ads also needs a developer token. See [easy connections](easy-connections.md) for app provisioning and current limitations.
3. Register `http://127.0.0.1:43821/oauth/callback` where the provider permits desktop loopback callbacks. Google requires a Desktop app client. Then use **Sign in** to authorize in the system browser. Signal validates state, uses S256 PKCE where supported, and consumes each callback once.
4. Choose whether to request sending/publishing scopes alongside read access. This grants the provider permission for future workflows; it does not turn on posting or sending. Additional developer products and reviews can still be required.
5. If the provider requires hosted HTTPS authorization, use its supported user-token flow and the **existing user access token** option under Advanced setup. Signal does not implement a deployed hosted OAuth broker and does not use deprecated copy/paste authorization-code flows. Native app registrations can now be provisioned in the build; provider verification and hosted OAuth for confidential clients remain separate work.
6. For API keys/app passwords, enter the provider-issued credential and, when needed, the site origin and username. Check the resulting identity. Use Preview inbox/account to verify the intended mailbox or resource.
7. Existing website keys can be imported with **Link configured Lemonade/CineGen website**, without displaying or retyping the key.

No account passwords should be supplied for OAuth providers. WordPress and Bluesky use dedicated revocable application passwords. Custom WordPress/Mastodon origins must be public HTTPS sites; their DNS is checked and pinned for the credential-bearing request. Fixed-provider requests use pinned provider endpoints and reject redirects. Provider response bodies are not included in error messages, and reflected credentials are removed from previews.

## Provider requirements and sources

Google supports desktop loopback authorization; its deprecated out-of-band flow is not used here. Gmail read scopes can require restricted-scope verification when distributing an app. Microsoft tenant policies may require administrator consent. [Google native OAuth](https://developers.google.com/identity/protocols/oauth2/native-app), [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [Microsoft authorization](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow), [Microsoft permissions](https://learn.microsoft.com/en-us/graph/permissions-reference).

LinkedIn's identity and member-sharing products are distinct; organization access is not implied by a personal login. X OAuth can issue refresh tokens when offline access is requested. Pinterest requires its applicable developer access and account permissions. Reddit API access and community rules remain independent constraints. [LinkedIn access](https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access), [X OAuth](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code), [Pinterest authentication](https://developer.pinterest.com/docs/getting-started/set-up-authentication-and-authorization/), [Reddit OAuth](https://github.com/reddit-archive/reddit/wiki/OAuth2).

Facebook Page, Instagram and Threads tokens are distinct; do not substitute a personal Facebook token for a Page token or an Instagram Login token. Instagram requires a professional account for these workflows. TikTok requires an audit for public Direct Post and explicit creator consent before uploading, so “fully unattended on every platform” is not an accurate promise. [Meta Instagram collection](https://www.postman.com/meta/instagram/folder/9cgqucg/instagram-api-with-facebook-login), [Threads documentation](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api), [TikTok Direct Post](https://developers.tiktok.com/docs/en/content-posting-api-get-started), [TikTok sharing requirements](https://developers.tiktok.com/docs/en/content-sharing-guidelines).

WordPress application passwords are separate from login passwords. Slack's identity check confirms authentication, not membership in every channel. Discord uses authorized bots rather than automated personal user accounts. [WordPress authentication](https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/), [Slack auth.test](https://docs.slack.dev/reference/methods/auth.test/), [Discord OAuth](https://docs.discord.com/developers/topics/oauth2).

Email delivery additionally needs authenticated sender domains, appropriate recipient permission, bounce/suppression processing, and unsubscribe handling. Connecting an inbox is not the same as configuring bulk email. The Resend connector checks domain read access; a sending-only key cannot satisfy that probe. [Gmail sender requirements](https://support.google.com/mail/answer/81126), [Resend domains](https://resend.com/docs/api-reference/domains/list-domains), [Brevo account API](https://developers.brevo.com/reference/get-account), [Mailchimp Marketing API](https://mailchimp.com/developer/marketing/api/).

Stripe should use a restricted read key: Balance read for the connection check, plus Charges, Products, Checkout Sessions and Invoices read for [Revenue sync](revenue-sync.md). Select each business's Stripe products in Revenue; passing the balance check alone does not establish those additional permissions. Google Ads needs its developer token in addition to OAuth, and APIs enforce account access. Read access is not authorization to spend money. [Stripe keys](https://docs.stripe.com/keys), [Google Ads access model](https://developers.google.com/google-ads/api/docs/oauth/access-model), [Google Ads v23 release](https://ads-developers.googleblog.com/2026/01/announcing-v23-of-google-ads-api.html).

## What connections do not finish

Signal 0.5 adds a separate [Operations workflow](autonomous-operation.md) for
owner-started website and Bluesky publishing, with durable scheduling and
delivery reconciliation. Account setup itself still does not start that work.
The broader sales and cross-channel automation described below remains unfinished.

The connection layer is implemented; the complete autonomous sales system remains in progress. Operations now supports website, Bluesky and LinkedIn member publishing. Sales separately supports Gmail/Outlook replies, opted-in outreach and follow-ups. Revenue implements configured Stripe capture/refund snapshots and known-campaign matching; GA4 supplies campaign observations. Additional social/video delivery, live account validation, full financial reconciliation and broader experiment optimization remain unfinished. Account previews alone do not populate campaign outcomes. Connecting an advertising account never starts an ad.

Signal 0.7 adds [Sales inbox monitoring](sales-inbox.md) for Gmail and Outlook,
with AI triage, inbound lead matching and persistent opt-out suppression. Configure
it separately in Sales; connecting an inbox alone does not start monitoring or
send email. Provider cards now identify this monitoring capability.

Signal 0.8 adds [automatic Gmail replies](sales-replies.md). Connect with OAuth
read/send permissions, enable Sales monitoring and triage, save a reply policy,
then Run Operations. Drafting uses current product research and a separate
editorial check. Sending checks the original conversation again, records the
attempt before submission and confirms the matching sent copy. Uncertain sends
are checked without resending. Signal 0.9 adds optional follow-up sequences after confirmed Gmail replies; configure timing in Sales. Signal 0.12 adds the same policy and sequences for Outlook using saved reply drafts and reconciled Sent Items copies. Outlook requires Mail.ReadWrite and Mail.Send; see [Outlook setup](outlook-replies.md).

Signal 0.13 adds [owner handoffs](sales-handoffs.md) using the existing Gmail or
Outlook connection. Review uncertain sends, record decisions and reminders, or
approve one exact response for the running reply policy. No additional CRM
account is needed for this local queue.

Provider approval, developer-app registration, user login/MFA and selection of the correct accounts remain external setup steps. Not every platform permits unattended actions. Agents running on this computer still depend on Signal and the machine staying available.

## Validation

Connection tests exercise all 28 provider response adapters, business isolation, secret boundaries, expiry, callback state/PKCE, token rotation, concurrent refreshes, disconnect races and read-only inbox preview. Desktop tests exercise account forms, encrypted files, reload persistence, separate businesses, disconnect, and 1440×900 / 720×800 layouts. The existing Lemonade and CineGen website credentials were checked with real read-only API requests in isolated memory and both were accepted. No messages were sent or content published.

Other provider checks use HTTP fixtures; real end-to-end OAuth consent remains unverified until the appropriate developer apps and user accounts are configured. The app never labels a provider as connected merely because a fixture test passed.

The 0.6 setup-checklist update passed typecheck, lint and all 36 connection tests. Packaged Connections smoke checks verify all 28 provider cards, nine setup categories, inbox capability labels, saved-versus-verified status, encrypted credential files, reload persistence, business isolation and disconnect. Both desktop and narrow layouts were inspected; no renderer exceptions or page overflow were found.

Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and `node scripts/connections-ui-smoke.mjs`. The UI script uses an explicit isolated `SIGNAL_PROFILE_DIR`, database, and offline mode. Pass a packaged `Signal.exe` path to test the packaged build. `pnpm exec tsx scripts/connections-live-smoke.ts` checks only the two already-configured website APIs without changing the installed profile.
