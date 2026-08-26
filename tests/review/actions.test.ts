import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { DbHandle } from '../../src/core/db/client.js';
import { drafts, links, opportunities, publications } from '../../src/core/db/schema.js';
import {
  approve,
  editDraft,
  finalBody,
  previewApproval,
  reject,
  type ReviewContext,
} from '../../src/core/review/actions.js';
import {
  HackerNewsPublisher,
  ManualPublisher,
  RedditApiPublisher,
  selectPublisher,
} from '../../src/core/publish/publisher.js';
import { fixedClock } from '../../src/core/lib/clock.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { newId } from '../../src/core/lib/id.js';
import {
  insertCommunity,
  insertOpportunity,
  insertProduct,
  insertPublication,
  insertRule,
  insertSource,
  testDb,
} from '../helpers/db.js';

const NOW = Date.parse('2026-08-11T15:00:00.000Z');
const DAY = 86_400_000;

const SUBSTANTIAL =
  'the arithmetic is weights plus kv cache plus whatever else is resident. ' +
  '13b at q4_k_m is about 7.9gb of weights, and a 4k context adds roughly 1.2gb, ' +
  'so you are at 9.1gb before the os and a browser. on a 16gb machine that fits, ' +
  'but only just, and a long context pushes you into swap territory quickly.';

function context(over: Partial<ReviewContext> = {}): ReviewContext {
  return {
    limits: {
      maxRepliesPerPlatformPerDay: 6,
      communityCooldownDays: 7,
      selfPromoRatioMaxPct: 10,
      selfPromoRatioWindow: 30,
    },
    timeZone: 'America/New_York',
    trackingOrigin: 'https://signal-edge-aionx.web.app',
    publishers: [],
    manual: new ManualPublisher(),
    ...over,
  };
}

