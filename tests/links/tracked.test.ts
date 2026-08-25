import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DbHandle } from '../../src/core/db/client.js';
import { links, type Community, type Product } from '../../src/core/db/schema.js';
import {
  attachToPublication,
  createLink,
  destinationWithUtm,
  substituteLink,
  trackedUrl,
  utmFor,
  utmSlug,
} from '../../src/core/links/tracked.js';
import { fixedClock } from '../../src/core/lib/clock.js';
import { insertCommunity, insertProduct, testDb } from '../helpers/db.js';

const NOW = 1_700_000_000_000;

describe('utmSlug', () => {
  it('lowercases, because analytics treats Reddit and reddit as two sources', () => {
    expect(utmSlug('LocalLLaMA')).toBe('localllama');
  });

  it('strips the r/ prefix', () => {
    expect(utmSlug('r/LocalLLaMA')).toBe('localllama');
  });

  it('collapses anything that would need escaping', () => {
    expect(utmSlug('Unix & Linux')).toBe('unix-linux');
    expect(utmSlug('ollama/ollama')).toBe('ollama-ollama');
    expect(utmSlug('discuss.huggingface.co')).toBe('discuss-huggingface-co');
  });

  it('does not leave leading or trailing separators', () => {
    expect(utmSlug('  !!hello!!  ')).toBe('hello');
  });

  it('caps the length', () => {
    expect(utmSlug('a'.repeat(200)).length).toBeLessThanOrEqual(64);
  });
});

describe('utmFor', () => {
  it('uses the community as the campaign', () => {
    const community = { name: 'localllama' } as Community;
    expect(utmFor(community, 'reddit')).toEqual({
      utmSource: 'reddit',
      utmMedium: 'comment',
      utmCampaign: 'localllama',
    });
  });

  it('falls back to unattributed with no community', () => {
    expect(utmFor(null, 'hn').utmCampaign).toBe('unattributed');
  });
});

describe('trackedUrl', () => {
  it('is short and carries no parameters', () => {
    // What goes in the comment. Parameters live on the record, so the scheme
    // can change without invalidating a link already in the wild.
    expect(trackedUrl('https://signal-edge-aionx.web.app', 'abc1234')).toBe(
      'https://signal-edge-aionx.web.app/r/abc1234',
    );
  });

  it('tolerates a trailing slash on the origin', () => {
    expect(trackedUrl('https://x.test/', 'k')).toBe('https://x.test/r/k');
  });
});

describe('destinationWithUtm', () => {
  const base = {
    destinationUrl: 'https://siplemona.de',
    utmSource: 'reddit',
    utmMedium: 'comment',
    utmCampaign: 'localllama',
    utmContent: null,
    publicationId: null,
  };

  it('applies the utm parameters', () => {
    const url = new URL(destinationWithUtm(base));
    expect(url.searchParams.get('utm_source')).toBe('reddit');
    expect(url.searchParams.get('utm_medium')).toBe('comment');
    expect(url.searchParams.get('utm_campaign')).toBe('localllama');
  });

  it('carries the publication id, which is what makes attribution unambiguous', () => {
    const url = new URL(destinationWithUtm({ ...base, publicationId: 'pub_114' }));
    expect(url.searchParams.get('pub')).toBe('pub_114');
  });

  it('omits pub when the link was never published', () => {
    expect(new URL(destinationWithUtm(base)).searchParams.has('pub')).toBe(false);
  });

  it('preserves an existing path and query on the destination', () => {
    const url = new URL(
      destinationWithUtm({ ...base, destinationUrl: 'https://siplemona.de/download?os=win' }),
    );
    expect(url.pathname).toBe('/download');
    expect(url.searchParams.get('os')).toBe('win');
    expect(url.searchParams.get('utm_source')).toBe('reddit');
  });
});

