import { Agent } from 'undici';

/** Local non-streaming inference can be silent longer than fetch's five-minute
 * headers timeout. Let the caller's finite deadline and cancellation govern the
 * whole request, including reading JSON. This dispatcher is never global. */
export async function localInferenceJson(url: URL, init: RequestInit & { signal: AbortSignal }): Promise<unknown> {
  const dispatcher = new Agent({
    headersTimeout: 0, bodyTimeout: 0,
    connect: { timeout: 10_000 }, maxResponseSize: 4 * 1024 * 1024,
  });
  try {
    const response = await fetch(url, { ...init, dispatcher } as RequestInit & { dispatcher: Agent });
    if (!response.ok) throw new Error(`Local Ollama returned HTTP ${response.status}`);
    return await response.json();
  } finally {
    // Also releases sockets on cancellation, invalid JSON and HTTP failures.
    await dispatcher.destroy();
  }
}
