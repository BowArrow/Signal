# Website lead verification: campaign continuity

Update at 22:25 UTC: Firebase access was refreshed, the visitor fixes were deployed
to both websites, and production script hashes plus desktop/mobile signup checks
pass. The checkout changes are also deployed; see [checkout attribution](checkout-attribution.md).
Verification emails and payments were not sent or created by these checks.

September 19, 2026. The live read-only website check passed for both Lemonade and CineGen at desktop and mobile widths: signup pages and policy endpoints load, the visitor scripts match their expected hashes, and private prospect metadata requires authentication. No form was submitted, email sent or contact created.

The subsequent source audit found that campaign IDs survived only in the landing tab's sessionStorage. Firebase email verification opened in a new tab/browser could lose that data because sendOobCode used a plain /get-started continuation URL. The prepared fix passes the campaign ID through the continuation URL and accepts it only from the same origin and /get-started path. Email addresses and authentication tokens stay out of that URL. Malformed IDs and unrelated continuation URLs are ignored. Browser storage failure no longer prevents email verification; the visitor can re-enter the email address.

Updated source files:
- Lemonade/site/prospect-signup.js
- CineGen/public/prospect-signup.js

Validation:
- Signal/scripts/prospect-attribution-check.mjs runs the actual browser scripts with simulated authentication and HTTP. Both businesses preserve campaign IDs in a fresh context and with storage disabled, reject unrelated/invalid continuation URLs, and require explicit opt-in after verification.
- Lemonade/scripts/prospect-browser-check.cjs now clears sessionStorage between the initial request and email-link completion, uses the returned continuation URL, and verifies the saved prospect campaign. It passed desktop/mobile checks, separate opt-in and opt-out, without real emails.

Deployment is pending. The existing Firebase credentials failed refresh. Google Cloud auth also requires reauthentication after using the existing portable Python executable to launch gcloud; no global Python setting was changed. The owner was asked to run firebase login --reauth. Do not claim the fix is live until the Hosting deployment and production hash checks succeed. The existing deploy-prospect-hosting.cjs clones each current release, replaces only prospect-signup.js, verifies preserved hashes and rejects a concurrent deployment before publishing.

Firebase documents passing state with the email link's continuation URL and warns against placing the user's email in redirect parameters: https://firebase.google.com/docs/auth/web/email-link-auth . API contract: https://firebase.google.com/docs/reference/rest/auth#section-send-email-signin .

A retained campaign is visitor-supplied attribution data. It is not independent proof of campaign causality, a delivered sales conversation or a payment. Actual email delivery and the complete customer-to-Stripe journey remain unverified.
