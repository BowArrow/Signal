# Licensed Lemonade control interface

Implementation checklist, October 15, 2026. This is a proposed contract, not an
interface available in the installed applications.

The subsequent [isolated-profile bridge](../apps/demo-studio/AUTOMATION.md) is
implemented in source, with its [validation status](studio-bridge-validation-2026-10-15.md)
recorded separately. The normal-instance attachment proposed below remains future
work; it is not required for the requested isolated-profile acceptance test.

## Outcome

Studio attaches to the user's running, licensed Lemonade, operates a selected
product window, records actual product behavior, and disconnects without closing
Lemonade. Dots use Studio's existing local client. Lemonade owns its licence,
model runtime, document permissions, and application state throughout.

The first acceptance demo is a real comparison of two synthetic supplier reports:
120 boxes at $2,400 versus $2,520. Lemonade must generate the comparison and save
the result before the recording can claim that it performed the work.

## Verified gaps

| Evidence | Consequence | Required change |
| --- | --- | --- |
| `apps/demo-studio/studio.mjs`, `Studio.launch()`, creates a new `LEMONADE_HOME`, Chromium profile and model port; defaults `defaultModel` to null. | A Studio session does not inherit the user's normal licence state, selected model or workspace. | Attach to the existing app through a supported interface. Keep isolated launch as a separate option. |
| Lemonade's `src/main/paths.ts` resolves state from `LEMONADE_HOME`; `src/main/licensing/index.ts` reads the licence from that root. | Pointing Studio at the installed executable alone does not make its isolated profile the normal licensed profile. | Query the running app's entitlement status. Do not copy licence files or bypass entitlement checks. |
| The saved synthetic-report session note reports "Trial finished" and explicitly identifies the comparison as manually authored. | The existing marketing take is evidence of editing notes, not AI report comparison. | Check entitlement and model readiness before planning an inference demonstration. |
| `Studio.launch()` selects one CDP page whose URL contains `surface=panel`; `requireSession()` requires a Studio-owned child. | There is no normal-instance attachment or supported window switching. | Separate connection ownership from product process ownership; enumerate and select approved surfaces. |
| `Studio.close()` calls `taskkill /T /F` for its child on Windows. | This behavior cannot be reused to detach from the user's normal application. | Add detach with no app termination, no settings reset and no account changes. |
| `cdp.mjs` rejects password and file inputs; Lemonade uses native file dialogs. | An agent cannot finish every document workflow through the current control list. | Add scoped fixture import and explicit human-handoff states. |
| Capture uses repeated screenshots; the saved session reports roughly 14-15 actual fps and silent output. | A 30 fps edit is not evidence of 30 fps product capture. | Report measured timing and dropped frames; negotiate native capture capabilities if higher fps/audio are needed. |
| The saved session note reports a session-file rename error during a take. | Durable receipts and concurrent access need explicit handling. The precise cause has not been reproduced. | Give each session one writer, use unique temporary files, handle Windows sharing failures with bounded retries, and test competing clients. |

Source paths under `src/main/` above refer to the adjacent Lemonade repository.
The session evidence is retained under
`data/demo-studio/sessions/ae2c15d4-9b0a-4c97-a369-a2a5ba11d3ec/session.json`.
The note is the dot's recorded account; this review did not independently replay
or revalidate that video. No live licence credentials were inspected.

## Minimum interface

All operation names below are proposed. Version and advertise capabilities so an
older packaged app reports a specific unsupported feature instead of silently
falling back to an isolated profile.

| Proposed operation | Required response or behavior | Owner |
| --- | --- | --- |
| `product.discover` | Protocol version, app version, ephemeral instance ID and available connection method. No account data or licence material. | Lemonade bridge / Studio adapter |
| `product.attach` | Connect to an explicitly paired instance; return a connection ID, capabilities and `ownership: attached`. Never start a second writer against the normal application home. | Both |
| `product.status` | Entitlement state and `active`, selected model and its loading/ready/error state, busy operations, selected window, and any required human step. Redact licence keys, machine identifiers and account details. | Lemonade |
| `windows.list` / `windows.select` | Stable window IDs for approved panel/editor surfaces, surface type, visibility, logical bounds, pixel size and scale factor. Selection is explicit. | Lemonade |
| `window.frame` | Apply supported product modes/bounds, then return the actual settled viewport. Keep native sizing separate from Studio's output aspect ratio, crop and zoom. | Lemonade |
| `observe` | Window ID, revision, visible text, bounded control references, roles and editable/disabled states. Exclude secrets. References belong to that window and connection. | Lemonade |
| `click` / `fill` / `key` / `scroll` / `cursor.move` | Validated, bounded user input. Reject stale or covered controls; never invoke arbitrary JavaScript or arbitrary IPC supplied by an agent. Return an action ID. | Lemonade |
| `documents.import` | Import only files explicitly staged for this demo through the ordinary product import path. Return document IDs, hashes and indexing readiness; never silently add personal watched folders. | Lemonade / Studio |
| `operation.status` / `events.read` | Correlated operation ID, pending/running/completed/failed/cancelled state, event sequence and result references. A timeout must not become a claimed success or automatic duplicate submission. | Lemonade |
| `screenshot` | Capture the selected approved window; return pixel dimensions, timestamp and bytes to Studio for durable storage. | Lemonade / Studio |
| `record.start` / `record.stop` | One recording ID, selected window, requested and measured fps, dimensions, timestamps, dropped-frame/error information and explicit audio capability/state. Stop is idempotent. | Both |
| `product.detach` | Finalize or recover the current recording, revoke control and remove temporary overlays. Leave Lemonade, documents, licence and user settings intact. | Both |

