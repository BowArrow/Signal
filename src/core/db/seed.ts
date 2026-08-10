import { eq, and } from 'drizzle-orm';
import type { Db } from './client.js';
import { products, sources } from './schema.js';
import { newId } from '../lib/id.js';
import type { SignalConfig } from '../config/schema.js';
import type { Logger } from '../lib/logger.js';

export interface SeedResult {
  readonly productsInserted: number;
  readonly productsUpdated: number;
  readonly productsRetired: number;
  readonly sourcesInserted: number;
  readonly sourcesUpdated: number;
  readonly sourcesRetired: number;
}

/**
 * Brings the database in line with signal.config.ts. Idempotent: run it as
 * often as you like. Config is the source of truth for products and sources,
 * so an edit there plus a re-seed is the whole workflow for adding a subreddit.
 *
 * Deliberately does not seed communities or their rules. A community is met
 * when something is ingested from it, and its rules are then fetched from the
 * platform's own API — see src/core/rules. Hardcoding a self-promo policy here
 * would be inventing a fact about someone else's community, which is both
 * wrong and the fastest way to get banned from it.
 */
export function seed(db: Db, config: SignalConfig, logger?: Logger): SeedResult {
  const result = {
    productsInserted: 0,
    productsUpdated: 0,
    productsRetired: 0,
    sourcesInserted: 0,
    sourcesUpdated: 0,
    sourcesRetired: 0,
  };

  db.transaction((tx) => {
    for (const p of config.products) {
      const existing = tx.select().from(products).where(eq(products.key, p.key)).get();
      const row = {
        key: p.key,
        name: p.name,
        positioning: p.positioning,
        targetBuyer: p.targetBuyer,
        priceCents: p.priceCents,
        currency: p.currency,
        proofPoints: p.proofPoints,
        links: p.links,
        utmBase: p.utmBase,
        enabled: true,
        updatedAt: Date.now(),
      };

      if (existing) {
        tx.update(products).set(row).where(eq(products.id, existing.id)).run();
        result.productsUpdated += 1;
      } else {
        tx.insert(products).values({ id: newId(), ...row }).run();
        result.productsInserted += 1;
      }
    }

    for (const s of config.sources) {
      const existing = tx
        .select()
        .from(sources)
        .where(and(eq(sources.kind, s.kind), eq(sources.identifier, s.identifier)))
        .get();

      const row = {
        kind: s.kind,
        identifier: s.identifier,
        displayName: s.displayName,
        pollIntervalSeconds: s.pollIntervalSeconds,
        enabled: s.enabled,
        updatedAt: Date.now(),
      };

      if (existing) {
        // lastPolledAt is runtime state, not config. Leave it alone.
        tx.update(sources).set(row).where(eq(sources.id, existing.id)).run();
        result.sourcesUpdated += 1;
      } else {
        tx.insert(sources).values({ id: newId(), ...row }).run();
        result.sourcesInserted += 1;
      }
    }

    // Anything removed from config gets disabled, not deleted.
    //
    // Deleting would cascade away the opportunities, drafts and publications
    // that reference it, taking real history with it. Disabling stops a
    // retired product being offered to the classifier and stops a retired
    // source being polled, while leaving what already happened intact.
    const configuredProducts = new Set(config.products.map((p) => p.key));
    for (const row of tx.select().from(products).all()) {
      if (configuredProducts.has(row.key) || !row.enabled) continue;
      tx.update(products)
        .set({ enabled: false, updatedAt: Date.now() })
        .where(eq(products.id, row.id))
        .run();
      result.productsRetired += 1;
      logger?.warn('product retired — no longer in signal.config.ts', { key: row.key });
    }

    const configuredSources = new Set(config.sources.map((s) => `${s.kind}:${s.identifier}`));
    for (const row of tx.select().from(sources).all()) {
      if (configuredSources.has(`${row.kind}:${row.identifier}`) || !row.enabled) continue;
      // A source Signal proposed itself is not config drift — leave it alone.
      if (row.discovered) continue;
      tx.update(sources)
        .set({ enabled: false, updatedAt: Date.now() })
        .where(eq(sources.id, row.id))
        .run();
      result.sourcesRetired += 1;
      logger?.warn('source retired — no longer in signal.config.ts', {
        source: row.displayName,
      });
    }
  });

  logger?.info('seed complete', { ...result });
  return result;
}
