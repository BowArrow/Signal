# Website requests into Signal

Lemonade and CineGen have a deployed `/get-started` page and `/api/prospects/*`
backend. Visitors verify their email through Firebase email-link authentication,
then separately choose whether to receive product guidance and promotional
follow-ups, including personal messages from the business's AI assistant.
Verification alone does not subscribe them. The form also lets them stop emails.

Production deployment completed on September 18, 2026 (Pacific time). Both signup
pages, visitor-script hashes, public policy endpoints and authenticated metadata
and change endpoints were verified live. Unauthenticated metadata requests return
401. Desktop and mobile rendering passed with no JavaScript exceptions. No real
verification email was sent and no contact was created during these checks;
real inbox delivery and visitor consent completion remain unverified.

The prepared Lemonade script `scripts/deploy-prospect-hosting.cjs` plans the
Hosting update without writing by default. After deploying `prospectApi`,
`prospectSignup`, and `writing` in each project, `--deploy` publishes the visitor
script and two rewrites using the current live release as its base. It checks
that every existing file hash is retained, records the prior release for rollback,
and enables email-link authentication without disabling password login. Its
production releases preserve all 33 existing Lemonade files and all 199 existing
CineGen files. Email-link authentication is enabled in both projects. Hosting
versions: `siplemona-de/447c2df2735633c7` and `cinegen-12360/8ed35ca0712360ad`.
Previous versions for rollback: `siplemona-de/ec67e27afae12585` and
`cinegen-12360/ff3869353f460eb0`. Live evidence is in
`data/prospects-production-validation/result.json` and its viewport captures.

## Connect and operate

1. Connect the business's existing website in Connections with its publishing key.
2. In Sales, choose Website requests, select that connection, and confirm Signal
   may read this business's contact and consent records. Enable and save the source.
3. Configure the sending inbox and outreach policy, then Run Operations. Website
   requests and the existing Mailchimp source can run independently side by side.
4. Open the website signup page from Sales to inspect the visitor experience.

Operations polls every five minutes while running. A monotonic change sequence,
fixed scan head and saved page cursor preserve updates across pauses and restarts.
Each page imports at most 100 changes transactionally. Gaps, unexpected businesses,
credential reflection and malformed records hold that page without importing it.

Only the supported consent version and exact product-specific consent text permit
outreach. Current verified email status, recorded opt-in, task and source are kept
with the lead. Existing leads keep their stage, notes and permission. Matching
known Stripe buyers enter as customers. Visitor-supplied campaign identifiers are
recorded as unverified notes, not payment attribution or evidence of effectiveness.

Every email write to a linked contact rechecks their current source record. Missing
or disabled users, changed email, revoked consent, unavailable sources and local
suppression hold delivery. Where both sources link a contact, both checks must
pass. Source changes or disabling hold those linked contacts; a new signup does
not silently remove a previous local opt-out. The existing reply-to-stop workflow
suppresses locally; it does not write back to the website or Mailchimp.

## Deployment maintenance

The shared backend is maintained in Lemonade's `functions/growth/prospects.js`.
`scripts/sync-growth.cjs` copies it and the visitor script to CineGen. Both
`functions/index.js` files export `prospectApi` and `prospectSignup`; Hosting
rewrites route `/api/prospects/**` and `/get-started` to those functions.

Required production setup:

- Deploy the two functions and the corresponding Hosting rewrite/static script for
  each business. Preserve unrelated website changes when preparing that deployment.
- Enable Firebase email-link sign-in in each project and authorize its real domain.
  Check the email action/continue URL returns the sign-in code to `/get-started`.
  The website loads its public Firebase API key from `/__/firebase/init.json`.
- Use each project's existing `SIGNAL_PUBLISH_KEY` secret. This key can now read
  prospect records through the new API; it cannot change visitor consent. Signal
  does not read prospect data until the source is explicitly configured.
- Keep Firestore client access denied for `websiteProspects`,
  `websiteProspectChanges` and `websiteProspectState`. The current repository rules
  give these collections no client access; writes go through the verified backend.
- Complete a real visitor verification and consent/revocation check before calling
  the source live. Inspect the production form and callback on desktop and mobile.

The backend stores current contact/consent records and immutable change history.
Neither a data-deletion workflow nor automatic retention pruning is included in
this checkpoint; do not delete sequence entries without a compatible reset or
tombstone protocol. Account deletion or loss of verified email blocks the current
contact read, but does not by itself remove previously imported records.

## Validation and references

The backend's Node tests cover authorization, separate consent, idempotent saves,
immediate opt-out, cooldown, fixed snapshots, pagination, deleted identities and
invalid input. Signal tests cover import, restart cursors, changed consent,
multiple sources, pre-send checks, suppression and purchase matching. Browser
checks render both businesses at 1440×1000 and 390×844 with simulated authentication
and no real email. The Firebase Auth emulator separately exercises the actual
email-link exchange and Admin SDK token verification with an isolated demo project.
Desktop checks use software rendering and an offline synthetic profile.

Sources: [Firebase email-link authentication](https://firebase.google.com/docs/auth/web/email-link-auth),
[send email-link request](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/accounts/sendOobCode),
[complete email-link sign-in](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/accounts/signInWithEmailLink),
[verify ID tokens](https://firebase.google.com/docs/auth/admin/verify-id-tokens),
[Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions),
and [query cursors](https://firebase.google.com/docs/firestore/query-data/query-cursors).
