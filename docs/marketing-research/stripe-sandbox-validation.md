# Checkout to revenue: Stripe sandbox validation

Verified September 19, 2026 at 22:39 UTC. Two actual Stripe-hosted test payments
completed using Stripe's published Visa test card. The actual Lemonade one-time
checkout callback and CineGen Creator subscription callback created the sessions.
Their campaign IDs reached Signal's real connection service, Stripe reader and
revenue service without replacing Stripe responses with fixtures.

| Case | Captured test amount | Refunded test amount | Result |
| --- | --- | --- | --- |
| Lemonade one-time checkout | USD 49.00 | USD 10.00 | Correct product and campaign; partial refund visible |
| CineGen Creator subscription, first invoice | USD 19.00 | USD 0.00 | Correct product and campaign through invoice subscription metadata |

These are synthetic transactions with no real money. They are not customer
acquisition, business revenue or proof of the full live visitor journey.

## What ran

- The checkout callbacks were evaluated directly from the current website source
  with their real campaign-metadata helpers. Source SHA-256 hashes and submitted
  parameter structures are retained in the evidence.
- Test credentials stayed in process memory. Every helper rejects non-test keys
  without echoing their values. The Stripe API also reported `livemode: false`.
- Lemonade used a new isolated test product and USD 49 price in the available
  AIon X Stripe sandbox. CineGen used its existing test Creator price. This does
  not validate Lemonade's live catalog, licensing webhook or separate account.
- Authentication and Firestore dependencies were isolated. The test customer used
  `example.invalid`; no real email address, Firebase user or license was created.
  A subsequent authenticated Firestore read confirmed the synthetic CineGen user
  document does not exist.
- Both checkouts ran in headless Chrome with GPU disabled, fresh profiles and no
  visible browser. The Stripe Sandbox label was checked before submitting the
  published test card. Success redirects went to an intercepted inert page rather
  than either production application.
- Signal ran against an in-memory database and vault. Both business campaigns and
  synthetic trial leads existed only there. All of its Stripe requests were GETs.
  The deployed website callbacks use the 2026 API shape; the reader requests its
  pinned `2024-06-20` shape. The real first subscription invoice was read correctly.
- Each business included only its own payment. Repeated sync did not double count.
  Correct campaign IDs and exact-contact hashes were available; test payments did
  not convert trial leads into real customers or add spendable marketing cash.
  Configuring a live scan with the test key produced an attention state and no
  live payment snapshot.
- The Lemonade partial refund was then issued in test mode and read correctly.
  The test CineGen subscription was canceled and cancellation verified by GET.
  The temporary Lemonade price and product were archived. Test receipts remain
  available for inspection; neither business's owner revenue settings changed.

## Webhook separation

The existing test Stripe webhook points to CineGen's deployed `stripeWebhook`.
Before generating events, the helper verified that deployment is ACTIVE, runs in
live mode and uses `STRIPE_LIVE_WEBHOOK_SECRET`. Test and live webhook signatures
are separate. No endpoint was disabled or reconfigured. This test intentionally
does not establish successful fulfillment through that deployed webhook.

## Reproduction and evidence

The retained run is `signal_1789857229161`. Scripts:

1. `node scripts/stripe-sandbox-check.mjs --prepare` creates test sessions using
   idempotency keys and saves state after each object. It refuses a cleaned run.
2. `node scripts/stripe-sandbox-browser.mjs lemonade --pay` and the corresponding
   `cinegen` command complete only open sandbox sessions. Without `--pay`, they
   inspect the hosted form without submitting it.
3. `node scripts/stripe-sandbox-check.mjs --status` refreshes saved session state.
4. `node node_modules/tsx/dist/cli.mjs scripts/stripe-sandbox-read.ts` runs the real
   read-only revenue path. This can still inspect the completed, cleaned run.
5. `node scripts/stripe-sandbox-check.mjs --refund` creates the bounded USD 10
   test refund once; repeating it does not issue another refund.
6. `node scripts/stripe-sandbox-check.mjs --cleanup` cancels the test subscription,
   expires unfinished sessions and archives only the temporary test product/price.

Evidence is under `data/stripe-sandbox-validation/`: `state.json`,
`revenue-initial.json`, `revenue-result.json`, and checkout/result screenshots and
DOM summaries for both businesses. State has no API keys. Signal's owner database
and encrypted account vault were never opened by these helpers. The test key was
read from CineGen's local functions environment file.

TypeScript and targeted ESLint checks pass. No production app binary changed.

## Remaining acceptance

Real visitor email-link delivery, customer authentication/consent, fulfillment,
conversation delivery and a real captured payment are still separate acceptance
items. Subscription renewal timing, discounts, taxes, mixed baskets, custom
top-ups and disputes were not exercised in this sandbox run. Existing fixture
tests are not substitutes for those live integration cases.

The later [custom top-up run](custom-topup-attribution.md) separately verified and
fixed that checkout path, and deployed the resulting change.

Primary references: [Stripe testing](https://docs.stripe.com/testing),
[Checkout Sessions](https://docs.stripe.com/api/checkout/sessions/create),
[metadata propagation](https://docs.stripe.com/metadata),
[webhook signatures](https://docs.stripe.com/webhooks/signature).
