/** Constrain campaign output to the already-selected destination and required fields. */
export function operationAgentSchema(accountId: string | undefined, image: boolean, shortPost = false, findingIds?: string[], productUrl?: string) {
  // Ollama's grammar parser rejects very large string repetition bounds. Keep
  // shape constraints here; deliveryInputSchema enforces every length afterward.
  const input = { type: 'object', additionalProperties: false, required: ['accountId', 'title', 'description', 'body', 'evidence', ...(image ? ['visual'] : []), ...(findingIds ? ['demand'] : [])], properties: {
    ...(findingIds ? { demand: { type: 'object', additionalProperties: false, required: ['findingId', 'reason'], properties: { findingId: { type: 'string', enum: ['none', ...findingIds] }, reason: { type: 'string', maxLength: 800 } } } } : {}),
    accountId: { type: 'string', ...(accountId ? { enum: [accountId] } : {}) },
    title: { type: 'string', maxLength: 160 }, description: { type: 'string', maxLength: 320 }, body: { type: 'string', ...(shortPost ? { maxLength: 180 } : {}) },
    evidence: { type: 'array', minItems: 1, maxItems: productUrl ? 1 : 8, items: { type: 'string', ...(productUrl ? { enum: [productUrl] } : {}) } },
    ...(image ? { visual: { type: 'object', additionalProperties: false, required: ['prompt'], properties: { prompt: { type: 'string' } } } } : {}),
  } };
  return { type: 'object', additionalProperties: false, required: ['message', 'actions'], properties: { message: { type: 'string' }, actions: { type: 'array', minItems: 1, maxItems: 1, items: { type: 'object', additionalProperties: false, required: ['tool', 'input'], properties: { tool: { type: 'string', enum: ['operations.enqueue'] }, input } } } } };
}
