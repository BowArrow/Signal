import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request } from 'node:https';

export function publicOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash || !url.hostname.includes('.') || isIP(url.hostname) || url.hostname.startsWith('[') || /(?:^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname)) throw new Error('Use a public HTTPS domain origin without a path, credentials, or port.');
  return url.origin;
}
export function publicAddress(ip: string): boolean {
  if (ip.includes(':')) return /^(?:2|3)/.test(ip); // Public global unicast; excludes mapped IPv4 and local IPv6.
  const [a = 0, b = 0] = ip.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)));
}
/** Pin custom-site DNS for the actual request, not just a preflight lookup. */
export async function customSiteFetch(url: string, headers: Record<string, string>): Promise<Response> {
  const target = new URL(url); publicOrigin(target.origin);
  const addresses = await lookup(target.hostname, { all: true });
  if (!addresses.length || addresses.some(address => !publicAddress(address.address))) throw new Error('Custom account sites must resolve only to public addresses.');
  const address = addresses[0]!;
  return new Promise((resolve, reject) => {
    const req = request(target, { method: 'GET', headers, timeout: 15000, family: address.family, lookup: (_host, _options, callback) => callback(null, address.address, address.family) }, res => {
      const chunks: Buffer[] = []; let size = 0;
      res.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 2_000_000) req.destroy(new Error('Provider response too large')); else chunks.push(chunk); });
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode ?? 500 })));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Account request timed out'))); req.on('error', reject); req.end();
  });
}
export async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}. Check the credential, API access, and requested permissions.`);
  if (!response.body) throw new Error('Provider returned no response');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > 2_000_000) throw new Error('Provider response too large'); chunks.push(chunk.value); } }
  finally { await reader.cancel(); }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Provider returned an unexpected response');
  return value as Record<string, unknown>;
}
