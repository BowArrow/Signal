import { expect, it } from 'vitest';
import { replyVoiceWarnings, requireNaturalReply, lacksReplyContext } from '../../src/core/marketing/voice.js';
import { copyWarnings } from '../../src/core/studio/store.js';

it('rejects the actual vague summarizing request and absolute local-analysis promise', () => {
  expect(lacksReplyContext("What's happening? Can someone summarize?")).toBe(true);
  expect(lacksReplyContext('Could someone explain this?')).toBe(true);
  expect(lacksReplyContext('Can someone summarize these quarterly reports and show what changed?')).toBe(false);
  expect(copyWarnings('Compare the figures across these quarterly reports and list only what changed year-over-year. This keeps your analysis entirely on your machine.')).toContain('Qualify the local-processing claim. Local model inference does not mean the entire analysis or workflow stays on the machine.');
});

it.each([
  'Great question! Start with a document.',
  'I totally understand your frustration. Here is our tool.',
  'Our game-changing app can supercharge your workflow.',
  'Try one file. Hope this helps!',
  "It's not about files, it's about your workflow.",
  'Try one file—then read the source.',
])('holds recognizable canned or promotional reply language: %s', body => {
  expect(replyVoiceWarnings(body).length).toBeGreaterThan(0);
  expect(() => requireNaturalReply(body)).toThrow('Reply voice needs revision');
});

it.each([
  "Are those scanned PDFs or selectable text? That changes which step you'll need first.",
  'Start with one document and check the cited passage before using the answer. Our app: https://siplemona.de/',
  "That won't replace replying to the original email. Keep the original thread open.",
  'Lemonade team · AI assistant\nReply "stop" if you do not want further contact.',
  'The invoice includes a leverage ratio. Check it against the original report.',
])('allows specific language, limitations and honest disclosure: %s', body => {
  expect(replyVoiceWarnings(body)).toEqual([]);
});
