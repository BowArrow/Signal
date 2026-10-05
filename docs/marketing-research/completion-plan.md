# Signal completion plan

The target is a desktop growth operator for Lemonade and CineGen that can research customer needs, choose bounded channel experiments, create reviewable campaign materials, help execute distribution, and measure the path to paying customers. Revenue is an observed business outcome, not a software guarantee.

## Current checkpoint: September 21, installed Signal 0.34.0

The owner-profile audit reports both businesses paused and passing saved configuration readiness for website/Bluesky/X publishing, branded cards, inbox triage/replies, website lead intake, Stripe and GA4. This is not a fresh provider delivery check or proof of a complete autonomous campaign. Facebook Page connections remain in attention. Initial outreach is disabled, with no mailing address configured.

Lemonade now has three LTD community campaigns (KenMoo, LTDHunt, Lifetimo), one creative campaign, eight draft assets and three administrator prospects with unknown permission. Its saved operating objective prioritizes the bounded LTD test. Separate UTM links and idempotent import readback passed; no community messages or posts were sent. See `output/ltd-campaigns/import-result.json`.

Affiliate enrollment and unpaid live checkout attribution passed for both sites. Verification email From headers now use `support@aionx.aionapp.org` and actual action links passed. Live Connect account creation still returned `account_create_activation_required` at 18:33 UTC; onboarding and payouts remain disabled. Recipient inbox placement and real affiliate payouts are not established. See `data/affiliate-readiness/` and the Lemonade affiliate launch report.

After the IDE restart, OpenArt's authenticated connector is callable in this chat. The live account check returned Pro and 20,902 credits; its model catalog includes Seedance 2.5. A single six-second 480p portrait reference-based clip with audio was quoted at 360 list credits, or 324 with the account's current MCP discount; the charge is finalized at submission. No generation was submitted during this audit. The desktop app does not yet contain an OpenArt provider integration: chat access is not unattended access from Signal.

Remaining acceptance work: integrate the chosen cloud creative route into Signal with persistent jobs and spending limits; produce and review real ads using genuine product footage; validate a complete bounded agent cycle and sustained operation on the selected runtime; package the latest runtime changes; repair Facebook access if that destination is needed; finish Stripe Connect activation and payout validation. Confirm actual placement and attribution evidence without interpreting software readiness as guaranteed sales.

### September 19 checkpoint

At 22:09 UTC the owner's local text-agent device was changed from auto to CPU, with the previous settings backed up under data/runtime-cpu-owner. Both business operations remain paused; no model was launched. This setting applies to future text-agent requests and does not clear the local H3 hold or change GPU power limits. The owner connection audit still reports Facebook attention and initial outreach disabled without a mailing address. Connection readiness is saved configuration, not a fresh delivery proof. Twenty-two revenue tests passed, including strengthened subscription-invoice campaign matching and conflicting-metadata checks.

The website attribution fixes are now deployed. Both checkout functions report ACTIVE, public campaign wiring passes, and desktop/mobile browser checks retain campaign IDs across navigation. Lemonade buy-button requests were intercepted and verified; no live payment session was created. Both signup scripts match their deployed hashes. See [checkout attribution](checkout-attribution.md).

At 22:39 UTC, actual Stripe-hosted sandbox checkouts completed for Lemonade's one-time flow and CineGen's Creator subscription flow. Signal's real read-only services matched the correct products and campaigns, kept businesses separate, retained a partial refund, rejected test/live mismatch and avoided duplicate counts or converting trial leads into real customers. The test subscription was canceled and temporary catalog objects archived. Owner live settings were untouched. Auth/storage were isolated, so real verification-email delivery, fulfillment and the live lead-to-sale journey remain open. See [sandbox acceptance evidence](stripe-sandbox-validation.md).

The custom top-up acceptance check exposed a separate measurement gap: CineGen created a new Stripe product for every custom purchase. Checkout now reuses a dedicated product, and a real USD 7 sandbox checkout for 280 tokens matched its campaign in Signal. The product exists in both Stripe modes; the owner's CineGen mapping now includes it, with the existing restricted key and history window preserved and a complete read-only scan verified. The checkout function was deployed and verified ACTIVE at 22:47 UTC. See [custom top-up attribution](custom-topup-attribution.md).

