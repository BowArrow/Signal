# Signal 0.33

This release adds delivery of approved ads to YouTube and prepares budgeted MiniMax H3 cloud generation for agents. The local H3 incident hold remains in force on the owner's PC.

## Behavior

- YouTube retains encrypted resumable upload sessions, checks progress before sending more bytes, freezes the approved file and channel, shares daily capacity across businesses on the same channel, and records the visibility and processing result confirmed by YouTube. Run authorizes upload; Pause stops further transfer. An accepted upload may continue processing remotely.
- H3 cloud shots require a saved per-shot and rolling-24-hour estimated USD budget. The default is zero. Estimates include the equal-duration Blender guide at the published MiniMax-H3 768P rates, alongside output generation. These estimates do not represent invoices or enforce a provider account billing cap.
- Attempted H3 charges remain reserved for 24 hours, including failed and uncertain submissions. Reservations are saved transactionally before the request. Queued work rechecks available budget before submission.
- Agents additionally need the cloud-shot setting enabled, an active task belonging to the business and the business running. Pause during preparation prevents spending; a remote task accepted during Pause is retained for subsequent reconciliation.
- A local H3 incident hold is exposed in the studio and blocks queued/new local H3 shots before runtime startup. CPU editing and imported footage remain usable. No local H3 rendering is authorized by resuming the overall project goal.

## Evidence and limits

The last full suite passed 1,253 tests before the cloud budget/agent controls. After those changes, targeted video, YouTube and Operations checks passed (35 + 15 + 88 tests), along with TypeScript, lint and build. Development UI checks passed at 1440x900 and 720x900 with no renderer errors, including the incident hold and cloud controls. The UI runs with GPU disabled. Provider tests use simulated responses; no paid cloud generation or real YouTube upload was performed.

The 0.33.0 installer was built and installed silently with /NORESTART. Packaged and installed offline UI checks passed the H3 hold, cloud-budget display, synthetic CPU ad assembly, final approval, YouTube queue/cancel and business switching at both viewports. Installed and packaged app.asar SHA-256 match: BC6438F484A2B0870F04E5AE18B4F3D1CD0DB78E62B1DD57DCB53B0943094085. Windows boot time remained 2026-09-19T09:52:34.5000000-07:00. The owner's spending settings remain disabled; enabling controls or recording a quote does not establish successful generation, publication, customer acquisition or sales.

## Sources

- MiniMax H3 multimodal inputs: https://platform.minimax.io/docs/api-reference/video-generation-v2-create
- Pricing checked September 19, 2026: https://platform.minimax.io/docs/guides/pricing-paygo
- YouTube resumable uploads: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
- YouTube upload restrictions: https://developers.google.com/youtube/v3/docs/videos/insert
