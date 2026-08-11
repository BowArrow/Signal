import type { HttpClient } from '../lib/http.js';
import type { Logger } from '../lib/logger.js';
import type { Source } from '../db/schema.js';
import { cleanText, MAX_TITLE_CHARS } from './normalize.js';
import type { NormalizedItem, Poller, PollResult } from './types.js';

/**
 * Any Discourse forum.
 *
 * One poller covers all of them, because Discourse serves the same documented
 * JSON everywhere: /latest.json for the topic list, /t/<id>.json for a thread.
 * A great many AI, self-hosting and developer-tool communities run it, and
 * none of them gate reading behind an approval.
 *
 * The identifier is the forum's base URL, optionally with a category:
 *   https://discuss.huggingface.co
 *   https://discuss.huggingface.co#category=beginners
 *
 * Each forum is its own community with its own rules, which is what the
 * registry already assumes.
 */

interface DiscourseTopic {
  readonly id?: number;
  readonly title?: string;
  readonly slug?: string;
  readonly posts_count?: number;
  readonly reply_count?: number;
  readonly created_at?: string;
  readonly excerpt?: string;
  readonly category_id?: number;
  readonly pinned?: boolean;
  readonly closed?: boolean;
  readonly archived?: boolean;
  readonly has_accepted_answer?: boolean;
  readonly last_poster_username?: string;
  readonly posters?: { readonly user_id?: number; readonly description?: string }[];
}

interface LatestResponse {
  readonly topic_list?: { readonly topics?: DiscourseTopic[] };
  readonly users?: { readonly id?: number; readonly username?: string }[];
}

export function parseForum(identifier: string): { baseUrl: string; category?: string } {
  const [rawUrl, fragment] = identifier.split('#');
  const category = fragment?.startsWith('category=') ? fragment.slice('category='.length) : undefined;
  return {
    baseUrl: (rawUrl ?? '').replace(/\/+$/, ''),
    ...(category ? { category } : {}),
  };
}

/** "discuss.huggingface.co" reads better than the full URL in a queue. */
export function forumName(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

export function normalizeTopic(
  topic: DiscourseTopic,
  baseUrl: string,
  authorByUserId: Map<number, string>,
): NormalizedItem | { skip: string } {
  if (!topic.id) return { skip: 'no topic id' };
  // A pinned topic is an announcement or a rules post, not a question.
  if (topic.pinned) return { skip: 'pinned' };
  if (topic.closed || topic.archived) return { skip: 'closed or archived' };
  if (topic.has_accepted_answer) return { skip: 'already has an accepted answer' };

  const title = cleanText(topic.title ?? '', MAX_TITLE_CHARS);
  if (!title.text) return { skip: 'empty title' };

  // /latest.json carries an excerpt only when the forum generates one, and
  // plenty do not. When it is missing the poller queues the opening post
  // instead of letting the topic be scored on its title.
  const body = cleanText(topic.excerpt ?? '');

  // The topic list gives poster user ids; the response's `users` array maps
  // them to names. The first poster is the person who asked.
  const originalPoster = topic.posters?.[0]?.user_id;
  const author = originalPoster != null ? (authorByUserId.get(originalPoster) ?? null) : null;

  const host = forumName(baseUrl);
  return {
    externalId: String(topic.id),
    url: `${baseUrl}/t/${topic.slug ?? 'topic'}/${topic.id}`,
    community: { platform: 'discourse', name: host, displayName: host },
    author,
    title: title.text,
    body: body.text,
    postedAt: topic.created_at ? Date.parse(topic.created_at) || null : null,
    commentCount: topic.reply_count ?? (topic.posts_count != null ? topic.posts_count - 1 : null),
    platformScore: null,
    truncated: body.truncated || title.truncated,
    raw: topic,
  };
}

/** Same shape the Reddit scraper uses, so the runner queues these too. */
export interface PollResultWithPending extends PollResult {
  readonly pendingBodies: { readonly externalId: string; readonly permalink: string; readonly platform: 'discourse' }[];
}

export class DiscoursePoller implements Poller {
  readonly kind = 'discourse' as const;

  constructor(
    private readonly http: HttpClient,
    private readonly logger: Logger,
  ) {}

  available(): { ready: boolean } {
    return { ready: true };
  }

  async poll(source: Source): Promise<PollResultWithPending> {
    const { baseUrl, category } = parseForum(source.identifier);
    if (!baseUrl) throw new Error(`discourse source has no base url: "${source.identifier}"`);

    const path = category ? `/c/${category}/l/latest.json` : '/latest.json';
    const res = await this.http.json<LatestResponse>(`${baseUrl}${path}`, {
      // Discourse documents these endpoints as its API, so they are not
      // scraping. Still rate-limited per host by the client.
      official: true,
      headers: { accept: 'application/json' },
    });

    const authorByUserId = new Map<number, string>();
    for (const user of res.users ?? []) {
      if (user.id != null && user.username) authorByUserId.set(user.id, user.username);
    }

    const topics = res.topic_list?.topics ?? [];
    const items: NormalizedItem[] = [];
    const skipped: PollResult['skipped'] = [];
    const pendingBodies: PollResultWithPending['pendingBodies'] = [];

    for (const topic of topics) {
      const normalized = normalizeTopic(topic, baseUrl, authorByUserId);
      if ('skip' in normalized) {
        skipped.push({ externalId: String(topic.id ?? '?'), reason: normalized.skip });
        continue;
      }
      items.push(normalized);

      // /latest.json only carries an excerpt when the forum generates one,
      // and many do not. Rather than score a topic on its title alone, queue
      // the opening post the same way scraped Reddit posts are queued.
      if (!normalized.body) {
        pendingBodies.push({
          externalId: normalized.externalId,
          permalink: `${baseUrl}/t/${topic.id}.json`,
          platform: 'discourse',
        });
      }
    }

    this.logger.debug('discourse poll complete', {
      forum: forumName(baseUrl),
      ...(category ? { category } : {}),
      kept: items.length,
      skipped: skipped.length,
    });

    return { items, skipped, pendingBodies };
  }
}
