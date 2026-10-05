import { expect, it } from 'vitest';
import { copyPassages } from '../../src/core/operations/copy-passages.js';

it('retains all non-whitespace copy, field identity and unique IDs across long and multilingual text', () => {
  const copy = { title: 'Check the actual offer', description: 'A description with two claims. Check both.', body: 'A useful sentence.\n\n'.repeat(40) + '界😀'.repeat(700) + '\nLast qualification: generation is a beta feature.' };
  const passages = copyPassages(copy);
  expect(new Set(passages.map(p => p.id)).size).toBe(passages.length);
  expect(passages.every(p => p.text.length <= 600 && copy[p.field].includes(p.text))).toBe(true);
  for (const field of ['title', 'description', 'body'] as const) expect(passages.filter(p => p.field === field).map(p => p.text).join('').replace(/\s/g, '')).toBe(copy[field].replace(/\s/g, ''));
  expect(passages.at(-1)!.text).toContain('generation is a beta feature');
});

it('keeps ordinary sentences intact and preserves the title and description as distinct evidence', () => {
  const copy = { title: 'Export your edit', description: 'Arrange clips on a timeline and export the result.', body: 'Try the editor. Review the arrangement before exporting. Our app: https://example.org/' };
  expect(copyPassages(copy)).toEqual([
    { id: 'title-1', field: 'title', text: copy.title }, { id: 'description-1', field: 'description', text: copy.description }, { id: 'body-1', field: 'body', text: copy.body },
  ]);
});
