# Marketing activity and conversation tracking — Signal 0.47

## Verified owner audit

On September 28, 2026, Lemonade had one shared public delivery slot per rolling day, no separate public reply allowance, and channel testing enabled. Its retained history contained one Bluesky reply and one website article. The reply had subsequently become unavailable. Research had accumulated 130 saved observations at the latest audit; observations are not qualified buyers.

Outreach was enabled with a limit of three emails per day. The three saved leads were already-contacted LTD partner submissions with unknown permission. None was eligible for a new opted-in outreach email. Connecting a mailbox does not create this audience. No budgets, lead permission, sending settings or CineGen operating state were changed for this release.

Evidence: `data/operations-validation/marketing-audit-2026-09-28.json`. These are timestamped observations, not permanent state.

## Implemented

- A definitive Bluesky NotFound or RecordNotFound response, including the notFoundPost thread variant, archives the conversation and stops automatic polling. Blocked access, malformed responses and network failures do not imply deletion.
- Owner Stop tracking and Resume tracking actions work locally, persist through restart, validate business ownership and abort in-flight checks. Publication receipts and saved responses remain available. Archiving never refunds delivery capacity or authorizes a repost.
- Conversations separates active and archived counts and excludes archived responses from the active review total. Show archived conversations reveals retained history.
- Operations shows the last 48 hours of confirmed publications, public replies and initial-outreach/follow-up sends, plus eligible new email contacts and pending or held outreach jobs. It explains missing lead inputs and current mailbox/contact eligibility failures using the same checks as the sender. These checks neither create drafts nor send mail.
- The shared article/reply allowance has an explicit explanation and a shortcut to configure independent limits. Saving policy changes retains the existing pause-and-review behavior.
- All 19 traction channels have a next action, outcome measure and stop rule. Automated capabilities, unfinished setup and owner-assisted experiments are grouped separately. Existing playbooks supply the detailed human steps; navigation buttons open Operations settings, Sales or Growth workspace.

## Boundaries

This release does not create an opted-in audience, submit partner applications, launch paid ads, or automate participation on unsupported communities. The new instructions make those dependencies explicit. Existing connected website publishing, qualified Bluesky replies and configured Sales automation retain their saved authorization. No sales outcome is guaranteed.

The owner was asked whether to set five or ten qualified replies per day while retaining one article/feed-post slot. Until answered, the saved shared limit remains in effect.

## Validation and installation

- TypeScript and scoped ESLint passed.
- 527 tests passed across Operations and outreach, including archive persistence, manual stop/resume, network versus deletion, concurrent refresh, lead eligibility and sending-policy regressions.
- Packaged Electron UI passed 40 screen/size combinations, navigation and keyboard checks, draft preservation, archive actions, 19 channel instructions, and action links. No renderer exceptions. Offline synthetic fixtures, hidden windows and disabled GPU were used.
- Artifacts: `release/Signal Setup 0.47.0.exe`, `data/operations-validation/release-0.47.json`, and screenshots in `data/workspace-ui-validation`.
- `scripts/install-tested-0.47.ps1` refuses to replace an open owner app, backs up the database, runs the installer silently, then compares the installed application hash with the tested package. The receipt records installation separately from build/test completion.
