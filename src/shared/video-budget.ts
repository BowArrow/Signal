// MiniMax H3, 768P only. Recheck the provider's price sheet before changing
// model, resolution, reference counts or reference-video duration.
export const H3_PRICE = {
  revision: '2026-09-19-h3-768p',
  source: 'https://platform.minimax.io/docs/guides/pricing-paygo',
  outputCentsPerSecond: 8, referenceCentsPerSecond: 8,
} as const;

export function h3EstimateCents(seconds: number) {
  if (!Number.isInteger(seconds) || seconds < 5 || seconds > 15) throw new Error('H3 budget estimates require a 5–15 second shot.');
  // Signal submits one equal-duration Blender guide and at most three images.
  // MiniMax's first five reference images are free for this model.
  return seconds * (H3_PRICE.outputCentsPerSecond + H3_PRICE.referenceCentsPerSecond);
}
