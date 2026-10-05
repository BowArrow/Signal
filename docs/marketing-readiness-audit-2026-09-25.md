# Signal: marketing and revenue readiness audit

Audited September 25, 2026. Scope: current Signal source, installed owner database, public Lemonade/CineGen services, existing validation receipts, and current marketing guidance. This is an implementation and launch assessment, not a revenue forecast.

Implementation update: [Signal 0.35 release state](release-0.35.md) records the
installed buyer-journey report, refreshed Analytics connections, and verified
website deployment. The evidence table below preserves the initial audit
snapshot; it is not the current installed version or latest analytics sync.

## Decision

Finish a measurable acquisition-to-purchase workflow for Lemonade first, then reuse it for CineGen. Signal already has substantial marketing infrastructure. Its biggest gaps are product activation measurement, reliable unattended execution, qualified distribution, and connecting the existing reports into one decision process. Adding every marketing channel would postpone the useful launch.

The appropriate next milestone is **a bounded, observable sales pilot**, followed by unattended operation once that pilot demonstrates reliable behavior. A completed app cannot guarantee demand or sales.

## Evidence checked today

Reproducible, contact-free snapshot: [audit JSON](../output/marketing-audit/2026-09-25.json). Read-only collector: [audit script](../scripts/marketing-readiness-audit.mjs). No credentials are decrypted by that collector. Configuration and cached reports are explicitly distinguished from current provider access.

| Area | Observed state | Meaning |
| --- | --- | --- |
| Source and installed version | Package and installed executable report 0.34.0 | This audit did not rebuild or verify byte parity with the installed archive. |
| Code checks | TypeScript passed; 56 test files / 1,262 tests passed | Implementation checks pass. They do not establish effective copy, live posting, or sales. |
| Operations | Both businesses paused; website, Bluesky and X selected; one publication/day per business | Accounts alone do not start work. |
| Text runtime | Local CPU selected, automatic runtime start disabled; Ollama endpoint unavailable | Run requires a usable configured model. Startup and recovery need an actual acceptance run. |
| Media runtime | ComfyUI endpoint unavailable; saved video renderer is local | Local H3 remains under its incident hold. Do not make local H3 a launch dependency. |
| Connections | Gmail, YouTube, Stripe, website, Bluesky, X, LinkedIn and GA4 have saved verified records; Facebook has attention status | These saved records are not fresh verification of every provider token. LinkedIn is not currently selected for Run. |
| Leads | Lemonade has three contacted leads, all permission unknown; CineGen has none | These are the previously recorded LTD partner inquiries, not an opted-in buyer list. All three reminders are overdue. |
| Campaign records | Six campaigns, twelve draft assets, no recorded Studio outcomes or Operations delivery records | Existing external ad files and manual inquiry receipts have not become a unified completed campaign history. |
| GA4 cache | Last sync September 19 UTC, covering August 19–September 17; Lemonade 0 sessions, CineGen 12; no matched campaigns | Stale, scoped observations. Not current traffic totals and not proof of no demand. |
| Stripe cache | Last sync September 19 UTC; zero stored payments for selected mappings/history | Does not establish today's revenue or lifetime business revenue. Refresh and reconcile before decisions. |
| Website intake | Authenticated `/api/prospects/meta` and `/changes` reads returned 200 for both products | Deployed read integration works. Saved intake snapshots have added zero leads; signup completion was not repeated today. |
| Public checkout wiring | Existing public-source check passed for both websites | Campaign hints reach checkout request code. No production payment was created during this audit. |
| Affiliates | Both live `/api/affiliates/program` endpoints: enabled, 10% commission, 30-day hold, **Connect disabled, payouts disabled** | Enrollment infrastructure is available; the program is not payout-ready. |