Two fictional character references (Maya for Lemonade, Eli for CineGen), product-specific story bibles and four draft script/prompt assets are now saved in the owner app. References were generated using the built-in image tool, copied into output/ad-drafts and imported into Signal with verified hashes. No characters are approved and no video job was queued. The owner has been asked to choose the character direction. See [draft materials](../../output/ad-drafts/README.md).

Version 0.34.0 adds per-business scheduled cloud video production: one character shot, playback approval, an ad assembly task tied to that shot, then finished-ad approval. Persistent cycles prevent duplicate production after restarts or repeated ticks. Run/Pause governs planning, cloud submission and CPU editing; missing setup or approvals hold the cycle. Public product facts are inspected before the scheduled agent reasons. Packaged and installed UI checks passed, and the installed archive matches the package. Owner video schedules, agent generation and cloud spending remain disabled. An actual cloud-generated character clip and finished brand ad still need a MiniMax key, chosen budget and approved reference. See [release 0.34](../release-0.34.md).

### Previous release checkpoint

Signal 0.33.0 is now installed and verified. It includes the local H3 incident hold, YouTube approved-ad delivery, estimated H3 cloud budgets and opt-in agent cloud shots tied to business Run/Pause. Packaged and installed CPU-only UI checks passed editing/approval/YouTube queue-cancel, budget display and hold enforcement at both viewports; installed and packaged archives match. Owner agent video generation remains disabled and cloud budgets remain zero. No paid cloud request or live publication was made. See [release 0.33](../release-0.33.md) for the final verification record.

### Prior investigation and source checkpoints (superseded by the installation above)

The owner selected cloud-generated character ads using MiniMax H3. Source now adds H3 per-shot and rolling-24-hour estimated dollar budgets (both default to $0), includes equal-duration Blender guide billing, and durably reserves attempted cost before submission. Failed and uncertain submissions retain their estimate; cross-business submissions share the limit. Forty-seven targeted video/YouTube tests and TypeScript checks passed. No cloud key was entered, owner budgets were not enabled, and no paid request was made. UI/build/package verification for these budget controls remains pending. These are estimates against published pricing, not a provider billing cap.

A read-only GPU query at 14:22 found RTX 3080 power.limit/default_limit 380 W, supported reported range 100?400 W, temperature 41 C. Earlier memory caps did not cap power. No power setting was changed and no GPU workload was launched. The owner asked whether lower-intensity H3 is possible; this is not permission to clear the incident hold or rerun it.

Latest interruption: the owner reported repeated crashes and stopped H3 testing. No more local H3 tests or configuration trials are authorized by continuation alone. A second unexpected Windows boot was verified at 09:52:34 Pacific; no H3 process or ComfyUI listener was present when checked at 14:19. Since the earlier 09:32 stop, only source checks, CPU/offline UI validation and packaging were launched; the second restart cause remains undetermined. Owner `video.config.agentDailyLimit` is now 0, with the former video configuration backed up under `data/h3-stop-20260919/`; the owner has no local video jobs or configured portable ComfyUI folder.

Source is now 0.33.0 with a desktop H3 hold, early queue/runtime refusal and visible studio explanation. 1,253 tests, typecheck, lint and build passed. The development UI wrote fresh ad/YouTube screenshots, but its terminal result was lost across the interruption. Packaging has no surviving handle and no 0.33.0 installer was found. Do not claim this version installed or restart packaging automatically while responding to the crash concern. Installed 0.32.3 remains the last verified version.

Video path under discussion: retain character references and Blender guide, use the existing MiniMax H3 cloud adapter for generation, and CPU editing for ads; alternatively use imported product demonstration footage. Official MiniMax V2 docs reconfirm reference images plus reference videos are supported. Cloud credentials, owner spending scope and an actual successful output remain unverified; no paid job has been started.

