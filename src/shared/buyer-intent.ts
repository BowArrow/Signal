export type BuyerIntent = 'software-request' | 'work-problem' | 'insufficient-context';
/** Conservative routing before model qualification, not proof of willingness to buy. */
export function buyerIntent(text: string): BuyerIntent {
  const value = text.replace(/\s+/g, ' ');
  if (/\b(?:no (?:ads|bots|promotion|AI)|do not (?:pitch|promote)|don['’]t (?:pitch|promote))\b/i.test(value)) return 'insufficient-context';
  const software = /\b(?:app|apps|tool|tools|software|program|extension|assistant|alternative)\b/i.test(value);
  const seeking = /\b(?:looking for|recommend|recommendations|suggestions|does anyone know|is there|I need|we need|I want|we want|anyone know|what (?:app|tool|software)|which (?:app|tool|software))\b/i.test(value);
  if (software && seeking) return 'software-request';
  const artifact = /\b(?:documents?|files?|PDFs?|spreadsheets?|reports?|notes|emails?|presentations?|invoices?|research|clips?|videos?|storyboards?|footage|scenes?)\b/i.test(value);
  const personal = /\b(?:I|we|my|our|client|project)\b/i.test(value);
  const problem = /\b(?:need|want|struggling|cannot|can't|can’t|hours|manual|scattered|different applications|different apps|compare|find|search|create|draft|link|organize|summari[sz]e|edit|render|export)\b/i.test(value);
  return artifact && personal && problem ? 'work-problem' : 'insufficient-context';
}
export const CONSULTATIVE_REPLY = [
  'CONVERSATION STRATEGY: Qualify before pitching. A keyword match is not a customer need.',
  'Software request: answer the actual selection question, explain one supported capability relevant to their constraints, and suggest a small task they can try. No feature dump, fake urgency or claim that the product fixes the whole workflow.',
  'Work problem: address the concrete bottleneck first. Offer one useful step or ask one question about their actual files, current workaround, or constraint if it changes your answer. Do not interrogate them or ask hypothetical willingness to pay.',
  'For the first work-problem reply, omit the product name, URLs and calls to download or buy. Signal adds team affiliation. Introduce the app only after interest or an explicit software request; do not treat silence as consent for another pitch.',
  'A product demonstration should reproduce their stated task with non-sensitive sample data, identify a checkable result and a relevant limit. A later trial invitation should name the first task to complete, not merely ask them to visit a homepage.',
  'Measure observed responses, trials and verified purchases separately. A reply, a click, friendliness or shared interests do not establish a qualified buyer or a sale.',
].join('\n');
