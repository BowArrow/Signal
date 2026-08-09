import { describe, expect, it } from 'vitest';
import {
  cleanText,
  decodeEntities,
  htmlToText,
  isTombstone,
  MAX_BODY_CHARS,
  normalizeHnHit,
  normalizeRedditPost,
  normalizeRssEntry,
  normalizeWhitespace,
  type AlgoliaHit,
  type RedditListingChild,
} from '../../src/core/ingest/normalize.js';

describe('decodeEntities', () => {
  it('decodes named, decimal and hex entities', () => {
    expect(decodeEntities('a &amp; b')).toBe('a & b');
    expect(decodeEntities('it&#39;s')).toBe("it's");
    expect(decodeEntities('it&#x27;s')).toBe("it's");
    expect(decodeEntities('&lt;script&gt;')).toBe('<script>');
  });

  it('handles the double escaping Reddit returns without raw_json=1', () => {
    // This is the actual failure mode: one pass leaves &#39; in the draft.
    expect(decodeEntities('it&amp;#39;s')).toBe("it's");
    expect(decodeEntities('a &amp;amp; b')).toBe('a & b');
  });

  it('leaves an unknown entity alone rather than mangling it', () => {
    expect(decodeEntities('&notarealentity;')).toBe('&notarealentity;');
  });

  it('terminates on a self-referential input', () => {
    // &amp;amp;amp;... would loop forever without the pass cap.
    const nested = '&amp;'.repeat(1) + 'amp;'.repeat(20);
    expect(() => decodeEntities(nested)).not.toThrow();
  });
});

describe('htmlToText', () => {
  it('keeps the link target, because a bare label is useless', () => {
    expect(htmlToText('see <a href="https://x.test/a">this</a>')).toBe(
      'see this (https://x.test/a)',
    );
  });

  it('does not duplicate when the label is the url', () => {
    expect(htmlToText('<a href="https://x.test">https://x.test</a>')).toBe('https://x.test');
  });

  it('turns block elements into paragraph breaks', () => {
    expect(htmlToText('<p>one</p><p>two</p>').trim()).toBe('one\n\ntwo');
  });

  it('turns list items into dashes', () => {
    expect(htmlToText('<ul><li>a</li><li>b</li></ul>')).toContain('- a');
  });

  it('strips script and style content entirely', () => {
    expect(htmlToText('a<script>evil()</script>b')).toBe('ab');
    expect(htmlToText('a<style>.x{}</style>b')).toBe('ab');
  });
});

describe('normalizeWhitespace', () => {
  it('preserves paragraph breaks but collapses runs', () => {
    expect(normalizeWhitespace('a\n\n\n\n\nb')).toBe('a\n\nb');
    expect(normalizeWhitespace('a\n\nb')).toBe('a\n\nb');
  });

  it('collapses horizontal runs and strips trailing spaces', () => {
    expect(normalizeWhitespace('a     b')).toBe('a b');
    expect(normalizeWhitespace('a   \nb')).toBe('a\nb');
  });

  it('normalizes non-breaking spaces and CRLF', () => {
    expect(normalizeWhitespace('a\u00a0b')).toBe('a b');
    expect(normalizeWhitespace('a\r\nb')).toBe('a\nb');
  });
});

describe('cleanText', () => {
  it('returns empty for null and undefined rather than "null"', () => {
    expect(cleanText(null)).toEqual({ text: '', truncated: false });
    expect(cleanText(undefined)).toEqual({ text: '', truncated: false });
  });

  it('does not truncate content under the cap', () => {
    const result = cleanText('x'.repeat(100));
    expect(result.truncated).toBe(false);
    expect(result.text).toHaveLength(100);
  });

  it('truncates and flags long content', () => {
    const result = cleanText('x'.repeat(MAX_BODY_CHARS + 500));
    expect(result.truncated).toBe(true);
    expect(result.text.endsWith('[truncated]')).toBe(true);
    expect(result.text.length).toBeLessThan(MAX_BODY_CHARS + 20);
  });

  it('prefers cutting on a paragraph boundary when one is near the cap', () => {
    const head = 'a'.repeat(Math.floor(MAX_BODY_CHARS * 0.9));
    const result = cleanText(`${head}\n\n${'b'.repeat(2000)}`);
    expect(result.truncated).toBe(true);
    expect(result.text).toBe(`${head}\n\n[truncated]`);
  });

  it('applies a separate, smaller cap when asked', () => {
    const result = cleanText('y'.repeat(50), 10);
    expect(result.truncated).toBe(true);
  });
});

