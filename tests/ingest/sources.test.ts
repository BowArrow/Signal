import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  normalizeQuestion,
  parseIdentifier,
  siteLabel,
} from '../../src/core/ingest/stackexchange.js';
import { forumName, normalizeTopic, parseForum } from '../../src/core/ingest/discourse.js';
import { normalizeIssue, repoFromUrl } from '../../src/core/ingest/github.js';
import { normalizeStory } from '../../src/core/ingest/lobsters.js';
import { parseSearchResults } from '../../src/core/ingest/reddit-scrape.js';

/**
 * These four exist because Reddit's API turned out to be gated behind a
 * discretionary approval. A system whose critical path depends on one
 * company's permission has a single point of failure, and these do not.
 */

describe('stack exchange', () => {
  it('splits site from query on the first colon only', () => {
    expect(parseIdentifier('superuser:local llm')).toEqual({
      site: 'superuser',
      query: 'local llm',
    });
    // A query containing a colon must not be truncated.
    expect(parseIdentifier('unix:ollama: gpu')).toEqual({ site: 'unix', query: 'ollama: gpu' });
  });

  it('treats a bare site as no query', () => {
    expect(parseIdentifier('askubuntu')).toEqual({ site: 'askubuntu', query: '' });
  });

  it('names the well-known sites properly', () => {
    expect(siteLabel('superuser')).toBe('Super User');
    expect(siteLabel('somethingelse')).toBe('somethingelse.stackexchange.com');
  });

  const question = {
    question_id: 1234,
    title: 'Why does 13b thrash on 16GB?',
    body: '<p>I keep seeing people say it&#39;s fine.</p>',
    link: 'https://superuser.com/q/1234',
    creation_date: 1_700_000_000,
    score: 4,
    answer_count: 0,
    is_answered: false,
    owner: { display_name: 'someone' },
  };

  it('maps a healthy question', () => {
    const result = normalizeQuestion(question, 'superuser');
    if ('skip' in result) throw new Error('unreachable');

    expect(result.externalId).toBe('1234');
    expect(result.community).toEqual({
      platform: 'stackexchange',
      name: 'superuser',
      displayName: 'Super User',
    });
    // creation_date is seconds; storing it unconverted would put every
    // question in 1970.
    expect(result.postedAt).toBe(1_700_000_000_000);
    // The body arrives as HTML from filter=withbody and must be flattened.
    expect(result.body).toBe("I keep seeing people say it's fine.");
  });

  it('skips a question that already has an accepted answer', () => {
    // The asker has moved on; a later reply helps nobody.
    expect(normalizeQuestion({ ...question, is_answered: true }, 'superuser')).toHaveProperty('skip');
  });

  it('skips a closed question', () => {
    expect(
      normalizeQuestion({ ...question, closed_date: 1_700_000_100 }, 'superuser'),
    ).toHaveProperty('skip');
  });

  it('keeps a question with no body', () => {
    const result = normalizeQuestion({ ...question, body: undefined }, 'superuser');
    if ('skip' in result) throw new Error('unreachable');
    expect(result.body).toBe('');
  });
});

describe('discourse', () => {
  it('parses a forum url, with and without a category', () => {
    expect(parseForum('https://discuss.huggingface.co')).toEqual({
      baseUrl: 'https://discuss.huggingface.co',
    });
    expect(parseForum('https://discuss.huggingface.co/#category=beginners')).toEqual({
      baseUrl: 'https://discuss.huggingface.co',
      category: 'beginners',
    });
  });

  it('strips a trailing slash so urls do not double up', () => {
    expect(parseForum('https://example.test///').baseUrl).toBe('https://example.test');
  });

  it('names a forum by host', () => {
    expect(forumName('https://discuss.huggingface.co')).toBe('discuss.huggingface.co');
    expect(forumName('not a url')).toBe('not a url');
  });

  const topic = {
    id: 77,
    title: 'How do I run this offline?',
    slug: 'how-do-i-run-this-offline',
    excerpt: 'Our network is air-gapped.',
    created_at: '2026-08-10T12:00:00.000Z',
    reply_count: 3,
    posters: [{ user_id: 9 }],
  };
  const authors = new Map([[9, 'asker']]);

  it('maps a topic to its url and community', () => {
    const result = normalizeTopic(topic, 'https://discuss.huggingface.co', authors);
    if ('skip' in result) throw new Error('unreachable');

    expect(result.url).toBe(
      'https://discuss.huggingface.co/t/how-do-i-run-this-offline/77',
    );
    expect(result.community?.name).toBe('discuss.huggingface.co');
    expect(result.author).toBe('asker');
    expect(result.commentCount).toBe(3);
  });

  it.each([
    ['pinned', { pinned: true }],
    ['closed', { closed: true }],
    ['archived', { archived: true }],
    ['already answered', { has_accepted_answer: true }],
  ])('skips a %s topic', (_label, override) => {
    expect(
      normalizeTopic({ ...topic, ...override }, 'https://x.test', authors),
    ).toHaveProperty('skip');
  });

  it('leaves the body empty when the forum publishes no excerpt', () => {
    // The poller queues a hydration fetch for exactly this case rather than
    // letting the topic be scored on its title.
    const result = normalizeTopic({ ...topic, excerpt: undefined }, 'https://x.test', authors);
    if ('skip' in result) throw new Error('unreachable');
    expect(result.body).toBe('');
  });
});

