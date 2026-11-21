# Signal sales audit — 12 November 2026

## Conclusion

The strongest supported explanation is insufficient qualified distribution, compounded by broken account access and incomplete measurement. Signal has generated substantial internal activity without establishing a repeatable path from a buyer problem to a live placement, useful product experience and payment. The evidence does not establish that price, checkout, product quality or the market are the main cause. Eight measured sessions cannot decide those questions.

This is an audit and implemented repair, not a claim of new sales. Source, installation and provider authorization are separate states.

## Current evidence

| Observation | What it tells us | Limits |
| --- | --- | --- |
| Lemonade GA4: 8 sessions, 0 engaged sessions, no tracked funnel events, Oct 13–Nov 11 | Very little measured traffic; no observed activation funnel | Sessions are not people; consent, filters and missing instrumentation can suppress observations |
| CineGen GA4: latest complete saved report Oct 3 | Current website performance is unknown | Configured authorization fails; other saved Google accounts cannot read the property |
| Fresh product-scoped Stripe snapshots: 0 stored payments | No payments found in the selected product scope | Not a company-wide revenue audit |
| Operations: 4 lifetime publication receipts, latest Sep 30; none in last 30 days | Signal's delivery engine has produced little verified distribution | An account-level Metricool check separately found 3 Bluesky posts Oct 25–27; the ledger misses external/manual publishing |
| 344 completed analysis tasks; 105 marketing tasks; 172 opportunity tasks | Internal activity greatly exceeds verified placement activity | Task counts are not impressions, acquisition or sales |
| 24 prospects; all contact permissions unknown | A research list exists | It is not an opted-in mailing list; 9 Lemonade records are marked contacted, not confirmed conversions |
| Both saved Bluesky sessions fail live checks | Saved “verified” badges did not prove current publishing access | Public research need not depend on these credentials |
| Current Lemonade research: 13 assessments, none suitable | Existing keyword strategy has not identified a qualified buyer request | Loosening qualification would create irrelevant promotion, not demand |
| Affiliate flags enabled, Connect/payout flags false | Affiliate distribution is not ready to promise | No payout readiness or partner reach has been demonstrated |

Evidence files: `output/marketing-audit/2026-11-12.json`, `output/marketing-audit/connections.json`, and `output/analytics/owner-diagnosis.json`. Initial saved statuses and later live authentication results differ; use the latter for connection health. Connected Metricool data was read separately and is not included in the Operations ledger.

## Why the marketing system stalls

