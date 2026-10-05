import { createServer, type Server, type ServerResponse } from 'node:http';
import { Agent } from 'undici';
import { afterEach, describe, expect, it } from 'vitest';
import { localInferenceJson } from '../../src/core/llm/local-request.js';

const servers: Server[] = [];
const timers: ReturnType<typeof setTimeout>[] = [];
afterEach(async () => {
  for (const timer of timers.splice(0)) clearTimeout(timer);
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close(error => error ? reject(error) : resolve());
  })));
});
async function endpoint(reply: (response: ServerResponse) => void): Promise<URL> {
  const server = createServer((_request, response) => reply(response));
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No HTTP test address');
  return new URL(`http://127.0.0.1:${address.port}/api/chat`);
}

describe('local inference HTTP deadlines', () => {
  it('survives silent generation that exceeds a transport header timeout', async () => {
    const url = await endpoint(response => {
      timers.push(setTimeout(() => response.end('{"message":{"content":"ready"}}'), 1500));
    });
    const shortTransport = new Agent({ headersTimeout: 50 });
    try {
      await expect(fetch(url, { dispatcher: shortTransport } as RequestInit & { dispatcher: Agent }))
        .rejects.toMatchObject({ cause: { code: 'UND_ERR_HEADERS_TIMEOUT' } });
    } finally { await shortTransport.destroy(); }
    await expect(localInferenceJson(url, { signal: AbortSignal.timeout(5000) }))
      .resolves.toEqual({ message: { content: 'ready' } });
  });

  it.each(['headers', 'body'])('still enforces the overall deadline during %s', async phase => {
    const url = await endpoint(response => {
      if (phase === 'body') { response.writeHead(200, { 'content-type': 'application/json' }); response.write('{'); }
    });
    await expect(localInferenceJson(url, { signal: AbortSignal.timeout(100) })).rejects.toBeInstanceOf(Error);
  });

  it('honors an explicit stop while waiting, without retrying', async () => {
    const controller = new AbortController();
    let requests = 0;
    const url = await endpoint(() => { requests++; controller.abort(new Error('Owner stopped marketing')); });
    await expect(localInferenceJson(url, { signal: controller.signal })).rejects.toThrow('Owner stopped marketing');
    expect(requests).toBe(1);
  });

  it('reports HTTP failures and releases the unfinished response', async () => {
    const url = await endpoint(response => { response.writeHead(503); response.write('unavailable'); });
    await expect(localInferenceJson(url, { signal: AbortSignal.timeout(1000) })).rejects.toThrow('Local Ollama returned HTTP 503');
  });

  it('bounds response size', async () => {
    const url = await endpoint(response => response.end(JSON.stringify({ content: 'x'.repeat(4 * 1024 * 1024) })));
    await expect(localInferenceJson(url, { signal: AbortSignal.timeout(2000) })).rejects.toBeInstanceOf(Error);
  });
});
