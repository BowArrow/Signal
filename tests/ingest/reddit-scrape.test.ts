import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  isSelfPost,
  parseListing,
  parsePostBody,
  textOf,
} from '../../src/core/ingest/reddit-scrape.js';
import { normalizeRedditPost } from '../../src/core/ingest/normalize.js';

/**
 * Parsed against markup actually served by old.reddit.com, captured to
 * tests/fixtures. Scraping breaks when a site changes its HTML, so the fixture
 * is the whole point: when Reddit reshuffles their markup these tests fail
 * loudly instead of ingestion silently returning nothing.
 */
const listingHtml = readFileSync(
  fileURLToPath(new URL('../fixtures/reddit-listing.html', import.meta.url)),
  'utf8',
);

describe('parseListing', () => {
  const children = parseListing(listingHtml);

  it('finds every post in the fixture', () => {
    expect(children.length).toBeGreaterThanOrEqual(6);
  });

  it('reads the fullname as the dedup key', () => {
    for (const child of children) {
      expect(child.data.name).toMatch(/^t3_[a-z0-9]+$/);
      expect(child.kind).toBe('t3');
    }
  });

  it('reads the title', () => {
    const titles = children.map((c) => c.data.title ?? '');
    expect(titles.every((t) => t.length > 0)).toBe(true);
    expect(titles.some((t) => /model size/i.test(t))).toBe(true);
  });

  it('reads the subreddit, which is what attributes the community', () => {
    for (const child of children) {
      expect(child.data.subreddit).toBe('LocalLLaMA');
    }
  });

  it('converts the millisecond timestamp back to created_utc seconds', () => {
    const first = children[0]?.data.created_utc;
    expect(first).toBeGreaterThan(1_700_000_000);
    // Would be a thousand times too large if the units were mishandled.
    expect(first).toBeLessThan(4_000_000_000);
  });

  it('reads score and comment count as numbers', () => {
    for (const child of children) {
      expect(typeof child.data.score).toBe('number');
      expect(typeof child.data.num_comments).toBe('number');
    }
  });

  it('reads the permalink', () => {
    expect(children[0]?.data.permalink).toMatch(/^\/r\/LocalLLaMA\/comments\//);
  });

  it('distinguishes self posts from link posts', () => {
    const selfPosts = children.filter(isSelfPost);
    expect(selfPosts.length).toBeGreaterThan(0);
    expect(selfPosts.length).toBeLessThanOrEqual(children.length);
  });

  it('leaves selftext empty, because the listing does not carry it', () => {
    // Old Reddit lazy-loads bodies. Pretending otherwise would mean scoring
    // every text post on its title alone without anyone noticing.
    for (const child of children) {
      expect(child.data.selftext).toBe('');
    }
  });

  it('produces children the existing normalizer accepts unchanged', () => {
    // The whole reason the scraper emits Reddit's own shape: nothing
    // downstream should know or care where the data came from.
    const normalized = children.map(normalizeRedditPost).filter((r) => !('skip' in r));
    expect(normalized.length).toBeGreaterThan(0);

    const first = normalized[0];
    if (!first || 'skip' in first) throw new Error('unreachable');
    expect(first.url).toContain('reddit.com/r/LocalLLaMA/comments/');
    expect(first.community).toEqual({
      platform: 'reddit',
      name: 'LocalLLaMA',
      displayName: 'r/LocalLLaMA',
    });
    expect(first.postedAt).toBeGreaterThan(1_700_000_000_000);
  });

  it('returns nothing for markup with no posts, rather than throwing', () => {
    expect(parseListing('<html><body>nothing here</body></html>')).toEqual([]);
  });

  it('survives a truncated page', () => {
    expect(() => parseListing(listingHtml.slice(0, 4000))).not.toThrow();
  });

  it('skips promoted posts', () => {
    const promoted = `<div class="thing" data-fullname="t3_ad1" data-promoted="true"
      data-subreddit="LocalLLaMA" data-domain="self.LocalLLaMA">
      <a class="title" href="/x">An advertisement</a></div>`;
    expect(parseListing(promoted)).toEqual([]);
  });

  it('skips a post with no title', () => {
    const untitled = `<div class="thing" data-fullname="t3_x" data-promoted="false"
      data-subreddit="LocalLLaMA" data-domain="self.LocalLLaMA"></div>`;
    expect(parseListing(untitled)).toEqual([]);
  });
});

describe('textOf', () => {
  it('strips tags and decodes entities', () => {
    expect(textOf('<b>it&amp;#39;s</b> here')).toBe("it's here");
  });

  it('handles an empty fragment', () => {
    expect(textOf('')).toBe('');
  });
});

describe('parsePostBody', () => {
  const postPage = `
    <div class="side"><div class="usertext-body"><div class="md">
      <p>sidebar description that must not be mistaken for a post body</p>
    </div></div></div>
    <div class="thing" data-fullname="t3_abc" data-type="link">
      <form class="usertext"><div class="usertext-body md-container">
        <div class="md">
          <p>i keep seeing people say 13b runs fine on 16gb.</p>
          <p>what&amp;#39;s the actual arithmetic? see <a href="https://x.test/a">this</a>.</p>
        </div>
      </div></form>
    </div>`;

  it('takes the body from the post, not the sidebar', () => {
    // Both use usertext-body. Anchoring on the post container is the fix.
    const body = parsePostBody(postPage, 't3_abc');
    expect(body).toContain('13b runs fine on 16gb');
    expect(body).not.toContain('sidebar description');
  });

  it('decodes entities and keeps link targets', () => {
    const body = parsePostBody(postPage, 't3_abc');
    expect(body).toContain("what's the actual arithmetic");
    expect(body).toContain('this (https://x.test/a)');
  });

  it('preserves paragraph breaks', () => {
    expect(parsePostBody(postPage, 't3_abc')).toContain('\n\n');
  });

  it('returns empty for a post with no body', () => {
    const linkPost = '<div class="thing" data-fullname="t3_z"><a class="title">x</a></div>';
    expect(parsePostBody(linkPost, 't3_z')).toBe('');
  });

  it('returns empty rather than throwing on unrecognised markup', () => {
    expect(parsePostBody('<html></html>', 't3_missing')).toBe('');
  });
});
