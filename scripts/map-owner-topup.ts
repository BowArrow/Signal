import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import type { App } from '../src/core/app.js';
import { settings, products } from '../src/core/db/schema.js';
import { RevenueService } from '../src/core/revenue/service.js';
import { OperationsService } from '../src/core/operations/service.js';

export async function mapOwnerTopup(app: App) {
  const product = app.db.select().from(products).where(eq(products.key, 'cinegen')).get();
  if (!product) throw Error('CineGen business is missing');
  app.operations = new OperationsService(app);
  if (app.operations.state(product.id).running) throw Error('Pause CineGen before changing its sales mapping');
  const revenue = new RevenueService(app); app.revenue = revenue;
  const previous = revenue.states().find(s => s.productId === product.id);
  if (!previous?.live) throw Error('Expected the existing live Stripe revenue source');
  const catalog = await revenue.catalog(product.id, previous.accountId);
  const topup = catalog.find(p => p.id === 'cinegen_custom_topup');
  if (topup?.name !== 'CineGen AI token top-up') throw Error('Provision the expected live custom top-up product first');
  const keys = ['revenue.config.', 'revenue.snapshot.', 'revenue.stage.'].map(prefix => prefix + product.id);
  const backup = app.db.select().from(settings).where(inArray(settings.key, keys)).all();
  const folder = join(process.cwd(), 'data', 'stripe-topup-validation'); mkdirSync(folder, { recursive: true });
  const changed = !previous.stripeProductIds.includes(topup.id);
  if (changed) {
    writeFileSync(join(folder, 'owner-before-' + Date.now() + '.json'), JSON.stringify(backup, null, 2), { flag: 'wx' });
    revenue.configure(product.id, { accountId: previous.accountId, live: true, since: previous.since, stripeProductIds: [...previous.stripeProductIds, topup.id] });
  }
  try {
    for (let page = 0; page < 20; page++) {
      await revenue.sync(product.id);
      if (revenue.states().find(s => s.productId === product.id)!.status !== 'partial') break;
    }
    const state = revenue.states().find(s => s.productId === product.id)!;
    if (state.status !== 'current') throw Error('The expanded live revenue scan could not complete');
    const result = { checkedAt: new Date().toISOString(), business: product.name, addedProduct: topup.id, mappingChanged: changed, mappedProductCount: state.stripeProductIds.length, status: state.status, scanned: state.scanned, excluded: state.excluded, totals: revenue.totals(product.id), operationsRunning: app.operations.state(product.id).running };
    writeFileSync(join(folder, 'owner-mapping.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  } catch (error) {
    if (changed && revenue.states().find(s => s.productId === product.id)?.revision === previous.revision + 1) {
      app.db.transaction(() => {
        app.db.delete(settings).where(inArray(settings.key, keys)).run();
        for (const row of backup) app.db.insert(settings).values(row).run();
      });
    }
    throw error;
  } finally { await revenue.stop(); }
}
