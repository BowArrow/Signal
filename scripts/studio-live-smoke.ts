import { mkdirSync, writeFileSync } from 'node:fs';
import { createApp } from '../src/core/app.js';
import { LocalRuntime } from '../src/core/runtime/manager.js';
import { studioAction, studioView, exportCampaign } from '../src/core/studio/store.js';
import { GrowthEngine } from '../src/core/growth/engine.js';
import { silentLogger } from '../src/core/lib/logger.js';

const app = createApp({ databaseUrl: ':memory:', logger: silentLogger }); const runtime = new LocalRuntime(app);
try {
  await runtime.start(); const status = await runtime.status(); console.log(JSON.stringify(status));
  const products = studioView(app).products;
  const product = (process.argv[2] ? products.find(p => p.name.toLowerCase() === process.argv[2]!.toLowerCase()) : products[0]);
  if (!product) throw new Error('Choose a configured product name');
  studioAction(app, { type: 'campaign', productId: product.id, value: { title: 'First customer workflow demonstration', channel: 'content', objective: 'Teach one concrete product workflow and invite a useful customer conversation.', audience: product.brand.audience, offer: product.brand.offer, formats: ['social', 'image-prompt'] } });
  const campaign = studioView(app).campaigns[0]!; studioAction(app, { type: 'generate', productId: product.id, id: campaign.id });
  await new GrowthEngine(app).runNext(['studio']); const state = studioView(app);
  mkdirSync('data/studio-validation', { recursive: true }); writeFileSync(`data/studio-validation/live-campaign-${product.name.toLowerCase()}.md`, exportCampaign(app, product.id, campaign.id));
  console.log(JSON.stringify({ task: state.campaigns[0]!.task, assets: state.assets.map(a => ({ kind: a.kind, title: a.copy.title, length: a.copy.body.length })) }));
  if (state.assets.length !== 2 || state.campaigns[0]!.task?.status !== 'done') process.exitCode = 1;
} finally { runtime.stop(); app.close(); }
