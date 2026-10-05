# Signal 0.39: Lemonade acquisition operation

The saved Lemonade policy now permits relevant original Bluesky request replies,
with hourly acquisition cycles and one publication per rolling day. Existing
website intake, opted-in initial emails, inquiry replies, Stripe and GA4 policies
remain configured. The business stays paused until Run marketing is selected.

## Changes

- Search up to three 100-post Bluesky pages, with cursor-loop detection,
  deduplication and account/cancellation checks on every page.
- Filter recently rejected or already-contacted requests before selecting the
  next assessment batch. Six rejected requests no longer block unseen candidates.
- Operations shows the current stage, next eligible campaign check, qualification
  counts and confirmed delivery counts separately. Unknown delivery remains
  unknown; no traffic or revenue is inferred from publication.
- Rolling publication capacity uses the same receipt/uncertainty rules in the
  scheduler and progress display.
- New profiles open Operations. Growth workspace links to Run marketing, and
  research instructions explain enabled direct replies and Bluesky query syntax.

## How the configured operation works

Open Operations, select Lemonade, and click **Run marketing**. Signal starts its
CPU text runtime, searches the configured public sources, checks requests against
the current product, writes and reviews appropriate responses, and publishes
through connected destinations within the saved limits. No copy/paste is needed
for those agent deliveries. A no-fit result continues research without inventing
a customer. Sales handles eligible website requests and buying inquiries under
its separate saved email policy. Analytics and Revenue track observed outcomes.

Keep Signal running. Pause stops new attempts; accepted or uncertain deliveries
are retained for reconciliation. Follow the progress card, Delivery history,
Sales handoffs, Analytics and Revenue. Public research authors are not enrolled
in email campaigns.

## Evidence and limits

- All 1,374 tests across 64 files passed on the clean two-worker run. The initial
  unrestricted run passed its assertions but had two worker RPC timeouts; it was
  not counted as a clean pass. Type checking and targeted lint passed.
- The packaged UI passed at 1440x900 and 720x800 with no renderer errors; the
  marketing progress view was visually inspected. Installer/application hashes
  and installation status are recorded in `data/operations-validation/release-0.39.json`.
- Fresh Lemonade GA4 and Stripe reads succeeded. Both sales sender aliases remain
  verified in Gmail. CineGen's separate GA4 authorization failed refresh and was
  marked as needing attention; its previous report was preserved.
- Live read-only research collected three recent public requests. Real CPU
  Gemma 4 e4b qualification rejected all three: incompatible iPad requirements,
  a sports-news question, and an unspecified summary request. Manual inspection
  agreed. This is a small rejection check, not broad marketing-quality proof.
- Both public signup pages and their product-specific scripts passed read-only
  desktop/mobile checks with no renderer errors. No signup or email was submitted.
- A further positive generation diagnostic stopped before model startup because
  free RAM was below its 12 GiB starting threshold. The guard was preserved.
- No public delivery, email, ad spend or sale occurred during these diagnostics.
- Paid ad execution and automated social-conversation handling are not qualified
  by this release. Sales-based funding settings alone do not launch ads.
- Local H3 remains held after the previous runtime incident. This update did not
  start ComfyUI or perform GPU rendering.

This is a configured organic acquisition pilot. The broader goal of a proven,
fully autonomous marketer across free and paid channels remains incomplete.
