import { describe, expect, it } from 'vitest';
import {
  checkDisclosure,
  hasDisclosure,
  type ProductNameCheck,
} from '../../src/core/guardrails/disclosure.js';

const PRODUCTS: ProductNameCheck[] = [
  { key: 'lemonade', name: 'Lemonade', aliases: ['lemonade.app'] },
  { key: 'cinegen', name: 'CineGen' },
  { key: 'sunshore', name: 'Sunshore' },
];

describe('hasDisclosure', () => {
  it.each([
    'disclosure: my product',
    'Disclosure: I build this.',
    'full disclosure, i built it',
    'i build this, so take it with salt',
    'i built this',
    'we build this',
    'i wrote this',
    'i work on it',
    "i'm the author",
    "I'm the creator of it",
    'my product, so obviously biased',
    'our tool does this',
    'i work at the company that makes it',
    'disclaimer: mine',
  ])('accepts %s', (text) => {
    expect(hasDisclosure(text)).toBe(true);
  });

  it.each([
    'this is a great tool',
    'someone built this',
    'they make a product like that',
    'i use this every day',
    'i like it a lot',
    'i found this helpful',
  ])('rejects %s', (text) => {
    expect(hasDisclosure(text)).toBe(false);
  });
});

describe('checkDisclosure', () => {
  it('passes when no product is named', () => {
    const result = checkDisclosure('the arithmetic is weights plus kv cache', PRODUCTS);
    expect(result).toMatchObject({
      productMentioned: false,
      violation: false,
    });
  });

  it('blocks a product named with no disclosure — the whole point', () => {
    const result = checkDisclosure('you should try Lemonade for this', PRODUCTS);
    expect(result.productMentioned).toBe(true);
    expect(result.disclosurePresent).toBe(false);
    expect(result.violation).toBe(true);
    expect(result.mentioned).toEqual(['Lemonade']);
    expect(result.message).toContain('no disclosure');
  });

  it('passes a product named alongside a disclosure', () => {
    const result = checkDisclosure(
      'i build Lemonade, which does exactly this. disclosure: my product.',
      PRODUCTS,
    );
    expect(result.violation).toBe(false);
    expect(result.disclosurePresent).toBe(true);
  });

  it('catches a second product name-dropped without disclosure', () => {
    // A draft about Lemonade that also mentions CineGen still needs to
    // disclose. Checking only the matched product would miss this.
    const result = checkDisclosure('for video work there is always CineGen', PRODUCTS);
    expect(result.violation).toBe(true);
    expect(result.mentioned).toEqual(['CineGen']);
  });

  it('reports every product named', () => {
    const result = checkDisclosure('Lemonade and CineGen and Sunshore', PRODUCTS);
    expect(result.mentioned).toEqual(['Lemonade', 'CineGen', 'Sunshore']);
  });

  it('matches a product name case-insensitively', () => {
    expect(checkDisclosure('try lemonade', PRODUCTS).productMentioned).toBe(true);
    expect(checkDisclosure('try LEMONADE', PRODUCTS).productMentioned).toBe(true);
  });

  it('matches an alias like the domain', () => {
    const result = checkDisclosure('grab it at lemonade.app', PRODUCTS);
    expect(result.productMentioned).toBe(true);
  });

  it.each([
    ['homemade lemonades taste better', 'a plural inside another word'],
    ['this is lemonade-flavoured', 'a hyphenated compound'],
    ['xLemonade', 'a prefix'],
    ['Lemonades', 'a plural'],
  ])('does not fire on %s (%s)', (text) => {
    // False positives are worse than they look: they train you to click past
    // the validator, which is how the real violation eventually gets through.
    expect(checkDisclosure(text, PRODUCTS).productMentioned).toBe(false);
  });

  it('still matches at a sentence boundary', () => {
    expect(checkDisclosure('I recommend Lemonade.', PRODUCTS).productMentioned).toBe(true);
    expect(checkDisclosure('Lemonade, specifically.', PRODUCTS).productMentioned).toBe(true);
    expect(checkDisclosure('(Lemonade)', PRODUCTS).productMentioned).toBe(true);
  });

  it('reports a disclosure present even when nothing is named', () => {
    // Not a violation, but the flag is recorded on the draft either way.
    const result = checkDisclosure('disclosure: i build tools in this space', PRODUCTS);
    expect(result.violation).toBe(false);
    expect(result.disclosurePresent).toBe(true);
  });

  it('handles an empty body', () => {
    expect(checkDisclosure('', PRODUCTS).violation).toBe(false);
  });

  it('handles an empty product list', () => {
    expect(checkDisclosure('Lemonade is great', []).violation).toBe(false);
  });

  it('escapes regex metacharacters in a product name', () => {
    const odd: ProductNameCheck[] = [{ key: 'x', name: 'C++ Helper' }];
    expect(() => checkDisclosure('anything', odd)).not.toThrow();
  });
});
