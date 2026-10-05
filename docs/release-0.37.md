# Signal 0.37: reach public requests and fund tests from sales

This update adds a route to buyers who do not follow the business, plus a calculation for reinvesting eligible Stripe proceeds. It does not complete autonomous paid advertising.

## Qualified public replies

- Search Bluesky through the connected business account. Retain recent original requests, their exact text and immutable post references. These observations never become email contacts.
- In acquisition mode, the enabled public-reply policy can select a supported request ahead of posting to an empty feed or writing another article. The existing agent checks product fit, creates a relevant answer and submits it to independent editorial review.
- Before delivery, re-read the original thread. Changed, deleted, blocked, restricted, stale and self-authored targets stop the write. Initial replies use text, company affiliation and a tracked link without promotional images.
- One person cannot receive another reserved/attempted initial response within 30 days across businesses. Three such responses per rolling day is the global ceiling; the business publication limit can be lower.
- Immutable record keys reconcile an accepted reply after a lost response without duplicating it. The parent and root references must also match.

## Sales-funded allowance

- Stripe reads now retain validated charge balance-transaction net, fees, availability and known collected tax. Missing permission or cash fields never become assumed zero costs.
- Revenue has an owner funding rule: percentage after operating reserves, additional cash reserve, total cumulative cap and 7–90-day hold. It starts disabled with a zero cap.
- Only product-scoped live receipts in the business currency qualify. Pending, young, refunded and disputed payments do not. Incomplete or stale scans and unknown cash evidence block new funding.
- The allowance is derived from the current completed snapshot, not appended on every sync. Prior spending, reservations and downward adjustments reduce what remains. Manual surplus credits are not added on top.
- Stripe availability is not profit or a bank balance. The owner's reserve must cover affiliate commissions, delivery costs and other obligations. This rule does not withdraw from Stripe, create ad billing or activate a campaign.

## Validation

- Full suite passed 1,352 tests in 62 files before the final UI/readiness and stale-request refinements. Affected service, acquisition, readiness, revenue and funding suites passed after those changes. Typecheck and targeted ESLint passed. Repository-wide ESLint remains blocked by 186 pre-existing errors in legacy CommonJS investigation scripts; these were not altered to make the result green.
- Hidden desktop fixtures passed at 1440×900 and 720×800: reply settings and funding settings persist, funding remains disabled without authorization, offline execution is blocked, business data stays separate, and there are no renderer exceptions.
- Live authenticated Bluesky search returned actual public observations. None was treated as a sale, opted-in contact or invitation to pitch an unrelated product. Publication integration tests used intercepted provider responses, including closed threads and lost acknowledgements.
- CPU-only Gemma 4 E4B qualification: 5/5 expected decisions against the live Lemonade product page, using two threads and no GPU. Cases cover a supported Windows document task, unsupported native macOS and enterprise requirements, a promotional question and a request to download a missing textbook. The first run rejected the promotion for a weak reason; an instruction refinement and second run correctly identified it as promotion. Final report: `data/operations-validation/acquisition-live-1790440040820.json`, 121 seconds. This bounded probe does not establish general semantic reliability.
- Live Stripe read checks returned HTTP 200 for balance-transaction permission in both configured businesses. Both product-scoped scans completed with zero qualifying captured payments. Consequently no observed sale currently funds marketing in these scopes.

## Remaining completion work

The [completion contract](signal-completion-contract.md) lists the operating loop and its acceptance evidence. Material remaining work includes paid ad execution and spend reconciliation, broader partner/community routes, approved video-to-distribution integration, processed funnel observation, broader model evaluation and optional unattended hosting. Google Ads is not currently connected in Signal. No customer email, public reply or ad spend was created by this release validation.

## Package and installation

`release/Signal Setup 0.37.0.exe` is 103,842,535 bytes. The packaged `resources/app.asar` SHA-256 is `67dc3f5b2adb80da79f5e1dd1cc86039133a0208f70dadeb4566691271a05d2c`. Both hidden desktop fixtures also passed against `release/win-unpacked/Signal.exe`.

Installation is pending closure of the owner's open Signal window. The paused owner policy has not yet been changed for this release. `scripts/prepare-owner-request-replies.ts` is prepared to preserve the one-publication daily limit, add four Bluesky searches, enable the reviewed-request route, and research hourly after Run. It refuses active/unfinished work and saves a private backup first. No reinvestment rule or spend cap has been authorized.
