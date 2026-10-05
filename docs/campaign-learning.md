# Campaign selection from measured results

Run now records why it chose the destination and topic direction for each cycle.
The decision appears in Operations, is supplied to the writing agent, and is
copied into the durable delivery. A settings change clears the pending selection;
the next cycle makes a new decision within the saved destinations and limits.

Without usable purchase evidence, Signal can use repeated positive GA4 visitor
observations to propose a follow-up experiment. If neither source supports a
decision, it rotates destinations by their most recent campaign and asks for a
distinct buyer problem. Missing tracking is never classified as a failed
experiment. Analytics purchase events never substitute for Stripe payments.

## Visitor-interest experiments before purchase evidence

The **Test visitor interest** decision works before Stripe is connected or any
payment has been attributed. It requires a verified, available GA4 connection
for this business, a complete unrestricted snapshot at most 36 hours old, and
matching property, account, hostname and observation metadata. Future-dated,
stale, sampled, thresholded, truncated or inconsistent reports cannot select a
topic. Report dates must match its property time zone and observation time.

Only confirmed publications at least seven days old when the report was read,
published within its calendar dates and the last 30 days, are eligible. Each
selected destination must have at least two mature publications with the exact
campaign tracking link intact. Only explicitly matched campaign rows contribute
observations. Missing rows display as unknown; they are not assigned zero traffic.
Signal uses the latest single snapshot and never adds overlapping snapshots.

A visitor-interest candidate needs at least two publications with 10 or more
engaged sessions each, and at least 40 observed sessions across its eligible
campaigns. Candidates are ordered by engaged sessions per observed campaign;
ties keep rotation. A campaign with repeated engagement supplies a reference
topic. The writer tests a distinct adjacent task using current product evidence,
not old copy as proof. An independent editorial check also compares the new
public body with the reference campaign: changing a headline, paraphrasing the
same feature or adding a CTA does not count as a new next step. After factual
review passes, a separate, short comparison identifies both reader actions and
classifies the new one as a repeat, a follow-up or an unrelated action. Only a
follow-up passes; otherwise the writer revises within its existing attempt limit.
The additional model call counts toward the configured API allowance. Unsupported
claims or Pause stop this comparison before it starts. The review and its explanation
are saved with the cycle's tool activity. This check also applies to purchase-
supported follow-ups. Internal analytics counts are not public marketing claims.

These thresholds are product heuristics for a bounded follow-up, not statistical
confidence, unique buyers, consent, causal attribution or proof of conversion.
Missing campaigns and unequal publication ages/exposure limit comparisons.
Engagement can result from time, views or configured key events; it need not
reflect purchase intent. A current report can still change as events process.

Purchase-supported decisions, including paid ties, take priority over this
weaker proxy. Every fourth cycle remains exploratory. No budget, spending,
interval or delivery cap increases. Corrections, disconnects and later reporting
limitations remove visitor focus at the next cycle. Saved deliveries retain the
evidence and decision used when they were queued.

## Purchase-supported allocation

With a verified Stripe connection, a complete live scan no more than 36 hours old
and a history start covering the last 30 days, Signal considers confirmed
publications aged 7–30 days. Every selected destination needs at least two such
publications, all with their campaign tracking links intact. This delays decisions
while publications collect observations. These are product heuristics, not
statistical confidence bounds or guarantees that an experiment has matured.

A destination becomes eligible for focus after at least three attributed live
payments across at least two publications. Fully refunded and disputed payments,
test records, unknown campaigns, other Stripe accounts, duplicate charge IDs and
payments preceding publication are excluded. Partially refunded payments count
once if they retain positive value. Counts include renewals and do not establish
unique customers, profit, current subscriptions, comparable exposure or causality.

Eligible destinations are compared by qualifying payments per mature publication.
Only a strictly higher observed ratio selects a focus destination; ties keep
rotation. Signal selects a paid publication as a reference topic and asks the
writer for a distinct adjacent task or next step, verified against today's product
source. It does not repeat the old copy or publish private payment results.
Every fourth cycle remains exploratory. Cycle numbers and evidence summaries
survive restart; stale/incomplete scans and later refunds can remove focus at the
next decision. Queued deliveries retain the decision made when they were created.

This is bounded, directional organic allocation, not a randomized test or proof
that one channel performs better. Website articles and social posts have different
lifetimes and exposure; those differences are not normalized. No destination is
disabled, and delivery limits, interval, budgets and spending permissions do not
increase. Copy fingerprints continue preventing exact repetition.

