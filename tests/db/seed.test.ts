import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { DbHandle } from '../../src/core/db/client.js';
import { products, sources } from '../../src/core/db/schema.js';
import { seed } from '../../src/core/db/seed.js';
import type { SignalConfig } from '../../src/core/config/schema.js';
import { validateConfig } from '../../src/core/config/load.js';
import rawConfig from '../../signal.config.js';

// Validated once, so the tests work against the same defaults-applied shape
// the application does rather than the looser authoring shape.
const baseConfig = validateConfig(rawConfig);
import { silentLogger } from '../../src/core/lib/logger.js';
import { testDb } from '../helpers/db.js';

function configWith(overrides: Partial<SignalConfig>): SignalConfig {
  return { ...structuredClone(baseConfig), ...overrides } as SignalConfig;
}

describe('seed', () => {
  let handle: DbHandle;
  beforeEach(() => {
    handle = testDb();
  });
  afterEach(() => handle.close());

  it('inserts products and sources from config', () => {
    const result = seed(handle.db, baseConfig, silentLogger);
    expect(result.productsInserted).toBe(baseConfig.products.length);
    expect(result.sourcesInserted).toBe(baseConfig.sources.length);
  });

  it('is idempotent', () => {
    seed(handle.db, baseConfig, silentLogger);
    const second = seed(handle.db, baseConfig, silentLogger);

    expect(second.productsInserted).toBe(0);
    expect(second.productsUpdated).toBe(baseConfig.products.length);
    expect(handle.db.select().from(products).all()).toHaveLength(baseConfig.products.length);
  });

  it('updates a product in place when config changes', () => {
    seed(handle.db, baseConfig, silentLogger);

    const edited = configWith({
      products: baseConfig.products.map((p, i) =>
        i === 0 ? { ...p, utmBase: 'https://changed.example' } : p,
      ),
    });
    seed(handle.db, edited, silentLogger);

    const row = handle.db
      .select()
      .from(products)
      .where(eq(products.key, baseConfig.products[0]!.key))
      .get();
    expect(row?.utmBase).toBe('https://changed.example');
  });

  it('disables a product removed from config rather than deleting it', () => {
    // Deleting would cascade away the drafts and publications that reference
    // it, taking real revenue history with it.
    seed(handle.db, baseConfig, silentLogger);
    const dropped = baseConfig.products[0]!.key;

    const result = seed(
      handle.db,
      configWith({ products: baseConfig.products.slice(1) }),
      silentLogger,
    );

    expect(result.productsRetired).toBe(1);
    const row = handle.db.select().from(products).where(eq(products.key, dropped)).get();
    expect(row).toBeDefined();
    expect(row?.enabled).toBe(false);
  });

  it('disables a source removed from config', () => {
    seed(handle.db, baseConfig, silentLogger);
    const dropped = baseConfig.sources[0]!;

    const result = seed(
      handle.db,
      configWith({ sources: baseConfig.sources.slice(1) }),
      silentLogger,
    );

    expect(result.sourcesRetired).toBe(1);
    const row = handle.db
      .select()
      .from(sources)
      .where(eq(sources.identifier, dropped.identifier))
      .get();
    expect(row?.enabled).toBe(false);
  });

  it('does not retire the same thing twice', () => {
    seed(handle.db, baseConfig, silentLogger);
    const trimmed = configWith({ products: baseConfig.products.slice(1) });

    expect(seed(handle.db, trimmed, silentLogger).productsRetired).toBe(1);
    expect(seed(handle.db, trimmed, silentLogger).productsRetired).toBe(0);
  });

  it('re-enables a product that comes back to config', () => {
    seed(handle.db, baseConfig, silentLogger);
    seed(handle.db, configWith({ products: baseConfig.products.slice(1) }), silentLogger);
    seed(handle.db, baseConfig, silentLogger);

    const row = handle.db
      .select()
      .from(products)
      .where(eq(products.key, baseConfig.products[0]!.key))
      .get();
    expect(row?.enabled).toBe(true);
  });

  it('leaves a discovered source alone — it is not config drift', () => {
    seed(handle.db, baseConfig, silentLogger);
    handle.db
      .insert(sources)
      .values({
        id: 'discovered-1',
        kind: 'reddit',
        identifier: 'somewhere_new',
        displayName: 'r/somewhere_new',
        pollIntervalSeconds: 1800,
        enabled: true,
        discovered: true,
        createdAt: 1_000,
        updatedAt: 1_000,
      })
      .run();

    const result = seed(handle.db, baseConfig, silentLogger);

    expect(result.sourcesRetired).toBe(0);
    expect(handle.db.select().from(sources).where(eq(sources.id, 'discovered-1')).get()?.enabled).toBe(
      true,
    );
  });

  it('does not touch lastPolledAt, which is runtime state', () => {
    seed(handle.db, baseConfig, silentLogger);
    const first = handle.db.select().from(sources).get();
    handle.db.update(sources).set({ lastPolledAt: 12_345 }).where(eq(sources.id, first!.id)).run();

    seed(handle.db, baseConfig, silentLogger);

    expect(handle.db.select().from(sources).where(eq(sources.id, first!.id)).get()?.lastPolledAt).toBe(
      12_345,
    );
  });
});
