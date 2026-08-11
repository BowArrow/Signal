import { HttpError, type HttpClient } from '../lib/http.js';
import type { Logger } from '../lib/logger.js';
import { decodeEntities } from './normalize.js';
import type { RedditListingChild } from './normalize.js';

/**
 * Reddit without the API.
 *
 * Reddit's Data API is now gated behind a discretionary approval, and every
 * unauthenticated JSON endpoint returns 403 behind Cloudflare. Old Reddit's
 * server-rendered HTML is still served, so this reads that instead — a
 * hand-rolled adapter over public pages.
 *
 * Casey's decision, made explicitly and against the ToS/robots guardrail in
 * his own original spec. It is fenced accordingly: it only runs for sources
 * carrying a named `ignoreRobotsTxt` exemption, it paces itself far more
 * slowly than the API client did, and it backs off hard rather than hammering
 * when Reddit pushes back. The account this system exists to protect is the
 * thing at risk if it misbehaves.
 *
 * Deliberately emits `RedditListingChild` — the exact shape the OAuth client
 * produced — so the normalizer, dedup, community attribution, rules gate and
 * scoring downstream are all untouched by where the data came from.
 */

export const OLD_REDDIT = 'https://old.reddit.com';

/**
 * Old Reddit serves the desktop site to a desktop browser agent and something
 * far less useful to anything else. This is not an attempt to look like a
 * person — the pacing below makes no secret of being a program — it is what
 * makes the HTML parseable at all.
 */
export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Per-post container in an old.reddit listing. */
const THING_SPLIT = /(?=<div [^>]*class="[^"]*\bthing\b)/;

function attr(block: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(block);
  return match?.[1];
}

function num(block: string, name: string): number | undefined {
  const raw = attr(block, name);
  if (raw == null || raw === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function bool(block: string, name: string): boolean {
  return attr(block, name) === 'true';
}

/** Strips tags and decodes entities from a fragment of markup. */
export function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, '')).trim();
}

/**
 * Parses one old.reddit listing page into the same children the API returned.
 *
 * Selftext is deliberately absent: old Reddit lazy-loads post bodies, so the
 * listing carries metadata and title only. Bodies are hydrated separately —
 * see hydrateBody — which keeps a poll to one request instead of twenty-five.
 */
export function parseListing(html: string): RedditListingChild[] {
  const blocks = html.split(THING_SPLIT).filter((b) => /data-fullname="t3_/.test(b));
  const children: RedditListingChild[] = [];

  for (const block of blocks) {
    const fullname = attr(block, 'data-fullname');
    if (!fullname) continue;

    // Promoted posts are advertising, not somebody asking a question.
    if (bool(block, 'data-promoted')) continue;

    const titleMatch = /<a[^>]*class="[^"]*\btitle\b[^"]*"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    const title = titleMatch ? textOf(titleMatch[1] ?? '') : '';
    if (!title) continue;

    const permalink = attr(block, 'data-permalink');
    const subreddit = attr(block, 'data-subreddit');
    const domain = attr(block, 'data-domain') ?? '';
    // data-domain is "self.<subreddit>" for a text post and the outbound host
    // for a link post.
    const isSelfPost = domain.startsWith('self.');

    children.push({
      kind: 't3',
      data: {
        name: fullname,
        id: fullname.replace(/^t3_/, ''),
        ...(permalink ? { permalink } : {}),
        ...(attr(block, 'data-url') ? { url: attr(block, 'data-url') } : {}),
        ...(attr(block, 'data-author') ? { author: attr(block, 'data-author') } : {}),
        ...(subreddit ? { subreddit } : {}),
        title,
        // Empty until hydrated. A link post legitimately has none.
        selftext: '',
        // data-timestamp is already milliseconds; created_utc is seconds.
        ...(num(block, 'data-timestamp') != null
          ? { created_utc: (num(block, 'data-timestamp') as number) / 1000 }
          : {}),
        ...(num(block, 'data-comments-count') != null
          ? { num_comments: num(block, 'data-comments-count') }
          : {}),
        ...(num(block, 'data-score') != null ? { score: num(block, 'data-score') } : {}),
        stickied: /\bstickied\b/.test(block) || bool(block, 'data-stickied'),
        over_18: bool(block, 'data-nsfw'),
        locked: /\blocked\b/.test(block) && /class="[^"]*locked/.test(block),
      },
      // Not part of Reddit's own shape — carried so the caller knows whether a
      // hydration fetch would find anything.
      ...(isSelfPost ? { __isSelfPost: true } : {}),
    } as RedditListingChild);
  }

  return children;
}

/** True when this post has a body worth a hydration request. */
export function isSelfPost(child: RedditListingChild): boolean {
  return (child as { __isSelfPost?: boolean }).__isSelfPost === true;
}

/**
 * Pulls the selftext out of a rendered post page.
 *
 * Old Reddit wraps a text post's body in the first `usertext-body` inside the
 * post's own `thing` container. The sidebar uses the same class, so anchor on
 * the post container first rather than taking the first match on the page.
 */
