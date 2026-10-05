# Revenue sync and campaign attribution

Signal 0.6 adds a read-only Stripe revenue source to Operations. This advances
the full autonomous growth goal by giving agents actual payment evidence when
an owner connects an appropriate account. It does not finish email selling,
all-channel distribution, creative orchestration or automated experiment changes.

## Setup and operation

1. Create a restricted Stripe key in Workbench > API keys, named for Signal and
   the business. Grant **Read** to Balance, Charges, Products, Checkout Sessions
   and Invoices, leave other permissions at **None**, and grant no **Write**
   permissions. Use `rk_live_` for actual sales or `rk_test_` for test payments.
   Link it in Connections for Lemonade or CineGen. The revenue reader
   requires read access to Charges, Products, Checkout Sessions and Invoices;
   the basic balance connection check alone does not prove those permissions.
2. Open Revenue for that business. Load the Stripe product catalogue and select
   the Stripe products that belong to that business. Choose live or test mode
   explicitly and select the beginning of the payment-history window.
3. Save the source and Sync revenue. The first scan reads ten charge records per
   page. Read next page continues manually; a running Operation continues pages
   between cycles and starts another scan approximately every fifteen minutes.

The reader uses GET requests to `https://api.stripe.com` with API version
`2024-06-20`. It resolves one-time charges to Checkout Sessions and their product
lines, or invoice charges to invoice lines. Every line must belong to the selected
Stripe products. Mixed-business baskets, manual invoice lines without a Stripe
product, unrelated charges, uncaptured authorizations, failed charges, and zero
captures are excluded. Product identifiers cannot be assigned to both business
profiles. Changing source configuration clears the previous source's snapshot.

Refund totals and dispute flags are refreshed by rereading the selected history
window, including its older charges. A refund on a payment before the configured
start date is outside this report. Gross captures, Stripe-reported refunds and
dispute flags are distinct; fees, tax liabilities, settlement, final dispute
balance movements and profit are not reconciled. The app never writes these
figures into the spendable marketing-cash ledger.

A scan stages pages persistently, then replaces the complete visible snapshot in
one transaction. An error preserves the last complete snapshot; it does not
silently replace totals with a partial page. The reader can resume a staged scan
after restart. Disconnect or configuration change prevents late results from
being committed. Page requests are bounded, use no redirects, and recheck account
existence before each request. Tokens, payer names, emails, billing addresses and
payment-method details are not retained in revenue snapshots or agent context.
Revenue snapshots now retain an account-scoped email hash for exact contact
matching. This is pseudonymous data, not encryption or proof of a person's
identity. The hash is omitted from renderer views and marketing-agent context.

Totals keep currencies and live/test modes separate. Amounts are stored in the
currency's smallest unit, so JPY display does not divide an amount by 100. Captured
payments are not unique customers: subscription renewals remain separate payments.
Screens show the scan window and completion time. Test payments do
not establish revenue. Disputed payments stay visibly flagged; the displayed
amount after refunds is not a claim that those funds are settled or available.

## Attribution and checkout changes

### Stop selling after a purchase

A completed live scan compares billing emails from the charge, Checkout Session
and invoice with existing lead contacts in the same business. Available emails
must agree after trimming and lowercasing. Invalid or conflicting values remain
unmatched; receipt-delivery addresses, names, domains, Gmail dots and plus tags
are never used to guess a buyer. No additional Stripe permissions are required.

Matching leads move to Customer, retaining their existing contact permission.
Signal clears their follow-up date, stops their sales sequences and cancels
unattempted automatic replies. A queued send also checks current purchase evidence
immediately before delivery. An already attempted send stays available for
reconciliation; it cannot be recalled. Explicit owner-approved answers remain
available for customer questions.

This takes effect when a complete scan observes the purchase, not immediately
when checkout finishes. The normal scan interval is fifteen minutes while
Operations runs. Partial/failed scans do not create new matches. A later-created
lead can match the completed snapshot on the next revenue tick. Purchases before
the configured history start and purchases under a different email remain
unmatched. Customer status records a purchase, not active subscription access;
refunds and disputes never restart sales sequences. Test payments never change
customer stages. Changing the source does not undo already stopped sequences or
previous customer stages. Matching a buyer does not infer campaign attribution.

The payment table shows matching lead counts, absent buyer emails and conflicting
emails. Lead counts are not unique customer counts, and billing email may belong
to a shared company mailbox. All matching and stopping happen locally.

### Campaign identifiers

Supported metadata keys are `signal_campaign` and `utm_campaign`, read from
Charges, Checkout Sessions, invoices and invoice subscription metadata. The value
must resolve to an existing Campaign Studio campaign or Operations delivery in
the same business. Missing or conflicting metadata is not inferred from timing,
email or customer identity. Unknown campaign identifiers are not credited.

Local changes in the adjacent Lemonade and CineGen repositories now preserve an
explicit Signal link's campaign identifier into Checkout metadata. One-time
PaymentIntents receive it too; CineGen subscriptions copy it to subscription
metadata for subsequent invoice payments. These are attribution hints, not proof
that a campaign caused the purchase, and do not modify affiliate commissions.

Lemonade forwards the campaign currently present on its checkout page URL.
CineGen keeps the initial Signal campaign hint in page memory through SPA
navigation. This adds no cookie, local-storage entry or analytics request.
A fresh page load, external login round trip, different device or return visit
can lose that hint. Those purchases remain unattributed rather than guessed.

**The checkout changes are local and have not been deployed.** Their tests use
isolated checkout callbacks. Live campaign metadata, real Stripe data reads,
renewal attribution and refunds still need validation against connected accounts.

## Sources and validation

- [Stripe Charge object](https://docs.stripe.com/api/charges/object?api-version=2024-06-20): captured amount, reported refunds, mode, currency, invoice and dispute fields.
- [List charges](https://docs.stripe.com/api/charges/list): bounded pagination and time windows.
- [List Checkout Sessions](https://docs.stripe.com/api/checkout/sessions/list): payment-intent lookup.
- [Metadata propagation](https://docs.stripe.com/metadata/use-cases): explicit metadata placement and subscription-to-invoice behavior, including the pinned 2024 API shape.

`tests/operations/revenue.test.ts` covers product isolation, test/live mismatch,
currency separation, refund updates, subscription invoices, campaign matching,
pagination, atomic snapshot replacement, restart, failure recovery, revocation,
read-only requests and secret/customer-data boundaries.

`node scripts/revenue-ui-smoke.mjs` exercises an isolated offline desktop profile
with simulated USD and JPY payments. It checks visible currency formatting,
business isolation, source edits, snapshot persistence and narrow layouts. Pass a
packaged `Signal.exe` path to test the packaged build.

Adjacent `functions/growth/campaign.test.js` files check bounded campaign values,
both real checkout callbacks with mocked dependencies, and the CineGen browser
hint without tracking storage. Existing checkout-credit and licence-isolation
regressions are also run. No real charge or purchase is created by these tests.
