# Signal: completion means an operating acquisition loop

Owner objective: sell Lemonade to solo customers and small businesses without requiring an existing social following. Start with zero cash and use a controlled share of eligible sales for paid acquisition. CineGen remains a separate business with separate product claims, senders, attribution and funding.

An app build, a completed draft and a provider receipt are distinct milestones. None proves a sale. No revenue guarantee is part of this completion contract.

## Required outcomes

1. **Acquire:** Find a concrete buyer problem and a permitted route to the buyer. Respond through a connected account with affiliation and a relevant useful answer. Never reinterpret an incompatible request to fit the product. Maintain partner/community opportunities separately from email leads. A website article alone does not establish distribution.
2. **Convert:** Show the actual product solving a small task; use current offer, platform and trial facts. Capture interested visitors, answer questions, provide the next product step and stop sales follow-ups after a matched purchase or opt-out. Reuse approved demos and video rather than continually producing disconnected prompts.
3. **Measure:** Track the campaign link through the website and qualifying Stripe checkout. Distinguish visits, requests, trial activation, purchases, refunds and acquisition costs. Attribute only records carrying reliable campaign evidence. Unattributed sales can fund the business but do not establish which channel won.
4. **Fund:** Derive a cumulative allowance from product-scoped live payments with known fees, tax and settlement. Apply the owner's hold, operating reserve, cash reserve, reinvestment percentage and cap. Deduct prior spend and reservations once. Later refunds and disputes reduce eligibility. Zero funds means zero new paid commitments.
5. **Buy reach:** Create an exact paid experiment with reviewed copy, audience, destination, provider-native total budget and end date. Validate access and billing, reserve its full liability, reconcile uncertain API writes, collect spend and conversion evidence, and stop or revise weak tests. Never substitute an average daily budget for a hard total. Account billing is separate from Stripe reads.
6. **Operate:** Resume durable work after restart, show the current action and result, and escalate only missing access, consequential business decisions or uncertain delivery. Make background behavior and Pause explicit. A local computer that is off cannot run its agents; hosted operation needs a separate deployment decision and credential/runtime design.

## September 26 implementation evidence

- Existing app: website publishing, connected social posting, opted-in initial email, inbox response/follow-up, website lead capture, Stripe revenue and GA4 reads, durable delivery/reconciliation, local or API agent configuration, campaign material and video tooling.
- 0.37 adds connected Bluesky search and direct replies to recent original requests. It uses product-fit qualification and independent copy review, a live thread check, three initial replies per rolling day across businesses, and no repeat approach to the same author within 30 days. It does not require followers. Live authenticated search worked; publication tests used intercepted provider APIs.
- 0.37 adds the sales-derived funding calculation and owner controls. It does not add paid ad execution. Financial fixtures verify duplicate prevention, deductions, pending/unknown evidence, refunds, reservations and stale-source behavior. No live sale is inferred from fixtures.
- Broader local-model evaluation, live funnel observations, paid campaign execution, partner/community acquisition routes and unattended hosting remain unfinished. Existing connections alone do not establish these capabilities.

## Next implementation order

1. Ship and inspect the qualified-request route; evaluate actual qualification and reply quality before increasing its one-per-day owner policy. Monitor relevant requests and no-fit outcomes, not a posting quota.
2. Verify website request and checkout attribution through the deployed sites. Observe processed GA4 results and preserve Stripe campaign metadata without creating a fake live sale. Connect approved product demos to the same tracked destinations.
3. Implement Google Search as the first paid adapter. It reaches active search demand without requiring followers. Onboarding needs an accessible Google Ads customer, billing and developer-token access. Draft/review, `validate_only`, paused provisioning, funded activation, spend reconciliation and stopping are separate acceptance tests. An account is not yet connected in Signal as of this audit.
4. Expand targeted partner and community routes with actual destination access and placement receipts. Do not claim an arbitrary Facebook group or third-party listing is automatically publishable. Measure each route's leads and paid outcomes before expanding.
5. Consolidate these actions into Run marketing and its outcome view. A successful completion exercise must demonstrate research, supported creative, actual permitted delivery, a received inquiry, response handling, observed attribution, and a funded paid test lifecycle. Test mode, live delivery and a real customer purchase must remain clearly separated.

## Research used for the current change

- [Bluesky search lexicon](https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/feed/searchPosts.json) and [post/thread definitions](https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/feed/defs.json): original post identifiers and current thread permissions.
- [Bluesky Community Guidelines](https://bsky.social/about/support/community-guidelines): avoid spam and deceptive affiliation.
- [Stripe balance transactions](https://docs.stripe.com/api/balance_transactions/object): fee, net, availability and source evidence; availability is not a bank-balance claim.
- [Google Ads campaign budgets](https://developers.google.com/google-ads/api/docs/campaigns/budgets/overview) and [creating total budgets](https://developers.google.com/google-ads/api/docs/campaigns/budgets/create-budgets): Search supports campaign totals for dated campaigns. Use provider validation and current account eligibility before enabling any campaign.