Source update after that installation: YouTube delivery now has an encrypted resumable upload session, restart reconciliation, 4 MiB transfer chunks, business Run/Pause integration, full-playback approval checks, channel-wide daily limits, duplicate prevention, processing/visibility receipts and tracked description links. Confirmed video campaign IDs participate in GA4 and Stripe attribution matching. Creative studio has channel, visibility, audience and synthetic-content settings plus queue/status controls. The 1,248-test full suite and desktop UI queue/cancel smoke passed; four additional concurrency/access/attribution tests passed in a 64-test targeted run. This change is **not installed or live-upload verified**. Owner settings are unchanged and no video was uploaded. Packaging was deferred when the owner asked to prioritize H3 rendering.

YouTube references: [resumable upload protocol](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol), [upload restrictions](https://developers.google.com/youtube/v3/docs/videos/insert), [processing and visibility fields](https://developers.google.com/youtube/v3/docs/videos). Unverified API projects can have uploads restricted to private; requested public visibility is not proof of public availability.

The full autonomous-growth objective remains open. Use this acceptance list to
distinguish implemented workflows from a functioning live business operation:

| Area | Local implementation | Remaining acceptance work |
| --- | --- | --- |
| Agent runtime | Local process ownership, CPU option, GPT settings, bounded work and cancellation | Validate sustained quality with the selected model and actual operating policies |
| Accounts | 28 provider connections; shared AIonX social credentials, linked Gmail, YouTube, GA4 and Stripe | Additional social/video publication adapters and real delivery checks; a read connection alone does not implement publishing |
| Distribution | Website, Bluesky, X, LinkedIn member and Facebook Page text/link delivery workflows installed | Fresh Facebook Page token (current token returns 401), real-account delivery checks, and video publishing remain open |
| Sales | Both website prospect sources and requested Gmail sales aliases configured; monitoring, AI triage and three eligible replies per day prepared | Business mailing address for initial outreach; validate a complete customer conversation |
| Measurement | Both GA4 properties linked; product-scoped live Stripe scans; deployed website wiring; actual sandbox checkout-to-reader flow and partial refund verified | Real customer payment attribution; recurring renewals and other untested billing paths |
| Creative | Local cards/illustrations; cast, story bible, Blender guide, H3 cloud workflow and scheduled production; CPU ad assembly, capped Kokoro narration, script captions, imported music, source audio, end cards and YouTube delivery | Owner-selected cloud H3 needs a key, budget, approved reference and completed clip; real ad listening/visual quality, transcription of existing footage and real video delivery remain open. Local H3 is on incident hold |
| Websites | Lead capture deployed on both Firebase sites; authenticated prospect APIs verified | Real visitor email-link delivery and complete lead-to-conversation check |
| Reliability | Durable tasks, receipts, uncertainty handling, Pause, tray/startup and runtime supervision | Sustained live operation and installed-app recovery checks |

The latest full-suite validation passed 1,235 tests in 55 files, including 28 video
tests. Five Windows integration checks, real small RAM/GPU
allocation-limit checks, typecheck, lint, build, and installed-app Operations UI
checks pass. Research now works while paused and does not authorize delivery.
Actual CPU edit fixtures passed in portrait, landscape and square, including
sound/silence, duration and format checks. Development and packaged UI checks
covered offline assembly, preview and final approval. Version 0.32.3 was installed
silently with no restart and its installed archive matches the packaged archive.
The owner's existing FFmpeg and Blender paths are configured; no H3 job was started.
The local Kokoro runtime is installed and checksum verified. An actual narrated
edit retained source audio, mixed music without clipped samples, and placed script
captions clear of the end card. Too-long narration was rejected without truncation.
Development, packaged and installed app checks completed narrated edits offline.
Voice quality and pronunciation still need listening review; these are synthetic
fixtures and have not been published.
The capped ComfyUI server starts successfully. A subsequent isolated H3 render
failed during CPU VAE loading; the watchdog stopped the worker on low memory
headroom. No video completed and no retry followed. Windows remained running
and memory counters recovered. H3 remains unsuitable for unattended operation
on this machine until it can complete within the installed limits.
CPU checks
found and documented model judgment failures; test counts do not establish copy
quality. Synthetic GA4 observations and intercepted publications are explicitly
marked as fixtures. No sales or acquisition results can be inferred from them.
See [the detailed operating checkpoints](../autonomous-operation.md) for evidence
and [campaign learning](../campaign-learning.md) for selection and review limits.
The [copy review protocol](../copy-review.md) now covers the actual artifact
instead of accepting a model's invented claim text. Its current diagnostic
results distinguish structural enforcement from model-dependent semantic quality.
See [directed video production](video-production.md) for the supplied workflow,
owner authorization, current render evidence and remaining media checks.

The September 18 live Stripe catalog exposed the custom product ID `lemonade`.
Signal now treats product IDs as opaque values, matching [Stripe's documented
custom-ID support](https://docs.stripe.com/api/products/create). The existing
restricted live key is shared across both business connections. Three Lemonade
products and eight CineGen plans/token packs are mapped separately. Both 90-day
scans completed; each inspected one charge and excluded it. No qualifying captured
payments were found in these scans, and no campaign revenue is claimed.
On September 19, both businesses received a paused operating setup: one daily
publication across their website, shared AIonX Bluesky and X; local branded cards;
up to three eligible incoming sales replies per day after a ten-minute delay;
no scheduled follow-ups. Each selected connection passed a fresh read check.
Four public buyer queries are configured per business. A first paused research
check completed for each and returned no qualifying recent questions. Initial
outreach remains disabled pending a business mailing address. No operation,
publication or email delivery was started by this setup. Account/readiness checks
do not establish reliable model copy or end-to-end delivery.

## Baseline audit

The existing checkout contains the 19-channel Bullseye board, persistent SQLite tasks, four-step local marketing agent, memory and cash ledgers, community ingestion and review, experiment measurements, engineering requests, basic ComfyUI import/queue/history handling, and isolated product browser sessions. Baseline validation on September 13, 2026: TypeScript passes; 26 test files and 494 tests pass. Existing uncommitted work is preserved.

Missing user journeys: provider/key configuration; runtime process and model management; structured business/brand onboarding; campaign-level production and quality review; a searchable execution playbook for every channel; creative workflow setup and inline media review; a distribution calendar and actual conversion/revenue recording tied to work.

## Delivery sequence

1. Runtime: fixed-origin OpenAI Responses transport, encrypted API key settings, local process ownership, model installation progress, shared provider routing, bounded usage and cancellation.
2. Growth workspace: product-specific offer/brand facts, all-channel execution playbooks, campaign briefs, a first-customer launch sequence and linked measurements.
3. Production: multi-asset campaign generation with evidence and review criteria, editing, exports, distribution scheduling, and lead/conversion follow-through.
4. Local creative: ComfyUI readiness and supported image/video setup, durable asset retrieval and previews, prompt/workflow provenance, GPU coordination and recovery.
5. Research and validation: comprehensive cited report, meaningful failure-path tests, live local agent smoke, built Electron UI inspection, packaging where feasible. External publication and spend require an explicit owner action.

## Research decisions underway

OpenAI structured output requires closed object schemas; the operator's dynamic tool input cannot honestly claim strict-schema compliance. The Responses transport uses JSON mode and retains application schema validation. See [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

Ollama exposes model downloads and JSON-formatted chat via local APIs. Signal should own the orchestration and process lifecycle, while using installed inference software. Managed launches set a 16K context and disable Ollama cloud features. See [Ollama chat](https://docs.ollama.com/api/chat), [model pull](https://docs.ollama.com/api/pull), and [FAQ](https://docs.ollama.com/faq).

The local hardware probe found an RTX 3080 with 10 GB VRAM. ComfyUI's Wan 2.2 5B documentation describes 8 GB operation with offloading; this supports an evaluation candidate, not a speed or quality claim. See [Wan 2.2 native workflow](https://docs.comfy.org/tutorials/video/wan/wan2_2). Neither ComfyUI nor Ollama was reachable at the initial probe.
