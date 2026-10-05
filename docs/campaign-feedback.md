# Campaign feedback between runs

An autonomous marketer should not start each day by repeating the same failed
claim. Operations now retains up to 24 recent editorial rejections per business.
This supplements the four-attempt revision loop; it never approves a campaign.

Only semantic rejections from independent editorial or demand-fit review enter
this history. Network failures, malformed model responses, missing links and
other structural errors do not become product lessons. Entries store the draft
title, limited correction text, finding ID, attempt identity, time and a hash of
the inspected product URL and text. They do not store credentials or inbox data.

On the next cycle, the writer receives the last four matching corrections as
fallible review feedback. They are not treated as product facts or instructions.
After two rejected drafts tied to the same public finding, that finding is
temporarily omitted from the writer's choices. The original research snapshot
remains intact for the audit trail, and the agent can choose another observation
or a supported product task with `findingId: none`.

Feedback expires after seven days and is ignored when the current product source
changes. A corrected, independently approved draft that queues successfully
clears earlier failures for its finding and source. Other corrections remain.
These limits allow recovery from fallible reviews rather than establishing a
permanent rejection of a topic, customer need or capability.

The database tests cover business/source isolation, expiry, duplicate attempt
handling, bounded history, malformed saved data, transient failures and recovery.
The agent integration test rejects a campaign, reconstructs Operations, starts
another cycle and verifies that the failed finding is absent from its schema and
context while corrections remain available and independent review still runs.
Real repeated-campaign improvement is not established by these controlled tests.

Review evidence now includes the complete inspected text, grouped into overlapping
700-character excerpts. The former 32-sentence cutoff excluded Lemonade's real
Word/Excel creation features (including explicit workbook formulas and editable
files), causing incorrect rejections. Latest observations replace older copies of
the same URL; oversized evidence is rejected explicitly rather than silently cut.
Regression tests place capabilities and network qualifications after 45 sentences
and verify they reach the reviewer with exact source excerpts.

The real CPU check in `scripts/editorial-live-smoke.ts` passed both cases against
the current Lemonade page: it accepted the documented editable-workbook capability
and rejected invented automatic YouTube publication. See
`data/editorial-cpu-full-source.log`. These focused checks verify that correction,
not the quality of every future campaign. Rejections also name unsupported claims
when the reviewer marks them false but leaves its issue list empty.

The design uses feedback between attempts, as studied in
[Reflexion](https://arxiv.org/abs/2303.11366). Signal does not reproduce that paper's
method or claim its benchmark results; its own marketing quality needs separate
validation with current product evidence.
