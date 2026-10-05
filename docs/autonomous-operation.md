# Autonomous operation: implementation and remaining requirements

The full objective is one Run action that operates marketing, sales and growth
for Lemonade and CineGen, using local or configured GPT agents, high-quality
marketing materials, distribution, follow-up and measured commercial results.
This objective is **not complete**. The connection catalogue, [Stripe revenue
sync](revenue-sync.md), and the first
autonomous publishing workflow are implemented; the remaining execution and
measurement requirements below must still be completed and verified.

## Run workflow implemented

Open Operations, choose a business, select up to three connected destinations,
set an objective, delivery cap and operating interval, then save. Run authorizes
automatic public publishing to those destinations. It first checks the configured
agent runtime. Policies start paused; connecting accounts does not start them.
The saved running state resumes when Signal reopens. Signal and the computer
must remain available for scheduled work; this is not a hosted background service.

Signal 0.10 adds optional [background operation](background-operation.md): close
to the system tray, login startup and idle-sleep prevention. Active local
operations supervise and recover the installed model runtime. Missing models
hold new generation while inbox reads and delivery checks continue.

The worker checks the current product website as an obligatory step, supplies
that evidence to the selected agent, and asks for one specific useful artifact.
A separate editorial model pass checks material claims against current source
text. Supporting quotations must actually occur in the fetched source. Queue
validation also checks placeholders, risky promises, affiliation, format length,
current-cycle evidence, product links and duplicate copy. These checks reduce
unsupported claims; they do not establish that every product claim is true.

Publishing adapters support the existing Lemonade/CineGen website API, Bluesky
posts with clickable links and reviewed images, plus X and LinkedIn member text/link
posts. Gmail/Outlook sending is configured separately through Sales. Other services
remain read connectors until their execution adapters exist. No ad spending is
authorized here. See [LinkedIn limits and validation](linkedin-publishing.md).

Each delivery is saved before a request, with a stable local identifier.
The worker obtains credentials from the main-process vault, renews supported
tokens, and checks current authorization immediately before each write. Website
posts use a unique slug and expectedVersion 0. Bluesky uses a stable TID record
key. Both read the destination first and reconcile a matching record after a
lost response, rather than blindly posting again. Different content at that
identifier requires attention. HTTP failures retain generic diagnostics without
provider bodies or credentials. Retry delays increase, with a bounded automatic
attempt count and an explicit reconciliation action afterward.

LinkedIn instead journals the send before creating a post and stores the returned
receipt before completing the local job. An uncertain attempt cannot be resent,
including after restart; it needs an owner check because the connected permissions
do not establish access to search member posts.

Pause aborts the active request and prevents new attempts. A remote server may
already have accepted a request: a returned receipt is preserved, or the same
publication is reconciled after resuming. A pending delivery reserves daily
capacity; confirmed publications count for a rolling 24 hours. Stopping retries
requires acknowledging that the content may already exist remotely. That
uncertainty remains in history and reserves capacity for a rolling day. The
fingerprint prevents automatic re-creation of the same uncertain content.
Changing policy pauses operation and cancels unattempted work; attempted,
unresolved work must first be reconciled or explicitly stopped.

Website and social calls to action receive source/medium/campaign parameters.
Overlength social copy must be shortened; tracking is never silently removed.
A configured Revenue source can now match Stripe payments that carry
these campaign identifiers. Links alone do not prove attribution, and a
publication receipt is evidence of publication, not evidence of traffic or sales.

## Research grounding

The retry design follows Bluesky's repository record API, including explicit
record keys and lookup of the same record. Feed posts use TIDs, have a 300-grapheme
limit, and use UTF-8 byte offsets for link facets:

