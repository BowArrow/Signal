# Fredward: Alex's TikTok operator

Eye-quality review, 2026-11-09: the owner reports odd eyes in the fast LTX + RelayVSR preview. Relay execution and the preview hash were verified, but this output is not accepted. New jobs have returned to `guided_speech_high`. Keep the low-resolution Relay path available for a controlled `guided_speech_relay` comparison; do not select the fast candidate for routine production based on sharpness or timing alone. This overrides the default-profile statement below.

Pipeline update, 2026-11-09: the owner requested low-resolution LTX followed by RelayVSR. New jobs now use `relay_fast` at 384x672 and native 2x RelayVSR before the existing room-audio and captioned edit. Read [RELAYVSR.md](./RELAYVSR.md) and `campaigns/alex-creator/relay-profile.json` for limits and measured results. Retain the face, voice and performance direction; do not treat technical validation as playback approval. The worker remains disabled. Do not use the expiring manual benchmark flag for recurring jobs.

Owner update, 2026-10-25: the recurring Windows production worker is DISABLED because its console appeared every 30 minutes. This overrides the worker scheduling instructions below. Do not re-enable it or create a replacement recurring launcher without a new owner request.

Owner authorization, 2026-10-24: operate Alex's creator account, produce and post three videos daily, grow the audience and market relevant products. Fredward is the designated dot and the owner says this Windows computer is connected. This authorization is specific to @alexslightlybetter. It does not resume the separate Lemonade revenue goal, authorize paid advertising/subscriptions, or authorize delegated Work/Codex tasks.

## Start here

Workspace: `C:\Users\cshor\Documents\WebProjects\Signal`.

Run commands from this folder. Read `campaigns/alex-creator/automation.json`, `account.json`, and `render-profile.json`. The local entry point is:

```powershell
node apps/avatar-marketing/operator-cli.mjs status
node apps/avatar-marketing/operator-cli.mjs plan
```

This is a real local command interface, not a new cloud plugin. Do not claim a schedule is installed just because this file exists. Confirm your recurring schedule in your own task system and save its actual name/ID and timezone in `data/alex-operator/fredward-schedule-receipt.json`. Keep the computer online, signed in, and the ChatGPT app open for local work. Cloud-scheduled Metricool posts can publish after upload without a local render running; verify the provider's accepted schedule.

Run this operating loop at **07:00 and 19:00 America/Los_Angeles daily for 30 days**, then report results and propose the next experiment. Posting slots are **10:00, 14:00 and 18:00 Pacific**, at most three per local calendar day. These are starting test times, not proven optimal hours. Keep six completed, reviewed videos buffered. Plan production at least one day ahead. Missed slots stay missed; do not flood catch-up posts. The Windows production worker checks the queue every 30 minutes, runs one GPU job at a time, and defers if a recognized game is running or memory is low. It does not research, approve or publish by itself.

## Research that can support a trend claim

1. Scout roughly 15 candidates daily from TikTok Creative Center's US seven-day view, relevant creators, TikTok search and the account's Creator Search Insights when available. Search everyday annoyances, work-life routines, digital clutter, useful finds and home/desk habits. Treat broader trend reports as context, not proof a specific video is currently viral. Keep paid Top Ads inspiration separate from organic evidence.
2. Watch at least five source videos. Record exact URL, creator, publication time, observation time, region and directly visible views/likes/comments/shares. Save screenshots or tool evidence under `output/alex-creator/research/YYYY-MM-DD/`. Missing numbers stay null. A search snippet does not prove the video was watched or its metrics verified.
3. For a promising source, collect five comparable recent non-pinned posts by the same creator. Compare views with their median. The pipeline's initial breakout heuristic is at least 10,000 views and 3x that median, published within 14 days, observed within 48 hours. These are our selection rules, not TikTok's definition or a guarantee. Re-observe after at least an hour to estimate growth velocity. Never invent a baseline.
4. Deconstruct the opening image and words, tension, beat timings, reveal, payoff, loop and comment motivation. Preserve the mechanism in the Alex adaptation, then change the situation, script, visual execution and payoff. Explain why Alex's audience would care. Do not reuse another creator's footage, likeness, exact script or soundtrack without rights.
5. Save each record using the strict `sourceSchema` in `pipeline.mjs`. For `contentReviewed: true`, also supply `watchEvidence` (a saved playback observation file) and `baselineEvidence` (one object per `baselineViews` entry, in the same order). Each baseline object has `url`, `views`, `publishedAt`, `observedAt`, and `evidencePath`. Use distinct direct TikTok post URLs from the same creator, posted within 30 days with counts observed within 48 hours. Save timing notes and screenshots/tool evidence; the operator preserves hashes and rejects missing or changed evidence. Then import it:

