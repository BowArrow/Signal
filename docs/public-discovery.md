# Public buyer research

Operations can run public research independently of publishing. Enable **Research
public buyer questions while running**, edit the business's searches and save,
then Run. Lemonade and CineGen have separate suggested searches, checkpoints,
observations and campaign evidence. No email address or public author is imported
into Sales. Research alone requires no AI model; composition and editorial review
use the configured agent when publishing is enabled.

Hacker News searches use its public Algolia endpoint; Operations uses exact
phrases to reduce unrelated matches. Stack Exchange uses `search/advanced` with
`filter=withbody`, a creation-date window and a selected supported site. These
readers are shared with existing ingestion. Stack Exchange's method backoff,
exhausted quota and duplicate-query cooldown apply across the shared reader.
Public response reads have a timeout and size limit; redirects are rejected.

Each business can configure up to eight searches. The worker performs one search
per pass, spaces that business's searches by at least a minute, and refreshes each
query no more than hourly. Failed attempts are visible and don't prevent the next
campaign from using product facts. Pause cancels pending research; results arriving
after Pause, a settings change or offline mode are discarded. Saved checkpoints
survive application restarts. Changing operating settings resets that revision's
research context.

Only dated observations from the last 14 days qualify. Observations must contain
request language near the search words; URLs and a comment's parent headline do
not supply that match. Launch announcements are excluded. This English-language
heuristic is intentionally selective and can miss valid questions. A successful
search can legitimately return no observations. The most recent 200 observations
are retained; up to six are supplied per campaign, preferring findings not recently
supplied. Provider permalinks are constructed from validated IDs.

The first campaign waits for a research attempt. Its agent must record a selected
finding and product-fit reason, or select `none` when the evidence doesn't fit.
An independent editorial pass must explicitly confirm a concrete request, that the
copy addresses it, and that current product evidence supports the needed capability.
A missing or negative verdict prevents queuing that draft. Source snapshots and
the internal decision are saved with the delivery. They establish which research
was supplied, not endorsement, contact permission, market size or conversion.

## Research references

- [HN Search implementation](https://github.com/algolia/hn-search) and
  [search endpoint](https://raw.githubusercontent.com/algolia/hn-search/master/app/controllers/api/v1/search_controller.rb).
- [Algolia advanced syntax](https://www.algolia.com/doc/api-reference/api-parameters/advancedSyntax):
  quoted phrases constrain matching; live unquoted searches returned unrelated
  discussions during validation.
- [Stack Exchange advanced search](https://api.stackexchange.com/docs/advanced-search)
  and [filters](https://api.stackexchange.com/docs/filters).
- [Stack Exchange throttling](https://api.stackexchange.com/docs/throttle):
  method-wide backoff and minimum spacing for identical requests.

## Validation boundary

Public API reads succeeded for both businesses. Initial local-generation runs
completed against simulated publishing transports, but manual inspection found
forced topic matches. Those results are not evidence of acceptable campaign quality.
Subsequent changes tightened request filtering and added explicit editorial fit
verdicts. A system crash interrupted the next live-generation check. Further GPU
tests are on hold while that incident is investigated; the final model-quality
check remains outstanding. The implementation is included in the 0.20 installer;
packaged desktop settings, findings and business isolation passed with software
rendering. Unit/integration tests exercise the gates with controlled responses and
cannot establish the model's judgment.

The subsequent CPU-only CineGen run completed without publishing. All four drafts
were rejected for unsupported export-quality claims. The gate worked; this was
not a content-quality pass. Revisions now retain the complete current source in
their structured history instead of slicing it out as drafts accumulate. After two
failed drafts, the writer must choose a different verified product task and
use `none` for the unsuitable public observations. The replacement still passes
the same independent review. Regression tests cover both acceptance and continued
rejection; another real CPU run is pending. Its trace records each model completion
so a failed run retains evidence for diagnosis.

The following CPU trace exposed a separate weakness: the reviewer accepted an
unsupported export-quality implication after initially rejecting it, while the
writer repeatedly cited the public question instead of the product website.
Those drafts still could not enter the queue. An editorial approval alone is not
evidence that a model's copy is accurate; inspect the actual artifact.

Source changes after the 0.23 package validate required citations, calls to action,
length, destination policy and available capacity before spending an editorial
model call. This preflight creates no delivery or reservation. Enqueue repeats
the same validation after review so an intervening Pause cannot authorize delivery.
The generation schema limits citations to the exact current product source URL;
the prompt repeats that URL and the required business link. Two failed drafts,
including structural failures, trigger a fresh angle. Editorial instructions now
explicitly check the central promised outcome rather than accepting it from a
list of supported features. These are implementation changes, not a model-quality
pass. The revised full suite passed 1,054 tests, typecheck, lint and the production
build passed. The preceding CPU run finished with four failed drafts and no
publication; a new run using these changes is recorded in
`data/discovery-cpu-cinegen-preflight.log`.

[Ollama's structured-output documentation](https://github.com/ollama/ollama/blob/main/docs/capabilities/structured-outputs.mdx)
describes schema-constrained responses and application-side validation. Signal
uses both; schema compliance does not establish factual accuracy or buyer value.

The CineGen preflight run completed successfully on its fourth attempt. It
selected `none` for the unsuitable export-quality question and produced
"From Concept Prompt to Editable Sequence: A CineGen Workflow Walkthrough."
Manual inspection found a source-grounded storyboard, clip generation and
timeline sequence without the abandoned export-quality promise. One simulated
publication was confirmed. The result and trace are retained under
`data/operations-validation/discovery-cpu-cinegen.json`; a readable copy is
`data/operations-validation/cinegen-campaign-preview.md`. This is one successful
CPU campaign, not evidence of dependable repeated quality, actual publication,
traffic or sales. A Lemonade run using the same workflow is recorded in
`data/discovery-cpu-lemonade-preflight.log`.

That Lemonade run completed on its third attempt with one simulated publication,
but diagnosis found that two earlier rejections were caused by a reviewer input
bug: the first 32 excerpts omitted documented Word/Excel creation capabilities.
The source implementation now supplies the entire inspected text in overlapping
chunks. The completed run predates that correction and is not validation of it.
The final copy also needs more precise wording about which files are searched and
what source-location detail is available. A focused real CPU review check of a
supported workbook capability and an unsupported publishing capability is logged
in `data/editorial-cpu-full-source.log`. No public article was published.
