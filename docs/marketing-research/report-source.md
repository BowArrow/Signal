# Marketing without financial runway

Prepared for Casey Shore, Lemonade and CineGen · 8 September 2026

## The decision

Build an operator that makes the founder's next useful action easier: discover real
questions, inspect the product, prepare helpful responses and demonstrations, keep
the evidence, and turn repeated friction into small engineering requests. Begin at
zero cash. Early acquisition often depends on direct recruitment and unusually
attentive onboarding; automating preparation does not remove the need to learn from
customers. This is experienced founder guidance, not a promise of growth.
[Paul Graham, Do Things that Don't Scale, July 2013](https://paulgraham.com/ds.html)

Bullseye is a learning loop: consider all 19 channels, select a few inexpensive
tests, evaluate acquisition cost, customer volume and customer fit, and focus on
the best measured opportunity. The supplied Traction excerpt supports this reading
(book pages 19–26). Its emphasis on cheap tests is compatible with zero-cash work;
it does not prescribe a universal order of channels or a reinvestment percentage.
[Gabriel Weinberg interview](https://mixergy.com/interviews/gabriel-weinberg-traction/)

## The first experiments

The following are starting hypotheses, not proven winners. Keep at most three
shortlisted at once, define the audience and success threshold before starting,
and record actual observations instead of interpreting silence as a sale.

| Product | Initial zero-cash test | Evidence to collect | Engineering implication |
| --- | --- | --- | --- |
| Lemonade | A real walkthrough answering a specific private-document question | Voluntary feedback, installation friction and qualifying purchases | A reproducible demo and privacy-preserving checkout attribution |
| Lemonade | A small onboarding clinic for people already asking about local AI | Where setup succeeds or stops, with permission | Fix the repeated activation blocker before broad promotion |
| Lemonade | One practical tutorial addressing observed confusion | Relevant reader questions and attributed purchases | Improve only the product/docs gaps that the tutorial exposes |
| CineGen | A real storyboard-to-export walkthrough using a narrow creative task | First successful export and creator feedback | Audit export/onboarding friction before acquiring more users |
| CineGen | A reusable project/tutorial for a specific creator audience | Whether creators finish the intended task | Make a repeatable template only after validating the task |
| CineGen | A small creator onboarding session | Buyer needs versus feature suggestions | Turn repeated, evidenced friction into acceptance criteria |

These tests adapt direct observation and founder-led recruitment. Distinguish the
customer's problem, need and proposed solution; a requested feature is not itself
proof of a market. [YC: User Observation, August 2016](https://www.ycombinator.com/blog/practical-design-user-observation/)

The current Lemonade site describes a Windows/Linux local assistant, a $49 perpetual
license and a 14-day trial, with no behavioral telemetry. Use voluntary source
answers and checkout records rather than silently introducing product analytics.
These are current vendor claims, not independently benchmarked capabilities.
[Lemonade product site](https://siplemona.de/)

CineGen now presents a browser production workspace covering storyboard, characters,
generation, timeline editing and review. Its 3D scene creator is marked beta. The
free offer includes one project and watermarked 720p exports; its paid plans differ
in included generation allowances. Recheck live entitlements and costs before
publishing a price or promising a demo. [CineGen product site](https://cinegenaimedia.com/)

## A cash rule the model cannot rewrite

Pending receipts differ from available funds. Settlement, fees, refunds, disputes
and reserves matter; gross sales and subscription list prices do not establish
money available for marketing. [Stripe: Balances and settlement time](https://docs.stripe.com/payments/balances)

Signal therefore records owner-confirmed settled surplus after fees, refunds,
delivery costs and obligations. Unknown deductions mean no confirmed surplus.
Avoid deducting a cost twice if it is already included in the supplied net figure.
The deterministic envelope is:

`max(0, min(owner cap, reinvestment share × max(0, settled surplus − additional reserve)) − marketing spend − commitments)`

The initial policy allocates 10% of recorded surplus with a $25 total cap. These
are conservative editable operating assumptions, not research-established optima.
The envelope begins at $0 and does not refill because a month passes. Product
ledgers remain separate; refunds and corrections immediately reduce eligibility.

| Tier | Evidence gate | Eligible work |
| --- | --- | --- |
| Bootstrap | No completed promising test | Zero-cash discovery, drafts, demos and onboarding |
| Organic | A completed test meets predefined customer/fit/CAC criteria | Continue organic work and learning |
| Funded tests | Promising test plus recorded surplus and available envelope | Reserve a concrete, affordable experiment |
| Repeatable | Two promising completed tests in the same channel plus available funds | Consider bounded expansion; keep measuring contribution |

Cash tiers and the Bullseye core channel are separate. A model's confidence cannot
promote either. Existing experiment revenue is measurement evidence, not an
automatic cash-ledger deposit. These gates do not prove statistical causality.

## Useful responses instead of promotional volume

Answer the actual question, retrieve relevant product facts, disclose affiliation
naturally, and avoid invented customer experience. Store approved voice preferences
and examples. Natural language is a writing goal, not an instruction to pretend
an autonomous system is a human employee.

Reddit's current spam policy explicitly includes continuous promotional bots and
repetitive unsolicited engagement. A useful operator prepares specific responses,
respects community rules and suppression, and does not turn a writing model into
a mass-posting loop. [Reddit Spam policy, updated May 2026](https://support.reddithelp.com/hc/en-us/articles/360043504051-Spam)

For search content, originality and usefulness matter. AI can assist research and
structure, while large volumes of low-value generated pages may violate scaled
content policies. [Google Search guidance, December 2025](https://developers.google.com/search/docs/fundamentals/using-gen-ai-content)

Affiliate endorsements need clear material-connection disclosures, and testimonials
cannot invent experience. Commercial email has identity and opt-out requirements;
the US rule alone does not establish permission for every jurisdiction or provider.
[FTC endorsement guidance](https://www.ftc.gov/business-guidance/resources/disclosures-101-social-media-influencers)
[FTC CAN-SPAM guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)

UTM tags identify campaign referrals. Keep source, medium, campaign and creative
identifiers consistent, but do not confuse a tagged visit with a paying customer
or proof that the campaign caused the purchase.
[Google Analytics campaign URL guidance](https://support.google.com/analytics/answer/10917952)

## Memory, tools and the engineering feedback loop

The likely Obelisk reference uses a local SQLite evidence index shared by a CLI
and desktop app. Its durable memories retain access to original evidence. Signal
adapts those ideas rather than claiming to install Obelisk itself.
[Obelisk project](https://github.com/tommy0103/obelisk)

Temporal graph designs retain provenance and invalidate outdated relationships
when new evidence contradicts them. Signal uses product-scoped memory nodes,
relationships, source references, observation timestamps, confidence and explicit
supersession. Model-written ideas remain hypotheses; owner corrections and actual
page observations have distinct origins. Retrieval combines bounded lexical
ranking and graph neighbors. A local graph is an engineering choice, not evidence
that memory storage itself produces revenue.
[Graphiti episodes](https://help.getzep.com/graphiti/core-concepts/adding-episodes)
[Graphiti temporal architecture](https://blog.getzep.com/beyond-static-knowledge-graphs/)

Each engineering request should include the product, problem, source evidence,
channel/test, smallest manual workaround, expected metric, priority and testable
acceptance criteria. An affiliate pilot should first establish partner interest,
referral-through-checkout attribution, duplicate/self-referral handling, refund
reversal and a commission ledger. A complete affiliate platform is a later
proposal, not a prerequisite for finding the first interested partner.

ComfyUI exposes workflow submission, queue/history inspection and saved-output
retrieval. Persist its prompt ID: successful submission means queued, not rendered.
Use installed local workflow nodes and models; inspect capabilities before offering
generation. Keep generated creative distinct from actual product screenshots.
Do not globally interrupt another application's render when cancelling one job.
[ComfyUI server API](https://docs.comfy.org/development/comfyui-server/comms_routes)
[Official workflow example](https://github.com/Comfy-Org/ComfyUI/blob/master/script_examples/websockets_api_example.py)

Remote product pages belong in an isolated browser without Node integration or
Signal's privileged preload. Keep authentication outside prompts and memory.
Product screenshots and page text are observations; a landing-page claim alone
does not verify an authenticated workflow.
[Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security)

## Limits and the next evidence

No reviewed source establishes a universal CAC target, optimal reinvestment share,
or guaranteed winning channel for either product. SEO and community work consume
time even when their cash cost is zero. CineGen's generation costs and Lemonade's
one-time licensing economics require different net-contribution records.

This research stops because the consequential decisions have primary support or
an explicit limitation. More generic marketing searches are unlikely to decide the
next step. Actual customer conversations, product use, local runtime tests and
recorded experiment outcomes will. Integration availability and implementation
validation are reported separately from this research.

Sources were accessed 8 September 2026. The Traction PDF was consulted locally;
its text and external account credentials are not embedded in Signal.