Lemonade's live homepage and LTD ad page have no visible GA4 tag. Its two homepage scripts, `nav.js` and `referral.js`, also contain no analytics instrumentation. CineGen is different: its live JavaScript bundle contains a GA4 measurement ID and consent-controlled analytics. Do not classify CineGen as uninstrumented just because the HTML lacks a tag. Its inspected telemetry implementation exposes page views and errors, but the source search found no business-event calls for signup, trial activation, first export or checkout. Event arrival and attribution still require browser/network and GA4 verification.

Prior evidence reviewed today, not repeated: September 19 Stripe **test-mode** receipts show campaign-matched Lemonade and CineGen payments, a partial Lemonade refund, and a CineGen custom top-up; repeat sync did not duplicate payments. See `data/stripe-sandbox-validation/revenue-result.json` and `data/stripe-topup-validation/revenue-result.json`. Therefore checkout attribution is partially proven, not missing wholesale. Production purchase verification remains separate.

## What is already implemented

- Nineteen-channel Bullseye planning, business profiles, campaign briefs, draft generation, lead stages and manually recorded outcomes: `src/shared/growth.ts`, `src/core/growth/`, `src/core/studio/`.
- Local and OpenAI agent routing, API-key support, CPU selection and cloud call limits: `src/core/runtime/client.ts`, `settings.ts`, and `src/shared/runtime.ts`. The older note that provider routing was unfinished is superseded by current source and passing tests; representative live quality still needs qualification.
- Website, Bluesky, X, Facebook Page and LinkedIn delivery paths; recorded attempts, receipts and duplicate protection: `src/core/operations/delivery.ts`. YouTube has a separate approved-video publishing path.
- Verified sender aliases, monitored inboxes, researched replies, opted-in outreach, follow-ups, suppression and owner handoffs: `src/core/sales/`.
- Read-only Stripe imports, product mapping, refunds/disputes and purchase-based follow-up stops; GA4 campaign reports; conservative destination/topic selection: `src/core/revenue/`, `analytics/`, `operations/learning.ts`.
- Branded cards, ComfyUI workflows, character/story planning, Blender guides, cloud H3 controls, video assembly and review gates: `src/core/video/`, `electron/main/video-host.ts`.
- Existing final narrated product ads: `output/openart-ads/final/`. Lemonade's ad page is publicly available. The files are usable campaign assets; making another generation backend is not required to launch this pilot.

## Finish in this order

### P0.1 — Instrument and reconcile the actual funnel

**Gap:** Connecting GA4 reads a property; it does not instrument the website. Signal's analytics model stores sessions, engagement and aggregate key events, while Studio separately sums manually recorded outcomes. There is no demonstrated automatic visitor → signup/trial → useful result → purchase funnel shared by these views.

**Work:** Add consent-aware Lemonade website measurement; validate CineGen's existing implementation. Define a small event contract, campaign continuity, event IDs, product scope and test/live separation. Import deduplicated lifecycle events into Signal. Preserve campaign information through consent and email verification without collecting document contents, prompts or customer media. Check CineGen's sanitized `page_location` behavior: it strips URL queries, so campaign attribution must be verified explicitly. Keep successful Stripe payment evidence authoritative for purchases.

**First useful result:** Lemonade: the user completes a real file-based task and saves a usable result. CineGen: the user completes a storyboard-to-timeline task and exports a usable clip. These are proposed definitions to validate with users, not existing measured events. Lemonade can use voluntary activation confirmation or explicit opt-in coarse telemetry; do not introduce silent document telemetry into a privacy product.

**Done when:** One controlled journey appears once at every applicable step; known test traffic/payments are labeled; refresh cannot double-count; missing/denied measurement remains unknown rather than zero; cross-product data cannot mix. A real customer purchase must be recorded as such when it occurs, not simulated to claim success.

