import { expect, it } from 'vitest';
import { blueskyPostUrl, externalBrowserUrl, normalizeBlueskyPostUrl } from '../../src/shared/bluesky-url.js';

const did = 'did:plc:225g4y2e35b4fylvbsbe752f';
const key = '3mwjlhrkwe22t';
const canonical = `https://bsky.app/profile/${did}/post/${key}`;
const legacy = `https://bsky.app/profile/${encodeURIComponent(did)}/post/${key}`;

it('builds the reported source with literal DID separators', () => {
  expect(blueskyPostUrl(`at://${did}/app.bsky.feed.post/${key}`)).toBe(canonical);
  expect(externalBrowserUrl(legacy)).toBe(canonical);
});
it('repairs saved links once and preserves query and fragment', () => {
  const result = normalizeBlueskyPostUrl(legacy + '?view=thread#reply');
  expect(result).toBe(canonical + '?view=thread#reply');
  expect(normalizeBlueskyPostUrl(result)).toBe(result);
});
it('preserves percent escapes belonging to a did:web identifier', () => {
  const web = 'did:web:example.com%3A8443:user';
  const expected = `https://bsky.app/profile/${web}/post/${key}`;
  expect(blueskyPostUrl(`at://${web}/app.bsky.feed.post/${key}`)).toBe(expected);
  expect(normalizeBlueskyPostUrl(`https://bsky.app/profile/${encodeURIComponent(web)}/post/${key}`)).toBe(expected);
});
it.each([
  'https://example.com/profile/did%3Aplc%3Atest/post/a',
  'https://bsky.app.evil.example/profile/did%3Aplc%3Atest/post/a',
  'https://bsky.app/profile/person.bsky.social/post/a',
  'https://bsky.app/profile/did%3Aplc%3Atest%2Fother/post/a',
  'https://bsky.app/profile/did%3Aplc%3Atest%ZZ/post/a',
  'https://bsky.app/profile/did%253Aplc%253Atest/post/a',
  'https://user@bsky.app/profile/did%3Aplc%3Atest/post/a',
])('does not rewrite unrelated or malformed links: %s', value => {
  expect(normalizeBlueskyPostUrl(value)).toBe(value);
});
it.each(['file:///C:/Windows', 'javascript:alert(1)', 'data:text/plain,test'])('keeps external opening restricted to web URLs: %s', value => {
  expect(() => externalBrowserUrl(value)).toThrow('refusing to open');
});
it.each([
  'at://did:plc:abc/app.bsky.feed.post/..',
  'at://did:plc:abc/app.bsky.feed.post/post?redirect=elsewhere',
  'at://did:plc:abc/app.bsky.feed.like/abc',
  'at://did:plc:abc/extra/app.bsky.feed.post/abc',
])('does not build invalid post routes: %s', value => expect(blueskyPostUrl(value)).toBeNull());
