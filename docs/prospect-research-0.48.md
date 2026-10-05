# Signal 0.48: prospect research and guided contributions

The Sales screen now exposes the saved lead pipeline and a separate research queue. Previously, its main view emphasized received email; connecting an inbox did not discover prospective customers or show the three existing LTD partner submissions.

## Owner workflow

1. Open **Sales → Prospects**. Existing partners, subscribers and researched businesses appear here with their actual stage and permission.
2. Choose **Research prospects and placements**, or enable automatic research in the expandable research settings. Automatic research runs while that business is running in Operations.
3. Open **Drafts & suggestions**. Each proposal has its actual source, observed excerpts, product evidence, proposed copy and next step.
4. A business email with a published contact can be individually approved and queued through the connected sender. The preview includes the same footer used by delivery. Approval covers one introduction; it does not enroll a prospect as a subscriber or schedule cold follow-ups.
5. Blog and community proposals include their destination and any contributor guidance Signal could retrieve. Review the copy and use the destination's permitted submission route. Contact-form-only businesses retain their contact page and a copyable message. Record a submission link afterward; an owner-recorded link is not verified delivery or publication.

**Conversations** contains received replies and human handoffs. **Setup** contains inboxes, subscriber imports and outreach settings. Switching views preserves unsaved local form edits.

## Research behavior

- Rotates business, blog and community queries, examining one new candidate per cycle. The owner can customize the audience and queries or supply a particular public page.
- Uses configured SearXNG, or public Brave search when no local search provider is available. Reads public HTTPS pages with existing DNS/private-network checks. Search challenges and unavailable pages are reported; access challenges are not bypassed.
- Uses the configured marketing model to assess fit and prepare copy, then performs a separate evidence and voice review. Short quoted evidence must occur in the retrieved pages. A plausible business workflow is labeled a hypothesis, not buying intent. Rejections receive a separate fit check and one reassessment when the stated reason is unsupported. Explainable copy defects receive one repair attempt; unresolved defects do not become sendable drafts.
- Records poor matches and review failures rather than fabricating customers or repeating dismissed businesses. Recovers interrupted research on restart.
- Extracts published same-domain business addresses from page text and mail links, including explicit visible `name -at- company -dot- com` spellings. It does not infer private addresses from names. Missing contacts leave a guided handoff, not a sendable email.
- Defaults to three prepared proposals per rolling day, up to ten awaiting review and 24 recorded assessments per rolling day. Research budgets are distinct from existing email and public-posting budgets.

## Delivery boundaries

Cold approval checks the draft version, sender and outreach-policy revision. Existing shared email limits, delay, current inbox scan, business scope, suppression, customer checks, previous conversations, deduplication and uncertain-delivery reconciliation still apply. No new external messages were sent during validation.

Blog/Reddit suggestions are prepared for human submission; this change does not add automatic posting to arbitrary forums. A contributor policy that forbids the proposed content is not permission to ignore that policy. A connected mailbox or prepared draft does not establish delivery, traffic or a sale.

## Validation artifacts

- Research, outreach, readiness and Operations tests; targeted lint and TypeScript checks.
- `scripts/workspace-ui-smoke.mjs`: isolated offline UI checks at 1440, 960, 720 and 480 pixels, saved-lead visibility, email/blog/community proposal cards, view switching and renderer errors. Packaged verification is recorded in the release receipt.
- `scripts/prospect-live-smoke.ts`: real public-page reads and the configured CPU-only local model in an isolated database with no credentials or delivery service. Public source/model evidence is saved under `data/prospect-live-validation/`.
- `data/prospect-live-validation/reviewed-business-draft.json`: a real researched business/contact with an explicit Codex editorial revision. The original model draft made an unsupported privacy claim and presumed prior use; the revised introduction removes both. This is an unsent review draft, not evidence of successful outreach.
- `data/prospect-live-validation/blog-result.json`: the live CPU run produced three proposed article pitches for Patriot's small-business blog, retained its contributor guidance, identified the bio/headshot submission requirements, and passed the separate model review. The pitches have not been submitted or accepted. Earlier rejected assessments and their model output remain available for diagnosis.
- `data/operations-validation/release-0.48.json`: final installer and application hashes, checks and installation state. An installer file alone does not mean the owner is running the update.

Sources used for live validation include [Lemonade](https://siplemona.de/), [Williams Grant Writing](https://williamsgrantwriting.com/), [Professional Grant Writers](https://www.professionalgrantwriter.org/about) and [Patriot contributor guidance](https://smallbusiness.patriotsoftware.com/guest-post-blog-guidelines-rules/). These are research inputs, not endorsements or contacted customers.