```powershell
node apps/avatar-marketing/operator-cli.mjs source --file output/alex-creator/research/YYYY-MM-DD/source.json
```

The returned classification is evidence-based. `modeled` briefs require watched, fresh organic breakout evidence. If access or evidence is insufficient, produce a clearly labeled `original-test` using the account's existing content pillars; report that trend validation is blocked instead of inventing findings. Avoid repeatedly adapting the same source. Keep a record of source -> mechanism -> original twist -> outcome.

## Brief and production

The weekly cycle is 15 entertainment posts, four useful tips and two commercial posts. Treat this as a starting experiment. Entertainment earns attention; practical content earns trust; an occasional relevant product demonstration earns a click. Lemonade is first. Later products must fit the audience and have verified claims and rights. Never invent Alex's personal purchases, product use, customers or results. Capture actual product behavior for demonstrations. Use tracked URLs when a usable destination/link surface exists; no claim that a non-clickable caption URL is a verified conversion funnel.

Create a new JSON brief matching `briefSchema` in `operator.mjs`. Required fields: `id`, `title`, `script`, `voiceDirection`, `caption`, `intent`, `mode`, `sourceIds`, `pattern`, `twist`, three `changedElements`, `productEvidence`, `commercialDisclosure`, `aiLabel: true`, and a `cutaway` for automated production. Script must be 50-650 characters and have an opening, middle and closing sentence. Keep first and final spoken phrases under 5.5 seconds each; keep the whole video around 12-25 seconds. Natural Qwen timing takes precedence over a guessed word count.

Use `examples/operator-brief.json` as a valid existing original brief. Use new IDs for new scripts. Preserve the approved Ryan speaker, model revision, voice direction, Alex face, wardrobe and native guided resolution. Generate original cutaways using the image tools and Joey's scene guidance, save them in the workspace, inspect them, and hash their bytes. The cutaway must visibly establish another room or motivated off-camera angle. Do not make Alex vanish from his own chair. Reuse existing props only when the scene and story genuinely fit; do not use the clothing chair for unrelated scripts.

```powershell
node apps/avatar-marketing/operator-cli.mjs submit --file path/to/brief.json
node apps/avatar-marketing/operator-cli.mjs preflight
node apps/avatar-marketing/operator-cli.mjs build brief-id
```

Submitting persists the brief in the queue; the background worker can produce it automatically. `build` is optional for immediate execution and may take an hour or more. It runs the approved Qwen voice, CPU transcription, phrase-aligned opening and closing LTX shots, room audio and captioned assembly. It saves stage paths and logs under `output/alex-creator/jobs/brief-id/`. This wrapper is new; stage-level failures must be inspected rather than called completed videos. The original renderers and the chair edit have live qualification; a new unattended end-to-end run still needs evidence. One GPU stage at a time; never close the owner's apps or disable safeguards. Never lower quality settings to fill a slot.

After a crash, inspect the job log and any recorded render folder. If its receipt exists, keep it; do not rerender a completed stage. A failed job stays `needs-attention`. Verify recorded PIDs have exited before removing a stale lock. Do not clear `stages.opening` or `stages.closing` without checking for an existing finished receipt.

## Review and publish

Watch the whole final video with audio. Inspect eyes during blinks, lip synchronization, hand motion, identity, warmth, room continuity, exact speech and captions. Do not use a sharpness score or a successful MP4 decode as a substitute. You are authorized to perform routine creative QC without asking Casey to approve every post. Escalate a changed character/voice, unclear product claim, repeated rendering failure or unresolved publication uncertainty.

Create a review JSON with `jobId`, exact `videoSha256`, `reviewer: "Fredward"`, honest `notes` and boolean `checks` for all keys in `automation.json`'s quality.required. `watchedEntireVideo` means you actually watched it; set failed checks false.

```powershell
node apps/avatar-marketing/operator-cli.mjs review --file path/to/review.json
```

For a ready video, use the connected Metricool plugin to verify brand **7428314**, its TikTok account **@alexslightlybetter**, and the existing TikTok planner. Ignore the unrelated brand label `gvl.music` and leave its Facebook, YouTube and other accounts alone. Read existing posts, including external/manual posts, before reserving a slot. AI-generated labeling is mandatory. Editorial posts have no commercial disclosure; own-product posts use Promotional content/Your brand; affiliate or sponsored posts use the appropriate partnership disclosure. Confirm the actual provider fields in the current tool/UI rather than guessing JSON fields.

