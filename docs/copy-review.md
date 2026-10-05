# Review the actual public copy

The editorial checker formerly returned paraphrased claims and a general approval
flag. Real local-model evaluations showed it sometimes invented a stronger offer
(such as free unrestricted exports), then rejected wording the writer had not
submitted. Such feedback could send later attempts in the wrong direction.

The current checker receives exact passages from the title, description and body.
Signal assigns stable field-specific IDs, preserves every non-whitespace span,
and attaches the original text to the audit itself. Normal sentences stay intact;
very long sentences are split into bounded spans rather than dropped. The model
selects source IDs, explains its comparison, and classifies each passage as
supported, unsupported or nonfactual. A passage with several factual claims is
supported only when all of them are supported. Instructions to try a capability
still assert that the capability exists.

Every passage must be checked exactly once. Missing or invented IDs, duplicate
checks, unknown source IDs, missing evidence for a supported passage, or an
entire artifact classified as nonfactual invalidate the review. These structural
errors hold the artifact but are not stored as factual corrections for later
campaigns. An unsupported verdict generates a correction linked to the actual
submitted passage. Final approval is computed by Signal after validation; the
model no longer supplies a general approval flag or replacement claim text.

Sources remain the latest same-task, same-business product observations, with
overlapping excerpts and the existing complete-source size limit. Ordinary
paraphrases are allowed. Plan limits must qualify offers that actually conflict
with them, but the checker must not invent a free-plan offer or transfer one
feature's beta status to another. Follow-up comparison remains a separate check.

Short social writers now omit links and affiliation text. Their output schema
limits the caption to 180 characters, matching the writing instruction and
leaving space for Signal to add the configured URL, tracking and disclosure. This removes
conflicting prompt instructions that led a local writer to attach "our app" to
a URL path. When a follow-up needs a new angle after repeated rejection, it keeps
the reference buyer workflow and changes the specific action or outcome rather
than being instructed to abandon that workflow.

This is an application-specific adaptation of fine-grained factual evaluation,
informed by [FActScore](https://arxiv.org/abs/2305.14251). That research decomposes
generated text into atomic facts and checks evidence; Signal's deterministic
passages can contain multiple facts and are not a FActScore implementation or
a validated factuality score. Structural coverage cannot ensure the model's
semantic judgment is correct.

## Validation

Unit tests exercise complete copy coverage, long and multilingual input, exact
audit wording, invalid reviewer output, demand fit, Pause and downstream delivery.
They use fixture judgments and do not establish real model capability.

`scripts/copy-review-live-smoke.ts [model]` uses actual CPU-only local inference
and the current CineGen source to check two supported offers and two unsupported
ones. It saves exact source text, model responses and outcomes under
`data/operations-validation/copy-review-*`. No provider credentials, customer
messages or publishing requests are used. A failed case remains a failure; it
must not be relabeled because the JSON was valid or the runtime was available.

`scripts/followup-review-live-smoke.ts [model]` separately checks that a repeated
action is rejected and a documented next step is accepted. The passage protocol
passed both of those Gemma 4 E4B CPU checks. The broader factual test still found
an incorrect rejection of a supported timeline-editing headline. A successful
fixed-case check alone does not establish dependable unattended operation.

On September 18, CPU Gemma 4 E4B passed three of the four factual cases and CPU
Qwen 3.5 9B passed all four against the same current CineGen source. The negative
responses were inspected for actual unsupported-claim judgments; a timeout,
invalid format or missing coverage does not count as a successful rejection.
The reports are `copy-review-1789750477576.json` (Gemma) and
`copy-review-1789750745769.json` (Qwen) under `data/operations-validation`.
These are small diagnostic cases, not a representative marketing quality score
or proof of successful customer acquisition.

New marketing profiles default to `qwen3.5:9b` based on these checks and the
successful CineGen cycle with passage review. Saved model selections are not
migrated. The selected model must still be installed (or a configured GPT
provider used); changing the default does not prove reliability for every task.
