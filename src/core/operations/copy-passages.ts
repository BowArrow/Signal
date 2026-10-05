import type { DeliveryInput } from '../../shared/operations.js';

/** Cover the complete artifact with exact spans. Long sentences are split, never dropped. */
export function copyPassages(copy: Pick<DeliveryInput, 'title' | 'description' | 'body'>) {
  const passages: { id: string; field: 'title' | 'description' | 'body'; text: string }[] = [];
  const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
  for (const field of ['title', 'description', 'body'] as const) {
    let index = 0, pending = '';
    const save = () => { if (pending.trim()) passages.push({ id: `${field}-${++index}`, field, text: pending.trim() }); pending = ''; };
    for (const { segment } of segmenter.segment(copy[field])) {
      if (pending.length + segment.length > 600) save();
      let remaining = segment;
      while (remaining.length > 600) { pending = remaining.slice(0, 600); save(); remaining = remaining.slice(600); }
      pending += remaining;
      if (pending.length >= 300) save();
    }
    save();
  }
  return passages;
}
