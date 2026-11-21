import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CodexClient, inspectCodex } from '../../src/core/llm/codex.js';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
let child: EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> };
let calls: { method?: string; id?: number; params?: Record<string, unknown>; error?: unknown }[];
let turnStatus: 'completed' | 'failed';
let nativeRequest: boolean;
let holdTurn: boolean;
function send(value: unknown) { child.stdout.write(JSON.stringify(value) + '\n'); }
beforeEach(() => {
  vi.stubEnv('SIGNAL_CODEX_EXECUTABLE', process.execPath);
  turnStatus = 'completed'; nativeRequest = false; holdTurn = false; calls = [];
  child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => { child.emit('exit', 0); }) });
  mocks.spawn.mockReturnValue(child);
  child.stdin.on('data', data => {
    const message = JSON.parse(String(data)); calls.push(message);
    queueMicrotask(() => {
      const result = message.method === 'config/read' ? { config: { mcp_servers: { private_server: {} } } } : message.method === 'account/read' ? { account: { type: 'chatgpt' } } : message.method === 'model/list' ? { data: [{ model: 'selected-model', isDefault: true }] } : message.method === 'thread/start' ? { thread: { id: 'thread-1' } } : {};
      if (message.id && message.method) send({ id: message.id, result });
      if (message.method === 'turn/start' && !holdTurn) {
        if (nativeRequest) send({ id: 900, method: 'item/tool/call', params: { name: 'send_mail' } });
        send({ method: 'item/completed', params: { threadId: 'thread-1', item: { type: 'agentMessage', text: '{"message":"Verified","actions":[]}' } } });
        send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { status: turnStatus, error: turnStatus === 'failed' ? { message: 'Rate limited' } : null } } });
      }
    });
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); });
const request = { model: 'selected-model', prompt: 'Explain our next action', maxTokens: 100 };
it('uses the signed-in account catalog without reading or copying credentials', async () => {
  expect(await inspectCodex()).toMatchObject({ model: 'selected-model' });
  expect(calls.map(c => c.method)).toEqual(['initialize', 'initialized', 'config/read', 'account/read', 'model/list']);
  expect(child.kill).toHaveBeenCalled();
});
it('executes a bounded read-only Codex turn, disables inherited MCP tools, and rejects native tool requests', async () => {
  nativeRequest = true;
  const result = await new CodexClient({ model: 'selected-model', offline: false }).complete(request);
  expect(JSON.parse(result.text).message).toBe('Verified');
  expect(calls.find(c => c.method === 'thread/start')?.params).toMatchObject({ sandbox: 'read-only', approvalPolicy: 'never', ephemeral: true, config: { 'mcp_servers.private_server.enabled': false } });
  expect(calls.find(c => c.id === 900)?.error).toBeTruthy();
  expect(mocks.spawn.mock.calls[0]?.[2]).toMatchObject({ windowsHide: true });
  expect(child.kill).toHaveBeenCalled();
});
it('does not turn a failed turn into a successful reply', async () => {
  turnStatus = 'failed';
  await expect(new CodexClient({ model: 'selected-model', offline: false }).complete(request)).rejects.toThrow('Rate limited');
});
it('rejects immediately on cancellation or a disconnected process and closes the child', async () => {
  holdTurn = true; const controller = new AbortController();
  const result = new CodexClient({ model: 'selected-model', offline: false, signal: controller.signal }).complete(request);
  const rejection = expect(result).rejects.toThrow('closed');
  await vi.waitFor(() => expect(calls.some(c => c.method === 'turn/start')).toBe(true));
  controller.abort(); await rejection;
  expect(child.kill).toHaveBeenCalled();
});
it('makes no process or inference call while offline', async () => {
  await expect(new CodexClient({ model: 'selected-model', offline: true }).complete(request)).rejects.toThrow('SIGNAL_OFFLINE');
  expect(mocks.spawn).not.toHaveBeenCalled();
});
