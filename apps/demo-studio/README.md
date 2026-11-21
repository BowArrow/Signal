# Signal Demo Studio

A local app for operating the real Lemonade desktop product and making reviewable marketing material. It uses a separate Lemonade home and Chromium profile for each session. Capture and editing run locally without a model. Optional LTX generation uses the local capped renderer and respects its existing hold. The studio does not start Codex, publish content, or connect to your personal Lemonade workspace.

## Open it

Run `scripts/start-demo-studio.ps1` from PowerShell, or use the Signal Demo Studio desktop shortcut if installed. Choose a session title and **Open Lemonade**. Use the real Lemonade window or **Interact with the product** in the studio. Save screenshots, record a clip, write narration notes, and export the demo pack.

Requires Node 22+, this repository's dependencies, and either the adjacent built Lemonade checkout or `DEMO_STUDIO_LEMONADE_EXE` pointing to a packaged Lemonade executable. The launcher runs the Node service in the background. Closing the studio browser window does not stop the service. **Close demo** stops only the Lemonade process launched for that session.

Video requires FFmpeg. The studio discovers Signal's installed FFmpeg or uses `DEMO_STUDIO_FFMPEG` / `ffmpeg` on PATH. Capture targets 8–30 fps and preserves elapsed frame timing; the actual rate depends on the computer and is recorded in each receipt. The October 15 directed capture measured about 11 fps at a 24 fps target. Edits render at 30 fps for smooth zooms; this does not create missing product-motion detail. Capture is silent and defaults to 120 seconds; agents can request up to 600 seconds for a complete inference workflow. Imported narration or music can be added in the edit. PNG capture does not need FFmpeg.

**LTX shot direction** includes Start local LTX, Check local LTX and Stop local LTX. Finish capturing and close the Lemonade demo window first; saved takes stay available. Starting is asynchronous; check readiness before submitting. The studio reuses the installed model files, starts no downloads, and keeps the existing RAM/GPU watchdog.

**Frame & movement** sets output size and cursor position. Output sizes are 1920×1080, 1080×1920, 1080×1080 and 1080×1350. The native product window keeps its correct expanded size; the output fits that image into the chosen frame. **Edit a marketing video** adds trimming, whole-frame or cropped fit, focal-point zooms, timed text and audio. Source captures are retained. For agent-directed editing and LTX, read [Directing guide](DIRECTING.md).

## Agent use

For real sample-file import, tracked AI comparisons, source navigation and
versioned Markdown/text exports, read [Product automation](AUTOMATION.md).
`product.resume` reopens a saved isolated profile with its settings preserved.
Its licence and selected local model must pass the normal product checks.

Attachment to the normal licensed Lemonade instance is not implemented yet.
The current launcher uses an isolated profile, including when a packaged
executable is configured. The [licensed-instance interface checklist](../../docs/lemonade-studio-interface.md)
defines the required product bridge, window control, recording and safe detachment.

An agent with local command access can import the client, without handling authentication itself:

```js
import { studioCommand } from './apps/demo-studio/client.mjs';
await studioCommand({ action: 'launch', title: 'A fictional client project' });
const view = await studioCommand({ action: 'observe' });
// Read view.text and view.controls. Use a real returned ref and revision.
await studioCommand({ action: 'click', ref: view.controls[0].ref, revision: view.revision });
await studioCommand({ action: 'screenshot', title: 'Project overview' });
await studioCommand({ action: 'note', text: 'Draft narration. Verify the observed result before making a claim.' });
const receipt = await studioCommand({ action: 'export' });
// receipt.saved, sessionId, folder, script and manifest identify durable outputs.
await studioCommand({ action: 'close' });
```

From a shell: `node apps/demo-studio/client.mjs --file path/to/command.json`. Omitting arguments returns status. The JSON file contains one command from the table below. Use structured files when shell quoting is inconvenient. Do not print or share `data/demo-studio/connection.json`: it contains the local connection token.

