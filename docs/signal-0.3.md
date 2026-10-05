# Signal 0.3: setup and validation

Signal's growth workspace uses the existing Lemonade and CineGen business profiles. Brand overrides, campaigns, customer conversations, and outcomes persist separately for each business. Existing history remains in SQLite; startup applies the added database migration and refreshes configuration-owned product facts.

## First useful workflow

1. Open Settings. For local execution, select Local, click Start local runtime, choose installed models for all three roles, and save. This machine already has Ollama and `gemma4:e4b`; Signal can launch the installed runtime. Enable startup if you want it launched whenever Signal opens. For GPT, save your OpenAI API key, choose a model available to your account, set the daily request cap, and save the provider. Test saved provider before queuing work.
2. In Growth workspace, select Lemonade or CineGen and confirm Brand & offer. Include concrete proof and any feature limitations. Existing profile defaults are starting context; your saved brand overrides take precedence.
3. Open Channel playbooks and choose a small test. In Campaign studio, save a brief with the requested formats and queue generation. Signal saves each completed material separately, so retrying a failed campaign resumes missing formats. Active tasks and cancellation are visible in Growth lab's Agents tab.
4. Read and edit each material. Verify claims, voice, and destination before approving. Export the campaign or copy material into the relevant publishing tool. The Distribution calendar stores reminders; it does not silently publish on a deadline. Record the actual publication URL after distribution.
5. Record customer conversations and follow-up dates in Lead pipeline. Record observed results in Revenue & outcomes, with a source and unique reference. The JSON example in that screen shows the import contract. Use disjoint increments rather than overlapping cumulative reports. Gross sales do not automatically fund the cash spending envelope.

For recurring work, Marketing agent can research public evidence, maintain memory, prepare campaigns, and submit configured local media jobs. Its `campaign.create` action queues multi-format production in the same workspace. Enable its scheduled cycles only after checking the saved provider and model. The desktop must remain open for these local workers to run.

## Local creative setup

Creative studio can connect to a running ComfyUI server or launch an existing Windows portable installation. Choose the root containing `ComfyUI/main.py` and `python_embeded/python.exe`, then Start ComfyUI. Signal starts built-in nodes only, uses its own output directory, and reserves 1 GB VRAM for the desktop. It never stops a server it did not launch.

An existing compatible installation was found on this machine at:

`C:\Users\cshor\AppData\Local\ai.dndrom.desktop\runtime\comfy-0.34.0\ComfyUI_windows_portable`

That installation belongs to another application. It was reused for a bounded validation without modifying its code or model files. Choose it explicitly, or use a separate ComfyUI portable installation for Signal. Downloads and existing model files can consume tens of gigabytes; the app checks installed components before enabling a recipe.

The tested Krea 2 Turbo recipe used its FP8 diffusion model, Qwen3-VL 4B FP8 encoder, and the existing Wan 2.1 VAE. The current official Krea tutorial names the Qwen image VAE; the recipe also recognizes that filename. The recipe card links to installation instructions and the model license. Check those terms for your business before commercial use.

Select a saved image brief, edit it to describe one image, choose an added recipe, and Generate locally. Review the output inline or use Save & open. For product demonstrations, use actual screenshots; generated UI is not evidence that a feature exists. Video scripts are shot plans: adapt one shot into the video prompt, render it, then edit and typeset the full promotional piece in the production tool.

FLUX.1 Schnell and Wan 2.2 5B recipes are included with node/model readiness checks. Their weights were not installed for this validation. Advanced local API-format workflows can be imported; custom execution nodes and paid API nodes are rejected. Signal holds the agent lane while media is pending and reconciles lost submission responses before allowing another render.

## Validation record

The unchanged baseline passed 494 tests. The completed suite passes 509 tests across 28 files, including campaign lifecycle, retries, cancellation, outcome idempotency, provider routing, request limits, ComfyUI submission recovery, and creative quality checks. TypeScript and lint checks pass. The Windows installer was built, and the packaged executable passed the isolated desktop workflow checks.

Live local generation produced saved social copy and an image brief for Lemonade and CineGen. A real ComfyUI Krea render completed at 1024 × 1024 and was visually inspected. Built Electron UI checks exercised both business profiles, all 19 playbooks, approval and settings persistence, creative setup, and 1440 × 900 / 720 × 800 layouts without renderer errors. The generated image and screenshots are in `data/studio-validation/`; they are development validation artifacts, not seeded production results.

GPT transport is covered with controlled HTTP fixtures, including errors and incomplete responses. A live GPT generation remains dependent on your key and account/model access. Wan video and FLUX generation require their installed weights and live render checks. Automatic external analytics imports and distribution require the corresponding service adapter, credentials, and explicit configuration. This work did not send customer messages, spend ad budgets, publish campaign material, or replace the installed application.

## Reproduce

`pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` validate source and bundles. `node scripts/studio-ui-smoke.mjs` exercises built Electron against an isolated fixture database. Pass an absolute packaged `Signal.exe` path to check the packaged application. `pnpm exec tsx scripts/studio-live-smoke.ts Lemonade` (or `CineGen`) exercises an actual local model without publishing. `scripts/creative-live-smoke.ts` accepts a ComfyUI portable root and runs the bounded real image test. `node scripts/render-growth-report.mjs` reproduces the standalone HTML and PDF report.

`pnpm package` builds the Windows installer under `release/`. Installing or replacing an existing desktop installation is a separate action from producing and testing that installer.
