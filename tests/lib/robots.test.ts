import { describe, expect, it } from 'vitest';
import { isAllowedByRobots } from '../../src/core/lib/http.js';

const UA = 'windows:com.aionx.signal:v0.1.0 (by /u/casey)';

describe('isAllowedByRobots', () => {
  it('allows everything when there are no rules', () => {
    expect(isAllowedByRobots('', UA, '/anything')).toBe(true);
  });

  it('honors a wildcard disallow', () => {
    const txt = 'User-agent: *\nDisallow: /private';
    expect(isAllowedByRobots(txt, UA, '/private/thing')).toBe(false);
    expect(isAllowedByRobots(txt, UA, '/public')).toBe(true);
  });

  it('treats an empty Disallow as allow-all', () => {
    expect(isAllowedByRobots('User-agent: *\nDisallow:', UA, '/anything')).toBe(true);
  });

  it('lets the longest matching rule win', () => {
    const txt = ['User-agent: *', 'Disallow: /feed', 'Allow: /feed/public'].join('\n');
    expect(isAllowedByRobots(txt, UA, '/feed/private')).toBe(false);
    expect(isAllowedByRobots(txt, UA, '/feed/public/a.xml')).toBe(true);
  });

  it('prefers a group naming us over the wildcard group', () => {
    const txt = [
      'User-agent: *',
      'Disallow: /',
      '',
      'User-agent: com.aionx.signal',
      'Disallow: /admin',
    ].join('\n');
    expect(isAllowedByRobots(txt, UA, '/feed.xml')).toBe(true);
    expect(isAllowedByRobots(txt, UA, '/admin/x')).toBe(false);
  });

  it('applies consecutive user-agent lines to one shared rule block', () => {
    const txt = ['User-agent: badbot', 'User-agent: *', 'Disallow: /nope'].join('\n');
    expect(isAllowedByRobots(txt, UA, '/nope')).toBe(false);
  });

  it('ignores comments and blank lines', () => {
    const txt = ['# a comment', '', 'User-agent: *  # inline', 'Disallow: /x  # also inline'].join('\n');
    expect(isAllowedByRobots(txt, UA, '/x')).toBe(false);
    expect(isAllowedByRobots(txt, UA, '/y')).toBe(true);
  });

  it('is case-insensitive on field names', () => {
    expect(isAllowedByRobots('USER-AGENT: *\nDISALLOW: /x', UA, '/x')).toBe(false);
  });

  it('ignores directives it does not implement', () => {
    const txt = ['User-agent: *', 'Crawl-delay: 10', 'Sitemap: https://x.test/s.xml', 'Disallow: /x'].join('\n');
    expect(isAllowedByRobots(txt, UA, '/x')).toBe(false);
    expect(isAllowedByRobots(txt, UA, '/y')).toBe(true);
  });

  it('applies rules only to the group they belong to', () => {
    const txt = ['User-agent: googlebot', 'Disallow: /', '', 'User-agent: *', 'Allow: /'].join('\n');
    expect(isAllowedByRobots(txt, UA, '/anything')).toBe(true);
  });

  it('blocks a full-site disallow', () => {
    expect(isAllowedByRobots('User-agent: *\nDisallow: /', UA, '/')).toBe(false);
  });
});
