import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Prompts live in src/prompts as versioned markdown, never as string literals
 * in business logic. Two reasons that matters here: a draft records which
 * prompt version produced it, so the learning loop can tell a prompt change
 * from a model change; and voice.md is a file Casey edits by hand and Phase 4
 * appends to, which only works if prompts are files.
 */

export interface Prompt {
  /** e.g. "reply.v1" — recorded on every draft. */
  readonly version: string;
  readonly template: string;
  /** Substitutes {{name}}. Throws on a placeholder with no value. */
  render(vars: Record<string, string>): string;
}

let cachedDir: string | null = null;

export function promptsDir(): string {
  if (cachedDir) return cachedDir;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // Packaged / bundled: copied next to the main bundle.
    join(here, 'prompts'),
    join(here, '..', 'prompts'),
    // Running from source under tsx: src/core/prompts -> src/prompts
    resolve(here, '..', '..', 'prompts'),
    resolve(here, '..', '..', '..', 'src', 'prompts'),
    resolve(here, '..', '..', '..', '..', 'src', 'prompts'),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'voice.md'))) {
      cachedDir = candidate;
      return candidate;
    }
  }
  throw new Error(
    `Could not find src/prompts. Looked in:\n${candidates.map((c) => `  ${c}`).join('\n')}`,
  );
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function renderTemplate(template: string, vars: Record<string, string>): string {
  const missing: string[] = [];
  const out = template.replace(PLACEHOLDER, (_match, name: string) => {
    const value = vars[name];
    if (value === undefined) {
      missing.push(name);
      return '';
    }
    return value;
  });
  if (missing.length > 0) {
    // Silently leaving a hole would ship "{{product}}" to a real community.
    throw new Error(`prompt is missing values for: ${[...new Set(missing)].join(', ')}`);
  }
  return out;
}

const cache = new Map<string, Prompt>();

/** `loadPrompt('reply', 1)` reads src/prompts/reply.v1.md. */
export function loadPrompt(name: string, version: number): Prompt {
  const key = `${name}.v${version}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const path = join(promptsDir(), `${key}.md`);
  if (!existsSync(path)) {
    throw new Error(`prompt ${key} does not exist at ${path}`);
  }
  const template = readFileSync(path, 'utf8');
  const prompt: Prompt = {
    version: key,
    template,
    render: (vars) => renderTemplate(template, vars),
  };
  cache.set(key, prompt);
  return prompt;
}

/**
 * The voice file. Read fresh every time rather than cached: it is the file
 * most likely to be edited while the app is running, and picking up a change
 * without a restart is the whole point of keeping it on disk.
 */
export function loadVoice(): { text: string; sampleCount: number; hasSamples: boolean } {
  const path = join(promptsDir(), 'voice.md');
  const text = readFileSync(path, 'utf8');

  // A sample section counts only if its fenced block has real content — the
  // shipped template has five empty placeholders and must not read as five
  // samples.
  const sections = text.split(/^## sample\b/im).slice(1);
  const filled = sections.filter((section) => {
    const fence = /```[\s\S]*?```/.exec(section);
    if (!fence) return false;
    const body = fence[0].replace(/```/g, '').trim();
    return body.length > 0 && !/^paste a real (post|comment) here$/i.test(body);
  });

  return { text, sampleCount: filled.length, hasSamples: filled.length > 0 };
}

/** Test seam. */
export function __resetPromptCache(): void {
  cache.clear();
  cachedDir = null;
}