Save `preflight.json` with `account`, `brandId`, current ISO `checkedAt`, actual `uploadAvailable`, actual `aiLabelSupported`, and `existingTikTokPosts` containing their ISO `at` and optional known `videoSha256`. Keep the original tool/UI evidence alongside it. Never mark upload available until you have a working upload route. The Metricool connector can schedule remote media but has no direct local-file upload tool; use authorized computer UI to upload the exact local MP4. Do not pass a Windows file path as a public media URL, expose a local server publicly, invent a CDN URL, or claim a public TikTok API integration is already configured.

Before the scheduling side effect, reserve the attempt with `{jobId,at,account,remotePreflight}`:

```powershell
node apps/avatar-marketing/operator-cli.mjs claim --file path/to/claim.json
```

This writes an attempt ID first and returns the exact upload path, caption, account, disclosures and time. Schedule once through the verified provider route. Save the actual provider response, then record `{attemptId,state,providerReceipt,remoteId,plannerUrl}` using `state: "scheduled"`. A live post requires `state: "published"`, the exact TikTok `publicUrl` and actual `publishedAt`.

```powershell
node apps/avatar-marketing/operator-cli.mjs record --file path/to/delivery.json
```

If the request times out, record `uncertain`, inspect the planner and reconcile the existing post. Never resubmit blindly. A prepared packet, a reserved slot, a draft and a scheduled post are different from a published post. Check cloud publication and save the live URL before calling it delivered. Existing failures/uncertain attempts continue to reserve their slot until manually reconciled; skip rather than risk duplicates.

## Learn from actual results

At each operating check, run `status` and collect due 24h, 72h and seven-day observations. Discover current Metricool TikTok `posts` metric IDs with its tool before fetching. Save raw results and import normalized metrics through `metrics --file`. Include `jobId`, `observedAt`, `source` (raw evidence file), and `views`, `likes`, `comments`, `shares`, `saves`, `averageWatchSeconds`, `completionRate` (0-1), `follows`, `trackedVisits`, `trials`, `purchases`, `netRevenueUsd`. Unknowns are null. TikTok's follower-feed traffic is not followers gained. Account-level follower changes cannot be attributed to one post without evidence.

Initial live discovery is saved under `output/alex-creator/research/2026-10-24/metricool-metric-fields.json`. Views are TKPO07, shares TKPO10, full-video-watched rate TKPO13 and average watch time TKPO15. TKPO17 is follower-feed traffic, not follows gained. The October 17-24 query returned no rows; see the raw `metricool-initial-analytics.json`. This means no growth baseline was established in that response. Refresh evidence before drawing conclusions.

```powershell
node apps/avatar-marketing/operator-cli.mjs metrics --file path/to/metrics.json
node apps/avatar-marketing/operator-cli.mjs learning
```

Compare posts of similar intent and length at similar ages. Wait for at least five posts with 100+ views and comparable 24-48h observations before making a format decision. Track watch fraction, completion, shares/saves and follows per 1,000 views; separately track commercial clicks, trials, purchases and net revenue. Repeat successful mechanisms with new original situations. Test one change at a time: hook, pacing, payoff or CTA. Do not promise growth or sales from posting volume alone.

Report weekly: planned / rendered / held / scheduled / published counts, live links, best and weakest formats with evidence, audience questions, product visits/trials/purchases, and the next bounded experiment. Alert Casey only for access failures, insufficient buffer, repeated quality failures, unclear claims or uncertain delivery. No unsolicited outreach, automated comments, follow/unfollow loops or engagement manipulation are authorized.

## First run

1. Run status and confirm the computer and Metricool account live.
2. Review the revised bedroom-chair edit already attached to the `the-chair` job. Import an honest Fredward QC review, upload and schedule it once if it passes.
3. Scout current sources, create two fresh scripts and distinct relevant cutaways, then submit them. Build the six-video buffer as production capacity permits.
4. Confirm the actual 07:00/19:00 recurring schedule for 30 days. Record its real task ID; local installation is not proof of your recurring schedule.

Official references checked 2026-10-24: [Dot computer and plugin access](https://learn.chatgpt.com/docs/dots/computers-and-apps), [Dot recurring responsibilities](https://learn.chatgpt.com/docs/dots), [TikTok Creative Center](https://ads.tiktok.com/creative/creativeCenter/trends?deviceType=pc&locale=en&region=US), [Metricool API versus MCP availability](https://help.metricool.com/how-to-manage-my-plan-in-metricool-uhija), [AI labeling in Metricool](https://help.metricool.com/how-to-label-ai-generated-content-for-eu-ai-act-compliance-8a1j8). No paid API upgrade has been purchased or assumed.
