# Product automation

The bridge operates one approved project inside an isolated Lemonade profile.
Resume reuses that profile's settings, licence state, selected model and project.
It does not attach to the owner's normal application home. Build the adjacent
Lemonade checkout with `npm.cmd run build` before launching a bridge session.
An older packaged executable will report an unavailable bridge.

Open **Work with sample documents** in Studio for the same controls used by the
local agent client. Choose approved samples there; no native file picker opens.
The initial approved set is the two synthetic supplier reports created with the
session. Arbitrary paths, private projects, inbox content and code execution are
not accepted by this interface.

## Commands

| Command | Input | Receipt |
| --- | --- | --- |
| `product.resume` | `sessionId` | Same session and profile, plus licence and selected-model readiness |
| `product.status` | none | Approved project, samples, imported documents, readiness, runs, operations, exports and event history |
| `product.setup` | `view: license` or `models` | Opens the normal Lemonade setup surface |
| `samples.list` | none | Approved sample IDs, names and SHA-256 hashes |
| `documents.import` | `projectId`, `sampleIds` | Queued operation ID; poll for document IDs, extraction status, hashes and `saved: true` |
| `operation.status` | `operationId` | Queued/running/completed/failed, start/end timestamps, result or structured error |
| `turn.send` | `projectId`, `documentIds`, `prompt`, `requestId` | Run ID; inference continues asynchronously |
| `turn.status` | `runId` | State, actual partial/final answer, attachment citations, model/backend, source hashes and timings |
| `source.open` | `runId`, `citationId` | Actual imported passage displayed inside the recorded product panel |
| `result.open` | `runId`, optional `exportId` | Editable project note and current version; with an export ID, reads and displays the actual exported file |
| `result.save` | `runId`, `text`, `baseVersion`, `reason` | New saved version and hash; original answer stays unchanged |
| `result.export` | `runId`, `format: md` or `txt` | Queued operation; poll for output path, hash, version history and export ID |
| `observe` | none | Existing screen/controls plus product readiness, runs, active project/document and visible blocking dialogs |

Imports and exports use jobs because an existing product permission prompt may
need a person. Poll their operation IDs while recording continues. The standard
permission prompt remains in Lemonade; no Windows Open or Save dialog is used.
`Never` permissions remain denied. A failed job has an error code and no success
receipt. A multi-file import can preserve earlier successful imports; inspect
`product.status` after a partial failure before retrying.

`turn.send` checks the licence and selected local model, then returns a run ID.
Reuse its request ID only for identical input; retries return the existing run.
The document-chat mode uses Lemonade's inference client and chat store with the
approved attachments and no general agent tools or private retrieval. The
selected model must be installed and its local runtime reachable. Ready means
eligible to run; loading and inference can still fail. Completion is not a claim
that the answer is correct.

Source IDs belong to that run. The bridge verifies source hashes before showing
them. `result.open` preserves the original answer as the first project-note
version. Saves require the current base version to avoid overwriting another
edit. Exports are confined to the session's `assets` folder, and reopening checks
the saved file's SHA-256 before displaying its bytes.

## First real check

1. Launch a session or resume its ID. Activate its licence and select an installed
   local model using the normal Lemonade screens. Never copy licence files or
   reset a trial. `LICENSE_REQUIRED` and `MODEL_NOT_READY` are setup failures.
2. Start recording. The default limit remains 120 seconds; agents can request
   `maxSeconds: 600` for a complete inference workflow. Capture timing remains
   measured, and footage is silent.
3. Import `supplier-original` and `supplier-revised`; wait for a completed import
   operation. They contain $2,400 and $2,520. Send a comparison prompt without
   supplying the expected answer.
4. Poll the run. Verify the actual $120 finding and both citations, then open each
   source in the product panel. A wrong, incomplete or failed answer fails this
   check. Do not replace it with manually written comparison text.
5. Open the completed answer, make a disclosed editorial edit, save a new version
   and export Markdown. Approve that file write in Lemonade if prompted. Reopen
   the exported file by export ID and verify the text and hash.
6. Stop recording and export the demo pack. Review the complete video and source
   passages. The manifest includes original/edited output provenance, source and
   export hashes, operation timing, model identity and failures.

`node scripts/demo-studio-bridge-session.mjs` starts an isolated test Studio and
opens a new product profile, leaving the main Studio service alone. Its printed
folder contains a private `connection.json`. To repeat in the same profile, pass
`--session=<UUID>` after its prior Studio/product process has exited.

Run the real check with:

```powershell
node scripts/demo-studio-bridge-acceptance.mjs --connection=data/demo-studio/bridge-check/<run>/connection.json
```

The check retains a failed receipt when activation, inference or comparison
fails. It can confirm the specific session export using the normal **Allow once**
button, matching the owner's requested export. It never changes permission
settings. Successful automation still needs full visual review; fixtures in
unit/UI tests are not live AI evidence.

Checks: `node --test apps/demo-studio/tests/*.test.mjs`,
`node scripts/demo-studio-bridge-ui-check.mjs`, and, from Lemonade,
`node scripts/demo-bridge-check.mjs` plus `npm.cmd run build`.

LTX holds, models, resource reserves and renderer limits are unchanged by this
bridge. Finish product capture before attempting LTX work under the existing
resource policy.
