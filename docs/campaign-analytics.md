# Campaign analytics

## September 25 update: buyer journey events

Signal 0.35 reads a second, independently validated GA4 report for
`download_requested`, `generate_lead`, `sign_up`, `begin_checkout` and
`product_activation`. It uses the same completed-day window and exact hostname
as the traffic report. Known campaigns are matched only to this business;
unknown campaign text is discarded. Repeated sync replaces the snapshot rather
than accumulating event counts. Invalid, restricted or unavailable event reports
are labeled unavailable without discarding successful traffic measurements.

The Analytics screen and agent context expose these observations. Counts are
events, not unique people, a sequential cohort, proof of installation, or money.
An absent event is displayed as **Not observed**, because instrumentation, consent
and reporting delays can also explain it. Stripe remains the payment authority.

Website implementation: optional Lemonade consent controls load Google only after
consent; download requests and successful checkout redirects emit distinct events.
Both guidance-request forms emit `generate_lead` after a successful subscribed
preference save. CineGen emits signup only for a newly created account, checkout
after a session URL is returned, and activation after a completed browser draft
export. Repeated completed exports are events, not new users. Lemonade desktop
activity is not collected. Authentication query parameters and private project
paths are excluded from explicitly configured page locations.

Release/deployment evidence and remaining limits are in [0.35 notes](release-0.35.md).

Implementation references:
- [GA4 recommended events](https://developers.google.com/analytics/devguides/collection/ga4/reference/events)
- [Campaign configuration and sanitized page locations](https://developers.google.com/analytics/devguides/collection/ga4/reference/config)
- [Consent initialization and updates](https://developers.google.com/tag-platform/security/guides/consent)

Signal 0.11 reads GA4 campaign observations for Lemonade and CineGen separately.
This gives the marketing and operating agents measured traffic evidence alongside
the existing Stripe payment evidence. It does not establish an autonomous
optimizer, guarantee sales, or complete the remaining publishing/sales adapters.

## Setup

1. Enable Google Analytics Admin API and Google Analytics Data API in the Google
   project used by your OAuth client. The connected Google user needs read access
   to the desired property and its metrics.
2. In Connections, select the business and connect Google Analytics 4 using
   read-only authorization. Preview account lists accessible properties.
3. In Analytics, select the connected account and enter the numeric GA4 property
   ID. A G-prefixed measurement ID is not a property ID.
4. Save the source and Sync analytics. The source is only configured until the
   first report confirms property and metric access.
5. Running Operations refreshes reports hourly, with five-minute retry spacing
   after failure. An interrupted read resumes on the next running worker cycle.
   Pause Operations stops automatic reads; manual Sync remains available.

The exact hostname is derived from the business's saved website URL. Subdomains,
including `www`, are not silently added. Check the actual measurement hostname
and business profile if a report is unexpectedly empty. A hostname change requires
resaving the source. Multiple businesses may use a shared property only with
distinct hostname scopes and separate business connections.

Connecting GA4 does not add trackers, change consent settings, or change
Lemonade's local application privacy behavior. This reader uses existing website
instrumentation. Without that instrumentation there may be no useful observations.

## Reporting and attribution

The report covers the last 30 completed calendar days in the property's timezone.
The date window is explicit, including around daylight-saving changes. Data may
still be revised by Google after a day ends; each sync replaces the rolling
snapshot instead of adding it to the previous one.

Rows contain session counts, engagement, configured key events, website purchase
events and an analytics purchase-revenue estimate. Currency values here are in
major units. They are never added to Stripe payment totals or the cash ledger.
Key events are not necessarily sales, and website events do not verify customers.

Only `utm_campaign` values equal to a known Signal campaign or delivery ID for
the selected business are matched. Unrecognized campaign strings are grouped
without storing their text. No visitor/contact information is requested. The
agent receives up to 100 rows ranked by sessions, the full totals, omitted-row
count, date window, source status, freshness and reporting limitations. The UI
shows up to 300 rows and full totals. These are associations, not causal estimates.

Sampling, thresholding, high-cardinality grouping, truncation and constrained
empty reports are labeled. Restricted metrics, inconsistent columns, invalid
values and reports beyond 10,000 rows or the 2 MB transport bound fail without
replacing the previous snapshot. A failed refresh never turns old evidence into
a current zero result. Evidence is stale after 36 hours or loss of source access.

All requests use fixed Google endpoints. Secrets remain in the main-process
vault, with token refresh and one renewal retry after a 401. Source changes,
removal, disconnection and cancellation prevent late results from overwriting
the current configuration. Unknown provider text and exception bodies are not
returned to agents or saved as user-facing diagnostics.

## Validation and limits

The adapter and service tests use simulated Google responses. They exercise
hostname scope, campaign ownership, credential refresh, concurrency, empty and
limited reports, malformed/oversized results, source changes, rolling replacement,
freshness and calendar boundaries. The isolated offline Electron fixture covers
business switching, report persistence, saving/removing the source and disabled
offline reads at desktop and narrow window widths. No real Google account grant
or production GA4 report has been verified by these checks.

## Primary API references

- [Google Data API runReport](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport): request shape, hostname filter and read-only OAuth scope.
- [Google dimensions and metrics](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema): campaign dimension and metric names.
- [Google report metadata](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/ResponseMetaData): limitations, currency and timezone.
- [Google Admin properties.get](https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/properties/get): property settings before selecting the calendar window.

Reviewed September 17, 2026. Google and website settings can change independently
of Signal; a successful account preview alone does not verify report access.
