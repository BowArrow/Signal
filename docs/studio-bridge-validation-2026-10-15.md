# Studio automation bridge validation

Implemented locally on October 15, 2026. No installer, release or public marketing
material was published. The normal licensed-instance attachment proposal remains
separate; this implementation follows the requested isolated-profile scope.

## Implemented

- Same-profile resume with preserved settings, licence bytes, approved samples
  and model choice. A session lease rejects another live Studio/product owner.
- Project-scoped file import using Lemonade's project service and permission
  checks, explicit extraction failures and source hashes.
- Asynchronous document-only inference through Lemonade's inference client and
  chat store, with a retained run ID, actual stream/answer, citations and timing.
  No general agent tools, private retrieval or replacement answer is available.
- Source passages shown inside the recorded product panel, with hash validation.
- Editable project notes retaining the original AI answer and subsequent versions.
  Permission-gated Markdown/text export and reopening of the saved file bytes.
- Studio controls, structured errors, active project/document/source observation,
  durable operation receipts and manifest provenance. Polling updates the latest
  run snapshot instead of accumulating a copy of every partial answer.
- A bounded 600-second recording option for the full workflow; the default
  remains 120 seconds. No LTX hold or resource-limit file was changed.

## Verified

- Lemonade typecheck and production build.
- Signal typecheck, scoped ESLint and three existing adapter tests.
- Thirteen Studio tests, including profile preservation, input rejection,
  command responsiveness after a queued turn, structured errors, session leases
  and concurrent manifest persistence. Existing LTX checks still pass.
- `Lemonade/scripts/demo-bridge-check.mjs`: actual fixture-file imports and
  project version persistence, licence/model rejection, run deduplication,
  asynchronous progress, source integrity, stale-edit rejection, export denial,
  export/reopen hashes, failed inference and restart persistence. Its model
  responses are explicit test fixtures, not evidence of a successful AI comparison.
- Desktop/mobile Studio layout at 1440 and 390 pixels, inspected from rendered
  screenshots with no horizontal overflow. This uses a disconnected UI fixture
  and does not record the owner's licence screen.

UI evidence: `data/demo-studio/bridge-ui-check/receipt.json` and
`controls-1440.png` / `controls-390.png` in that folder.

## Live acceptance passed

On October 15, the owner authorized a licence for this demo. The existing
`Lemonade/scripts/mint-license.mjs` workflow issued a one-device complimentary
licence, tagged `origin: comped` so it does not count as revenue. Activation went
through the normal Licence screen and returned `licensed`. No licence files were
copied, no trial was reset and no activation was simulated. Resume after a product
restart preserved the licence, selected model, project and saved results.

Session: `a4992979-0e7c-47c2-88d4-f4d988fae621`.
Project: `cd2e49a5-3f9f-49b1-be57-62a34912b415`.
Test Studio connection discovery:
`data/demo-studio/bridge-check/1792096910245/connection.json` (contains a secret;
do not print or share).
Licence receipt, without its key:
`data/demo-studio/bridge-check/1792096910245/licence-receipt.json`.
Retained initial failure receipt:
`data/demo-studio/bridge-acceptance/1792094704910/receipt.json`.

The installed `qwen3.5:9b` model was selected through Models. Two real inference
runs independently found the $120 increase, unchanged 120-box quantity and
November 4 to November 11 delivery change, citing both imported reports. The
prompt did not supply the expected answer. Both source passages opened inside
the captured surface. The answer became a project note; adding an editorial
review sentence created a second version while preserving the original. Export
used the normal Allow once permission prompt, and reopening verified the saved
Markdown bytes and hash.

Final acceptance receipt:
`data/demo-studio/bridge-acceptance/1792097331440/receipt.json`.
Video: session assets `clip-e02afd13-e3e0-4ca1-bc43-e329e5d8778a.mp4`,
30.07 seconds, 1920 by 1080, silent, 309 captured frames at approximately
10.28 fps. The entire file decoded successfully. Visual review used one frame
per second across the recording and full-resolution milestone screenshots.
The original and edited notes, both passages and reopened export were visible.
This is an acceptance recording, not an approved or published marketing edit.

The first successful recording and its receipt remain in
`data/demo-studio/bridge-acceptance/1792097220025/`. Its edited-note framing was
too low on the page; the final script scrolls the note into view and holds it.
The separate main Studio service and the owner's synthetic-report session were
not restarted or modified. The bridge is running in the separate local test
Studio; the installed Signal 0.55 adapter and main Studio were not upgraded.

## Markdown display correction

The owner identified raw Markdown in the reopened export. Complete Markdown
exports and project notes now use Lemonade's existing Markdown renderer. Source
passage highlighting and the exact Markdown used for editing/export remain
intact. The corrected renderer is loaded in the isolated demo window.

The Lemonade build and existing Markdown checks passed. Live inspection of the
saved answer verified lists, emphasis and currency in dark/light themes at 1180
and 390 pixels, no modal overflow, unchanged editor text and export SHA-256,
and retained source highlighting. Evidence:
`data/demo-studio/markdown-review/1792098088611/receipt.json` and screenshots.
The earlier acceptance videos retain the display they originally captured;
use the updated app for subsequent recordings.

See [Product automation](../apps/demo-studio/AUTOMATION.md) for the exact command
contract and acceptance procedure.