export function parsePostBody(html: string, fullname: string): string {
  const blocks = html.split(THING_SPLIT);
  const block = blocks.find((b) => b.includes(`data-fullname="${fullname}"`)) ?? blocks[1] ?? '';

  const body = /<div class="usertext-body[^"]*"[^>]*>([\s\S]*?)<\/form>/.exec(block);
  if (!body) return '';

  const md = /<div class="md">([\s\S]*?)<\/div>\s*<\/div>/.exec(body[1] ?? '');
  const inner = md?.[1] ?? body[1] ?? '';

  // Keep link targets and paragraph breaks, and decode entities here rather
  // than relying on cleanText downstream — a caller reading this body directly
  // should never see a raw &amp;#39;.
  const stripped = inner
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(p|li|blockquote|h[1-6])\s*>/gi, '\n\n')
    .replace(/<\s*li[^>]*>/gi, '- ')
    .replace(
      /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
      (_m, href: string, label: string) => {
        const text = label.replace(/<[^>]+>/g, '').trim();
        return !text || text === href ? href : `${text} (${href})`;
      },
    )
    .replace(/<[^>]+>/g, '');

  return decodeEntities(stripped)
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export class RedditBlockedError extends Error {
  constructor(readonly status: number) {
    super(
      `Reddit returned ${status}. The public HTML path is being refused — ` +
        'back off and leave it alone for a while rather than retrying hard.',
    );
    this.name = 'RedditBlockedError';
  }
}

/**
 * A minimal client over old.reddit's HTML pages.
 *
 * Paced deliberately slowly. The thing being protected is the Reddit identity
 * this whole system is built to establish reputation for, and no amount of
 * ingestion throughput is worth risking it.
 */
export class RedditScrapeClient {
  constructor(
    private readonly http: HttpClient,
    private readonly logger: Logger,
  ) {}

  available(): { ready: boolean } {
    // No credentials involved. That is the entire point.
    return { ready: true };
  }

  /**
   * Four seconds between requests, well beyond the client default. This path
   * has no rate limit published for it and no account to attribute load to,
   * so the only responsible setting is a slow one.
   */
  static readonly MIN_INTERVAL_MS = 4000;

  private async page(path: string, params: Record<string, string> = {}): Promise<string> {
    const url = new URL(path, OLD_REDDIT);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    try {
      const res = await this.http.request(url.toString(), {
        // Only reachable from a source carrying a named robots exemption;
        // HttpClient refuses otherwise.
        ignoreRobotsTxt: true,
        minIntervalMs: RedditScrapeClient.MIN_INTERVAL_MS,
        headers: {
          'user-agent': BROWSER_UA,
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'en-US,en;q=0.9',
        },
      });
      return await res.text();
    } catch (err) {
      // A 403 arrives as an HttpError from the retry loop. Translate it, so
      // the caller can tell "Reddit is refusing us" from "the parse failed" —
      // they need very different responses.
      if (err instanceof HttpError && (err.status === 403 || err.status === 429)) {
        this.logger.warn('reddit refused a public page request', {
          status: err.status,
          path,
        });
        throw new RedditBlockedError(err.status);
      }
      throw err;
    }
  }

  async listing(subreddit: string, limit = 25): Promise<RedditListingChild[]> {
    const html = await this.page(`/r/${subreddit}/new/`, { limit: String(limit) });
    const children = parseListing(html);
    this.logger.debug('scraped listing', { subreddit, posts: children.length });
    return children;
  }

  async search(query: string, limit = 25): Promise<RedditListingChild[]> {
    const html = await this.page('/search', {
      q: query,
      sort: 'new',
      t: 'week',
      limit: String(limit),
      include_over_18: 'off',
    });
    const children = parseListing(html);
    this.logger.debug('scraped search', { query, posts: children.length });
    return children;
  }

  /** Fetches one post page and returns its selftext. */
  async body(permalink: string, fullname: string): Promise<string> {
    const html = await this.page(permalink);
    return parsePostBody(html, fullname);
  }

  /** The rules page, as the community wrote them. */
  async rules(subreddit: string): Promise<{ shortName: string; description: string }[]> {
    const html = await this.page(`/r/${subreddit}/about/rules/`);
    const rules: { shortName: string; description: string }[] = [];

    // Each rule is a table row: the short name in a header cell, the body in
    // the following markdown block.
    const rows = html.split(/(?=<div class="rule[ "])/).slice(1);
    for (const row of rows) {
      const name = /<div class="rule-header"[^>]*>([\s\S]*?)<\/div>/.exec(row);
      const desc = /<div class="md">([\s\S]*?)<\/div>/.exec(row);
      const shortName = name ? textOf(name[1] ?? '') : '';
      const description = desc ? textOf(desc[1] ?? '') : '';
      if (shortName || description) rules.push({ shortName, description });
    }

    return rules;
  }
}