Bluesky posts now fail validation if adding the campaign tracking link would
exceed the character limit. The writing agent receives a request to shorten the
caption instead of silently dropping attribution. Previously published untracked
posts remain untracked.

## Evidence and research

- [GA4 Data API dimensions and metrics](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema)
  defines `sessionManualCampaignName` from `utm_campaign`, `sessions`, and
  `engagedSessions`. The app compares these visitor observations separately from
  payment records; configured key events can contribute to engagement.
- [GA4 data freshness](https://support.google.com/analytics/answer/11198161?hl=en)
  describes processing delays, changing attribution and late events. This informs
  the distinction between missing observations and failure; it does not validate
  this app's seven-day maturity or payment-count thresholds.
- [Stripe Charge object](https://docs.stripe.com/api/charges/object) defines live
  mode, captured and refunded amounts, and dispute flags used by the existing
  read-only revenue reader.

`tests/operations/learning.test.ts` covers persistence, cold start, observation
age, tracking gaps, fresh complete data, scope, payment exclusions, ties,
exploration, refunds and daily limits. Operations service tests check that the
decision reaches the saved delivery and tracked social links are not discarded.
The desktop smoke checks the decision explanation, narrow layout, business scope
and clearing a pending selection after settings change. These tests do not prove
marketing effectiveness; connected-account results are still unverified.

`SIGNAL_TRAFFIC_FIXTURE=1` selects synthetic visitor evidence for the existing
Operations UI smoke. `scripts/traffic-live-smoke.ts` runs a real CPU-only text
agent against current product source with synthetic analytics and an intercepted
Bluesky transport. Its reports explicitly identify the fixture observations and
simulated publication; they are not customer traffic or a real post.

`scripts/followup-review-live-smoke.ts` checks the editorial comparison separately:
a paraphrase of the same action must be rejected, while dragging generated shots
into a master storyboard is a documented next action after generating those
shots. This tests judgment, not merely valid JSON. Combining factual review and
action comparison caused CPU Gemma 4 E4B and Qwen 3.5 9B checks to reject a valid
next action. Separating those two checks let Gemma pass both fixed cases.
In a subsequent full CPU Gemma cycle, the comparison rejected two repetitive
drafts and accepted a distinct character-reference task. However, factual review
approved an overstated character-consistency promise. The simulated delivery
therefore passed the transport assertions but failed manual copy-quality review.
Deterministic revision checks now hold instant-generation wording and consistency
promises across every scene before model review and again at the queue boundary.
These are conservative checks for observed failures, not a general truth detector.
The queue also rejects invented business-link paths: a destination must use the
configured website path or a page inspected for this business in the current
cycle. Tracking queries and fragments are allowed; an older inspection cannot
authorize a new path. This catches malformed links such as affiliation text
being appended to the website URL. It is not a live availability check.
A subsequent CPU Qwen 3.5 9B cycle exhausted four writing attempts with no
approved delivery (`traffic-cpu-cinegen-1789749100593.json`). Its factual reviewer
rejected the character promises but also introduced plan and workflow claims
not made by the submitted copy. The run exposed the adverb "consistently" and
malformed destination paths; regression checks now cover both. The run began
before those last two fixes and is evidence of model limitations, not a successful
end-to-end validation of the final source. Neither tested small CPU model is
established as a dependable unattended writer/reviewer by these results.
Model availability alone does not establish editorial reliability. The
[MT-Bench judge study](https://arxiv.org/abs/2306.05685) documents limitations of
model-based evaluation, including reasoning limits and biases; it does not
validate Signal's models or campaign quality. A working model/provider and
representative local checks remain necessary.

September 25 follow-up: the current CPU Gemma 4 E4B reviewer accepted two supported
export drafts and rejected invented automatic YouTube publishing and free
watermark-free 4K exports. Each judgment took approximately 109–114 seconds.
However, one accepted draft's body was classified as nonfactual despite explicitly
promising timeline editing and export. Correct artifact-level decisions alone
would have hidden this skipped claim. The positive-fixture evaluation now requires
all three factual passages to be checked as supported; reassessing the saved
responses passes three of four cases. This is a remaining model-quality issue,
not evidence that autonomous editorial review is dependable. The CPU runtime was
stopped after this bounded run. No content was delivered or published.
See `data/operations-validation/copy-review-assessment-1790355711143.json`.
