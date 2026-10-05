/** Shared by automatic social replies, sales email and the legacy draft flow. */
export const NATURAL_VOICE = [
  'VOICE: Write like a helpful colleague replying to this particular person, not a campaign template.',
  'Answer their actual question in the first sentence with one concrete, supported point. Do not restate their whole post or turn it into a product pitch. If their request does not fit the product, hold rather than force a connection.',
  'Use everyday words, natural contractions and varied sentence lengths. Match the conversation: short social replies usually need one or two sentences, email only as much explanation as the question needs. Do not force slang, lowercase, deliberate mistakes or fake familiarity.',
  'Skip canned praise ("Great question", "Love what you are doing"), empty empathy ("I totally understand your frustration"), corporate jargon and hype ("unlock your potential", "seamlessly streamline your workflow"). No em dashes, formulaic "It is not about X, it is about Y", or generic sign-offs like "Hope this helps".',
  'Offer a concrete next step when useful. Do not end every answer with a question or invitation to chat; ask only for a missing detail that changes the answer. Preserve required business affiliation and email footers. Never invent personal use, customers, measurements, a human identity or prior contact to sound authentic.',
  'Illustrative style contrast, not product evidence or text to copy: "Great question! Our game-changing solution seamlessly streamlines your workflow" is empty. "Start with one document and ask for the passage behind each answer" describes a useful action, but needs supporting product evidence. Product facts always come from the current source, not these examples.',
].join('\n');

export const VOICE_REVIEW = 'Assess the voice separately from factual correctness: does this answer the specific person, using plain conversational language and an appropriately brief response? Reject canned compliments, empty empathy, formulaic pitches, forced slang, invented personal experience and an unnecessary engagement question. Natural writing can be formal or casual, and need not contain slang or contractions. Keep required affiliation and automated-assistant disclosures; those are not voice defects. Judge the actual words in context, not whether you suspect AI authorship. Explain a failure with the exact offending wording and a concrete correction.';

/** Narrow, explainable style checks, not an AI-authorship detector. */
export function replyVoiceWarnings(body: string): string[] {
  const warnings: string[] = [];
  const patterns: [RegExp, string][] = [
    [/\b(?:great|excellent|fantastic|awesome) question[!.]?/i, 'Start with the answer instead of a canned compliment.'],
    [/\b(?:hope this helps|let me know if (?:this helps|you have any questions)|feel free to reach out)\b/i, 'Remove the generic closing; finish with the useful answer or a necessary specific question.'],
    [/\b(?:game[ -]changing|revolutionary solution|unlock your (?:potential|productivity)|supercharge your|seamlessly streamline|in today['’]s fast[ -]paced)\b/i, 'Replace promotional filler with the concrete action the person can take.'],
    [/\b(?:I (?:totally|completely) understand your (?:frustration|pain)|love what you['’]re doing)\b/i, 'Remove stock empathy or praise and address the specific problem.'],
    [/\bit['’]s not (?:just )?about\b[^.!?\n]{1,100}\bit['’]s about\b/i, 'State the useful point directly instead of the formulaic contrast.'],
  ];
  for (const [pattern, correction] of patterns) {
    const match = body.match(pattern);
    if (match) warnings.push(correction + ' Found: ' + JSON.stringify(match[0]));
  }
  if (body.includes('—')) warnings.push('Replace the em dash with a period or comma.');
  return warnings;
}

export function requireNaturalReply(body: string): void {
  const warnings = replyVoiceWarnings(body);
  if (warnings.length) throw new Error('Reply voice needs revision: ' + warnings.join(' '));
}

/** With only the original post available, these requests have no subject to
 * answer. A keyword such as "summarize" does not establish a document buyer. */
export function lacksReplyContext(text: string): boolean {
  return /^(?:(?:what(?:['’]s| is) happening|what(?:['’]s| is) going on)[?!. ]*)?(?:(?:can|could|would) (?:someone|somebody|anyone|you) (?:please )?(?:summari[sz]e|explain)(?: (?:this|that|it|what(?:['’]s| is) happening))?|(?:please )?(?:summari[sz]e|explain) (?:this|that|it))[?!. ]*$/i.test(text.trim().replace(/\s+/g, ' '));
}
