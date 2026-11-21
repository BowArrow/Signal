import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';

const connectionSchema = z.object({ url: z.string().url(), token: z.string().regex(/^[a-f0-9]{64}$/) });
const actions = ['status', 'session.open', 'launch', 'observe', 'click', 'fill', 'key', 'scroll', 'screenshot', 'record.start', 'record.stop', 'note', 'export', 'close', 'format.set', 'cursor.move', 'cursor.set', 'wait', 'asset.import', 'edit.render', 'ltx.status', 'ltx.start', 'ltx.stop', 'ltx.prepare', 'ltx.submit', 'ltx.poll', 'product.resume', 'product.status', 'product.setup', 'samples.list', 'documents.import', 'operation.status', 'turn.send', 'turn.status', 'source.open', 'result.open', 'result.save', 'result.export'] as const;
export async function demoStudioCommand(productKey: string, input: Record<string, unknown>, signal: AbortSignal, env: Record<string, unknown> = process.env): Promise<unknown> {
  if (productKey !== 'lemonade') throw new Error('Demo Studio currently supports only Lemonade.');
  z.enum(actions).parse(input['action']);
  const configured = z.string().optional().parse(env['SIGNAL_DEMO_STUDIO_CONNECTION']);
  const localAppData = z.string().optional().parse(env['LOCALAPPDATA']);
  const file = configured || join(localAppData || process.env['LOCALAPPDATA'] || homedir(), 'Signal', 'demo-studio', 'connection.json');
  let connection;
  try { connection = connectionSchema.parse(JSON.parse(await readFile(file, 'utf8'))); }
  catch { throw new Error('Open Signal Demo Studio with scripts/start-demo-studio.ps1 first.'); }
  const url = new URL(connection.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password) throw new Error('Demo Studio must run on this computer.');
  const response = await fetch(new URL('/api/command', url), {
    method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(input['action'] === 'edit.render' ? 900000 : 180000)]),
    headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  const result = await response.json() as { error?: string; code?: string };
  if (!response.ok) throw Object.assign(new Error(result.error || 'Demo Studio request failed.'),{code:result.code});
  return result;
}
