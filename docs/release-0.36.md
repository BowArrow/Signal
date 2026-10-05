# Signal 0.36: qualify customer problems before producing campaigns

Customer acquisition mode separates buyer research from publishing. A completed research cycle can find no suitable request or report missing audience access. It cannot substitute an unrelated promotional post to fill a delivery quota.

- Checks recent public requests against current product text and the saved business audience. Suitable decisions require exact request and product excerpts. Unsupported requests are retained to avoid repeatedly spending model calls on the same question.
- With no existing audience, a connected social feed is not selected as a source of reach. A selected business website can receive a practical article through the existing editorial review, durable delivery queue and receipt reconciliation. Search content is a long-term channel, not proof that the public author was reached.
- Operations now includes initial email setup for opted-in leads using the monitored business sender alias. It reuses Sales consent checks, current product research, review, delay, opt-outs, purchase stops and uncertain-send reconciliation. Saving pauses the business; Run authorizes the saved policy.
- Physical mailing addresses are distinguished from sender email addresses. No postal address is fabricated or inferred.
- Existing publishing mode and saved policies retain their behavior until explicitly changed.

## Validation

- Full suite: 1,291 tests in 58 files passed. After replacing model-copied quotes with source excerpt IDs and adding postal-address validation, all 175 affected tests in four files passed. Typecheck and targeted ESLint passed.
- Desktop fixture passed at 1440x900 and 720x800: acquisition settings persist, sender alias displayed, initial response settings save without creating jobs, offline Run blocked, business isolation and zero renderer exceptions. Test windows stay hidden.
- Acquisition integration tests run through the marketing agent and intercepted publication API: accepted request to reviewed delivery and receipt, no-fit completion without a post, rejection of generic replacements, and Pause during assessment.
- CPU-only Gemma 4 E4B probe: 3/3 synthetic requests correctly classified against the live Lemonade homepage (supported Windows document task accepted; native macOS and enterprise server requests rejected). Two CPU threads, zero GPU layers, 119 seconds. Report: `data/operations-validation/acquisition-live-1790374624845.json`. An earlier quote-copying probe failed closed; source selection now uses IDs and attaches original text. An intermediate retest lost its external runtime connection; the completed probe owned its runtime process.
- Packaged desktop passed the UI fixture as well. Signal 0.36 installed successfully; installed and packaged app.asar SHA-256 both `e73014f5153636d8e38655d98f5997f519a8accae17e19a432d61cb85ca4ca41`.

## Saved owner setup

Lemonade now uses acquisition mode with no existing social audience. Its existing public research, website, incoming email, Stripe and GA4 configurations remain selected. Initial email responses are enabled from `sales@aionx.aionapp.org`, up to three per rolling day, with a ten-minute send delay and no unanswered follow-ups. The owner's supplied physical address is stored only in the local policy, not this document. A backup of prior policies was saved under the app's local backups folder.

Read-only inspection found no configuration blockers. This is a configuration check, not a new live verification of every provider credential. Lemonade remains paused. No customer email or public post was sent by this update.

## Remaining work

This is not a complete autonomous acquisition system. Search coverage is currently Hacker News and Stack Exchange. Community replies and partner placements still need supported distribution routes, and the completed Studio video is not yet connected to every social delivery API. Paid acquisition is not enabled. Those reach gaps remain material for a business without an existing audience; website content alone does not establish demand or prompt sales.

Qualification quotes verify traceability, not semantic correctness. The local model still needs broader quality evaluation; the prior editorial probe had an overall correct decision while skipping a factual body claim. No sales or audience growth is inferred from tests, created drafts or publication receipts. GA4 processed ingestion of the new website events still needs observation.

## Research informing this change

- [Google: helpful, reliable, people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content): answer a real task rather than filling a keyword or publishing quota.
- [Google: AI search optimization guidance](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide): useful original content; no automatic ranking claim.
- [Y Combinator: first five customers](https://www.ycombinator.com/blog/first-five): early customers require a concrete reachable audience, not simply an owned social account.
- [FTC commercial email guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business): accurate identity, postal address and opt-out support for marketing emails.
