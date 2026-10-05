# Background operation and runtime recovery

Signal 0.10 adds desktop lifecycle controls and supervision of the installed
local model server. Open **Settings > Background operation** to configure them.
These settings do not start a business operation or grant publishing permission.

## Setup

- **Keep Signal running when I close the window** hides the window in the system
  tray. Use the tray to reopen Signal, pause all Operations, or Quit. Background
  mode starts disabled, so upgrading does not silently change close behavior.
- **Start Signal when I sign in** registers the packaged default-profile app as
  a Windows/macOS login item. It starts hidden when background mode is enabled.
  The app reports the OS's actual startup state. Development/offline/isolated
  profiles cannot modify OS startup. Linux startup registration is not offered.
- **Prevent idle sleep while operations run** asks the OS to keep the app active
  while at least one business's Operations policy is running. The display can
  turn off. The request is released when operations pause or Signal quits. This
  starts disabled and does not prevent deliberate shutdown or loss of power.
- **Recover the local model runtime** starts enabled. A saved running local
  operation can start its installed Ollama server after Signal reopens and
  recover it if the server stops. It also supervises the existing runtime
  auto-start preference. It never downloads models or switches to GPT.

Account authorization, product policies and model installation remain one-time
setup steps. Signal and this computer need to stay available for scheduled work;
the desktop app is not a hosted service. Optional login startup resumes work at
user sign-in, not before login or while the machine is powered off.

## Recovery behavior

Signal checks the configured local server and required model IDs. Failed starts
retry after increasing delays, beginning at 30 seconds and capped at 15 minutes.
A healthy server with missing models requires selecting or installing those
models in Settings; it is not restarted repeatedly. Runtime status appears in
Settings and Operations. A resume-from-sleep event requests a fresh check while
preserving an explicit manual stop.

New automatic AI generation waits while recovery is pending or models are
missing. The health check runs independently so inbox reads, revenue sync and
reconciliation of attempted delivery can continue. Previously reviewed queued
copy may still be delivered under its existing policy. Those paths keep their
freshness, permission, suppression and daily-limit checks.

Stopping the runtime pauses Operations and holds automatic recovery until an
explicit Start/Run request. Changing provider settings or API keys also pauses
Operations. An active general agent task must finish or be cancelled first.
Signal stops only its own Ollama child; an externally managed server is left
running. Stopping or quitting during startup prevents a late server launch.

Quit stops this process and releases its sleep request. Running policy state
stays saved so it can resume on the next launch. Delivery receipts and uncertain
attempts retain their existing recovery rules. The app's per-profile instance
lock makes a second launch reopen the existing worker, including in isolated
profiles. Distinct profiles remain independent.

## Research grounding

The lifecycle uses Electron's [tray API](https://www.electronjs.org/docs/latest/api/tray),
[login item settings](https://www.electronjs.org/docs/latest/api/app#appsetloginitemsettingssettings-macos-windows),
and [application suspension blocker](https://www.electronjs.org/docs/latest/api/power-save-blocker).
Windows may apply a launcher's hidden startup setting to its first
[ShowWindow call](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-showwindow).
An explicit tray/shortcut reopen handles that first-call behavior.

## Verification and limits

Unit tests cover recovery, backoff, missing models, manual hold, shutdown races,
external server ownership, disabled/offline behavior, startup rejection and
sleep-request release. Desktop validation uses an isolated offline profile and
checks saved preferences, close-to-tray, second-launch reuse, hidden startup,
reopening and graceful Quit. OS startup writes are disabled in that profile.

`pnpm exec tsx scripts/runtime-recovery-smoke.ts` uses an in-memory database and
synthetic account checks. On September 17, 2026 it started the installed Ollama
server for two configured business operations, stopped only that owned server,
recovered it, and verified the manual hold. No models were downloaded and no
real email, public post or account write was performed. If an external server is
already running, this check leaves it alone and reports that crash recovery was
not exercised.

Run `node scripts/desktop-ui-smoke.mjs` or pass the packaged Signal executable.
Actual login-item registration on the owner's computer, login/reboot recovery,
long-running operation under real network/account failures, and commercial
outcomes remain unverified. These controls improve continuity; they do not
complete the remaining sales, publishing, creative and measurement workflows.

The final 0.10 check passed typecheck, lint, 650 tests and packaged Background
Settings, Sales and Operations checks at desktop and narrow widths. Installer:
`release/Signal Setup 0.10.0.exe`. It has not replaced the owner's installed app.
