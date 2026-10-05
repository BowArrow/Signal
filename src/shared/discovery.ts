import { z } from 'zod';

export const discoveryQuerySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('bluesky'), query: z.string().trim().min(3).max(160) }).strict(),
  z.object({ kind: z.literal('hn'), query: z.string().trim().min(3).max(160) }).strict(),
  z.object({ kind: z.literal('stackexchange'), site: z.enum(['superuser', 'softwarerecs', 'video', 'ai', 'stackoverflow']), query: z.string().trim().min(3).max(160) }).strict(),
]);
export type DiscoveryQuery = z.infer<typeof discoveryQuerySchema>;
export const discoveryPolicySchema = z.object({ enabled: z.boolean(), queries: z.array(discoveryQuerySchema).min(1).max(8) }).strict();
export type DiscoveryPolicy = z.infer<typeof discoveryPolicySchema>;
export interface DemandFinding {
  reply?: { uri: string; cid: string; authorDid: string };
  id: string; url: string; title: string; excerpt: string; postedAt: number; observedAt: number;
  query: string; kind: DiscoveryQuery['kind'] | 'search-console'; requestLanguage: boolean;
}
export interface DiscoverySnapshot {
  productId: string; revision: number; lastAttemptAt: number | null; nextAttemptAt: number;
  searches: { query: string; attemptedAt: number; status: 'ok' | 'attention'; found: number; detail: string }[];
  findings: DemandFinding[];
}
export function queryLabel(query: DiscoveryQuery): string { return query.kind === 'stackexchange' ? `stackexchange:${query.site}:${query.query}` : `${query.kind}:${query.query}`; }
export function parseDiscoveryQueries(text: string): DiscoveryQuery[] {
  return discoveryPolicySchema.shape.queries.parse(text.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(line => {
    if (line.startsWith('hn:')) return { kind: 'hn', query: line.slice(3) };
    if (line.startsWith('bluesky:')) return { kind: 'bluesky', query: line.slice(8) };
    const match = /^stackexchange:([^:]+):(.+)$/.exec(line);
    if (match) return { kind: 'stackexchange', site: match[1], query: match[2] };
    throw new Error('Use hn:search words, bluesky:search words or stackexchange:site:search words, one search per line.');
  }));
}
export function suggestedDiscoveryQueries(businessName: string): string {
  if (/cinegen/i.test(businessName)) return 'hn:video editing\nhn:storyboard\nstackexchange:video:editing\nstackexchange:softwarerecs:video editor';
  if (/lemonade/i.test(businessName)) return 'hn:local AI\nhn:documents\nstackexchange:softwarerecs:offline assistant\nstackexchange:superuser:local AI';
  return '';
}
