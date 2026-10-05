# Signal 0.41: buyer intent, helpful replies and tracked conversations

The automatic marketing and sales flows did not consistently receive the older
reply voice guidance. A shared policy now tells each flow to answer the specific
person first, use ordinary language, avoid generic compliments and pitches, and
ask a question only when its answer changes the next step. Legacy drafts receive
the same rules. Business affiliation and automated-assistant disclosures remain.
Public replies put an added affiliation beside the link after the useful answer.

Specific stock phrases and em dashes stop a reply before queueing. This is an
explainable style check, not an AI-authorship detector. Public reply review must
explicitly approve conversational fit and plain language as well as source-backed
claims. Email reviewers also assess tone. Rejected email wording is fed into the
existing bounded preparation retries. No artificial typos, fake customer identity
or invented personal experience are used to make writing sound human.

Live 0.40 inspection confirmed generation across the former five-minute cutoff.
Its first cycle rejected four drafts for unverified website destinations; new
feedback identifies the invalid paths and supplies the exact allowed homepage.
A later cycle published a Bluesky reply to "What's happening? Can someone
summarize?" by turning it into quarterly-report promotion. This is a quality
failure, not a successful acquisition. Such contextless requests are now excluded
before qualification and checked again before queueing. The published reply's
absolute local-analysis promise is also covered by a regression check.

Tests cover canned wording, ordinary language, required disclosures, missing and
failed voice verdicts, email holds and the observed context/claim failure. These
tests do not prove that a local model will judge every future reply correctly.
No new test sends a real message. Build and installation receipts are separate.

Buyer-intent routing now separates explicit software requests, concrete work
problems and insufficient context before model qualification and again before
queueing. A work-problem response must offer help without a product mention or
link; Signal adds transparent team affiliation. Explicit software requests can
receive a relevant supported recommendation. These checks narrow candidate
selection; they do not establish willingness to buy.

Operations now includes Tracked conversations, reached directly from the public
reply count. It shows the original post, exact sent reply, public links, observed
responses and review state. Read-only checks run every 15 minutes while marketing
is running, with manual refresh available. Deleted or unavailable replies retain
their original send receipt and are not reposted. The owner-deleted reply was
checked live and its unavailable status saved. Social responses are tracked for
review; automatic continuation of these conversations is not implemented.

The strategy and primary sources are documented in
marketing-research/conversation-led-acquisition-2026-09-26.md. Hacker News remains
research-only because its guidelines prohibit AI-generated and AI-edited comments.

Validation: 775 tests across 32 files passed, covering operations, sales, legacy
drafts, marketing and voice. After the final prompt correction and an additional
advice-only review test, all 110 tests in the two affected files passed again
(776 distinct tests covered overall). Type checking and targeted lint passed.
The final Windows package passed the populated Conversations UI checks at
1440x900 and 720x800 with no renderer errors. Screenshots were visually inspected.
Package hashes and installation status are recorded separately in
data/operations-validation/release-0.41.json. The update is built and tested;
the owner must quit the running 0.40 application before installation.
