# Run readiness

Operations can start any combination of configured business activities:

- Website, Bluesky, X, Facebook Page or LinkedIn member publishing. Bluesky additionally supports
  reviewed local illustrations or built-in branded cards.
- Gmail/Outlook inbox monitoring and optional AI triage.
- Configured replies, follow-ups and initial outreach.
- Mailchimp prospect ingestion.
- Stripe sales tracking and Google Analytics reporting.

Stripe can reuse one connected read-only credential across businesses using
**Use for ...** in Connections. Each business still selects its own products in
Revenue. Product IDs may be owner-defined (for example, `lemonade`); the catalog,
saved source and payment line matching accept them. Unscoped invoice items remain
excluded. This follows [Stripe's product-ID API contract](https://docs.stripe.com/api/products/create).

A publishing account is optional. Leave publishing destinations empty for Sales
or reporting only. **Clear publishing destinations** also removes disconnected
destinations that no longer have a visible account checkbox. Save to apply the
change. Removing image publishing clears the prior workflow selection.

The activity list reports the selected business's connection status, expiration
and known email scopes. Sending policies require automatic inbox monitoring and
AI triage. An unavailable configured activity blocks startup with a specific
remediation message. Configure at least one activity and turn off offline mode
before Run. Account status is a saved access check, not a guarantee that the
provider is reachable or that a token still works; adapters validate actual
requests and preserve failures in their existing status views.

## Research before starting delivery

After public buyer research is configured, **Research now** reads one saved query
while the operation can remain paused. It does not start a model, create a sales
contact, queue a campaign, or change publishing authorization. It uses the same
query rotation, hourly checks and error backoff as scheduled research. Repeated
clicks reuse recent results. Results arriving after a settings change are discarded.
An empty result is reported as no qualifying recent observations, not evidence
that a market has no demand.

## Models used by Run

Read-only ingestion, inbox monitoring without AI triage, and reporting do not
require a model. The Run handler skips model startup and availability checks for
these activities. With automatic runtime startup disabled, recovery also leaves
the local runtime alone for those operations.

AI-enabled operations check their marketing model. Generated illustrations additionally
require the configured ComfyUI workflow and vision model. Built-in branded cards
use local layout rendering and require neither ComfyUI nor a vision model.
An unrelated configured growth or vision model
does not block an email-only operation. Runtime recovery checks the models needed
by running operations and separately enabled automatic growth/marketing workers.
The independent runtime-autostart preference still applies.

These are availability checks, not proof that a model will produce good copy or
that its vision implementation works. In particular, the previously documented
Gemma vision limitation still requires a working vision model selection.
Qwen 3.5 9B passed a fresh two-image pixel-description check on September 18;
that narrow test does not establish every-frame video review or sustained copy quality.

## Startup and Pause

Run validates its activities before starting a model and rechecks them before
authorizing work. **Cancel startup** remains available while the check is in
progress and targets the business that started the request, even if the selected
business changes. Pause, Pause all, or a newer startup invalidates an older
pending startup. A late model response cannot restart a paused operation.

No publishing task is queued when no publishing destination is selected. Sales
and reporting retain their own limits, consent checks and status displays.
Clearing destinations changes no email policy. Starting an operation does not
establish traffic, conversions or revenue.

The main process enforces these checks. Renderer controls only display the
current result and request actions through the existing validated IPC boundary,
following [Electron's IPC sender-validation guidance](https://www.electronjs.org/docs/latest/tutorial/security#17-validate-the-sender-of-all-ipc-messages).
