# Signal 0.40: assess new evidence and allow slow CPU generation

Lemonade's first live acquisition cycle ran before its searches found candidates.
It completed with an empty batch and consumed the hourly interval. Later searches
found 11 observations, but none had been assessed when the owner reported that
Signal had not reached anyone.

The scheduler now waits for eligible evidence before creating an acquisition
task. Fresh candidates after an empty or no-fit batch can start after a one-minute
minimum interval. Failed qualification and completed publication work retain
the configured cadence. Publication limits, repeat-contact suppression and
editorial review remain enforced. Queue creation and its checks are atomic.

Active operating tasks receive priority over queued background analysis. An
already-running model request finishes normally. Operations displays the actual
next assessment deadline, or no deadline when it is waiting for new evidence.

The corrected scheduler was also invoked once against Lemonade's already-running
operation, queuing its waiting six-candidate batch without changing the policy or
reading credentials. The installed app performs the qualification and any
authorized delivery. Queuing work is not evidence that anyone was contacted.

That batch rejected five observations and selected one document-workflow
discussion as a topic for a website article. Article composition then failed
after 300,975 milliseconds. No delivery was created. The native local model
request used a 15-minute abort deadline, but Node fetch also has a separate
five-minute response-headers timeout. A dedicated local dispatcher now defers
to the existing overall deadline and cancellation, with a ten-second connection
timeout and a four-MiB response limit. CPU settings remain two threads, zero GPU
layers and the existing context/batch limits. Cloud requests are unchanged.

Validation: 441 tests across Operations, the growth workflow and LLMs passed, including
empty scans, early fresh-evidence scheduling, failure cooldowns, publication
reservations, running-operation priority, actual HTTP header delays, cancellation
during headers/body and oversized responses. Type checking and targeted lint
passed. A separate 306-second HTTP simulation records the actual default timeout
and the corrected request in data/operations-validation/local-inference-timeout.json.
On Node 22.16.0, the previous request failed at 300,612 ms with
UND_ERR_HEADERS_TIMEOUT, while the corrected request completed at 306,023 ms.
The packaged Windows app passed 1440x900 and 720x800 UI checks without renderer
errors. The final installer and app archive hashes are in release-0.40.json.
Packaging and installation evidence are recorded separately.

These fixes do not prove successful outreach. The observed batch supplied no
suitable original Bluesky request for direct reply. HN discussion informs owned
website content rather than contacting its author. The three saved Lemonade leads
have unknown email permission, so the saved opt-in-only email policy cannot send
to them. The existing consent requirements and publication limits are unchanged.