describe('isTombstone', () => {
  it.each([
    '[removed]',
    '[deleted]',
    '[dead]',
    '[flagged]',
    '  [DEAD]  ',
    '[Removed By Reddit]',
  ])('recognizes %s', (input) => {
    expect(isTombstone(input)).toBe(true);
  });

  it('does not flag a post that merely mentions one', () => {
    expect(isTombstone('my process [deleted] the wrong file')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────── reddit ──

function redditPost(data: Partial<RedditListingChild['data']> = {}): RedditListingChild {
  return {
    kind: 't3',
    data: {
      id: 'abc123',
      name: 't3_abc123',
      permalink: '/r/LocalLLaMA/comments/abc123/vram_sizing/',
      author: 'ferrous_oxide',
      title: 'VRAM sizing: what fits on 16GB?',
      selftext: 'what is the actual arithmetic?',
      created_utc: 1_700_000_000,
      num_comments: 41,
      score: 128,
      ...data,
    },
  };
}

describe('normalizeRedditPost', () => {
  it('maps a healthy self post', () => {
    const result = normalizeRedditPost(redditPost());
    expect(result).not.toHaveProperty('skip');
    if ('skip' in result) throw new Error('unreachable');

    expect(result.externalId).toBe('t3_abc123');
    expect(result.url).toBe(
      'https://www.reddit.com/r/LocalLLaMA/comments/abc123/vram_sizing/',
    );
    expect(result.author).toBe('ferrous_oxide');
    expect(result.commentCount).toBe(41);
    expect(result.platformScore).toBe(128);
    expect(result.truncated).toBe(false);
  });

  it('converts created_utc seconds to epoch milliseconds', () => {
    const result = normalizeRedditPost(redditPost({ created_utc: 1_700_000_000 }));
    if ('skip' in result) throw new Error('unreachable');
    expect(result.postedAt).toBe(1_700_000_000_000);
  });

  it('derives the fullname when only id is present', () => {
    const { name: _omitted, ...withoutName } = redditPost().data;
    const result = normalizeRedditPost({ kind: 't3', data: withoutName });
    if ('skip' in result) throw new Error('unreachable');
    expect(result.externalId).toBe('t3_abc123');
  });

  it.each([
    ['stickied', { stickied: true }, 'stickied'],
    ['locked', { locked: true }, 'locked'],
    ['a deleted author', { author: '[deleted]' }, 'deleted author'],
    ['automod', { author: 'AutoModerator' }, 'deleted author'],
    ['a removed body', { selftext: '[removed]' }, 'body removed'],
    ['an empty title', { title: '' }, 'empty title'],
  ])('skips %s', (_label, data, reasonFragment) => {
    const result = normalizeRedditPost(redditPost(data));
    expect(result).toHaveProperty('skip');
    if (!('skip' in result)) throw new Error('unreachable');
    expect(result.skip).toContain(reasonFragment);
  });

  it('skips a child with no identifier at all', () => {
    const result = normalizeRedditPost({ kind: 't3', data: {} });
    expect(result).toHaveProperty('skip');
  });

  it('keeps a link post with an empty body', () => {
    const result = normalizeRedditPost(redditPost({ selftext: '' }));
    if ('skip' in result) throw new Error('unreachable');
    expect(result.body).toBe('');
  });

  it('falls back to the url when there is no permalink', () => {
    const { permalink: _omitted, ...withoutPermalink } = redditPost().data;
    const result = normalizeRedditPost({
      kind: 't3',
      data: { ...withoutPermalink, url: 'https://elsewhere.test/x' },
    });
    if ('skip' in result) throw new Error('unreachable');
    expect(result.url).toBe('https://elsewhere.test/x');
  });
});

// ─────────────────────────────────────────────────────── hacker news ──

function hnStory(overrides: Partial<AlgoliaHit> = {}): AlgoliaHit {
  return {
    objectID: '39000001',
    title: 'Show HN: a local model runner',
    story_text: 'we built <p>this</p>',
    author: 'pg',
    created_at_i: 1_700_000_000,
    num_comments: 63,
    points: 210,
    _tags: ['story'],
    ...overrides,
  };
}

describe('normalizeHnHit', () => {
  it('maps a story to the item permalink, not the outbound url', () => {
    const result = normalizeHnHit(hnStory({ url: 'https://someblog.test/post' }));
    if ('skip' in result) throw new Error('unreachable');
    expect(result.url).toBe('https://news.ycombinator.com/item?id=39000001');
    expect(result.postedAt).toBe(1_700_000_000_000);
    expect(result.platformScore).toBe(210);
  });

  it('marks a comment as a reply so four on one thread are distinguishable', () => {
    const result = normalizeHnHit(
      hnStory({
        _tags: ['comment'],
        title: null,
        story_title: 'Building a Rust inference engine',
        comment_text: 'the stutter is not the render',
        story_text: null,
      }),
    );
    if ('skip' in result) throw new Error('unreachable');
    expect(result.title).toBe('re: Building a Rust inference engine');
    expect(result.body).toBe('the stutter is not the render');
  });

  it.each([['[dead]'], ['[flagged]'], ['[flagged][dead]']])(
    'skips a %s story rather than queuing it',
    (title) => {
      const result = normalizeHnHit(hnStory({ title }));
      expect(result).toHaveProperty('skip');
    },
  );

  it('skips an empty comment', () => {
    const result = normalizeHnHit(
      hnStory({ _tags: ['comment'], comment_text: '', title: null, story_text: null }),
    );
    expect(result).toHaveProperty('skip');
  });

  it('skips a story with no title', () => {
    const result = normalizeHnHit(hnStory({ title: null, story_title: null }));
    expect(result).toHaveProperty('skip');
  });

  it('renders html in the body as readable text', () => {
    const result = normalizeHnHit(hnStory({ story_text: '<p>one</p><p>two</p>' }));
    if ('skip' in result) throw new Error('unreachable');
    expect(result.body).toBe('one\n\ntwo');
  });
});

// ────────────────────────────────────────────────────────────── rss ──

describe('normalizeRssEntry', () => {
  it('reads an RSS 2.0 item', () => {
    const result = normalizeRssEntry(
      {
        guid: 'https://blog.test/a',
        link: 'https://blog.test/a',
        title: 'A post',
        description: '<p>body text</p>',
        pubDate: 'Wed, 15 Nov 2023 22:13:20 GMT',
      },
      'https://blog.test/feed',
    );
    if ('skip' in result) throw new Error('unreachable');
    expect(result.externalId).toBe('https://blog.test/a');
    expect(result.body).toBe('body text');
    expect(result.postedAt).toBe(Date.parse('Wed, 15 Nov 2023 22:13:20 GMT'));
  });

  it('reads an Atom entry with attribute-shaped link and object title', () => {
    const result = normalizeRssEntry(
      {
        id: 'urn:uuid:1',
        link: { '@_href': 'https://blog.test/b' },
        title: { '#text': 'Atom post' },
        content: { '#text': 'atom body' },
        updated: '2023-11-15T22:13:20Z',
      },
      'https://blog.test/feed',
    );
    if ('skip' in result) throw new Error('unreachable');
    expect(result.externalId).toBe('urn:uuid:1');
    expect(result.title).toBe('Atom post');
    expect(result.url).toBe('https://blog.test/b');
  });

  it('falls back from guid to link for the dedup key', () => {
    const result = normalizeRssEntry(
      { link: 'https://blog.test/c', title: 'No guid' },
      'https://blog.test/feed',
    );
    if ('skip' in result) throw new Error('unreachable');
    expect(result.externalId).toBe('https://blog.test/c');
  });

  it('skips an entry with nothing to key on', () => {
    expect(normalizeRssEntry({ title: 'Orphan' }, 'https://blog.test/feed')).toHaveProperty('skip');
  });

  it('leaves postedAt null on an unparseable date rather than guessing', () => {
    const result = normalizeRssEntry(
      { guid: 'x', title: 'T', pubDate: 'not a date' },
      'https://blog.test/feed',
    );
    if ('skip' in result) throw new Error('unreachable');
    expect(result.postedAt).toBeNull();
  });

  it('prefers content:encoded over description', () => {
    const result = normalizeRssEntry(
      {
        guid: 'x',
        title: 'T',
        description: 'short summary',
        'content:encoded': 'the full article body',
      },
      'https://blog.test/feed',
    );
    if ('skip' in result) throw new Error('unreachable');
    expect(result.body).toBe('the full article body');
  });
});
