# Campaign continuity through checkout

**Deployment checkpoint, September 19 at 22:25 UTC:** both website updates and
their checkout functions are deployed. Lemonade Hosting version
`ef684db71536efb4`, CineGen Hosting version `2bf5fb4ce28fe1e8`; functions
`createCheckout` and `createCheckoutSession` report ACTIVE with update times
22:20:50 and 22:22:19 UTC. See `data/checkout-deployment/deployed.json`.
Live source checks pass for both sites. Real desktop/mobile browser checks retain
the campaign after navigation; Lemonade's actual buy handler sends the expected
field in two intercepted requests. Every non-GET browser request was blocked,
so no Stripe Checkout Session or payment was created. The real paid-customer
journey remains unverified. Signup scripts match the expected live hashes and
both pages pass read-only browser checks.

September 19, 2026. The source implementation now keeps a validated Signal
campaign ID and expiry in same-origin sessionStorage for up to 30 minutes.
Full-page navigation and authentication returns in the same tab can retain it;
an unrelated browser context cannot. The getter checks expiry at checkout time,
including in a long-lived SPA. A new explicit source or campaign supersedes the
previous hint; invalid or ambiguous tags clear it. Storage failures leave the
current page usable and never prevent a purchase. No email, authentication token,
browsing history, cookie, localStorage entry or tracking request is added by this
helper. Existing affiliate-referral behavior remains separate.

The canonical helper is `CineGen/public/campaign-attribution.js`. Identical copies
prefix both sites' `referral.js`, because server-rendered writing and signup pages
already load that script. The helper initializes once when both scripts are
present. Keep the copies identical; the continuity regression enforces this.
Lemonade's homepage reads the getter when creating checkout. CineGen's existing
source billing hook reads the compatible `signalCampaignHint` property.

Email verification includes validated campaign/source parameters in its
same-origin continuation URL. It removes authentication parameters while retaining
those public campaign parameters, so the later referral helper can pick them up
after verification in a fresh tab. Consent is still a separate unchecked choice.

## Local evidence

- `node scripts/campaign-continuity-check.mjs`: executes the actual three helper
  copies and Lemonade buy handler; verifies navigation, expiry, replacement,
  malformed storage, duplicate script loading, unavailable storage and the
  checkout request's campaign field. No real requests or payments.
- `node scripts/prospect-attribution-check.mjs`: both visitor scripts preserve
  a valid campaign across fresh email-link contexts, remove authentication URL
  parameters and reject invalid/ambiguous checkout hints.
- `node --test ../CineGen/functions/growth/campaign.test.js ../Lemonade/functions/growth/campaign.test.js`:
  five tests pass, including the actual checkout callbacks putting campaign
  metadata on Checkout Sessions, PaymentIntents and subscriptions as applicable.
  Stripe and authentication are fixtures.
- `Lemonade/scripts/prospect-browser-check.cjs`: real headless Chrome executes
  the visitor/referral scripts for both businesses, with simulated email
  verification, separate opt-in and opt-out. Desktop/mobile pass with no renderer
  errors or real emails.
- Targeted ESLint checks pass for the Signal validation scripts.

## Earlier production gaps, now deployed

The public read-only audit at 22:04 UTC found:

- Lemonade's live homepage checkout sends only the existing referral token;
  it does not send a Signal campaign ID.
- CineGen's `/campaign-attribution.js` returns the SPA HTML fallback despite
  HTTP 200. Its homepage does not load that script. The inspected main bundle
  does not prove checkout campaign wiring; lazy chunks are not proof either way.
- Neither site's live referral or signup script has this continuity fix.
- Backend checkout function revisions remain unverified. No test-mode checkout
  or payment was created, and no campaign revenue is claimed.

`node scripts/campaign-production-check.mjs` records these observations under
`data/campaign-production-validation/result.json` and exits unsuccessfully while
browser wiring is missing. It checks MIME/content as well as HTTP status. Even a
passing public-source check is not an end-to-end sales acceptance check.

Firebase reauthentication was subsequently completed by the owner. The live
changes and validation results are recorded in the checkpoint above.

`deploy-prospect-hosting.cjs` updated the signup scripts first. Lemonade's
`deploy-campaign-hosting.cjs` then changed only its live homepage checkout
expression and two visitor scripts, preserving all 31 other file hashes and
the existing Hosting configuration. Its original-homepage check uses the Firebase
CLI's gzip level 9. CineGen's existing build retained prior asset generations;
the frontend diff was reviewed and a temporary Hosting config selected only
`cinegen-12360`. Other hosting sites and non-checkout functions were not deployed.
No full-attribution claim is justified until a Stripe test-mode checkout-to-reader
path and actual payment observations are verified.

Browser session behavior and blocked storage are described by
[MDN sessionStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage).
[Stripe metadata](https://docs.stripe.com/metadata) documents the separate object
fields used for checkout/subscription/payment metadata. Campaign values are
visitor-supplied hints; matching them is not proof of causality or entitlement to
an affiliate commission.

A later reader audit strengthened the subscription-renewal regression: a known business campaign is matched from the invoice subscription snapshot without looking up a one-time Checkout Session. Conflicting invoice and subscription hints remain unknown while the captured payment stays recorded. All 22 revenue tests passed. These are mocked provider responses, not a real Stripe payment or deployed website verification.
