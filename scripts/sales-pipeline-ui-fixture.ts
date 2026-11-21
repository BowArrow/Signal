import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { ConnectionService } from '../src/core/connections/service.js';
import { SalesPipeline } from '../src/core/sales/pipeline.js';
import { savePipelineLead } from '../src/core/sales/pipeline-store.js';
if (process.env.SIGNAL_OFFLINE !== '1' || !process.env.SIGNAL_DATABASE_URL?.includes('sales-validation')) throw new Error('Use an isolated offline sales-validation profile.');
const app = createApp({ logger: silentLogger });
try {
  app.connections = new ConnectionService(app, { available: () => false, get: () => undefined, set: () => {}, delete: () => {} });
  const productId = app.connections.view().products.find(p => p.name === 'Lemonade')!.id;
  const pipeline = new SalesPipeline(app); let lead = pipeline.ingest(productId, { name: 'Research studio · synthetic fixture', email: 'research@example.org', sourceUrl: 'https://example.org/request', sourceSignal: 'We need a local AI tool to compare client research documents and prepare a draft summary.' });
  lead = savePipelineLead(app, lead, { stage: 'ENRICHED' }, 'Synthetic source verified for UI validation.');
  lead = savePipelineLead(app, lead, { stage: 'QUALIFIED', qualification: { qualified: true, icp_score: 87, angle_tag: 'local_workflow_speed', specific_pain_point: 'Comparing source documents', recommended_cta: 'send_guide_link', reasoning: 'An explicit source-document task matches the supported workflow.' } }, 'Synthetic qualification fixture.');
  const body = 'You mentioned needing to compare client research documents. We build Lemonade, which can compare source documents and prepare an editable draft. Would a short setup guide help?';
  savePipelineLead(app, lead, { stage: 'DRAFT_READY', requested: false, draft: { subject: 'Comparing research documents', body, originalBody: body, product_quote: 'Lemonade compares source documents and prepares editable drafts.', productUrl: 'https://siplemona.de', observedAt: Date.now(), criticPassed: true, critic: { passed: true, word_count: body.split(/\s+/).length, contains_ai_cliches: false, references_source_signal: true, has_low_friction_cta: true, violations: [], rewrite_instruction: null } } }, 'Draft and critique passed in this synthetic UI fixture. No email has been sent.');
} finally { app.close(); }
