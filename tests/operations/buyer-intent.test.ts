import { expect, it } from 'vitest';
import { buyerIntent } from '../../src/shared/buyer-intent.js';
it.each([
  "What's happening? Can someone summarize?",
  'Can someone summarize the football rules?',
  'Who watched the news? Explain this to me.',
  'Our new AI summarizer launched today!',
  'I need a PDF app. No AI, please.',
])('does not turn casual conversation, promotion or an exclusion into a prospect: %s', text => {
  expect(buyerIntent(text)).toBe('insufficient-context');
});
it.each([
  'Can anyone recommend a tool to compare PDF reports?',
  'I need software to organize my project notes on Windows.',
])('recognizes explicit software shopping: %s', text => expect(buyerIntent(text)).toBe('software-request'));
it.each([
  'I need to compare two reports and produce an editable summary.',
  'I want to review a document and create a presentation. My email, notes and files live in different applications and I cannot link them together.',
])('keeps concrete work problems for a helpful first conversation: %s', text => expect(buyerIntent(text)).toBe('work-problem'));