Code seams: `src/shared/analytics.ts`, `src/core/analytics/service.ts`, `src/core/studio/store.ts`, website `referral.js`, CineGen `src/lib/telemetry.js`, existing Stripe webhooks/readers. [GA4 recommended events](https://support.google.com/analytics/answer/9267735?hl=en) provides standard event names such as signup, lead generation and purchase; product-specific activation needs an explicit definition.

### P0.2 — Qualify one dependable agent and make Run observable

**Gap:** The selected local endpoint is down. Existing recorded CPU-model checks also exposed unsupported claims and false rejections. Valid JSON and 1,262 passing tests do not prove unattended editorial judgment. A new model connection alone will not fix this.

**Work:** Qualify one already-supported provider against representative Lemonade/CineGen tasks: factual product claims, useful creative variation, buying questions, unsupported requests, opt-outs and ambiguous delivery. Start with approved facts/templates and escalate novel claims. Measure accepted useful output, false approvals, false holds, latency and actual cost. Preserve the CPU/resource safeguards. Use a configured cloud text model if the local candidate cannot meet the required quality; keep provider choice and spending explicit.

Make a daily activity view reconcile attempted actions, confirmed results, holds, next actions and data freshness. Expose a heartbeat and distinguish paused, waiting for review, unavailable model and background operation. Tray behavior already exists; this is an integration/verification task, not a request to build it again. A desktop process cannot work while the PC is off; a hosted worker is a later option if that becomes necessary.

**Done when:** A controlled run survives restart/token failure, produces useful approved material, preserves exact sender/business identity, and cannot duplicate uncertain delivery. Every external action has a visible receipt or explicit unresolved status. Then run a limited real pilot within the selected policies.

Code seams: `runtime/`, `operations/readiness.ts`, `operations/review.ts`, `sales/`, `runtime/continuity.ts`, Operations and reporting screens. `docs/campaign-learning.md` records the prior semantic failures.

### P0.3 — Turn the existing offer into a repeatable buyer journey

**Gap:** A generic audience, a completed ad and a connected account do not supply interested buyers. Current Run research searches Hacker News and Stack Exchange; this does not establish LTD community placement. The three stored LTD inquiries are partner contacts, and no approved placement is recorded.

**Work:** Choose one initial buyer/use case per product. For Lemonade, test the hypothesis that Windows/Linux users with recurring document work value a one-time purchase and local processing. Reuse the existing $49 LTD ad and trial path, verify the offer against the live site, and give the prospect one practical first task. For CineGen, test independent creators making short promotional videos with a real project walkthrough and one clear next action.

Extend the existing community/rules/lead data into a placement workflow: destination, relevant audience, current rules, admin permission, requested placement, approved copy, submission receipt, published URL, campaign and follow-up status. Review current replies to KenMoo/Lifetimo/LTDHunt before further contact. Do not promote the three inquiries into opted-in product leads.

**Done when:** At least one appropriate placement is accepted and its live URL is recorded, or a documented rejection redirects the experiment. The exact ad/landing page/trial instructions agree. Each subsequent reply, trial and purchase has a traceable source where available. A placement is a distribution milestone, not a sales guarantee.

Facebook Page publishing is not Facebook Group publishing. Zapier's [Groups integration removal notice](https://help.zapier.com/hc/en-us/articles/23970212345357-App-update-Facebook-Groups-app-removal) documents the retired integration. Use permitted admin placements/manual handoff with receipts; do not promise a universal one-click group poster.

### P0.4 — Add onboarding and lifecycle triggers

**Gap:** Existing Sales replies and unanswered-message follow-ups are conversation-driven. They are not a demonstrated product-usage lifecycle system. Studio can record activations/retention manually, but that does not supply automatic activation triggers.

**Work:** Add opt-in journeys for signup without a useful result, trial nearing expiration, a successful first task, and paid onboarding. Use actual product state; distinguish help from marketing, stop promotional sequences when appropriate, and avoid repeated messages across shared inboxes. Start with a short sample task and help link, not a long feature tour. Collect structured objections/loss reasons and feed reviewed findings into briefs and FAQs.

**Done when:** Eligible test users receive only the intended next step, existing customers do not receive acquisition nags, opt-outs stop the sequence, and users can reach first value without owner intervention. Measure activation and return use, not email opens alone. [Amplitude's activation guidance](https://amplitude.com/books/user-engagement/activating-new-users) supports measuring first value and whether activated users return.

### P1.1 — Complete affiliates before recruiting commission partners

**Gap:** Live Connect and payout flags are disabled on both products. Existing commission, refund and transfer code is substantial; it should be completed and verified rather than replaced.

**Work:** Resolve actual platform onboarding requirements; verify account creation, affiliate onboarding, referral attribution, commission holds, refunds/disputes, transfer reconciliation and payout reporting. Keep the read-only Stripe reporting credential separate from authorized backend payout credentials. Expose program readiness in Signal so agents cannot recruit affiliates on an unsupported payout promise.

**Done when:** The full sandbox lifecycle passes, live capabilities are confirmed, and the program truthfully communicates supported payouts. The first legitimate payable commission gets a reconciled transfer when due. Do not create a fake sale or transfer merely to claim readiness. [Stripe's capability guidance](https://support.stripe.com/questions/payouts-or-charges-not-enabled-for-connected-accounts-with-platform-gathered-verification-requirements?locale=en-GB) distinguishes account verification from enabled payments/payouts.

### P1.2 — Run creative experiments using the product we already have

**Gap:** High-quality finished ads exist, but their production history and performance are separate from Signal's draft asset records. Automated cloud video has configuration/review paths; an unattended high-quality run remains unproven.

**Work:** Import final MP4/captions/posters into the campaign library with approval and version metadata. Make three inexpensive variations around buyer problem, actual product demonstration and offer. Tag hook, audience, proof, CTA and placement. Keep real UI readable; demonstrate a result before listing features. Compare qualified clicks, activated trials and retained purchases. Keep the AI character a fictional creative element, not a testimonial.

Google's [video creative guidance](https://support.google.com/google-ads/answer/14783551?hl=en) emphasizes attention, branding, connection and direction, including clear CTAs. Its [2026 marketing outlook](https://business.google.com/in/think/future-of-marketing/marketing-predictions-guide-2026/) emphasizes creator collaboration and integrated marketing; those are directional opinions, not proof any specific ad will convert. For Signal, real workflow demonstrations and small creator pilots are a practical test of that advice.

**Done when:** Existing approved footage can be reused, published through an eligible selected route, and compared by outcome without another expensive generation round. Local H3 and a new OpenArt connector are not prerequisites.

### P1.3 — Measure contribution and uncertainty, not just activity

**Gap:** Current selection is explicitly a bounded heuristic using campaign/payment associations and engagement, not a randomized experiment. Cloud text uses a call-count cap, not a complete dollar-cost ledger. Manual cash/spend records and payment totals are not joined into campaign contribution.

**Work:** Combine refunds, payment fees, commissions, generation spend and allocated variable fulfillment costs per campaign/product. Distinguish one-time Lemonade revenue from CineGen recurring subscriptions and credit top-ups. Persist experiment hypothesis, variant, exposure, observation window and stopping criteria. Show insufficient evidence honestly. Keep attribution and causal incrementality distinct; postpone sophisticated modeling until traffic supports it.

**Done when:** Signal can explain where money went, what converted, and which next test is justified. A cost cap does not rise because a model predicts sales. For the LTD, acquisition must fit within net one-time contribution after realistic ongoing support costs.

### P1.4 — Add content/search demand feedback and reputation monitoring

**Gap:** Writing and publishing are present. A demonstrated search-query → useful page → impression/click → activation feedback loop is not. Gmail suppression exists, but a complete deliverability dashboard and automatic campaign pause on meaningful bounce/complaint signals are not established.

**Work:** Prioritize buyer-intent tutorials, honest comparisons and product-specific answers with original screenshots/examples. Verify indexing and feed Search Console query/page data into the existing planner. Add timestamped sender-domain/authentication checks and delivery-health evidence; Gmail acceptance is not proof of inbox placement. Existing outreach supports reply-to-stop and a mailto unsubscribe header; add web one-click unsubscribe before bulk newsletter use if applicable.

Google says [normal SEO practices apply to AI Search](https://developers.google.com/search/docs/appearance/ai-features); special AI files or schema are not required. Its [AI-content guidance](https://developers.google.com/search/docs/fundamentals/using-gen-ai-content) warns against scaled content without added value. [Gmail sender guidance](https://support.google.com/mail/answer/81126) distinguishes all-sender authentication requirements from bulk-sender requirements; Signal's tiny configured limits are not a reason to invent a bulk-sending launch blocker.

## Channel coverage and where to spend effort

Signal already represents all nineteen Bullseye channels. That is planning coverage, not nineteen working delivery integrations. The following covers those channels plus current AI-search and creator practices. Priority is my assessment of these products and current evidence, not a universal ranking.

| Channel family | Recommendation for this launch |
| --- | --- |
| Existing platforms, LTD communities, community building | First Lemonade acquisition test. Use permitted placements and buyer conversations; record results. |
| Sales, email marketing | First conversion layer: inquiries and opted-in trial help. Add activation triggers; do not scrape public authors into email lists. |
| Content marketing, organic social, video | Reuse actual product demos. Social posting alone does not create an audience. |
| Targeting blogs, partnerships, affiliates, creators | Small relevant reviewer/creator trials; affiliate recruiting waits for truthful payout readiness. |
| SEO and AI-search discoverability | Publish useful buying/workflow pages, then inspect actual query and conversion evidence. Avoid mass generic AI articles. |
| Engineering as marketing | Later: a genuinely useful local-AI compatibility guide/checker or a CineGen shot-planning template, with accurate limitations and a measurable CTA. |
| Viral/referral growth | Later: invite/share flows after users obtain value. Never gate their work behind forced public promotion. |
| Search ads, social/display ads, retargeting | Defer material spend until tracking, activation and contribution are known. A future adapter needs billing caps, conversion feedback and stop rules. |
| Publicity, unconventional PR | A documented customer result or compelling working demo, when real evidence exists. |
| Speaking, events, trade shows, offline ads | Not required for the first app release. A small online demo/workshop is a cheaper hypothesis than a booth or broad offline campaign. |

Early manual customer recruitment is compatible with later automation: [Paul Graham's founder guidance](https://www.paulgraham.com/ds.html) explains why founders initially recruit and help users directly. Signal should remove repetitive preparation, tracking and follow-up work while retaining the learning from those conversations.

## Suggested first pilot

1. Close P0.1 and P0.2: working measurement plus a qualified agent, with existing paid/video settings unchanged.
2. Lemonade: one buyer/use case, the existing LTD ad, one landing/trial journey, and the existing three community partner requests reviewed for current responses. Start with the first permitted placement.
3. Aim to learn from ten qualified conversations and five completed first-value tasks. These are small discovery targets, not statistically powered tests or guaranteed outcomes. Record actual sales, costs and reasons people decline.
4. Review the bottleneck: no visitors means distribution; visitors without signup suggests offer/page fit; signup without activation suggests onboarding/product friction; activation without purchase suggests value/pricing/fit. Do not diagnose a bottleneck from missing instrumentation.
5. Repeat the best-supported test before expanding channels. Run CineGen as a separate measured workflow with its own creator use case, onboarding and contribution economics.

Release acceptance: the app can execute the selected workflow, account for its actions and spending, detect failures, stop safely, and present current verified outcomes. Commercial validation is separate: real retained purchases and evidence that a channel can repeat at an affordable cost. No percentage-complete estimate substitutes for those checks.

## Boundaries of this audit

No new campaigns were started, messages sent, ads purchased, paid media generated or local GPU models launched. Provider access beyond the website intake APIs was not reauthorized or comprehensively refreshed. This audit did not repeat affiliate account signup, product onboarding, or a production payment. The latest stored reports are explicitly dated. Older setup documentation contains stale deployment statements; current endpoint checks and dated receipts take precedence.
