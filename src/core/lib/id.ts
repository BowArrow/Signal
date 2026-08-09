import { customAlphabet, nanoid } from 'nanoid';

/** Primary keys. Opaque, URL-safe, no coordination needed. */
export function newId(): string {
  return nanoid(21);
}

/**
 * Short ids for tracked links. These end up inside Reddit comments, so they
 * need to be short and unambiguous when read aloud or retyped: no lookalike
 * characters, lowercase only.
 */
const shortAlphabet = '23456789abcdefghjkmnpqrstuvwxyz';
const shortId = customAlphabet(shortAlphabet, 7);

export function newLinkId(): string {
  return shortId();
}