function scenario(
  handle: DbHandle,
  opts: { body?: string; withProduct?: boolean; verified?: boolean } = {},
) {
  const source = insertSource(handle);
  const community = insertCommunity(handle);
  insertRule(handle, community.id, { verified: opts.verified ?? true });
  const product = insertProduct(handle);
  const opportunity = insertOpportunity(handle, source.id, {
    communityId: community.id,
    status: 'queued',
    matchedProductId: product.id,
  });

  const draftId = newId();
  handle.db
    .insert(drafts)
    .values({
      id: draftId,
      opportunityId: opportunity.id,
      productId: opts.withProduct === false ? null : product.id,
      promptVersion: 'reply.v1',
      generatedBody: opts.body ?? SUBSTANTIAL,
      humanEditedBody: null,
      disclosurePresent: false,
      productMentioned: false,
      validatorResults: [],
      blocked: false,
      status: 'pending',
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();

  return { source, community, product, opportunity, draftId };
}

/**
 * Nine earlier non-promotional replies, well outside the cooldown.
 *
 * Without them a promotional draft is the 1st of 1 posts in the community and
 * the ratio cap refuses it — correctly, since the first thing said somewhere
 * should not be an advert. Earning the right to mention a product is the
 * intended shape of this system, so the tests have to earn it too.
 */
function earnTheRatio(handle: DbHandle, sourceId: string, communityId: string): void {
  for (let i = 0; i < 9; i += 1) {
    insertPublication(handle, {
      sourceId,
      communityId,
      publishedAt: NOW - (30 + i) * DAY,
      promotional: false,
    });
  }
}

describe('selectPublisher', () => {
  it('falls back to manual when the platform publisher is unavailable', () => {
    const manual = new ManualPublisher();
    const { publisher, fellBack } = selectPublisher(
      'reddit',
      [new RedditApiPublisher(false)],
      manual,
    );
    expect(publisher).toBe(manual);
    expect(fellBack).toContain('discretionary approval');
  });

  it('falls back to manual for Hacker News, permanently and by policy', () => {
    const manual = new ManualPublisher();
    const { publisher, fellBack } = selectPublisher('hn', [new HackerNewsPublisher()], manual);
    expect(publisher).toBe(manual);
    expect(fellBack).toContain('draft-only');
  });

  it('uses manual with no registered publisher at all', () => {
    const manual = new ManualPublisher();
    expect(selectPublisher('lobsters', [], manual).publisher).toBe(manual);
  });
});

describe('previewApproval', () => {
  let handle: DbHandle;
  beforeEach(() => {
    handle = testDb();
  });
  afterEach(() => handle.close());

  it('allows a clean non-promotional draft', () => {
    const { draftId } = scenario(handle);
    const result = previewApproval(handle.db, draftId, context(), fixedClock(NOW));
    expect(result.ok).toBe(true);
    expect(result.promotional).toBe(false);
  });

  it('refuses a draft naming a product with no disclosure', () => {
    const { draftId } = scenario(handle, { body: `${SUBSTANTIAL} try Lemonade.` });
    const result = previewApproval(handle.db, draftId, context(), fixedClock(NOW));
    expect(result.ok).toBe(false);
    expect(result.blockedBy).toContain('disclosure');
  });

  it('re-validates the edited text, not the generated text', () => {
    // The whole point of editing is that what I send is not what was written.
    const { draftId } = scenario(handle);
    editDraft(handle.db, draftId, `${SUBSTANTIAL} this will supercharge your setup`);

    const result = previewApproval(handle.db, draftId, context(), fixedClock(NOW));
    expect(result.ok).toBe(false);
    expect(result.blockedBy).toContain('Marketing language');
  });

  it('refuses when the daily cap is spent', () => {
    const { draftId, source, community } = scenario(handle);
    for (let i = 0; i < 6; i += 1) {
      insertPublication(handle, {
        sourceId: source.id,
        communityId: community.id,
        publishedAt: NOW - (i + 1) * 60_000,
        promotional: false,
      });
    }
    const result = previewApproval(handle.db, draftId, context(), fixedClock(NOW));
    expect(result.ok).toBe(false);
    expect(result.blockedBy).toContain('daily cap');
  });

  it('checks limits as of now, not as of when the draft was written', () => {
    // A draft sitting in the queue for three days must obey today's cooldown.
    const { draftId, source, community } = scenario(handle);
    insertPublication(handle, {
      sourceId: source.id,
      communityId: community.id,
      publishedAt: NOW - DAY,
      promotional: false,
    });
    const result = previewApproval(handle.db, draftId, context(), fixedClock(NOW));
    expect(result.ok).toBe(false);
    expect(result.blockedBy).toContain('cooldown');
  });

  it('surfaces warnings without blocking', () => {
    const { draftId } = scenario(handle, { verified: false });
    const result = previewApproval(handle.db, draftId, context(), fixedClock(NOW));
    expect(result.ok).toBe(true);
    expect(result.warnings?.some((w) => w.includes('never confirmed'))).toBe(true);
  });

  it('reports a missing draft rather than throwing', () => {
    expect(previewApproval(handle.db, 'nope', context(), fixedClock(NOW)).ok).toBe(false);
  });
});

describe('approve', () => {
  let handle: DbHandle;
  beforeEach(() => {
    handle = testDb();
  });
  afterEach(() => handle.close());

  it('publishes, records, and marks everything published', async () => {
    const { draftId, opportunity } = scenario(handle);

    const result = await approve(handle.db, draftId, context(), silentLogger, fixedClock(NOW));

    expect(result.ok).toBe(true);
    expect(result.method).toBe('manual');

    const publication = handle.db.select().from(publications).get();
    expect(publication?.draftId).toBe(draftId);
    expect(publication?.publishedAt).toBe(NOW);
    expect(publication?.promotional).toBe(false);

    expect(handle.db.select().from(drafts).get()?.status).toBe('published');
    expect(
      handle.db.select().from(opportunities).where(eq(opportunities.id, opportunity.id)).get()
        ?.status,
    ).toBe('published');
  });

  it('writes nothing when a limit refuses', async () => {
    const { draftId, source, community } = scenario(handle);
    insertPublication(handle, {
      sourceId: source.id,
      communityId: community.id,
      publishedAt: NOW - DAY,
      promotional: false,
    });

    const result = await approve(handle.db, draftId, context(), silentLogger, fixedClock(NOW));

    expect(result.ok).toBe(false);
    // A refusal must not leave a half-finished publication behind. The setup
    // row is what caused the refusal, so scope this to the draft under test.
    expect(
      handle.db.select().from(publications).where(eq(publications.draftId, draftId)).all(),
    ).toHaveLength(0);
    expect(handle.db.select().from(drafts).get()?.status).toBe('pending');
  });

  it('copies to the clipboard on a manual publish', async () => {
    const { draftId } = scenario(handle);
    const copied = vi.fn();

    const result = await approve(
      handle.db,
      draftId,
      context({ manual: new ManualPublisher(copied) }),
      silentLogger,
      fixedClock(NOW),
    );

    expect(result.ok).toBe(true);
    expect(copied).toHaveBeenCalledOnce();
    expect(copied.mock.calls[0]?.[0]).toContain('kv cache');
  });

  it('substitutes a tracked link when the draft carried the product url', async () => {
    const { draftId, source, community } = scenario(handle, {
      body: `${SUBSTANTIAL}\n\ni build Lemonade, at https://example.test/lemonade. disclosure: my product.`,
    });
    earnTheRatio(handle, source.id, community.id);

    const result = await approve(handle.db, draftId, context(), silentLogger, fixedClock(NOW));

    expect(result.ok).toBe(true);
    expect(result.trackedUrl).toMatch(/signal-edge-aionx\.web\.app\/r\//);
    expect(result.body).toContain(result.trackedUrl as string);
    expect(result.body).not.toContain('example.test/lemonade');

    const link = handle.db.select().from(links).get();
    expect(link?.publicationId).toBe(result.publicationId);
    expect(
      handle.db
        .select()
        .from(publications)
        .where(eq(publications.id, result.publicationId as string))
        .get()?.linkId,
    ).toBe(link?.id);
  });

  it('records the reply as promotional when the text names a product', async () => {
    const { draftId, source, community } = scenario(handle, {
      body: `${SUBSTANTIAL}\n\ni build Lemonade. disclosure: my product.`,
    });
    earnTheRatio(handle, source.id, community.id);

    const result = await approve(handle.db, draftId, context(), silentLogger, fixedClock(NOW));

    expect(
      handle.db
        .select()
        .from(publications)
        .where(eq(publications.id, result.publicationId as string))
        .get()?.promotional,
    ).toBe(true);
  });

  it('refuses a promotional first post, because that is what the ratio is for', async () => {
    // No history: this would be 1 of 1 posts in the community, and the first
    // thing said somewhere should not be an advert.
    const { draftId } = scenario(handle, {
      body: `${SUBSTANTIAL}\n\ni build Lemonade. disclosure: my product.`,
    });

    const result = await approve(handle.db, draftId, context(), silentLogger, fixedClock(NOW));

    expect(result.ok).toBe(false);
    expect(result.blockedBy).toContain('self-promo ratio');
  });

  it('leaves no orphan link when the draft mentioned no url', async () => {
    const { draftId, source, community } = scenario(handle, {
      body: `${SUBSTANTIAL}\n\ni build Lemonade. disclosure: my product.`,
    });
    earnTheRatio(handle, source.id, community.id);

    const result = await approve(handle.db, draftId, context(), silentLogger, fixedClock(NOW));

    expect(result.ok).toBe(true);
    expect(result.trackedUrl).toBeNull();
    // A link record with nothing pointing at it would inflate the link table
    // and imply attribution that can never happen.
    expect(handle.db.select().from(links).all()).toHaveLength(0);
  });

  it('publishes the edited body, not the generated one', async () => {
    const { draftId } = scenario(handle);
    const edited = `${SUBSTANTIAL}\n\none more thing i measured myself.`;
    editDraft(handle.db, draftId, edited);

    const result = await approve(handle.db, draftId, context(), silentLogger, fixedClock(NOW));

    expect(result.body).toBe(edited);
    expect(handle.db.select().from(publications).get()?.postedBody).toBe(edited);
    // The generated body survives for the learning loop.
    expect(handle.db.select().from(drafts).get()?.generatedBody).toBe(SUBSTANTIAL);
  });

  it('explains itself when it falls back from an unavailable API', async () => {
    const { draftId } = scenario(handle);

    const result = await approve(
      handle.db,
      draftId,
      context({ publishers: [new RedditApiPublisher(false)] }),
      silentLogger,
      fixedClock(NOW),
    );

    expect(result.ok).toBe(true);
    expect(result.method).toBe('manual');
    expect(result.note).toContain('discretionary approval');
  });
});

describe('editDraft', () => {
  let handle: DbHandle;
  beforeEach(() => {
    handle = testDb();
  });
  afterEach(() => handle.close());

  it('never overwrites the generated body', () => {
    const { draftId } = scenario(handle);
    editDraft(handle.db, draftId, 'something else entirely');

    const draft = handle.db.select().from(drafts).get();
    expect(draft?.generatedBody).toBe(SUBSTANTIAL);
    expect(draft?.humanEditedBody).toBe('something else entirely');
    expect(finalBody(draft!)).toBe('something else entirely');
  });

  it('clears the edit when the text is put back as it was', () => {
    const { draftId } = scenario(handle);
    editDraft(handle.db, draftId, 'changed');
    editDraft(handle.db, draftId, SUBSTANTIAL);
    expect(handle.db.select().from(drafts).get()?.humanEditedBody).toBeNull();
  });
});

describe('reject', () => {
  let handle: DbHandle;
  beforeEach(() => {
    handle = testDb();
  });
  afterEach(() => handle.close());

  it('records the reason on the draft and closes the opportunity', () => {
    const { draftId, opportunity } = scenario(handle);

    expect(reject(handle.db, draftId, 'Marketing register', 'too salesy', fixedClock(NOW))).toBe(
      true,
    );

    const draft = handle.db.select().from(drafts).get();
    expect(draft?.status).toBe('rejected');
    expect(draft?.rejectionReason).toBe('Marketing register');
    expect(draft?.rejectionNote).toBe('too salesy');

    // Terminal for the opportunity too, so a poller re-seeing the thread
    // tomorrow does not put it back in the queue.
    expect(
      handle.db.select().from(opportunities).where(eq(opportunities.id, opportunity.id)).get()
        ?.status,
    ).toBe('rejected');
  });

  it('returns false for a draft that does not exist', () => {
    expect(reject(handle.db, 'nope', 'Wrong community', undefined, fixedClock(NOW))).toBe(false);
  });
});