describe('github', () => {
  it('extracts owner/repo from the api url', () => {
    expect(repoFromUrl('https://api.github.com/repos/ollama/ollama')).toBe('ollama/ollama');
    expect(repoFromUrl(undefined)).toBeNull();
    expect(repoFromUrl('https://api.github.com/users/someone')).toBeNull();
  });

  const issue = {
    id: 55,
    number: 12,
    title: 'Can this run fully offline?',
    body: 'Our build box has no internet.',
    html_url: 'https://github.com/ollama/ollama/issues/12',
    repository_url: 'https://api.github.com/repos/ollama/ollama',
    created_at: '2026-08-10T00:00:00Z',
    comments: 2,
    state: 'open',
    user: { login: 'someone', type: 'User' },
  };

  it('maps an issue, with the repo as its community', () => {
    const result = normalizeIssue(issue);
    if ('skip' in result) throw new Error('unreachable');
    expect(result.community).toEqual({
      platform: 'github',
      name: 'ollama/ollama',
      displayName: 'ollama/ollama',
    });
    expect(result.commentCount).toBe(2);
  });

  it('skips a pull request', () => {
    // The search API returns PRs alongside issues, and a PR is somebody's
    // code rather than somebody's question.
    expect(normalizeIssue({ ...issue, pull_request: {} })).toHaveProperty('skip');
  });

  it('skips a closed issue', () => {
    expect(normalizeIssue({ ...issue, state: 'closed' })).toHaveProperty('skip');
  });

  it('skips an issue opened by a bot', () => {
    expect(normalizeIssue({ ...issue, user: { login: 'dependabot', type: 'Bot' } })).toHaveProperty(
      'skip',
    );
  });

  it('skips an issue whose repository cannot be determined', () => {
    expect(normalizeIssue({ ...issue, repository_url: undefined })).toHaveProperty('skip');
  });
});

describe('lobsters', () => {
  const story = {
    short_id: 'abc123',
    title: 'Running a 30B locally',
    short_id_url: 'https://lobste.rs/s/abc123',
    created_at: '2026-08-10T09:00:00.000-05:00',
    score: 21,
    comment_count: 8,
    description_plain: 'Some notes on tensor split.',
    submitter_user: 'someone',
  };

  it('maps a story to its comments page, not the outbound link', () => {
    const result = normalizeStory(story);
    if ('skip' in result) throw new Error('unreachable');
    // A reply belongs on the comments page.
    expect(result.url).toBe('https://lobste.rs/s/abc123');
    expect(result.platformScore).toBe(21);
    expect(result.author).toBe('someone');
    expect(result.community?.displayName).toBe('Lobsters');
  });

  it('accepts submitter_user as an object', () => {
    const result = normalizeStory({ ...story, submitter_user: { username: 'other' } });
    if ('skip' in result) throw new Error('unreachable');
    expect(result.author).toBe('other');
  });

  it('skips a story with no short_id', () => {
    expect(normalizeStory({ ...story, short_id: undefined })).toHaveProperty('skip');
  });
});

// ─────────────────────────────────────────── reddit search markup ──

const searchHtml = readFileSync(
  fileURLToPath(new URL('../fixtures/reddit-search.html', import.meta.url)),
  'utf8',
);

describe('parseSearchResults', () => {
  const children = parseSearchResults(searchHtml);

  it('finds the results', () => {
    // Reusing the listing parser here returned nothing at all, silently, and
    // discovery looked like it was simply finding no threads.
    expect(children.length).toBeGreaterThanOrEqual(4);
  });

  it('reads the subreddit, which is what the rules gate keys on', () => {
    for (const child of children) {
      expect(child.data.subreddit).toBeTruthy();
    }
    // A search spans communities; that is the whole point of discovery.
    expect(new Set(children.map((c) => c.data.subreddit)).size).toBeGreaterThan(1);
  });

  it('carries the body inline, so nothing needs hydrating', () => {
    expect(children.some((c) => (c.data.selftext ?? '').length > 40)).toBe(true);
  });

  it('reads title, author, permalink and timestamp', () => {
    const first = children[0];
    expect(first?.data.title).toBeTruthy();
    expect(first?.data.permalink).toMatch(/^\/r\/.+\/comments\//);
    expect(first?.data.created_utc).toBeGreaterThan(1_700_000_000);
  });

  it('returns nothing for markup with no results', () => {
    expect(parseSearchResults('<html><body>no results</body></html>')).toEqual([]);
  });
});
