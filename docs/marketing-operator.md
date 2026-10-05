# Local marketing operator

Open **Marketing agent** in Signal. Choose Lemonade or CineGen, talk to the
operator, or choose **Run next marketing cycle**. The operator uses the configured
local model through the Growth lab server URL. Its own default model is
`gemma4:e4b`; change it under Operator settings. No cloud model fallback is used.

The included four-page research PDF is available through **Read the marketing
research**. Research source records and implementation notes are in
`docs/marketing-research/`.

## What runs

Each request is durable in SQLite, uses the existing single growth worker, and is
bounded to four model turns with one structured tool action per turn. Model requests time
out after a minute. A writing success moves to a final response instead of saving
repeated variants. Errors and tool outcomes are inspectable; requests can be
cancelled or retried. Scheduled cycles run only while Signal or its worker is open.

Tools retrieve memory, read public product pages and other public HTTPS text,
search discovered opportunities, optionally search a local SearXNG service, add
engineering requests, save copy, queue Bullseye research/opportunity work and
submit ComfyUI jobs. Website-blog tools added alongside this work retain their
separate configuration and publishing controls. This installation does not enable
automatic website publishing or send any customer messages.

## Memory and engineering

This is an Obelisk-inspired local graph, not an installation of Obelisk. Nodes
carry product scope, evidence source, observation time, confidence and status.
Relationships are inspectable. Model-written conclusions remain hypotheses;
actual fetched pages and owner-provided corrections have separate origins.
Retrieval ranks lexical matches and expands one graph hop, bounded to 1,000 active
entries per product. Old corrected entries stay in history but leave retrieval.
Forgetting removes an entry's content and relationships from the memory store;
it is not a deletion of separate conversation, draft or tool audit records.

Engineering requests include acceptance criteria, evidence, priority, metric and
a manual workaround. They are deduplicated by normalized title per product.
The initial requests are audits of purchase attribution and small affiliate
pilots. They are proposals, not assertions that those capabilities are absent.
Only an owner status change marks a request shipped, and public claims still need
product verification.

## Cash and tiers

All products start with no cash ledger entries and zero spendable marketing funds.
Record only settled surplus after fees, refunds, delivery costs and obligations;
enter later reductions as adjustments. The operator cannot create these records
or edit its policy. The default 10% reinvestment share and $25 total allocation cap
are editable owner assumptions, not promises or Traction prescriptions.

The envelope subtracts additional reserves, actual marketing spend and reserved
commitments. Recording spend with a reservation's reference settles that
commitment so it is not counted twice. Duplicate receipt references are rejected.
A paid growth test reserves its estimated cost when its clock starts; no payment
is made. Record its real expense separately and release unused reservations.

Experiment revenue does not credit the cash ledger. A completed promising test
unlocks the organic tier; settled surplus can then fund small tests. Two promising
completed tests in the same channel plus remaining funds qualify for the repeatable
tier. Corrected measurements or cash adjustments can move eligibility down again.

## Media and product access

Start a local ComfyUI server and set its URL under Operator settings. **Check
ComfyUI** discovers installed checkpoints. A 512px starter image workflow is
provided for compatible SD-style checkpoints. Other model architectures, video
and audio require an API-format workflow exported from ComfyUI; use `{{prompt}}`
in the text field Signal should replace. Only installed built-in local nodes are
accepted; remote API nodes, custom execution nodes and embedded credentials are
rejected. No models are silently downloaded and no cloud rendering is used.

Jobs retain their prompt ID, workflow hash, product and outputs. Queued does not
mean generated. Signal pauses its own model tasks while its media job is pending;
other applications' GPU usage remains outside Signal's control. Queued cancellation
deletes only the app's own prompt. Running jobs must be stopped in ComfyUI before
being cancelled here, avoiding a global interrupt on older servers. Saved outputs
can be copied into Signal's per-user asset folder and opened.

Product sessions run in isolated Electron browser partitions without Signal's
privileged preload. Users can inspect the live product, sign in where supported,
and capture actual screenshots. Google/Microsoft authentication popups are
permitted; credentials remain in the isolated session. Public-page research does
not automatically read an authenticated session. Generated creative is separate
from a real product capture.

## Verification boundary

On the usual local Ollama endpoint (port 11434), marketing uses the native chat
API with a 16,384-token context. The default 4K compatibility context truncated
instructions during a real cycle. Other compatible runtimes require an adequate
context setting in their server configuration. Gemma 4 E4B is the operator default;
its installed-profile trials produced concrete demo scripts. Source references
and product steps still need review before external use.
[Ollama context configuration](https://docs.ollama.com/api/openai-compatibility)

Core operator and local model behavior can be tested without website credentials.
ComfyUI HTTP lifecycle tests use a local fixture server; a successful fixture test
does not establish that a real model/checkpoint can render on this machine.
Similarly, product landing-page research is not a claim to have tested every
authenticated product function. Keep these capability states visible when setting
up the machine.
