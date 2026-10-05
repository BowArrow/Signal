import { replyVoiceWarnings } from '../marketing/voice.js';
import { copyWarnings } from '../studio/store.js';

export function prospectCopyWarnings(subject: string, body: string) {
  const warnings = [...replyVoiceWarnings(subject + '\n' + body), ...copyWarnings(body)];
  if (/without\s+(?:ever\s+)?(?:uploading|sending|sharing)\s+(?:your\s+|any\s+|sensitive\s+)*(?:files|documents|data)|\b(?:keep|keeps|keeping)\s+everything\s+local/i.test(body)) warnings.push('Remove the absolute privacy promise. Describe the supported document task; optional network tools and setup are separate.');
  if (/have you found (?:it|lemonade|cinegen) useful|as (?:a |an )?(?:current |existing )?(?:user|customer) of/i.test(body)) warnings.push('Do not imply this cold prospect has used the product. Ask a relevant workflow question without assumed usage.');
  return [...new Set(warnings)];
}
