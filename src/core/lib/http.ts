import { setTimeout as sleep } from 'node:timers/promises';
import type { Logger } from './logger.js';

export type FetchFn = typeof fetch;

export interface HttpOptions {
  readonly userAgent: string;
  /** Minimum gap between two requests to the same host. */
  readonly minRequestIntervalMs: number;
  readonly requestTimeoutMs: number;
  readonly maxRetries: number;
  readonly respectRobotsTxt: boolean;
}

export class HttpError extends Error {
  constructor(
    override readonly message: string,
    readonly status: number,
    readonly url: string,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class RobotsDisallowedError extends Error {
  constructor(readonly url: string) {
    super(`robots.txt disallows fetching ${url}`);
    this.name = 'RobotsDisallowedError';
  }
}

export class OfflineError extends Error {
  constructor(readonly url: string) {
    super(`SIGNAL_OFFLINE=1 blocked a request to ${url}`);
    this.name = 'OfflineError';
  }
}

/**
 * A deliberately small robots.txt reader: User-agent groups, Allow, Disallow,
 * longest-match-wins. It does not implement Crawl-delay (we enforce our own
 * interval, which is stricter) or sitemap directives.
 *
 * Fail-closed on a parse error and fail-open on a network error, which is the
 * conventional reading: an unreachable robots.txt means "no rules published",
 * a malformed one means "I do not understand your rules, so I will not fetch".
 */
export function isAllowedByRobots(robotsTxt: string, userAgent: string, path: string): boolean {
  const lines = robotsTxt.split(/\r?\n/);
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let current: { agents: string[]; rules: { allow: boolean; path: string }[] } | null = null;
  let lastLineWasAgent = false;

  for (const rawLine of lines) {
    const line = rawLine.split('#')[0]?.trim() ?? '';
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'user-agent') {
      if (!current || !lastLineWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastLineWasAgent = true;
      continue;
    }

    if (field === 'allow' || field === 'disallow') {
      lastLineWasAgent = false;
      if (!current) continue;
      current.rules.push({ allow: field === 'allow', path: value });
    }
  }

  const ua = userAgent.toLowerCase();
  // A group naming us specifically wins over the wildcard group.
  const specific = groups.find((g) => g.agents.some((a) => a !== '*' && ua.includes(a)));
  const wildcard = groups.find((g) => g.agents.includes('*'));
  const group = specific ?? wildcard;
  if (!group) return true;

  let verdict = true;
  let bestLength = -1;
  for (const rule of group.rules) {
    // An empty Disallow means "allow everything" and matches nothing.
    if (rule.path === '') continue;
    if (!path.startsWith(rule.path)) continue;
    if (rule.path.length > bestLength) {
      bestLength = rule.path.length;
      verdict = rule.allow;
    }
  }
  return verdict;
}

/**
 * One client per process. Serializes requests per host at the configured
 * interval, retries on 429 and 5xx with backoff, and honors Retry-After.
 *
 * `official` marks a documented API endpoint. Those skip the robots.txt check —
 * robots.txt governs crawlers, and an API you authenticated against has its
 * own terms — but they still get the same rate limiting.
 */
export class HttpClient {
  private readonly nextAllowedAt = new Map<string, number>();
  private readonly robotsCache = new Map<string, { allowedFor: (path: string) => boolean; fetchedAt: number }>();
  private readonly chain = new Map<string, Promise<unknown>>();

  constructor(
    private readonly options: HttpOptions,
    private readonly logger: Logger,
    private readonly fetchFn: FetchFn = fetch,
    private readonly offline = false,
  ) {}

  async request(
    url: string,
    init: RequestInit & { official?: boolean } = {},
  ): Promise<Response> {
    if (this.offline) throw new OfflineError(url);

    const { official = false, ...requestInit } = init;
    const target = new URL(url);

    if (this.options.respectRobotsTxt && !official) {
      const allowed = await this.checkRobots(target);
      if (!allowed) throw new RobotsDisallowedError(url);
    }

    return this.serialize(target.host, () => this.attempt(url, requestInit));
  }

  async json<T>(url: string, init: RequestInit & { official?: boolean } = {}): Promise<T> {
    const res = await this.request(url, init);
    return (await res.json()) as T;
  }

  async text(url: string, init: RequestInit & { official?: boolean } = {}): Promise<string> {
    const res = await this.request(url, init);
    return res.text();
  }

  /** Runs `fn` after the per-host interval has elapsed, one host at a time. */
  private serialize<T>(host: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.chain.get(host) ?? Promise.resolve();
    const next = previous.then(async () => {
      const waitUntil = this.nextAllowedAt.get(host) ?? 0;
      const delay = waitUntil - Date.now();
      if (delay > 0) await sleep(delay);
      try {
        return await fn();
      } finally {
        this.nextAllowedAt.set(host, Date.now() + this.options.minRequestIntervalMs);
      }
    });
    // Keep the chain alive after a rejection so one failure does not poison
    // every later request to that host.
    this.chain.set(host, next.catch(() => undefined));
    return next;
  }

  private async attempt(url: string, init: RequestInit): Promise<Response> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
      if (attempt > 0) {
        const backoff = Math.min(30_000, 500 * 2 ** (attempt - 1));
        this.logger.debug('retrying request', { url, attempt, backoff });
        await sleep(backoff);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.options.requestTimeoutMs);
      try {
        const headers = new Headers(init.headers);
        headers.set('user-agent', this.options.userAgent);
        if (!headers.has('accept')) headers.set('accept', 'application/json, text/plain, */*');

        const res = await this.fetchFn(url, { ...init, headers, signal: controller.signal });

        if (res.status === 429 || res.status >= 500) {
          const retryAfter = Number(res.headers.get('retry-after'));
          if (Number.isFinite(retryAfter) && retryAfter > 0) {
            this.logger.warn('rate limited, honoring retry-after', { url, retryAfter });
            await sleep(Math.min(retryAfter * 1000, 60_000));
          }
          lastError = new HttpError(`${res.status} ${res.statusText}`, res.status, url);
          continue;
        }

        if (!res.ok) {
          // 4xx other than 429 will not fix themselves. Fail immediately.
          throw new HttpError(`${res.status} ${res.statusText}`, res.status, url, await safeText(res));
        }

        return res;
      } catch (err) {
        if (err instanceof HttpError && err.status < 500 && err.status !== 429) throw err;
        lastError = err;
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`request to ${url} failed after ${this.options.maxRetries + 1} attempts`);
  }

  private async checkRobots(target: URL): Promise<boolean> {
    const origin = target.origin;
    const cached = this.robotsCache.get(origin);
    const ONE_DAY = 86_400_000;
    if (cached && Date.now() - cached.fetchedAt < ONE_DAY) {
      return cached.allowedFor(target.pathname + target.search);
    }

    let allowedFor: (path: string) => boolean;
    try {
      const res = await this.fetchFn(`${origin}/robots.txt`, {
        headers: { 'user-agent': this.options.userAgent },
      });
      if (res.status === 404 || res.status === 410) {
        allowedFor = () => true;
      } else if (!res.ok) {
        // Can't read the rules; treat as no rules published.
        allowedFor = () => true;
      } else {
        const body = await res.text();
        allowedFor = (path) => isAllowedByRobots(body, this.options.userAgent, path);
      }
    } catch (err) {
      this.logger.warn('robots.txt unreachable, proceeding', { origin, err: String(err) });
      allowedFor = () => true;
    }

    this.robotsCache.set(origin, { allowedFor, fetchedAt: Date.now() });
    return allowedFor(target.pathname + target.search);
  }
}

async function safeText(res: Response): Promise<string | undefined> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return undefined;
  }
}