describe('createLink', () => {
  let handle: DbHandle;
  beforeEach(() => {
    handle = testDb();
  });
  afterEach(() => handle.close());

  it('writes a record with no publication yet', () => {
    const product = insertProduct(handle);
    const community = insertCommunity(handle);

    const link = createLink(handle.db, product, community, 'reddit', fixedClock(NOW));

    expect(link.publicationId).toBeNull();
    expect(link.destinationUrl).toBe(product.utmBase);
    expect(link.utmCampaign).toBe('localllama');
    expect(handle.db.select().from(links).all()).toHaveLength(1);
  });

  it('mints short, unambiguous ids', () => {
    const product = insertProduct(handle);
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      seen.add(createLink(handle.db, product, null, 'reddit', fixedClock(NOW)).id);
    }
    expect(seen.size).toBe(50);
    for (const id of seen) {
      // No lookalike characters: these get read aloud and retyped.
      expect(id).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{7}$/);
    }
  });

  it('attaches to a publication after the fact', () => {
    const product = insertProduct(handle);
    const link = createLink(handle.db, product, null, 'reddit', fixedClock(NOW));
    attachToPublication(handle.db, link.id, 'pub_1');
    expect(handle.db.select().from(links).get()?.publicationId).toBe('pub_1');
  });
});

describe('substituteLink', () => {
  const product = {
    name: 'Lemonade',
    utmBase: 'https://siplemona.de',
  } as Product;
  const tracked = 'https://signal-edge-aionx.web.app/r/abc1234';

  it('replaces a bare host', () => {
    const result = substituteLink('grab it at siplemona.de today', product, tracked);
    expect(result.substituted).toBe(true);
    expect(result.body).toBe(`grab it at ${tracked} today`);
  });

  it('replaces a full url with scheme and path', () => {
    const result = substituteLink('see https://siplemona.de/download for it', product, tracked);
    expect(result.body).toBe(`see ${tracked} for it`);
  });

  it('replaces a www form', () => {
    expect(substituteLink('www.siplemona.de', product, tracked).body).toBe(tracked);
  });

  it('leaves trailing sentence punctuation alone', () => {
    const result = substituteLink('it is at siplemona.de.', product, tracked);
    // The trailing full stop belongs to the sentence, not the URL.
    expect(result.body).toBe(`it is at ${tracked}.`);
  });

  it('stops at a closing bracket so markdown links survive', () => {
    const result = substituteLink('[Lemonade](https://siplemona.de)', product, tracked);
    expect(result.body).toBe(`[Lemonade](${tracked})`);
  });

  it('does not inject a link the draft never had', () => {
    // Substituting is fine; adding a URL after review would change the text
    // I approved. A bare mention with no link is a good reply.
    const result = substituteLink(
      'i build Lemonade, which does this. disclosure: my product.',
      product,
      tracked,
    );
    expect(result.substituted).toBe(false);
    expect(result.body).not.toContain(tracked);
  });

  it('reports a product mention that carried no link', () => {
    // Worth surfacing: this reply will produce no attribution at all.
    const result = substituteLink('i build Lemonade. disclosure: my product.', product, tracked);
    expect(result.mentionWithoutLink).toBe(true);
  });

  it('does not claim a missing link when the product is not mentioned either', () => {
    const result = substituteLink('the arithmetic is weights plus kv cache', product, tracked);
    expect(result.substituted).toBe(false);
    expect(result.mentionWithoutLink).toBe(false);
  });

  it('replaces every occurrence', () => {
    const result = substituteLink('siplemona.de and again siplemona.de', product, tracked);
    expect(result.body).toBe(`${tracked} and again ${tracked}`);
  });

  it('survives a product whose utmBase is not a url', () => {
    const broken = { name: 'X', utmBase: 'not-a-url' } as Product;
    expect(() => substituteLink('anything', broken, tracked)).not.toThrow();
    expect(substituteLink('anything', broken, tracked).substituted).toBe(false);
  });

  it('does not match a different host that merely contains the name', () => {
    const result = substituteLink('see notsiplemona.decoy.test now', product, tracked);
    expect(result.substituted).toBe(false);
  });
});