- [Create record API](https://github.com/bluesky-social/atproto/blob/main/lexicons/com/atproto/repo/createRecord.json)
- [Get record API](https://github.com/bluesky-social/atproto/blob/main/lexicons/com/atproto/repo/getRecord.json)
- [Feed post schema](https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/feed/post.json)
- [Creating a post](https://docs.bsky.app/docs/tutorials/creating-a-post)

Email adapter design must respect the provider's retry window rather than assume
permanent deduplication. For example, [Resend retains idempotency keys for 24 hours](https://resend.com/docs/dashboard/emails/idempotency-keys).
The [account guide](account-connections.md) records the remaining provider setup
and platform permission requirements.

## Completion audit: still required

Signal 0.8 also runs configured [Gmail reply policies](sales-replies.md): incoming
inquiries receive researched, reviewed answers under separate daily limits.
The Sales screen owns those policies and their delivery history. Run explicitly
includes enabled replies; saving a reply policy pauses Operations.

| Requirement | Current evidence and remaining work |
| --- | --- |
| One Run action with persistent policy and durable execution | Implemented for website, Bluesky and LinkedIn public copy, plus separately configured Sales and reporting activities. Tests cover research, agent generation, review, queue, delivery, restart, limits and Pause. The whole live acquisition-to-sale path remains unproven. |
| All selected marketing channels | The 28-provider account catalogue exists; remaining social/video/email publishing adapters need execution and receipt validation. Channels requiring manual platform participation must be represented honestly. |
| Sales operation | [Sales inbox](sales-inbox.md), [replies](sales-replies.md), [Outlook delivery](outlook-replies.md) and [owner handoffs](sales-handoffs.md) are implemented. [Proactive opted-in outreach](proactive-outreach.md) adds initial emails and unanswered sequences. Mailchimp and website request adapters check current consent. Real provider compatibility, production website signup/auth setup and broader lifecycle campaigns remain. |
| Measurement and optimization | Product-scoped Stripe capture/refund snapshots and known-campaign attribution feed the agent. [GA4 reports](campaign-analytics.md) add exact-hostname campaign observations with freshness and reporting limitations. Checkout propagation is locally patched but undeployed. Live payment verification, customer/payment identity matching, full financial reconciliation and evidence-based experiment updates remain. Gross revenue never becomes spendable cash automatically. |
| High-quality creative production | Local ComfyUI workflows and Campaign Studio exist. Operations integrates image generation, independent visual review and verified Bluesky image delivery. Dependable branded assets, product demonstrations, video and other media destinations remain incomplete. GPU-heavy validation is on hold after the Windows crash. |
| Local/GPT runtime ownership | Runtime configuration is checked at Run. Local supervision now recovers the installed server with backoff, checks configured models, and respects manual stop and external ownership. Tray/background lifecycle, login-startup controls and idle-sleep prevention are implemented. Live owned-Ollama recovery passed; owner OS login registration, real reboot/login recovery and long-running reliability remain unverified. |
| Real connected-account operation | Existing website credentials previously passed live reads. This iteration exercises publication through intercepted transport, never actual customer accounts. Real authorized publication and OAuth grants still require verification. |
| Continuous reliability | Delivery lease recovery, stable IDs, policy revocation, per-profile single-instance ownership, background restart and runtime recovery are tested. Cross-provider rate handling, credential recovery, monitoring and long-running soak tests remain. |
| Actual commercial evidence | No sale is established by generated material or a simulated publication. The app must distinguish measured purchases from forecasts and owner-entered outcomes. |

## Validation commands

- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- `node scripts/operations-ui-smoke.mjs` exercises a separate offline profile,
  settings persistence, product isolation and disabled offline Run, at desktop
  and narrow widths. Optionally pass a packaged Signal.exe path.
- `pnpm exec tsx scripts/operations-live-smoke.ts Lemonade` and the same command
  with `CineGen` use real local inference and live public website research with
  **intercepted, simulated publication**. They do not load installed credentials.
  Reports and generated copy are saved under `data/operations-validation`.

The goal remains active until the full workflow above is implemented and verified
against actual supported destinations and commercial data.

### Verified checkpoint: Signal 0.5.0

On September 16, 2026, typecheck, lint and all 563 tests passed. The packaged
Operations, Connections and Campaign Studio desktop smoke tests passed at
1440x900 and 720x800 with no renderer exceptions. The Operations screen was
visually inspected. The installer is `release/Signal Setup 0.5.0.exe`; this does
not establish that the installed user app has been upgraded.

Both Lemonade and CineGen completed real local `gemma4:e4b` operation cycles
using live product website reads, editorial checks and simulated publication
receipts. Lemonade required corrections before its final copy passed; CineGen
passed its final checked run in one generation attempt. No customer messages,
real public posts, ads or purchases were created by these validation runs.
Commercial outcomes and real publication remain unverified.

### Verified checkpoint: Signal 0.6.0

The next continuation added Stripe revenue snapshots, capture/refund updates,
product scoping, currency/mode separation, campaign matching and commercial
evidence in the marketing agent context. Local checkout changes in Lemonade and
CineGen preserve the campaign hint for one-time and subscription purchases; they
are not deployed. See [Revenue sync](revenue-sync.md) for coverage and limits.

Typecheck, lint and all 577 Signal tests passed. Nine adjacent checkout,
attribution and licensing regression tests passed. Packaged Revenue and Operations
UI smoke checks passed at 1440x900 and 720x800 with no renderer exceptions;
Revenue formatting was visually inspected. The installer is
`release/Signal Setup 0.6.0.exe`. The revenue tests use simulated Stripe responses,
not live customer accounts. No real payment, refund or publication was performed.

The preceding goal turn and this continuation both made implementation progress.
The full goal remains active: email selling and follow-up, remaining publishing
adapters, creative delivery, analytics/experiment updates, runtime continuity,
real-account verification and deployment still need completion.

### Verified checkpoint: Signal 0.7.0

This continuation made implementation progress on the full goal by adding the
[Sales inbox](sales-inbox.md): persistent Gmail/Outlook ingestion, bounded AI
triage, inbound lead creation/matching, reply-driven follow-up cancellation and
durable opt-out suppression. The Operations worker schedules configured Sales
sources, Pause aborts active work, and the general marketing agent receives
business-specific inbox counts and freshness without email bodies or addresses.

Typecheck and lint passed. The final suite passed all 597 tests in 32 files,
including 20 Sales tests. Packaged Sales, Connections and Operations UI smoke
checks passed at 1440x900 and 720x800 with no renderer exceptions. Screens and
the inert rendering of saved email text were visually inspected. The installed
local `gemma4:e4b` model passed three synthetic integrated triage cases: a buying
inquiry, a refund complaint, and an attempted instruction to export customer data
and API keys. The test stopped its own runtime afterward and sent no email.

The installer is `release/Signal Setup 0.7.0.exe`; it has not been installed over
the owner's app. Gmail/Outlook ingestion uses authenticated provider APIs in the
implementation, but the validation used synthetic mailbox transport. Real
mailbox OAuth grants and live reads, and GPT triage with an owner key, remain
unverified. There was no public publication, ad spend, customer email or deployment.

The full goal remains active. Automatic email reply composition and delivery,
contact-specific sales sequences, complete handoff handling, remaining channel
and media execution, analytics-driven experiment updates, runtime continuity,
and real-account verification remain necessary. This checkpoint does not claim
that clicking Run now operates the complete sales business.

### Verified checkpoint: Signal 0.8.0

This continuation adds [automatic Gmail replies](sales-replies.md): current-site
research, separate editorial review, durable scheduling, scoped sending, fresh
thread checks and sent-copy reconciliation. Policy changes pause Operations.
Pause and cancellation races preserve any accepted receipt; uncertain attempts
are never resent. Automatic preparation retries and delivery checks are bounded.

Typecheck and lint passed, along with all 620 tests in 33 files, including 23
reply tests. Packaged Sales, Connections and Operations desktop checks passed
at 1440x900 and 720x800 with no renderer exceptions or page overflow. Reply
policy and queued-reply layouts were visually inspected at both sizes.

The installed local `gemma4:e4b` model completed a synthetic inbound-sales
workflow using live Lemonade website research: inquiry triage, answer generation,
four supporting evidence quotes, editorial approval, and one simulated Gmail
send with a matching sent-copy receipt. This is an integration example, not a
broad reply-quality benchmark. No real customer email was sent.

The packaged installer is `release/Signal Setup 0.8.0.exe`; it has not replaced
the owner's installed app. Real OAuth grants and delivery remain unverified.
The full goal stays active: Outlook sending, complete sales sequences/handoffs,
remaining channel execution, creative delivery, analytics-based optimization,
runtime continuity, real-account verification and deployment remain necessary.

### Verified checkpoint: Signal 0.9.0

The next goal turns made implementation progress by adding configured Gmail
follow-up sequences after a confirmed initial answer. Up to three steps use
fresh product research and editorial review, maintain pipeline due dates, and
verify the original thread and prior sent copies. Owner schedule changes,
replies, suppression and completed/lost pipeline stages stop the sequence.
Uncertain sends cannot advance it until reconciled; stopping a sequence while
a request is in flight preserves the receipt without restarting future steps.

The full objective remains active. These sequences handle existing inbound
buying conversations. They do not finish proactive opted-in outreach, Outlook
sending, full handoff management, customer-to-purchase identity matching,
remaining publishing/media adapters, analytics-driven optimization, runtime
continuity, or real-account verification and deployment.

Typecheck, lint and all 632 tests passed, including 35 reply/sequence tests.
The packaged Sales, Connections and Operations checks passed at 1440x900 and
720x800 with no renderer exceptions or horizontal overflow. Sales checks cover
sequence stopping, timing persistence, policy saving, cancellation and business
isolation. Operations shows the enabled follow-up count before Run. Final
sequence and policy layouts were visually inspected at both widths.

Both Lemonade and CineGen completed real local `gemma4:e4b` workflows with live
public product research: an initial answer and one reviewed follow-up, each with
exact supporting source quotations and intercepted Gmail sent-copy receipts.
Each business produced two simulated sends and a completed sequence. These
checks sent no real customer email and establish no commercial outcome.

The installer is `release/Signal Setup 0.9.0.exe`. It has not replaced the owner's
installed app. No real-account writes, public posts, ads or deployment occurred.

### Verified checkpoint: Signal 0.10.0

The following goal turns added [background operation and runtime recovery](background-operation.md):
tray hide/reopen, optional login startup, idle-sleep prevention, per-profile
single-instance ownership, local model health checks and bounded recovery.
New generation waits for required models while non-model work can continue.
Manual runtime stop pauses Operations and holds recovery; shutdown prevents a
late server launch and leaves externally managed servers alone.

Typecheck, lint and all 650 tests passed in 35 files. Packaged Background
Settings, Sales and Operations checks passed at 1440x900 and 720x800 with no
renderer exceptions or page overflow. Background checks exercised hiding without
quitting, a second launch reusing the existing worker, hidden restart using the
saved preference, explicit reopening and clean Quit. Final checkbox layouts
were visually inspected at both widths.

The installed Ollama server also passed a real owned-runtime recovery check for
both configured businesses in an in-memory fixture: start, verified models,
owned-server stop, recovery and manual hold. No model was downloaded and no real
email, publishing request or account write was performed. The installer is
`release/Signal Setup 0.10.0.exe`; the owner's installed app and OS login settings
were not changed.

The full objective remains active. Real login/reboot recovery and long-running
network/account failure handling still need verification. Remaining sales
handoffs and proactive outreach, Outlook sending, customer/purchase matching,
social/media execution, analytics-driven optimization and real-account
verification/deployment are not completed by this lifecycle work.

### Verified checkpoint: Signal 0.11.0

The next goal turn added [GA4 campaign reporting](campaign-analytics.md). Each
business selects its connected account and numeric property ID. A fixed Google
reader filters the exact website hostname and reads the last 30 completed local
calendar days. Known campaign/delivery IDs match only within the business;
unknown names are grouped without retaining their text. Running Operations
refreshes this snapshot hourly. Marketing and operating agents receive the
observations, freshness, window and limitations alongside separate Stripe evidence.

Failed, malformed, restricted or oversized reports preserve the previous complete
snapshot. Sampling, thresholding, grouping and truncation are visible limitations.
Changing/removing the source invalidates pending reads. Token renewal remains in
the main process. Interrupted reads restart when the worker resumes.

Typecheck, lint and all 676 tests passed in 36 files, including 26 analytics tests.
Packaged Analytics, Connections and Operations checks passed at 1440x900 and
720x800 with no renderer exceptions or page overflow. Analytics checks covered
snapshot persistence, business isolation, source saving/removal and offline read
blocking. The desktop and narrow analytics layouts were visually inspected.

The installer is `release/Signal Setup 0.11.0.exe`. It has not replaced the owner's
installed app. Google report responses were simulated; real GA4 authorization,
production measurement quality and account-specific access remain unverified.
No website tracking was installed or changed, and no real account writes,
messages, publications, advertisements or financial transactions occurred.

The full objective remains active. This measurement feature does not complete
experiment optimization, Outlook sending, handoffs/proactive outreach,
customer-to-payment matching, remaining social/media delivery, or real-account
verification and deployment. Connecting an account remains distinct from having
an implemented, authorized action workflow for that provider.

### Verified checkpoint: Signal 0.12.0

The next goal turn added [Outlook replies and follow-ups](outlook-replies.md).
Microsoft mailboxes now use the existing business-scoped research, editorial
review, suppression, scheduling and sequence policies. OAuth can request
Mail.ReadWrite and Mail.Send. Both permissions are required to enable Outlook
replies, and read-only accounts remain ineligible until reauthorized.

The Graph adapter verifies the original conversation, creates a reviewed MIME
reply draft, saves its immutable ID, rechecks the draft and running policy, then
sends and confirms the same ID in Sent Items. Drafts never count as sent. Lost
responses, edited messages, new activity or policy changes hold the operation;
an attempted reply is not automatically created or sent again. Confirmed prior
copies are required before later sequence steps can send.

Typecheck, lint and all 710 tests passed in 37 files, including 34 Outlook tests.
The packaged Outlook Sales, Gmail Sales, Connections and Operations checks passed
at 1440x900 and 720x800 with no renderer exceptions or page overflow. The Outlook
check selected its permission-qualified inbox and enabled/persisted its policy.
The narrow Outlook reply form was visually inspected. A prior Connections check
was updated from its obsolete monitoring-only expectation to the implemented
reply capability and required permissions, then passed.

Lemonade and CineGen each completed a real installed `gemma4:e4b` run with live
public product research, an initial answer and one follow-up. Each reply passed
editorial review with exact source quotations, and the simulated Outlook
transport confirmed two sent copies and a completed sequence. No real customer
email or external draft was created.

The installer is `release/Signal Setup 0.12.0.exe`; it has not replaced the owner's
installed app. Real Microsoft consent, account-specific MIME/tenant behavior,
mailbox sending and recipient delivery remain unverified. No actual account
writes, publication, advertising spend, payments or deployment occurred.

The full objective remains active. Handoff management, proactive opted-in
outreach, customer/payment identity matching, remaining social and media delivery,
experiment optimization, operational resilience and real-account verification
and deployment still require work. Adding Outlook closes one execution gap;
it does not prove that clicking Run will generate sales.

### Verified checkpoint: Signal 0.13.0

The next goal turn added [owner handoffs](sales-handoffs.md). Sales now collects
triaged handoffs, exhausted reply preparation, uncertain sends and sequence
attention into a business-scoped queue with reminders and a bounded local history.
Operations shows queue counts and the system tray shows due reminders.

The owner can record an external response or no-response decision, explicitly
acknowledge an uncertain attempt, retry eligible preparation, reconcile a sent
copy, or approve one exact response for Run. Exact response approval expires
after 24 hours and uses the existing Gmail/Outlook sending checks and limits.
Taking over stops the associated follow-ups. Late receipt confirmation cannot
restart them. Owner-entered outcomes never become provider receipts or sales.

Typecheck, lint and all 729 tests passed in 38 files, including 18 handoff tests
and an additional Outlook owner-response test. Packaged handoff, Gmail Sales,
Outlook Sales, Operations and background desktop checks passed at 1440x900 and
720x800 with no renderer exceptions or page overflow. Handoff checks exercised
exact preview/approval, reminder and resolution persistence, uncertain receipt
preservation, inert source text and business isolation. The desktop and narrow
response-editor layouts were visually inspected. Background checks confirmed
tray persistence, single-instance reopening, saved startup behavior and clean
quit in an isolated profile; they did not modify OS startup registration.

The installer is `release/Signal Setup 0.13.0.exe` (103682631 bytes). It has not
replaced the owner's installed app. Provider transport was simulated; no real
email, external draft, publication, advertising spend or financial transaction
occurred. Real mailbox authorization and delivery remain unverified.

The full objective remains active. Proactive opted-in outreach, customer/payment
identity matching, remaining social and media execution, experiment optimization,
operational resilience and real-account verification/deployment still require
work. The account catalogue and new owner queue do not establish automatic sales.

### Verified checkpoint: Signal 0.14.0

Operations now connects a business-scoped ComfyUI workflow to Bluesky image
campaigns: current product research, copy review, local rendering, review of the
prepared pixels, up to three complete compositions, durable upload and matching
post receipts. A separate local image-review model can be selected in Settings.
Browser auto-launch is disabled for managed ComfyUI and the validation scripts.
See [automatic campaign images](automatic-campaign-images.md).

Actual local runs completed for Lemonade and CineGen using installed Krea 2
weights and Qwen 3.6 35B image review. Lemonade used Qwen for writing and needed
three renders; CineGen used Gemma 4 E4B for writing and needed one render. The
approved JPEGs and their accessible descriptions were visually inspected.
These are basic editorial illustrations, not proof of effective advertising or
finished branded/video production. Both publication transports were simulated;
each confirmed one image upload and one matching post, with no real publication.

The Windows Ollama 0.32.5 Gemma 4 E4B vision path misdescribed actual pixels and
is not a validated reviewer. Qwen correctly described the retained outputs.
Local model choice materially affects reliability and speed. The large Qwen
model requires CPU offloading on this machine.

Typecheck, lint and a 765-test suite passed. Targeted editorial checks also
passed after preserving longer correction feedback. The packaged image,
Operations, Connections and background desktop checks passed at 1440x900 and
720x800. They exercised image and vision-model setting persistence, image
preview, business isolation, offline delivery blocking, encrypted account
storage, tray persistence, single-instance reopening and clean quit. Stripe
setup now explicitly lists restricted-key Read permissions and no Write grants.

A real Gemma local sales run completed an initial answer and one follow-up
through simulated Gmail delivery. The follow-up needed all three permitted
preparation attempts after source-quotation formatting failures; no unreviewed
reply was sent. This verifies recovery, not consistent first-attempt quality.

The installer is `release/Signal Setup 0.14.0.exe` (103691018 bytes). It has not
replaced the owner's installed app. No real email, social publication, payment,
refund, payout or advertising spend occurred during validation.

The full goal remains active. Proactive eligible-lead outreach, video and
remaining distribution adapters, richer branded
creative production, measured campaign selection and improvement, and real
account verification/deployment remain incomplete. Read-only Stripe tracking
exists but requires the owner's restricted keys and selected product scope.

### Purchase feedback checkpoint after the 0.14 package

The current source and local build now match product-scoped live Stripe purchases
to existing lead emails, mark matching leads as customers, stop their sequences
and cancel unsent automatic sales replies. Conflicting/missing emails and test
payments do not match. Partial scans do not modify customers. Refunds never resume
sales sequences, uncertain sends remain reconcilable, and explicit owner-written
customer responses remain possible. This uses existing GET-only permissions.
Matching does not infer campaign attribution or establish subscription entitlement.

All 773 tests in 39 files passed, including eight new purchase-matching and
sales-stopping cases. Typecheck, lint and the production build passed. The local
desktop Revenue check passed at 1440x900 and 720x800 with no renderer errors;
the narrow payment table was visually inspected. These checks used synthetic
payments and intercepted mail delivery. No owner Stripe key or live purchase
was used. This addition is not included in the earlier 0.14 installer and has
not replaced the installed app. See [revenue sync](revenue-sync.md).

### Campaign learning checkpoint, 0.15

Operations now stores an evidence-based destination decision for each cycle and
copies it into its delivery history. With sufficiently complete live payment
observations, it allocates up to three of four cycles to a destination with
repeated attributed payments, and supplies a paid publication's topic for a
distinct next step. Every fourth cycle remains exploratory. Stale/incomplete
data, tracking gaps, ties and sparse observations preserve rotation. This is
directional allocation, not causal testing or proof of channel effectiveness;
limits and spending permissions do not increase. See
[campaign learning](campaign-learning.md) for the exact thresholds and limits.

Bluesky copy must now leave room for its tracking link; an oversized caption
returns a correction instead of silently losing attribution. The current local
build passes 790 tests in 40 files, typecheck and lint. Operations desktop checks
passed at 1440x900 and 720x800 with no renderer errors, including the decision
explanation, business isolation, offline Run and settings changes. The narrow
decision explanation was visually inspected. Tests use synthetic payment data
and intercepted publication; real effectiveness remains unverified.

`release/Signal Setup 0.15.0.exe` was built (103691206 bytes). The packaged
Operations and Revenue checks both passed at 1440x900 and 720x800 with zero
renderer errors, including purchase-match display and cycle-decision evidence.
This installer includes purchase matching and campaign learning; it has not
replaced the owner's installed app. No live publication, email or Stripe write
was performed. The full goal remains incomplete, especially proactive acquisition,
video and additional channel delivery, reliable creative quality, and live
account verification.

### Proactive outreach checkpoint, 0.16

Sales now has a separate initial-outreach policy for opted-in pipeline leads.
Run can select an eligible contact, research the current product website, prepare
and review one useful email, preserve campaign tracking, wait for the configured
delay, check actual mailbox history and send through Gmail or Outlook. The policy
sets its sender, objective, mailing address and independent daily limit. Run shows
that scope. Purchase matches, opt-outs, changed leads, owner Pause and policy edits
prevent new attempts; uncertain sends remain reconcilable without another write.

Both providers passed intercepted transport tests, including changed Outlook
drafts, lost create/send responses, recipient deduplication, source freshness,
bounded preparation retries, crash recovery and content retention. Typecheck,
lint and all 835 tests in 41 files passed. The new Sales controls passed local
desktop checks at 1440x900 and 720x800 with zero renderer errors; the narrow form
was visually inspected.

Real Gemma 4 E4B runs researched the current Lemonade and CineGen sites, generated
and reviewed first-message copy, and each completed one simulated Gmail send on
the first preparation attempt. Their saved messages were inspected. Earlier
validation exposed copied drafting instructions and vague product introductions;
the current prompts, deterministic checks and retry feedback address those
observed failures. Evidence: `data/outreach-validation/local-lemonade.json`,
`local-cinegen.json`, `data/outreach-lemonade-release.log` and
`data/outreach-cinegen-release.log`. No actual contact received an email.

This completes the first-message path for existing opted-in leads, not automatic
prospect discovery or unanswered outreach sequences. Customer replies use the
separate existing reply policy. Live provider acceptance, deliverability, opt-in
records and marketing effectiveness still require verification. See
[proactive outreach](proactive-outreach.md).

The final 0.16 installer was built (103687687 bytes). Packaged outreach and Gmail
inbox/reply checks passed at 1440x900 and 720x800 with zero renderer errors. The
owner's installed application was not replaced.

### Prospect import checkpoint, 0.17

Sales can now preview and atomically import up to 500 contacts from a UTF-8 CSV
for a selected business. The import retains source and supplied consent evidence,
preserves existing leads, applies opt-outs, skips suppressed contacts, and adds
known Stripe purchasers as customers. Changed pipeline records invalidate the
preview. Importing pauses that business; Run resumes its configured operation.
Unknown permission prevents initial outreach. See [prospect imports](prospect-import.md).

The full suite passed 860 tests in 42 files. Two subsequent provider integration
cases also passed in the 46-test outreach suite: imported opted-in prospects move
through Run, research, review, delay and confirmed simulated delivery, while
unknown contacts remain unsent. Both Gmail and Outlook transports were intercepted.
Typecheck and lint passed; a transient lint/build temporary-file race was resolved
by running lint after the build completed. No application fix was needed for that
tooling race.

The built desktop import controls passed at 1440x900 and 720x800 with zero renderer
errors, including preview-only behavior, saved permissions, repeated-import
deduplication and business isolation. The narrow import form was visually
inspected. Automatic CRM synchronization, website-form ingestion, prospect
discovery and live acquisition-to-sale validation remain incomplete.

`release/Signal Setup 0.17.0.exe` was built (103690117 bytes). The packaged
prospect-import/outreach and Gmail inbox/reply checks passed at 1440x900 and
720x800, each with zero renderer errors. Final typecheck, lint and diff whitespace
checks passed. The owner's installed app remains unchanged. No real contact was
messaged, no account was modified remotely, and the full goal remains active.

### Automatic prospect ingestion checkpoint, 0.18

Run now polls a selected Mailchimp audience for each business, imports eligible
new subscribers, matches known purchasers and processes opt-outs. Eligibility
requires explicit consent to one-to-one messaging as well as subscribed status
and any configured marketing permission. Existing pipeline records are preserved.
The source stores page checkpoints, polls changes every five minutes while Run
is active and performs a daily full refresh. Source edits pause Operations.

Current audience consent is checked before linked Gmail or Outlook email writes,
including replies and follow-ups. Outlook repeats the check before sending its
draft. A transient audience error before an initial outreach write permits a
bounded preparation retry; an attempted write never takes that recovery path.
See [automatic prospect sources](prospect-sources.md) for limits and research.

All 904 tests in 43 files passed, including intercepted Mailchimp-to-Gmail and
Mailchimp-to-Outlook workflows, late opt-outs, missing contacts, unavailable
providers and recovery. The Outlook test also verifies that a draft remains
unsent when consent changes after draft creation. No live provider credential
or recipient was used. Typecheck, lint and diff whitespace checks passed.

`release/Signal Setup 0.18.0.exe` was built (103692199 bytes). Packaged source,
import and outreach controls passed at 1440x900 and 720x800 with zero renderer
errors. Separate packaged Gmail and Outlook inbox/reply checks passed at both
sizes. Source reads and Run were blocked offline; source disable persisted;
the authorized ingestion scope appeared in Operations. The narrow source form
was visually inspected. The installed app was not replaced.

Live Mailchimp access, other CRM and direct website signup ingestion, automatic
new-prospect discovery, unanswered initial-outreach follow-ups, video/additional
channel delivery, reliable branded creative and real acquisition-to-sale
validation remain outstanding. This is concrete progress, not completion of the
full autonomous-growth goal.

### Run readiness checkpoint, 0.19

Run now supports Sales, prospect ingestion and reporting without requiring a
publishing destination. The main process checks the selected business's configured
activities and returns actionable blockers for missing connections or email
permissions. The desktop shows that activity scope. Read-only operations skip
model startup; AI operations check their marketing model and, when selected,
their image reviewer. Runtime recovery no longer holds an email-only operation
for unrelated configured models.

Pending startup has a business-scoped cancellation generation. Pause, Pause all,
settings changes that pause the operation and a newer startup invalidate the older
attempt. Cancel startup remains available during the model check and targets the
original business. Clearing publishing destinations prevents publishing task
creation. Selecting Text only now clears a previously saved image workflow.
See [Run readiness](run-readiness.md).

All 925 tests in 44 files passed. The new coverage includes read-only and
email-only startup, scope and connection failures, model selection, startup
failure/cancellation, late runtime responses, required image review and clearing
image publishing. Existing purchase-stop fixtures now include their simulated
Stripe connection so they exercise the full configured operation.

Packaged Operations and Sales/source/import checks passed at 1440x900 and
720x800 with zero renderer errors. A separate isolated packaged profile clicked
the actual Run and Pause controls with no publishing destination and deliberately
unavailable model names. It started read-only inbox monitoring and stopped it
without starting a model or queuing publication. That profile contained no remote
credentials and a disabled ingestion seed; no actual mailbox was accessed. The
activity list and smaller layouts were visually inspected.

`release/Signal Setup 0.19.0.exe` was built (103691735 bytes). Final typecheck,
lint and whitespace checks passed. The owner's installed app was not replaced.

The full goal remains incomplete: these tests prove startup behavior, not live
marketing effectiveness or acquisition-to-sale performance. New-prospect discovery,
direct signup ingestion, unanswered initial-outreach follow-ups, additional channel
delivery, video, dependable branded creative and live account validation remain.

### Public research checkpoint, unreleased

Operations now includes optional product-scoped public buyer research, with editable
Hacker News and Stack Exchange searches, durable checkpoints, cancellation and
visible findings. A publishing cycle waits for the first research attempt, receives
a bounded source snapshot and records which request fits the verified product (or
that none do). This does not import authors or authorize community replies. See
[public buyer research](public-discovery.md).

Live public API reads succeeded. Early local-model campaign runs completed against
simulated destinations, but manual inspection found forced matches to competitor
launches and unrelated topics. Filtering now excludes launches, requires request
language near query words, ignores URL-only matches and uses exact HN phrases.
The editorial gate now requires separate verdicts for the request, campaign fit
and supported product capability. Final full validation passed 953 tests in 46
files, including the added verdict-gate tests. Typecheck, lint and diff whitespace
checks passed. Desktop research
settings and business isolation passed at 1440x900 and 720x800.

A Windows 0x133 bugcheck interrupted the next live generation run. No replacement
run is active. Further GPU generation checks are on hold; the most recent partial
run must not be reported as passed. The final model-quality check, latest UI render
and packaging are outstanding. Version 0.19 remains the latest built installer;
the owner's installed application remains unchanged. Direct signup ingestion,
unanswered initial-outreach follow-ups, additional channels, reliable branded
creative/video and live acquisition-to-sale validation remain incomplete.

### Unanswered outreach sequences checkpoint, 0.20

Sales now supports zero, one or two follow-ups after an unanswered initial email.
Each follows the original Gmail/Outlook thread and confirmed sent history, with
fresh product research, independent review, distinct copy and a configurable
2–14 day delay after the preceding confirmed send. Initial emails and follow-ups
share the rolling outreach limit. Old policies default to no follow-ups; changing
settings does not retroactively enroll earlier initial emails. Replies, opt-outs,
known purchases, changed contacts/policies and manual stops end the sequence.
Uncertain attempts remain reconcilable without another send. Sales shows progress,
the next eligible time and a sequence stop control. See
[proactive outreach](proactive-outreach.md).

The full suite passed 995 tests in 47 files, including 42 follow-up cases against
intercepted Gmail/Outlook transports. Coverage includes complete two-step threads,
shared capacity, delayed sends after Pause, no retroactive enrollment, purchase
stops, late consent changes, modified history, restart recovery and lost send
responses. Typecheck, lint and whitespace checks passed. The first lint attempt
overlapped the build and encountered a removed Vite temporary config; running lint
after the build passed.

`release/Signal Setup 0.20.0.exe` was built (103698102 bytes). Packaged Sales and
Operations checks passed at 1440x900 and 720x800 with zero renderer errors.
Follow-up settings persisted, sequence progress and stop behavior worked, and
business isolation and offline restrictions held. Follow-up controls, sequence
cards and public-research findings were visually inspected. All desktop checks
used software rendering; no local model or ComfyUI generation was started. The
owner's installed app was not replaced and no actual email was sent.

This package also contains the public-research implementation described above.
Its final local-model quality check is still pending; packaging and desktop checks
do not establish campaign relevance. Live Gmail/Outlook follow-up compatibility,
direct signup ingestion, additional channel delivery, dependable branded creative
and video, and live acquisition-to-sale validation remain incomplete. The full
autonomous-growth goal remains active.

The next signup-ingestion investigation found that CineGen's current Auth signup
creates an account and sends verification, without recording a marketing opt-in
in that path (`src/Components/Functional/Auth/index.jsx`). Its existing
`functions/growthLeads.js` contains researched candidates and manually approved
founder outreach, not an opted-in signup feed. Lemonade's licensing backend uses
checkout/licence endpoints rather than customer accounts. These sources must not
be reclassified as opted-in prospects. No changes were made to either business's
signup flow or deployed backend during this checkpoint.

### Website requests checkpoint, 0.21

Signal now supports a separate website prospect source alongside Mailchimp for
each business. A fixed change-feed head and durable sequence cursor preserve
updates across restarts. Verified, explicitly opted-in requests become leads;
existing lead fields remain intact, known Stripe buyers become customers, and
opt-outs stay suppressed. Every linked email write checks current website consent
and current verified account identity. When both sources link a contact, both
must permit the message. Operations shows both source scopes and can run them
without a publishing destination. See [website requests](website-prospects.md).

The prepared shared website changes add `/get-started`, its visitor script, and
authenticated prospect endpoints to Lemonade and CineGen. Firebase email-link
verification and an explicit later checkbox are separate steps. Verification
alone does not subscribe. Visitors can stop emails from the page. Shared writing
navigation links to the form. Production websites and authentication settings have
not been changed; deployment and actual website callback validation remain pending.

The full Signal suite passed 1013 tests in 48 files, followed by a 64-test outreach
run including eight additional website-to-Gmail/Outlook delivery cases. Those cases
confirm current consent is checked at the actual transport boundary, including
Outlook opt-out after draft creation. Shared backend tests passed 28 cases. The
Firebase Auth emulator completed the actual email-link token exchange and Admin
SDK verification with an isolated demo project. Browser checks passed for both
businesses at 1440x1000 and 390x844, with simulated email requests and no real sends.

`release/Signal Setup 0.21.0.exe` was built (103699821 bytes). Packaged Sales and
Operations checks passed at 1440x900 and 720x800 with zero renderer errors. Website
and Mailchimp sources were shown independently, blocked network reads offline,
disabled independently and stayed within their business. Website forms and the
desktop source controls were visually inspected. Typecheck, lint, module parity
and whitespace checks passed. The installed app was not replaced. All browser and
desktop checks used software rendering; no GPU inference was started.

The full goal remains active. Website deployment/auth setup, live provider and
acquisition-to-sale validation, final research relevance, additional publishing
channels and dependable branded creative/video remain outstanding. The signup
backend retains consent change history; deletion/retention lifecycle work is
documented as incomplete rather than implied by the opt-out control.

### CPU-only agents checkpoint, 0.22

Settings now supports CPU-only local Ollama execution, including writing, research,
sales and image review. Every local agent request carries `num_gpu: 0`; unsupported
endpoints hold, and existing profiles retain Automatic. Saved changes reach existing
clients, cancellation remains available, and CPU calls allow a longer timeout.
ComfyUI retains its own device configuration. The sidebar now displays the running
app's version instead of a hard-coded older version. See
[local CPU execution](local-cpu-runtime.md).

The full suite passed 1,034 tests in 49 files; typecheck, lint and whitespace checks
passed. A real Gemma 4 E4B text request completed in 12.2 seconds on Ollama 0.32.5,
with two loaded-model observations reporting zero GPU memory. The full CineGen
research-to-campaign validation is being rerun on CPU with simulated publication;
its content-quality verdict is still pending and is not covered by the short probe.

`release/Signal Setup 0.22.0.exe` was built (103700373 bytes). Packaged Settings,
CPU preference persistence, tray/reopen/startup and quit checks passed at 1440x900
and 720x800 with zero renderer errors. The provider screen was visually inspected.
The owner's installed application and runtime preferences were not changed.

Website deployment is now authorized. Its first attempt failed before changing
production because Firebase credentials expired. A subsequent read-only check
confirmed the same authentication problem. Local deployment preparation preserves
existing live assets; production publication and visitor verification still await
renewed Firebase login. The full autonomous-growth goal remains active.

### LinkedIn and factual revision checkpoint, 0.23

Operations now supports public LinkedIn member text/link posts through connections
with granted publishing permission. The writer has a dedicated professional-post
brief; final text includes business affiliation and a tracked product link. A
durable record precedes the provider write, and confirmed receipts persist before
the job finishes. Unknown acceptance cannot trigger another POST after a retry or
restart. Explicit provider rejections can be retried after correction. Read-only
connections are visibly unavailable as publishing destinations.

The full suite passed 1,052 tests in 49 files. Tests include LinkedIn acceptance,
permissions, lost responses, missing receipts, server errors, duplicate responses,
explicit rejections, receipt recovery, Pause and final text length. Two further
regressions verify that repeatedly rejected campaign angles change while retaining
current product facts, without bypassing independent review. Typecheck, lint and
whitespace checks passed.

`release/Signal Setup 0.23.0.exe` was built (103702094 bytes). Packaged Operations
checks passed at 1440x900 and 720x800 with zero renderer errors. LinkedIn permission
presentation, settings persistence, offline Run and business isolation passed, and
the destination controls were visually inspected. No LinkedIn post was sent, and
live provider compatibility remains unverified. The installed owner app is unchanged.

The first full CPU CineGen run finished with all four drafts rejected and no
publication. The writer repeatedly inferred unsupported export-quality benefits
from an integrated workspace. Source facts could also fall out of the prior JSON
history as drafts accumulated. The revision flow now retains source facts and
requires a different supported task after two factual rejections. A second real
CPU run is in progress with a 20-minute deadline and per-completion trace files;
it has not yet established a content-quality pass. GPU-heavy validation remains
on hold, website deployment remains pending Firebase reauthentication, and the
full autonomous-growth goal remains active.

### Campaign validation follow-up, source build after 0.23

The second CPU run finished with four failed drafts and zero publication writes.
Its trace showed inconsistent editorial judgment and repeated incorrect source
citations. Structural checks now run before editorial inference without creating
a delivery, and enqueue rechecks policy after review. Generation restricts the
evidence field to the inspected product URL. Two failed drafts trigger a new
angle, including failures outside the editorial pass; the reviewer must check
the central promised outcome before accepting supporting feature claims.

The revised suite passed 1,054 tests in 49 files, plus typecheck, lint and the
production build. These changes are not yet in the 0.23 installer. A new CPU-only
CineGen run is recorded in `data/discovery-cpu-cinegen-preflight.log`; its result
must be inspected before making any content-quality claim. Website deployment
still requires renewed Firebase login. No public campaign was sent in validation.

### X delivery checkpoint, 0.24

X is now an Operations destination for original text/link posts when the connected
account has `tweet.write`. The writer has a short-post brief and the final tracked
text uses the official weighted-character parser. Delivery persists the attempt
before posting and the returned ID before finishing. Unknown acceptance cannot
trigger a second POST, including after restart. The UI disables read-only X
destinations and removes misleading retry buttons for uncertain X/LinkedIn posts.
See [X setup and limits](x-publishing.md).

The full suite passed 1,070 tests in 49 files, including 16 new X cases. Typecheck,
lint and packaging passed. `release/Signal Setup 0.24.0.exe` is 103771553 bytes.
The packaged Operations screen passed at 1440x900 and 720x800 with no renderer
errors; publishing permissions, business isolation, offline Run and persistence
were checked, and the actual destination controls were visually inspected.
The installed owner app remains unchanged. No X API publication was sent; real
account access, billing and delivery are unverified. The CineGen CPU run has now
completed on its fourth attempt with a source-grounded storyboard-to-timeline
guide and one simulated publication. Manual inspection passed for that artifact;
repeated quality and actual commercial results remain unproven. A matching
Lemonade check is running. The full growth goal remains active.

### Evidence coverage and cross-cycle feedback checkpoint, 0.25

The Lemonade CPU run completed with one simulated publication after three drafts.
Investigation found that its first two rejections were incorrect: a 32-excerpt
limit hid the homepage's explicit Word/Excel creation features from the reviewer.
The reviewer now sees the complete inspected text in overlapping chunks, uses
the latest observation of each URL and rejects oversized input explicitly.
A real CPU review then accepted the documented workbook capability and rejected
an invented YouTube-publishing capability. The final earlier campaign still
needs more precise wording about file scope and source-location detail; a
completed queue/receipt path does not establish consistently good writing.

Operations also retains limited editorial corrections between runs, keyed to the
business and product-source text. Repeatedly rejected research findings are
temporarily deferred, not deleted from the audit trail. Feedback expires after a
week, is ignored when source evidence changes and clears for findings recovered
by an accepted revision. Network and structural failures do not become editorial
lessons. See [feedback behavior and evidence](campaign-feedback.md).

The full suite passed 1,079 tests in 50 files, plus typecheck, lint and packaging.
`release/Signal Setup 0.25.0.exe` is 103772475 bytes. The installed owner app remains
unchanged. Packaged Operations checks passed at 1440x900 and 720x800 with zero
renderer errors; the destination controls were visually inspected. No customer
email or public post was sent during these validations.
Production website deployment still awaits Firebase reauthentication; creative,
live-account and sustained autonomous-operation requirements remain open.

### Local branded cards checkpoint, 0.26

Operations now offers a built-in branded card for Bluesky. The operating writer
produces copy without an art prompt; independent editorial review still applies.
A hidden local renderer lays out the reviewed headline and description with the
business name and domain, checks text fit, and saves the normalized image for the
existing upload and receipt workflow. It does not invoke ComfyUI or a vision model.
The policy only requires the text agent when this card option is selected.

The full suite passed 1,086 tests in 50 files. These include the operating agent
path, Pause during rendering, failed-layout holds, model requirements and recovery
after a lost publication response. Typecheck and lint passed. Separate Electron
software-rendering checks produced actual Lemonade and CineGen JPEGs, exercised
maximum-length and literal-markup copy, and verified cancellation and rejected
overflow cleanup. The actual images were visually inspected. Packaged controls
and saved-image previews passed at 1440x900 and 720x800, with policy persistence,
business isolation, offline Run protection and zero renderer errors.

This checkpoint supplies a dependable layout option, not evidence of campaign
conversion or a complete image/video pipeline. Test publications used intercepted
transports; no real post or email was sent. The installed owner app and production
websites remain unchanged. Firebase authentication, real-account validation,
sustained writing quality and the remaining creative workflows are still open.

### Visitor-interest experiments checkpoint, 0.27

When verified Stripe purchase evidence is insufficient, Operations can select a
follow-up experiment using fresh, complete, product-scoped GA4 observations.
The decision requires repeated engaged visits on mature, tracked publications;
missing rows remain unknown. Purchase evidence takes priority, every fourth cycle
still explores, and the selection never raises delivery or spending limits.
The Operations explanation distinguishes visitor interest from paid acquisition.

Factual review and comparison with the previous reader action now run separately.
CPU Gemma passed a fixed repeated-action/valid-next-action pair. A full synthetic
CineGen cycle caught repeated drafts but exposed an overstated consistency claim
that factual review accepted. Direct revision checks now block the observed
generation-time and universal consistency wording independently of the model.
Pause also prevents another model request after an in-flight review completes.

The source suite passes 1,139 tests in 51 files; typecheck and lint pass. The
tests cover traffic eligibility, unknown observations, payment precedence,
scope isolation, verified destination paths, review failures and Pause. Model smoke tests use real CPU
inference and current website text, with synthetic traffic and intercepted
publication. They do not prove campaign effectiveness or live-account delivery.
The owner profile still has no saved new Connections accounts, operating
policies, Stripe configuration or GA4 configuration. Legacy website publishing
configuration exists separately. Production deployment requires Firebase
reauthentication, and installed-app, live-account, long-run and creative-pipeline
validation remain open.

The rebuilt `release/Signal Setup 0.27.0.exe` is 103777951 bytes. Its packaged
Operations smoke passed at 1440x900 and 720x800 with zero renderer errors,
persisted policies, business isolation and offline Run protection. The visitor
table was visually inspected at both sizes. This validates the packaged build,
not the installed owner application, which remains unchanged.

The final CPU Qwen test exhausted four drafts without an approved delivery and
made zero simulated publications. It exposed both overclaims and inaccurate
review judgments; the current small local models have not met unattended-copy
quality requirements. The test runtime stopped afterward. Additional fixes
cover consistency adverbs and invented business-link paths, with regression
tests and a rebuilt package. See the detailed [model evidence](campaign-learning.md)
before interpreting this checkpoint as readiness to operate live.

### Review coverage and writer instructions checkpoint, 0.28

Editorial decisions now cover exact passages from every title, description and
body. Signal validates complete, unique passage coverage and known source IDs,
then attaches the actual copy to its audit. A model cannot replace the submitted
wording with an invented claim field. Unsupported judgments still require model
reasoning; structural validation alone cannot make those judgments correct.
See [copy review](copy-review.md) for the protocol, research and limitations.

Short social writer instructions now consistently leave the business link and
company disclosure to Signal. Follow-up revisions keep the selected buyer
workflow while changing a rejected action or outcome. Tests cover both successful
replacement and exhausted retries without bypassing independent review.

The source suite passes 1,152 tests in 52 files, typecheck and lint. Real CPU
Gemma checks passed the repeated-action and valid-next-step cases. On a separate
four-case factual evaluation, Gemma passed three and Qwen 3.5 9B passed four.
Both unsupported offers were rejected for actual factual reasons, not transport
or format errors. These narrow diagnostics do not prove sustained autonomous
copy quality, live distribution or sales. The owner profile and installed app
remain unchanged; Firebase reauthentication is still required for deployment.
