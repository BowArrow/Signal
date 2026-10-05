const DID = /^did:(?:plc|web):(?:[A-Za-z0-9._:-]|%[0-9A-Fa-f]{2})+$/;
const RECORD_KEY = /^[A-Za-z0-9._~-]{1,100}$/;

/** Bluesky's web router expects literal DID separators in the profile path. */
export function blueskyPostUrl(uri: string): string | null {
  const match = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/.exec(uri);
  if (!match || !DID.test(match[1]!) || !RECORD_KEY.test(match[2]!) || ['.', '..'].includes(match[2]!)) return null;
  return `https://bsky.app/profile/${match[1]}/post/${match[2]}`;
}

/** Repair links saved by older Signal releases without rewriting their history. */
export function normalizeBlueskyPostUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { return value; }
  if (url.origin !== 'https://bsky.app' || url.username || url.password) return value;
  const match = /^\/profile\/([^/]+)\/post\/([^/]+)\/?$/.exec(url.pathname);
  if (!match || !/^did%3A(?:plc|web)%3A/i.test(match[1]!)) return value;
  let did: string;
  try { did = decodeURIComponent(match[1]!); } catch { return value; }
  const canonical = blueskyPostUrl(`at://${did}/app.bsky.feed.post/${match[2]}`);
  return canonical ? canonical + url.search + url.hash : value;
}

export function externalBrowserUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`refusing to open a ${url.protocol} url`);
  return normalizeBlueskyPostUrl(value);
}
