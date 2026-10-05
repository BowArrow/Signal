import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { localInferenceJson } from '../src/core/llm/local-request.js';

// No model, accounts, owner database or outbound requests. Reproduces a silent
// CPU inference response across Node fetch's actual five-minute deadline.
const delayMs = 306_000;
const timers: ReturnType<typeof setTimeout>[] = [];
const server = createServer((_request, response) => {
  timers.push(setTimeout(() => response.end('{"message":{"content":"completed"}}'), delayMs));
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('No test listener');
const url = new URL(`http://127.0.0.1:${address.port}/api/chat`);
const startedAt = Date.now();
console.log('Simulating silent inference for 306 seconds; no model is running for this test.');
try {
  const [previous, fixed] = await Promise.all([
    (async () => {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(900_000) });
        await response.json();
        return { ok: true, elapsedMs: Date.now() - startedAt, code: null };
      } catch (error) {
        return { ok: false, elapsedMs: Date.now() - startedAt, code: (error as { cause?: { code?: string } }).cause?.code ?? 'unknown' };
      }
    })(),
    (async () => {
      const body = await localInferenceJson(url, { signal: AbortSignal.timeout(900_000) });
      return { ok: JSON.stringify(body) === '{"message":{"content":"completed"}}', elapsedMs: Date.now() - startedAt };
    })(),
  ]);
  const receipt = { createdAt: new Date().toISOString(), node: process.version, delayMs, previous, fixed };
  await writeFile('data/operations-validation/local-inference-timeout.json', JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
  if (previous.ok || previous.code !== 'UND_ERR_HEADERS_TIMEOUT' || !fixed.ok) process.exitCode = 1;
} finally {
  for (const timer of timers) clearTimeout(timer);
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
