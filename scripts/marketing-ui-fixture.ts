import { resolve, sep } from 'node:path';
import { createApp } from '../src/core/app.js';
import { initializeMarketing, marketingView } from '../src/core/marketing/store.js';
import { executeMarketingTool } from '../src/core/marketing/agent.js';
const file = process.argv[2];
if (!file || !resolve(file).startsWith(resolve('data/growth-validation') + sep)) throw new Error('Fixture must stay inside growth-validation');
const app = createApp({ databaseUrl: file });
try {
  initializeMarketing(app); const p = marketingView(app).products[0]!;
  await executeMarketingTool(app, p.id, 'draft.save', { title:'Synthetic reply fixture', body:'A useful test response, created only in an isolated UI fixture database.', kind:'reply', targetUrl:'', evidence:['UI fixture'] },new AbortController().signal);
} finally { app.close(); }
