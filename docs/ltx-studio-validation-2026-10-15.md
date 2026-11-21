# Local LTX setup, October 15, 2026

The retained production hold came from an earlier cropped preview with rejected
face detail, plus incomplete runtime and packaged-release validation. The model
files were already installed. This work adds managed start/stop commands to
Demo Studio and validates a local preview configuration; it does not release
Signal's unattended production queue.

## Completed render

`data/ltx-preview-validation/1792083653665/preview.mp4` completed in about 129
seconds with the full Joey-structured prompt prepared by Demo Studio. FFprobe
reports 384×512, 121 frames, 24 fps, and 5.041667 seconds. The whole file decoded
without FFmpeg errors. Sampled frames preserve the full head and show coherent
gaze/smile motion. Full creative acceptance remains the owner's decision.

The retained configuration uses one asynchronous transfer stream, a 6 GiB GPU
headroom target, 16 GiB commit ceiling and 3 GiB working-set ceiling. The original
6 GiB RAM and 8 GiB commit reserves, whole-device 8 GiB GPU watchdog and thermal
guard remain unchanged. Two transfer streams exceeded the GPU watchdog with
the longer directing prompt. A CPU text-encoder experiment eventually reached
the RAM reserve and was not retained. No upstream ComfyUI source was modified.

The decoder now uses 64-frame temporal tiles with 16-frame overlap. Prepared
references fit inside the bounded preview frame instead of cutting off heads.
These are small local previews, not native 1080p generations.

## Demo Studio integration

- `ltx.start` starts the installed, offline, supervised renderer asynchronously.
- `ltx.status` explains readiness, the production hold and resource stops.
- `ltx.stop` refuses to interrupt a queued render and stops only the studio-owned
  renderer. The watchdog also stops if the owning application exits.
- A local preview receipt is bound to the runtime source fingerprint and exact
  production hold. New holds or runtime changes invalidate that receipt.
- Saved plans must match the current runtime fingerprint. Temporary connection
  failures keep polling the same supervised job rather than resubmitting it.
- Generated assets retain `qualityApproved:false` and require review.

The live agent check successfully prepared and submitted jobs. While another
Lemonade demo was open, those runs stopped at the RAM reserve during model
loading. Tighter 14 GiB commit / 2–3 GiB working-set experiments did not resolve
that condition; the completed-render configuration above was restored. No
successful end-to-end agent API render is claimed under that concurrent load.

Capture first, stop recording, then close the Lemonade demo window. Saved takes
and the session remain available for LTX preparation and editing. Start LTX
afterward. The active synthetic-report demo was left open until it closed independently.
The studio was then restarted with the final server-side controls. A later
startup check was held with only about 3.6 GiB RAM available; a separate
llama-server process was using about 5.7 GiB. That process was left untouched. The runtime arguments
and workflow are read from source on start/preparation.

Evidence: `data/demo-studio/ltx-check/` contains live submissions and failed-run
receipts; `data/demo-studio/ltx-ui-check/receipt.json` records desktop/mobile UI
checks. Unit tests cover holds, fingerprint changes, duration limits, duplicate
submission, transient transport failures, and Windows ownership/resource limits.

## Follow-up after permission to unload Ollama

The owner authorized unloading the competing Ollama model while preserving the
dot's session. On the follow-up check, `ollama ps` was already empty and no
Ollama model runner remained, so there was no model to unload. No unrelated
application was stopped and the main Studio service was not restarted.

An isolated Studio API check against the separate directed-demo test session
still stopped before inference. The supervisor measured 12,476,133,376 bytes
of free physical RAM and 23,063,998,464 bytes of free commit (about 21.48 GiB).
The retained 16 GiB job ceiling plus 8 GiB reserve requires 24 GiB of free commit
at startup. No resource limits or reserves were lowered. The end-to-end Studio
API render therefore remains unverified; the earlier standalone preview remains
the completed render evidence.

The protected synthetic-report session was already recorded as closed when
checked, and its saved captures and notes were left intact.
