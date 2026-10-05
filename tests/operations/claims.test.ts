import { expect, it } from 'vitest';
import { generationClaimWarnings } from '../../src/core/operations/claims.js';

it.each([
  'Generate sequenced shots instantly.',
  'Instant video generation.',
  'Immediately render the finished clip.',
  'Keep their look and voice consistent across every scene you generate.',
  'The same character in all generated shots.',
  'Set up your character library once so they appear consistently in every generated scene.',
  'Character consistency across all shots.',
])('flags a generation assurance for revision: %s', text => {
  expect(generationClaimWarnings(text)).toHaveLength(1);
});

it.each([
  'Set a reusable character reference, then check the generated shots.',
  'Review every scene for continuity before exporting.',
  'Use consistent naming for your files.',
  'Generate a storyboard. Your changes are saved immediately.',
])('allows practical steps without generation assurances: %s', text => {
  expect(generationClaimWarnings(text)).toEqual([]);
});
