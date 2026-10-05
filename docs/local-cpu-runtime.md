# Local CPU execution

In Settings, choose **Local model processing → CPU only — Ollama agents**, then
save provider settings. This pauses Operations as with other provider changes.
Run resumes work under the saved configuration. Existing profiles keep Automatic.

CPU mode requires HTTP Ollama on localhost, 127.0.0.1 or ::1, port 11434, with the
`/v1` base path. Each local completion uses the native `/api/chat` endpoint with
`options.num_gpu: 0`, a 16,384-token context and `keep_alive: 0`. The setting applies
to all agent tasks and image review. The legacy configured pipeline also checks
it; if that pipeline points to another server, its requests hold. No compatibility
fallback silently drops the CPU setting. Explicit cloud model tags are rejected.

CPU calls have a 15-minute timeout by default and still accept cancellation. They
can be much slower than GPU calls. This does not change ComfyUI, the desktop's
renderer, other applications, or requests made to Ollama by another client. GPT
continues to use the configured OpenAI provider. CPU mode is not a diagnosis or a
fix for the machine's earlier Windows bugcheck.

Validation includes a real text-only request to installed Ollama 0.32.5 with
`gemma4:e4b`: valid structured output in 12.2 seconds and two `/api/ps` observations
reporting zero GPU memory for the loaded model. `scripts/runtime-cpu-smoke.ts`
repeats this check using an in-memory Signal database, a three-minute overall
deadline and no business credentials or outbound writes. It stops the runtime it
owns and leaves the owner's profile untouched. The artifact is
`data/runtime-validation/cpu-probe.json`.

Transport tests cover CPU requests, unsupported endpoints, cancellation, images,
structured output and restoring Automatic. Integration checks cover persistence
and applying saved changes to existing clients. Desktop checks use software
rendering and an isolated offline profile. A short inference probe does not prove
campaign quality or sustained runtime reliability.

Implementation references: [Ollama 0.32.5 scheduler](https://github.com/ollama/ollama/blob/v0.32.5/server/sched.go)
and [runner options](https://github.com/ollama/ollama/blob/v0.32.5/api/types.go).
