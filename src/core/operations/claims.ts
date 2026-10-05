/** Conservative checks for generation promises missed by local editorial models.
 * These flag wording for revision; passing them does not establish factual accuracy.
 */
export function generationClaimWarnings(text: string): string[] {
  const sentences = text.split(/[.!?\n]+/);
  const warnings: string[] = [];
  if (sentences.some(sentence => /\b(?:instant(?:ly)?|immediate(?:ly)?)\b/i.test(sentence) && /\b(?:generat\w*|render\w*)\b/i.test(sentence))) {
    warnings.push('Remove the instant generation promise. Describe the generation step without asserting an unverified completion time.');
  }
  if (sentences.some(sentence => /\b(?:consisten(?:t(?:ly)?|cy)|identical(?:ly)?|same|unchanged)\b/i.test(sentence) && /\b(?:every|all)\s+(?:generated\s+)?(?:scenes?|shots?|frames?|clips?)\b/i.test(sentence))) {
    warnings.push('Remove the promise of consistency across every generated scene. Describe setting a reusable character reference and checking the outputs, without promising identical results.');
  }
  return warnings;
}