For saved outputs, Studio returns `saved: true`, an operation ID, session ID,
asset path, byte count and SHA-256 only after the output and manifest are durable.
Observation and action receipts alone do not establish that a generated document
was saved. Keep captured-product, manually authored and generated assets distinct
in the manifest.

## Connection and session rules

- [ ] Implement the bridge inside the normal Lemonade main process. Reuse its
  WindowManager, validated input path and application services. Do not require
  public remote-debugging ports or duplicate the licence/model runtime in Studio.
- [ ] Provide an explicit local pairing control and visible connected/recording
  state in Lemonade, with an immediate disconnect control. Use a current-user
  restricted named pipe or an authenticated loopback endpoint with Host/Origin
  checks, per-connection credentials and revocation. Never place secrets in
  recordings, manifests or ordinary logs.
- [ ] Preserve normal entitlement enforcement. Return `human_required` for
  activation, missing model setup, unavailable native interactions or a denied
  permission, including a concrete next action and a resumable operation ID.
- [ ] Support a single controlling lease per attached window/session. Other
  clients can inspect permitted status but cannot switch the active session or
  overwrite an in-flight take. Lease loss stops input and recovers capture.
- [ ] Stage fictional data in a named demo project within the licensed app. Show
  the selected scope before capture; do not silently capture unrelated windows.
  Detaching never deletes the demo project or changes personal preferences.
- [ ] Route model requests through the same licensed production path used by the
  UI. Never substitute canned output, inject an assistant response or infer model
  completion from a fixed delay.
- [ ] Preserve running work when Studio disconnects or restarts. Persist enough
  recording/operation identity to recover without replaying a mutating action.
- [ ] Use live memory readiness for LTX. For an attached app, replace the current
  blanket instruction to close Lemonade with an idle-state check and an explicit
  model-unload handoff when needed. Detachment does not free the app's model RAM.
  Never unload an actively used model or terminate the normal app automatically.

## Implementation order and locations

1. **Lemonade bridge and contract.** Add shared versioned request/response types
   under `src/shared/`, bridge lifecycle after `AppContext.boot()` in
   `src/main/index.ts`, and approved surface access through `src/main/windows.ts`.
   Reuse `src/main/ipc.ts` service behavior, `src/main/licensing/` entitlement and
   existing model status. Keep the transport separate from UI IPC registration.
2. **Studio connection abstraction.** In `apps/demo-studio/studio.mjs`, represent
   isolated-child versus attached-instance ownership explicitly. Add attachment,
   detachment, window selection and preflight commands to `protocol.mjs`; keep
   the existing CDP implementation as the isolated-launch adapter. Never route
   attached instances into the current process-killing `close()` branch.
3. **Capture and durable sessions.** Add the product capture adapter, lease and
   operation journal. Preserve the existing editor, formats, overlays and FFmpeg
   exports. Fix the reported persistence failure once reproduced, without
   modifying another client's active session.
4. **Guided UI and agent entry point.** Offer "Use my open Lemonade" and "Open an
   isolated demo" as explicit choices. Explain licence/model/window readiness
   and human steps before recording. Update `src/core/marketing/demo-studio.ts`,
   the local client guide and capability examples together.
5. **Package and validate.** Build and test the Lemonade bridge, then package the
   relevant apps. Source changes alone do not enable the installed releases.

## Acceptance checklist

- [ ] Attach to a packaged licensed Lemonade already running with unsaved work.
  Confirm its PID, normal application home, licence and selected model stay the
  same; detaching leaves the unsaved work and application open.
- [ ] An older app returns a clear unsupported-version result. Missing pairing,
  expired credentials and revoked access deny control.
- [ ] A second agent cannot steal an active session or stop its take. Repeated
  operation IDs do not create duplicate imports, model requests or recordings.
- [ ] Inspect and operate both panel and a separate document editor. Test display
  scaling, window movement/resizing, stale references and window closure.
- [ ] Import the two synthetic reports through the product, wait for indexing,
  run the real comparison, observe model completion, save the result and reopen
  it. Record the actual operation/result IDs and retained output.
- [ ] Trial-expired, model-missing and native-dialog cases produce actionable
  human handoffs. Resuming continues the same operation without fabricated output.
- [ ] Capture landscape, portrait, square and feed outputs with cursor movement,
  zoom and titles. Verify full-file decoding, framing, timing and measured fps.
  Audio is recorded only when explicitly enabled and supported.
- [ ] Disconnect, Studio restart, Lemonade restart and mid-recording failure leave
  recoverable assets and truthful completion states. Reproduce and resolve the
  reported rename failure with competing clients and Windows file contention.
- [ ] Verify the installed build end to end before marking licensed attachment
  available to dots. Human review of the final marketing take remains separate.

LTX is independent of this missing product bridge. Its successful standalone
five-second preview does not establish licensed Lemonade control or a completed
Studio API render. See [current LTX evidence](ltx-studio-validation-2026-10-15.md).
