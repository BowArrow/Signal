import type { NormalizedItem } from './types.js';

/**
 * Bodies are capped before they reach the database. A 40k-character thread
 * costs real money to classify and adds nothing after the first few thousand
 * characters — the question is always near the top.
 */
export const MAX_BODY_CHARS = 6000;
export const MAX_TITLE_CHARS = 400;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  '#39': "'",
  '#x27': "'",
  '#x2F': '/',
  '#47': '/',
};

/**
 * Reddit double-escapes: selftext comes back with `&amp;#39;` where the source
 * had an apostrophe. One pass leaves `&#39;` sitting in the text, which then
 * shows up verbatim in a draft. So decode repeatedly until it stops changing.
 */
export function decodeEntities(input: string): string {
  let out = input;
  for (let pass = 0; pass < 4; pass += 1) {
    const next = out.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
      const lower = entity.toLowerCase();
      if (lower.startsWith('#x')) {
        const code = Number.parseInt(entity.slice(2), 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      if (lower.startsWith('#')) {
        const code = Number.parseInt(entity.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      return NAMED_ENTITIES[lower] ?? match;
    });
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * HN comment_text and RSS content are HTML. Turn them into something a person
 * and a model can both read, preserving paragraph breaks and link targets —
 * a comment that says "see [this](url)" is useless without the url.
 */
export function htmlToText(html: string): string {
  return (
    html
      .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, '')
      .replace(/<\s*br\s*\/?\s*>/gi, '\n')
      .replace(/<\s*\/\s*(p|div|li|tr|h[1-6]|blockquote)\s*>/gi, '\n\n')
      .replace(/<\s*li[^>]*>/gi, '- ')
      .replace(/<\s*a[^>]+href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\s*\/\s*a\s*>/gi, (_m, href: string, label: string) => {
        const text = label.replace(/<[^>]+>/g, '').trim();
        if (!text) return href;
        return text === href ? href : `${text} (${href})`;
      })
      .replace(/<[^>]+>/g, '')
  );
}

/**
 * Collapses runs of whitespace without destroying paragraph structure. Blank
 * lines carry meaning in a Reddit post and the drafter reads them.
 */
export function normalizeWhitespace(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    // Non-breaking and narrow no-break spaces arrive via HTML entities. They
    // read as ordinary spaces but defeat every whitespace regex after this.
    .replace(/[\u00a0\u202f\u2007]/g, ' ')
    // Trailing spaces on a line are noise.
    .replace(/[ \t]+$/gm, '')
    .replace(/[ \t]{2,}/g, ' ')
    // Three or more newlines collapse to a paragraph break.
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface CleanResult {
  readonly text: string;
  readonly truncated: boolean;
}

export function cleanText(input: string | null | undefined, maxChars = MAX_BODY_CHARS): CleanResult {
  if (input == null) return { text: '', truncated: false };
  const decoded = normalizeWhitespace(decodeEntities(htmlToText(input)));
  if (decoded.length <= maxChars) return { text: decoded, truncated: false };

  // Cut on a paragraph boundary if there is one nearby, so the tail is not a
  // half sentence.
  const window = decoded.slice(0, maxChars);
  const lastBreak = window.lastIndexOf('\n\n');
  const cut = lastBreak > maxChars * 0.6 ? window.slice(0, lastBreak) : window;
  return { text: `${cut.trimEnd()}\n\n[truncated]`, truncated: true };
}

/**
 * Placeholders platforms leave behind when content is gone. HN in particular
 * returns a story whose entire title is "[dead]" or "[flagged]", which without
 * this check sails through as a perfectly valid-looking opportunity.
 */
const TOMBSTONES = new Set([
  '[removed]',
  '[deleted]',
  '[removed by reddit]',
  '[unavailable]',
  '[dead]',
  '[flagged]',
  '[flagged][dead]',
  '[flagged] [dead]',
]);

export function isTombstone(text: string): boolean {
  return TOMBSTONES.has(text.trim().toLowerCase());
}

export function isDeletedAuthor(author: string | null | undefined): boolean {
  if (!author) return true;
  const a = author.trim().toLowerCase();
  return a === '[deleted]' || a === 'automoderator';
}

// ─────────────────────────────────────────────────────────── reddit ──

export interface RedditListingChild {
  readonly kind: string;
  readonly data: {
    readonly id?: string;
    readonly name?: string;
    readonly permalink?: string;
    readonly url?: string;
    readonly author?: string;
    readonly title?: string;
    readonly selftext?: string;
    readonly created_utc?: number;
    readonly num_comments?: number;
    readonly score?: number;
    readonly stickied?: boolean;
    readonly over_18?: boolean;
    readonly locked?: boolean;
    readonly link_flair_text?: string | null;
    readonly subreddit?: string;
  };
}

export function normalizeRedditPost(child: RedditListingChild): NormalizedItem | { skip: string } {
  const d = child.data;
  const externalId = d.name ?? (d.id ? `t3_${d.id}` : undefined);
  if (!externalId) return { skip: 'no id on the listing child' };

  // A stickied post is a mod announcement or a megathread, never someone
  // asking a question we can answer.
  if (d.stickied) return { skip: 'stickied' };
  if (d.locked) return { skip: 'locked — cannot reply' };
  if (isDeletedAuthor(d.author)) return { skip: 'deleted author or automod' };

  const rawBody = d.selftext ?? '';
  if (isTombstone(rawBody)) return { skip: 'body removed or deleted' };

  const title = cleanText(d.title ?? '', MAX_TITLE_CHARS);
  if (!title.text) return { skip: 'empty title' };
  const body = cleanText(rawBody);

  return {
    externalId,
    url: d.permalink
      ? `https://www.reddit.com${d.permalink}`
      : (d.url ?? `https://www.reddit.com/comments/${d.id ?? ''}`),
    author: d.author ?? null,
    title: title.text,
    body: body.text,
    postedAt: typeof d.created_utc === 'number' ? Math.round(d.created_utc * 1000) : null,
    commentCount: typeof d.num_comments === 'number' ? d.num_comments : null,
    platformScore: typeof d.score === 'number' ? d.score : null,
    truncated: body.truncated || title.truncated,
    raw: child,
  };
}

// ─────────────────────────────────────────────────────── hacker news ──

export interface AlgoliaHit {
  readonly objectID: string;
  readonly title?: string | null;
  readonly story_title?: string | null;
  readonly url?: string | null;
  readonly story_url?: string | null;
  readonly author?: string | null;
  readonly story_text?: string | null;
  readonly comment_text?: string | null;
  readonly created_at_i?: number;
  readonly num_comments?: number | null;
  readonly points?: number | null;
  readonly _tags?: string[];
}

export function normalizeHnHit(hit: AlgoliaHit): NormalizedItem | { skip: string } {
  if (!hit.objectID) return { skip: 'no objectID' };
  if (isDeletedAuthor(hit.author)) return { skip: 'deleted author' };

  const isComment = (hit._tags ?? []).includes('comment');
  const rawBody = (isComment ? hit.comment_text : hit.story_text) ?? '';
  const rawTitle = hit.title ?? hit.story_title ?? '';

  // HN keeps dead and flagged submissions in the search index with the
  // tombstone as the entire title. Nothing to reply to.
  if (isTombstone(rawTitle)) return { skip: 'dead or flagged story' };
  if (rawBody && isTombstone(rawBody)) return { skip: 'dead or flagged comment' };

  const body = cleanText(rawBody);
  const title = cleanText(rawTitle, MAX_TITLE_CHARS);

  // A comment with no text is a moderation artifact. A story with neither text
  // nor title is not something we can reason about.
  if (isComment && !body.text) return { skip: 'empty comment' };
  if (!isComment && !title.text) return { skip: 'empty story title' };

  // For a comment, Algolia's title field holds the parent story. Four comments
  // on one thread would otherwise arrive as four identical-looking rows, so
  // mark them as replies and let the body carry the actual content.
  const displayTitle = isComment
    ? `re: ${title.text || 'Hacker News thread'}`
    : title.text || `${body.text.slice(0, 120)}…`;

  return {
    externalId: hit.objectID,
    url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
    author: hit.author ?? null,
    title: displayTitle,
    body: body.text,
    postedAt: typeof hit.created_at_i === 'number' ? hit.created_at_i * 1000 : null,
    commentCount: typeof hit.num_comments === 'number' ? hit.num_comments : null,
    platformScore: typeof hit.points === 'number' ? hit.points : null,
    truncated: body.truncated || title.truncated,
    raw: hit,
  };
}

// ────────────────────────────────────────────────────────────── rss ──

export interface RssEntry {
  readonly guid?: string | { '#text'?: string } | null;
  readonly id?: string | null;
  readonly link?: string | { '@_href'?: string } | null;
  readonly title?: string | { '#text'?: string } | null;
  readonly description?: string | null;
  readonly summary?: string | null;
  readonly content?: string | { '#text'?: string } | null;
  readonly 'content:encoded'?: string | null;
  readonly author?: string | { name?: string } | null;
  readonly 'dc:creator'?: string | null;
  readonly pubDate?: string | null;
  readonly published?: string | null;
  readonly updated?: string | null;
}

/** RSS and Atom disagree about almost every field name. Flatten both. */
function pickString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const text = obj['#text'] ?? obj['@_href'] ?? obj['name'];
    if (typeof text === 'string') return text;
  }
  return null;
}

export function normalizeRssEntry(entry: RssEntry, feedUrl: string): NormalizedItem | { skip: string } {
  const link = pickString(entry.link);
  const guid = pickString(entry.guid) ?? entry.id ?? link;
  if (!guid) return { skip: 'no guid, id or link' };

  const title = cleanText(pickString(entry.title) ?? '', MAX_TITLE_CHARS);
  if (!title.text) return { skip: 'empty title' };

  const rawBody =
    entry['content:encoded'] ?? pickString(entry.content) ?? entry.summary ?? entry.description ?? '';
  const body = cleanText(typeof rawBody === 'string' ? rawBody : '');

  const dateString = entry.pubDate ?? entry.published ?? entry.updated ?? null;
  const parsed = dateString ? Date.parse(dateString) : Number.NaN;

  return {
    externalId: guid,
    url: link ?? feedUrl,
    author: pickString(entry.author) ?? entry['dc:creator'] ?? null,
    title: title.text,
    body: body.text,
    postedAt: Number.isFinite(parsed) ? parsed : null,
    commentCount: null,
    platformScore: null,
    truncated: body.truncated || title.truncated,
    raw: entry,
  };
}
