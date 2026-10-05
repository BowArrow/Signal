import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request } from 'node:https';
import type { IncomingMessage } from 'node:http';
import type { App } from '../app.js';
import { marketingSettings } from './store.js';

// Node forwards these socket options; the installed HTTPS options type omits them.
const pinnedSocketOptions = { autoSelectFamily: false };

function privateAddress(ip: string): boolean {
  if (isIP(ip) === 6) return !/^2[0-9a-f]{3}:/i.test(ip);
  const [a = 0, b = 0] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}
export interface PublicPage { url: string; title: string; body: string; observedAt: number; trust: string; links?: { url: string; text: string }[]; }
export function pageLinks(raw: string, base: string) {
  const links: { url: string; text: string }[] = [];
  const clean = (value: string) => value.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&#(?:39|x27);/g, "'").replace(/&quot;/g, '"').trim();
  for (const match of raw.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = new URL(clean(match[1]!), base);
      if (!['https:', 'mailto:'].includes(url.protocol) || url.username || url.password) continue;
      links.push({ url: url.href.slice(0, 2000), text: clean(match[2]!).slice(0, 200) });
      if (links.length >= 150) break;
    } catch { /* Unusable page link. */ }
  }
  return links;
}
export async function publicPage(app: App, value: string, signal?: AbortSignal): Promise<PublicPage> {
  if (app.env.SIGNAL_OFFLINE === '1') throw new Error('Offline mode');
  let url = new URL(value);
  for (let hop = 0; hop < 4; hop++) {
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Web research accepts public HTTPS pages without credentials');
    const addresses = await lookup(url.hostname, { all: true });
    if (!addresses.length || addresses.some((a) => privateAddress(a.address))) throw new Error('Private network pages cannot be read by the public research tool');
    const address = addresses[0]!;
    // Pin the checked address so a second DNS lookup cannot rebind to localhost.
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const req = request(url, { family: address.family, ...pinnedSocketOptions,
        lookup: (_host, _options, callback) => callback(null, address.address, address.family),
        signal: AbortSignal.any([AbortSignal.timeout(12000), ...(signal ? [signal] : [])]), headers: { 'user-agent': 'SignalResearch/0.2 (read-only product research)', 'accept-encoding': 'identity' } }, resolve);
      req.on('error', reject); req.end();
    });
    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400 && response.headers.location) { response.destroy(); url = new URL(response.headers.location, url); continue; }
    if (status < 200 || status >= 300) { response.destroy(); throw new Error(`Page returned HTTP ${status}`); }
    const contentType = response.headers['content-type'] ?? '';
    if (!/text\/(html|plain)|application\/(json|xhtml)/i.test(contentType)) { response.destroy(); throw new Error('Use a text or HTML page for research'); }
    let raw = ''; let bytes = 0;
    const decoder = new TextDecoder();
    for await (const chunk of response) { const buffer = Buffer.from(chunk as Uint8Array); bytes += buffer.length; if (bytes > 1000000) { response.destroy(); break; } raw += decoder.decode(buffer, { stream: true }); }
    const title = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]*>/g, '') ?? url.hostname;
    const body = raw.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, 12000);
    return { url: url.toString(), title, body, links: pageLinks(raw, url.href), observedAt: app.clock.now(), trust: 'Untrusted page text; claims require verification before publication.' };
  }
  throw new Error('Too many redirects');
}
export async function searchWeb(app: App, query: string) {
  const base = marketingSettings(app).searxUrl;
  if (!base) return { available: false, detail: 'No local SearXNG server configured. Use signals.find for discovered community questions or web.read for a specific public URL.' };
  if (app.env.SIGNAL_OFFLINE === '1') throw new Error('Offline mode');
  const url = new URL(`${base.replace(/\/$/, '')}/search`); url.searchParams.set('q', query.slice(0, 300)); url.searchParams.set('format', 'json');
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Local search returned ${response.status}`);
  const result = await response.json() as { results?: { title: string; url: string; content: string }[] };
  return { available: true, results: (result.results ?? []).slice(0, 6).map((r) => ({ title: String(r.title).slice(0, 200), url: String(r.url).slice(0, 2000), snippet: String(r.content).slice(0, 600) })) };
}