| Action | Fields | Result |
| --- | --- | --- |
| `status` | none | Connection, sessions, assets, recording and FFmpeg availability |
| `session.open` | saved `sessionId` | Continue editing a saved session after restart, without launching the product |
| `launch` | optional `title` | New isolated session and initial observation |
| `observe` | none | Screen text, visible controls, references and revision |
| `click` | `ref`, `revision` | Real mouse input; observe again afterward |
| `fill` | `ref`, `revision`, `text` | Replace text through keyboard input |
| `key` | `key` | Enter, Tab, Escape, Backspace or arrow keys |
| `scroll` | `delta`, optional `x`, `y` | Mouse wheel input |
| `screenshot` | optional `title` | PNG, SHA-256 and saved receipt |
| `record.start` | optional `title` | Begin a silent sampled recording |
| `record.stop` | none | Encode MP4 and return saved receipt |
| `note` | `text` | Save draft narration or observation |
| `export` | none | Markdown shot list/script and JSON capture manifest |
| `format.set` | `format`: landscape/portrait/square/feed, `fps`: 8–30 | Output dimensions for subsequent recordings |
| `cursor.move` | normalized `x`, `y` (0–1), `durationMs` (0–10000) | Eased visible pointer movement and real hover input |
| `cursor.set` | `visible`, optional `clicks` | Pointer and click-ring visibility |
| `wait` | `milliseconds` (0–10000) | Hold the shot while recording continues |
| `asset.import` | absolute `path`, `title`, `role`: reference/generated/audio | Copy an image, MP4, or audio file into the session |
| `edit.render` | `edit` (see directing guide) | Render and save a local MP4, up to 12 shots / 120 seconds |
| `ltx.start` / `ltx.stop` | none | Start the installed renderer with memory supervision; stop only the studio-owned idle renderer |
| `ltx.status` | none | Model receipt, running service, live supervision and existing hold |
| `ltx.prepare` | `direction` (see directing guide) | Joey-directed prompt, bounded Comfy workflow, reference and durable plan |
| `ltx.submit` | `planId` | Submit once if runtime checks pass and no hold exists |
| `ltx.poll` | `planId` | Retrieve generated MP4 or report render state; never declares creative approval |
| `close` | none | Finish recording and close this demo's Lemonade process |

The local HTTP interface is `POST /api/command` with a JSON command and bearer token. `GET /api/status` and `/api/help` expose state and instructions. Default address: `http://127.0.0.1:4319`. The service binds only to loopback, checks Host and Origin, rejects cross-origin requests, and requires a random per-start token for all control and asset endpoints. The launcher uses a fragment to establish an HttpOnly, SameSite cookie for the studio. No arbitrary JavaScript or shell execution endpoint exists.

For Signal's in-process marketing agent, source integration adds `demo.status` and `demo.command` for the Lemonade product only. Start the studio first. An installed Signal release must include those source changes to expose these tools; the existing 0.55 installation does not. Other agents can use this standalone client immediately.

## Dots

Give your dot access to this computer and point it to this README. Local access is a prerequisite, not an automatic integration or a saved dot schedule. The studio itself uses no model tokens. Your dot's own work and any Work/Codex tasks it delegates remain subject to their respective usage rules. See [official computer connection instructions](https://learn.chatgpt.com/docs/dots/computers-and-apps).

Suggested instruction:

> Use Signal Demo Studio in C:\Users\cshor\Documents\WebProjects\Signal. Read apps/demo-studio/README.md. Capture a real Lemonade walkthrough using fictional data, save the screenshots and silent clip, and export a demo pack. Check the actual result before describing a feature as working. Do not publish or start Work/Codex tasks without my approval.

## Data and scope

All sessions live under `data/demo-studio/sessions/<session-id>/`. `assets/` holds PNGs, MP4s, scripts and manifests. `session.json` records actions and notes. `frames/` preserves source frames if encoding fails. `sample-documents/` contains two clearly fictional supplier documents; importing them is a product interaction, not a model-produced result. Session data is ignored by Git.

New sessions start without a chosen local model. Features that need inference require configuring a model through Lemonade and verifying the resulting work. This app does not bypass licensing, fabricate responses, copy accounts, or promise that every product feature is ready. It controls the main product panel; separate editor windows, native file pickers, passwords and files outside the approved Studio sample set still require direct interaction. Exported notes are drafts, not evidence of feature correctness.

Tests: `node --test apps/demo-studio/tests/*.test.mjs`. Real-product smoke check: `node scripts/demo-studio-smoke.mjs`. Directed edit check: `node scripts/demo-studio-director-smoke.mjs` with `DEMO_STUDIO_FFMPEG` set. These checks create only new isolated demo sessions. The directed check prepares a synthetic LTX fixture but does not submit it for inference. On October 15, a five-second local preview completed at 384?512 / 24 fps and passed full-file decoding. The matching validation receipt enables Demo Studio previews while retaining Signal?s separate production hold. Generated footage still requires creative review. Use `node scripts/demo-studio-ltx-smoke.mjs --session=<saved session UUID>` for an explicit real inference check; it requires the validation receipt and never clears a hold. The live agent check submitted successfully but stopped at the RAM reserve while another demo was open; capture and LTX generation should run sequentially on this machine.