1. **Research completion is being mistaken for progress toward a sale.** The durable unit of progress should be an observed placement or buyer conversation, its resulting visits, and a verified first useful task. A drafted article or enabled campaign provides none of those by itself.
2. **The acquisition strategy has no effective escape from empty searches.** It repeatedly waits for narrow public queries to produce suitable questions. Public source failures and rejected Bluesky credentials compound this. A source returning zero results must trigger a bounded alternative placement, not another generic strategy report.
3. **Access recovery was missing from the interface.** The user was told to reconnect, but existing account cards had no reconnect action. Disconnecting and adding a new account would risk breaking saved campaign references.
4. **Measurement cannot distinguish poor activation from unobserved activation.** CineGen's report is stale; Lemonade has no recorded trial/task events in this range. A stale zero must never become a current zero. Aggregate event counts are not a linked conversion cohort.
5. **The positioning needs a specific reason to choose a paid product.** “Local AI for private documents” overlaps free alternatives. AnythingLLM offers a free desktop product, while LM Studio now describes local document and agent workflows. A generic privacy promise is not demonstrated differentiation. The useful hypothesis is less setup and a dependable, source-verifiable task for a particular person; that hypothesis still needs observation. See [AnythingLLM](https://anythingllm.com/) and [LM Studio](https://lmstudio.ai/).
6. **The system retained outdated commercial facts.** Lemonade's old $49 perpetual offer must not drive new copy. The live offer observed November 12 is $149/year or $15/month per person, with a 14-day trial. Existing assets with old pricing require review before reuse. See [Lemonade](https://siplemona.de/).

April Dunford's positioning method starts from the alternatives customers actually consider, then identifies differentiated value and the customers who care about it. Applied here: compare against manual document comparison and existing local tools before asserting that privacy alone wins. This is a positioning hypothesis, not evidence of demand. [Positioning quickstart](https://www.aprildunford.com/post/a-quickstart-guide-to-positioning), [Positioning and competition](https://www.aprildunford.com/post/positioning-and-competition).

Channel selection should consider reach, intent, context, effort, cost and time. At this stage, one reachable placement plus observed task feedback is more informative than producing additional unplaced videos. Demand Curve also distinguishes experimentation that produces learning from activity alone. [Channel evaluation](https://gp.demandcurve.com/lessons/how-to-evaluate-channels), [Experimentation guidance](https://www.demandcurve.com/newsletters/growth-newsletter-317).

## Implemented in Signal 0.59.2

- Added **Reconnect** on existing Bluesky and Google Analytics cards. Bluesky verifies the replacement session belongs to the same account; shared business links retain their IDs. Failed replacements leave prior credentials intact. Google sign-in preserves the selected account ID and explicitly prompts for account selection and consent. Reconnection is followed by a property-level Analytics refresh; a successful account read is not proof of property access.
- Public Bluesky discovery no longer requires a publishing session. Authenticated Bluesky reads retry once after a rejected access token. Public endpoint access can still fail; errors remain visible and no delivery permission is expanded.
- One failed selected account no longer blocks all read-only acquisition research. Delivery still validates the destination actually selected.
- Added a bounded stalled-acquisition recovery task after at least two hours without an eligible request or recent delivery. It researches and saves a finished brief, deduplicates per campaign revision, permits one delayed failure retry, and stops when paused, replaced or expired. Its tools cannot send, publish, spend or change campaign settings.
- Suppressed redundant broad product-analysis scheduling while Operations owns the product's active work. Opportunity discovery remains enabled.
- Added evidence-based next steps for broken access, unknown measurement, low reach, unobserved activation and mature-trial review. The 50-session threshold is a prioritization heuristic, not a conversion benchmark or statistical test.
- Marked reports stale when their account/property/hostname changes or status is no longer current. Added specific reconnect/property-access guidance while retaining prior evidence.
- Enabled the existing public search fallback for marketing research when no SearX instance is configured.
- Fixed a live-discovered persistence failure: substantive briefs could exceed the old 4,000-character draft limit. Saving and editing now share a bounded 16,000-character limit. Manual retries retain the original recovery restrictions and tracking. The guided conversation shows a plain-language recovery message instead of internal instructions.
- Added a recovery quality gate after reviewing actual generated work. A completed recovery requires a concrete HTTPS placement, substantive pages actually read in that task, current product evidence, finished copy and explicit unverified-demo status. Placeholder links, unread rules, unsupported character-consistency promises and free/paid confusion are rejected. These checks reduce specific observed failures; they do not replace human editorial review or establish placement permission.
- Updated the bundled Lemonade offer and expanded the audit's task, delivery and discovery coverage.

## The next acquisition experiment

Start with Lemonade's existing audience: people actively comparing local desktop assistants for private document work. Do not simultaneously spend effort scaling both products or producing avatars. CineGen first needs current measurement; its free-editor offer can support a separate later task test. [CineGen offer](https://cinegenaimedia.com/).

**Buyer/task hypothesis:** a Windows or Linux user who repeatedly checks changed figures across two reports and needs to verify every answer against a source. Their alternatives are manual side-by-side review and an existing local document assistant. Do not claim a unique or faster workflow until tested.

**Demonstration:** use the two clearly synthetic reports in `campaigns/sales-recovery-2026-11-12/`. Ask for changed figures with filenames and exact supporting quotes, then an intentionally unanswerable question. The expected answer key is supplied. Record whether indexing completes, references open, answers are correct, and missing information is acknowledged. Do not publish a claim that this demo passed until it has been run in Lemonade.

**Primary placement:** prepare a founder-authored Show HN submission around a working product people can actually try. The official rules require something substantive, not simply a landing page or signup; the author should be available to discuss it. The existing no-account trial helps, but the product demonstration and appropriate linked destination must be checked first. Account access, acceptance and reach are unverified. [Show HN rules](https://news.ycombinator.com/showhn.html).

**Fallback placement:** a factual AlternativeTo product listing, with an accurate offer, operating systems and current screenshots. Submission requires an account/verified email and moderation; neither publication nor traffic is promised. Do not manufacture ratings. [AlternativeTo FAQ](https://alternativeto.net/faq/).

**Measurement:** use distinct UTM source, medium, campaign and content values for each placement. Verify one consenting tagged visit appears in GA4 before interpreting absence of results. Record a placement URL and timestamp; downloads/trials; volunteered first-task results; stated alternatives and objections; and product-scoped settled payments. Do not add private-document telemetry or treat unrelated aggregate events as a linked funnel. [Google campaign URL guidance](https://support.google.com/analytics/answer/10917952).

**Seven-day operating window, beginning with a verified live placement:** spend at most two hours verifying access/rules and preparing one placement; if it cannot go live, switch to the fallback instead of repeating research. Aim to observe five voluntary trial attempts—an operational learning target, not an expected conversion rate. If exposure produces no relevant visits, fix placement/message. If relevant visits do not start the trial, investigate offer/download friction. If trials cannot complete the task, fix the observed onboarding/product problem. If useful trials do not purchase, ask about the current alternative, frequency of need, trust and price.

**Purchase window:** allow each Lemonade trial its full 14 days plus a short follow-up observation period. A user starting on day 7 cannot fairly be judged a failed paid conversion on day 7. Stop or revise based on observed objections; do not automate unsolicited follow-ups. Never call the experiment live until its placement receipt exists.

## Software decision

| Tool | Decision now | Reason |
| --- | --- | --- |
| Signal + existing GA4 + Stripe | Repair and use | Already holds campaigns, prospects and payment/traffic evidence; access and trustworthy interpretation matter more than another dashboard |
| Existing Metricool connection | Keep for scheduling/account-level cross-checks | Already connected; reconcile its publication URLs into the evidence ledger manually until an import is implemented. [Plans](https://metricool.com/pricing/) |
| Buffer | Alternative, not an additional subscription | Overlaps scheduling; changing schedulers does not create distribution. [Plans](https://buffer.com/pricing) |
| HubSpot CRM | Defer | Signal already has a small prospect/conversation workflow. Add a CRM when pipeline volume or shared ownership requires it. [CRM](https://www.hubspot.com/products/crm) |
| SparkToro | Optional audience research | Could identify reachable publications and communities; audience affinity is not verified purchase intent. No subscription purchased. [Product](https://sparktoro.com/) |
| PostHog | Consider only if current measurement cannot answer a specific question | Funnel analysis can help a consenting website flow. Do not silently instrument private desktop document activity. [Funnels](https://posthog.com/docs/product-analytics/funnels) |
| More AI video/ad software | Defer | Existing distribution and access are the immediate constraints. Additional rendering capacity cannot supply qualified buyers |

## Verification and remaining work

The final full suite passed: 82 files, 1,605 tests. TypeScript, production build and lint on the changed source/test files passed. Packaged reconnect and guided-flow checks passed at widths 1440, 900, 720 and 390 with zero renderer errors. Signal 0.59.2 was installed with matching installer/application hashes; database backups are recorded in `data/operations-validation/release-0.59.2.json`.

Repository-wide lint remains failing because it includes downloaded runtime/generated trees and unrelated files; this is not reported as a clean full lint run.

During this work, the owner reconnected Bluesky successfully; both shared business links became verified. A new Google login could access Lemonade but returned HTTP 403 for CineGen property 498970669. CineGen needs a Google account with property access; repeating consent for the same inaccessible account cannot supply that permission.

The source comparison demo has an answer key but is not yet product-verified. An actual isolated Lemonade readiness check returned LICENSE_REQUIRED (expired trial) and no selected model; no inference or comparison success was claimed. Receipt: `output/marketing-audit/demo-readiness.json`. Four manually prepared drafts were saved in the installed owner database. Lemonade's first autonomous attempt failed the old body-size limit; after that fix, it saved a detailed but placement-blocked brief. CineGen's autonomous draft contained a placeholder placement and blurred free/paid features. That weak draft was rejected; the useful Lemonade research was retained. The repaired workflow requests source-checked replacement briefs within the existing research-and-draft scope. Saving any of these drafts is not a verified placement.

No new public placement, outreach message, paid subscription or sale is claimed by this work. Those boundaries prevent internal preparation from again being counted as customer acquisition.

Final live validation: Lemonade's replacement recovery completed in the installed 0.59.2 application, with successful product inspection, a substantive Show HN rules read and a saved brief. Editorial review aligned its synthetic figures with the supplied files and clarified Linux architecture and founder affiliation. The resulting artifact is `output/marketing-audit/lemonade-recovery-reviewed.json`; its placement and demonstration remain unverified. CineGen's replacement was still processing at this checkpoint. Its rejected draft is retained as evidence, and the separate manually prepared first-edit test is available for review.

Installation and validation summary: `output/marketing-audit/implementation-receipt.json`.
