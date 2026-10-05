import type { CompletionRequest } from '../../src/core/llm/client.js';

/** A fixture verdict for workflow tests; semantic model behavior has separate live checks. */
export function reviewFixture(request: CompletionRequest, options: { supported?: boolean; quoteId?: string; explanation?: string } = {}) {
  const passages = JSON.parse(request.prompt.split('ARTIFACT_PASSAGES: ')[1]!) as { id: string }[];
  return { checks: passages.map(passage => ({ passageId: passage.id, quoteIds: [options.quoteId ?? 'source-1'], explanation: options.explanation ?? 'The observed source supports this exact passage.', verdict: options.supported === false ? 'unsupported' : 'supported' })) };
}
