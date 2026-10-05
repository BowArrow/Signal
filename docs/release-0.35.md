# Signal 0.35: measured buyer journey

September 25, 2026.

Signal now reports observed download requests, requests for guidance, new accounts,
checkout starts and completed product tasks by campaign. Previously the Analytics
screen exposed aggregate key events without identifying these actions. Counts are
explicitly event counts; missing measurements are not inferred conversion failures.
Stripe evidence stays separate from website events and spendable cash.

Each event report is bounded to 10,000 rows, validates columns/counts/calendar
settings, retains reporting limitations and matches only the selected business's
campaigns. Repeat sync replaces the snapshot. A failed event read is marked
unavailable while retaining successfully refreshed traffic data. Model context
limits the included event rows and warns against inferring cohort conversion rates.

## Validation and installation

- TypeScript and targeted lint passed. Full suite: 1,274 tests in 57 files.
- Development, packaged and installed UI checks passed at 1440x900 and 720x800,
  including persistence, business isolation, source removal and offline behavior.
  The validation browser now renders offscreen, so it does not open a visible app
  window. Production window behavior is unchanged.
- Lemonade browser checks passed consent denial, granting, withdrawal/regrant,
  query-secret exclusion, campaign continuity, mobile layout and event boundaries.
  Google requests were intercepted in these checks; they did not create real
  checkouts or prove production analytics ingestion.
- CineGen checks passed sanitized private routes, campaign continuity and consent
  withdrawal while the Analytics SDK initializes. Production frontend build and
  targeted lint passed. Signup, checkout and completed draft exports are instrumented.
- Existing email-verification attribution regression checks passed for both sites.
- Both existing GA4 connections refreshed successfully through the live Data API.
  Data-stream measurement IDs match the website configurations. The new event
  reports currently contain no observed funnel events.
- Installed 0.35.0 silently with `/S /NORESTART`. Installed and packaged app.asar
  SHA-256: `9736CED09278731CD9533317EAAEF1BA99F7F9ADA27D7667D685F3A3E0001A4B`.
- A bounded CPU startup/completion probe passed using Gemma 4 E4B, two inference
  threads and zero observed VRAM allocation: 12.3 seconds. This narrow readiness
  check does not establish unattended marketing-copy quality.
- A four-case CPU editorial evaluation reached the correct approve/reject decision
  in all four cases (109–114 seconds each), but mislabeled a factual body passage
  as nonfactual in one supported draft. The stricter passage-coverage assessment
  therefore passes **three of four cases**. The evaluation harness now requires
  factual coverage in its positive fixtures. No further inference was needed to
  assess the saved responses; the owned runtime stopped after the run. This is
  not qualification for unattended marketing. Evidence:
  `data/operations-validation/copy-review-assessment-1790355711143.json`.

## Website release state

Both websites were **deployed and public files verified September 25, 2026** after
Firebase reauthentication. Lemonade release `a397994cc7a31a6d` changes five relevant
pages/scripts and preserves the other 35 Hosting files. CineGen release
`19590f2401c20c1a` publishes the built frontend through Hosting. The configured
deployment also released the CineGen pitch site; its complete file manifest is
identical to the preceding release. No backend functions, payment settings or
affiliate payout flags were changed.

All ten checked public HTML/script/style assets matched their expected SHA-256
hashes. The production Lemonade browser check passed consent denial, granting,
withdrawal/regrant, campaign continuity and query-secret exclusion. Google and
write requests were intercepted, so this does not prove processed GA4 events or
create customer conversions. Receipts: `output/marketing-audit/lemonade-funnel-release.json`,
`cinegen-funnel-release.json`, `website-funnel-live-verification.json`, and
`data/website-funnel-validation-live/result.json`.

Publication used `node scripts/publish-website-funnel.cjs` from Signal and
`node scripts/firebase-safe.mjs deploy --only hosting --project cinegen-12360`
from CineGen. Verify public file hashes with
`node scripts/verify-website-funnel-release.mjs`, then run
`node scripts/website-funnel-smoke.mjs --live` for the production Lemonade pages.
The browser check blocks Google and all write requests; it verifies the deployed
consent/event code without creating a checkout or contaminating analytics.
Actual GA4 ingestion remains a separate observation.

The owner reported no LTD replies. That status was added to all three existing
partner records without changing stage or email permission. Operations remain
paused; no new outreach, public posts or paid generation were performed.

## Remaining work

Observe actual GA4 event delivery from consented use. Then qualify
agent copy and reply behavior, implement lifecycle onboarding using real product
state, and finish affiliate onboarding/payout readiness. This release adds event
observations; it does not provide a deduplicated person-level activation cohort,
automatic Lemonade desktop activation telemetry, or evidence of new customers.
