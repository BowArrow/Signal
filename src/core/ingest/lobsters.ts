import type { HttpClient } from '../lib/http.js';
import type { Logger } from '../lib/logger.js';
import type { Source } from '../db/schema.js';
import { cleanText, MAX_TITLE_CHARS } from './normalize.js';
import type { NormalizedItem, Poller, PollResult } from './types.js';

/**
 * Lobsters.
 *
 * Small and low-volume, but the readership skews hard toward people who run
 * their own infrastructure — which is most of Lemonade's buyer in one place.
 * Public JSON, no key, no gate.
 *
 * The identifier is either `newest` for everything, or a tag: `ai`, `ml`,
 * `privacy`. Lobsters is one community with one set of norms, so unlike
 * Reddit the tag does not change whose rules apply.
 */

const BASE = 'https://lobste.rs';

interface LobstersStory {
  readonly short_id?: string;
  readonly title?: string;
  readonly url?: string;
  readonly short_id_url?: string;
  readonly created_at?: string;
  readonly score?: number;
  readonly comment_count?: number;
  readonly description_plain?: string;
  readonly description?: string;
  readonly tags?: string[];
  readonly submitter_user?: string | { readonly username?: string };
}

function submitter(story: LobstersStory): string | null {
  const value = story.submitter_user;
  if (typeof value === 'string') return value;
  return value?.username ?? null;
}

export function normalizeStory(story: LobstersStory): NormalizedItem | { skip: string } {
  if (!story.short_id) return { skip: 'no short_id' };

  const title = cleanText(story.title ?? '', MAX_TITLE_CHARS);
  if (!title.text) return { skip: 'empty title' };

  // description_plain is already stripped of markup; description is HTML.
  const body = cleanText(story.description_plain ?? story.description ?? '');

  return {
    externalId: story.short_id,
    // short_id_url is the comments page, which is where a reply would go.
    url: story.short_id_url ?? `${BASE}/s/${story.short_id}`,
    community: { platform: 'lobsters', name: 'lobsters', displayName: 'Lobsters' },
    author: submitter(story),
    title: title.text,
    body: body.text,
    postedAt: story.created_at ? Date.parse(story.created_at) || null : null,
    commentCount: story.comment_count ?? null,
    platformScore: story.score ?? null,
    truncated: body.truncated || title.truncated,
    raw: story,
  };
}

export class LobstersPoller implements Poller {
  readonly kind = 'lobsters' as const;

  constructor(
    private readonly http: HttpClient,
    private readonly logger: Logger,
  ) {}

  available(): { ready: boolean } {
    return { ready: true };
  }

  async poll(source: Source): Promise<PollResult> {
    const tag = source.identifier.trim();
    const path = tag === '' || tag === 'newest' ? '/newest.json' : `/t/${tag}.json`;

    const stories = await this.http.json<LobstersStory[]>(`${BASE}${path}`, {
      // Lobsters publishes these as its JSON API.
      official: true,
      headers: { accept: 'application/json' },
    });

    const items: NormalizedItem[] = [];
    const skipped: PollResult['skipped'] = [];

    for (const story of Array.isArray(stories) ? stories : []) {
      const normalized = normalizeStory(story);
      if ('skip' in normalized) {
        skipped.push({ externalId: story.short_id ?? '?', reason: normalized.skip });
        continue;
      }
      items.push(normalized);
    }

    this.logger.debug('lobsters poll complete', {
      tag: tag || 'newest',
      kept: items.length,
      skipped: skipped.length,
    });

    return { items, skipped };
  }
}
