# CineGen custom top-up attribution

Deployed: `createCheckoutSession` is ACTIVE with update time
2026-09-19T22:46:52.954883837Z, verified by a fresh Cloud Functions API read.
Only that function was deployed; Hosting and the Signal desktop binary did not
change. Deployment evidence is `data/stripe-topup-validation/deployment.json`.

September 19, 2026. CineGen's custom top-up checkout created a different Stripe
product for every purchase via `price_data.product_data`. Signal intentionally
scopes whole payments to a saved list of product IDs, so those purchases would
be excluded even when their campaign metadata was correct.

Custom top-ups now use `cinegen_custom_topup` in `price_data.product`. The amount
still comes from the server's USD 5–500 range and existing 40-tokens-per-dollar
conversion. The generic product name is accompanied by explicit token-count
text above the checkout submit button. PaymentIntent and Session campaign
metadata, affiliate attribution and the existing token ledger are retained.
The fixed product was provisioned separately in Stripe test and live modes.

## Verification

- The actual updated checkout callback created a Stripe sandbox session for USD
  7 and 280 tokens. The Stripe-hosted form was visually inspected in headless,
  GPU-disabled Chrome and completed with Stripe's published test card.
- Signal's real read-only connection, Stripe reader and revenue service found
  the captured 700 cents with the correct product and campaign. Re-sync did not
  double count; test/live mismatch was rejected, and the synthetic lead remained
  a trial. No marketing cash was created.
- Seven focused website tests pass, including the actual checkout callback,
  invalid amount rejection and exactly-once crediting of custom top-up metadata.
  These fulfillment tests use isolated storage; live token crediting was not
  exercised by the sandbox payment.
- TypeScript and targeted ESLint checks pass for the Signal helpers.
- A subsequent authenticated Firestore read confirmed that the synthetic buyer
  document was not created in CineGen's production database.
- At 22:45:38 UTC, the existing owner CineGen revenue mapping was extended from
  eight products to nine. The account, read-only restricted key, live mode and
  history window were preserved. A complete read-only scan inspected one charge
  and excluded it; no qualifying live revenue was found. CineGen remained paused.
  Previous revenue settings and snapshot were backed up before the change.

Evidence: `data/stripe-topup-validation/state.json`, `revenue-result.json`,
`cinegen-filled.png`, `owner-mapping.json`, and `owner-before-*.json`.
The test payment remains in Stripe's sandbox for inspection. It created no
subscription, real payment or live customer entitlement. The reusable test
product stays active for future test checkouts.

## Provisioning and scope

`CineGen/functions/scripts/ensure-stripe-topup-product.js` inspects test mode by
default; `--live` selects live mode. Adding `--provision` creates only the absent,
fixed product using an idempotency key. Existing entries must have the expected
mode and application metadata. This helper never creates prices or payments.

`node scripts/manage-owner-social.mjs --map-custom-topup` changes only CineGen's
existing product list while it is paused, preserves its other source settings,
then runs a complete read-only sync. If that sync fails, it restores the prior
configuration and snapshot unless a concurrent change superseded its revision.

The three `stripe-sandbox-*` helpers accept `--topup` for this separate test run.
The ordinary one-time/subscription evidence remains under
`data/stripe-sandbox-validation/`.

Only new custom top-up checkouts use the stable product ID. This change does not
rewrite historical Stripe products, past payments or existing open sessions.

Primary references: [Stripe product identity](https://docs.stripe.com/api/products/create),
[Checkout line items](https://docs.stripe.com/api/checkout/sessions/create),
[Stripe testing](https://docs.stripe.com/testing).
