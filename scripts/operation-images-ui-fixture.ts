import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { ConnectionService, type CredentialVault } from '../src/core/connections/service.js';
import { OperationsService } from '../src/core/operations/service.js';
import { marketingWorkflows, settings } from '../src/core/db/schema.js';
import { standardImageWorkflow } from '../src/core/marketing/comfy.js';
import { imageDigest } from '../src/core/operations/images.js';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConnectedAccount } from '../src/shared/connections.js';
import type { Delivery } from '../src/shared/operations.js';
import { BRAND_CARD_WORKFLOW } from '../src/shared/brand-card.js';
const branded = process.env['SIGNAL_CARD_FIXTURE'] === '1';

if (process.env['SIGNAL_OFFLINE'] !== '1' || !process.env['SIGNAL_DATABASE_URL']?.includes('operation-images-validation') || !process.env['SIGNAL_PROFILE_DIR']?.includes('operation-images-validation')) throw new Error('Use an isolated offline profile.');
const app = createApp({ logger: silentLogger });
try {
  const source = JSON.parse(readFileSync('data/operation-images-validation/local-lemonade.json', 'utf8')) as { job: Delivery }; const bytes = readFileSync(branded ? 'data/brand-card-validation/lemonade.jpg' : 'data/operation-images-validation/local-lemonade.jpg');
  if (branded) {
    const report = JSON.parse(readFileSync('data/brand-card-validation/report.json', 'utf8')).examples.lemonade;
    source.job.title = report.input.title; source.job.description = report.input.description;
    source.job.image = { workflowId: BRAND_CARD_WORKFLOW, mediaId: 'fixture-card', phase: 'ready', reviewAttempts: 0, detail: 'Local brand card rendered and checked for text fit. Publication is pending.', asset: { sha256: imageDigest(bytes), width: report.width, height: report.height, bytes: bytes.length, mime: 'image/jpeg', alt: `${report.input.brand}. ${report.input.title}. ${report.input.description}. ${report.input.domain}`, reviewedAt: Date.now(), model: 'Local layout check v1' } };
  }
  if (!source.job.image?.asset || source.job.image.asset.sha256 !== imageDigest(bytes)) throw new Error('Run and verify the local image smoke first.');
  const vault: CredentialVault = { available: () => false, get: () => undefined, set: () => { throw new Error('No credentials'); }, delete: () => {} };
  app.connections = new ConnectionService(app, vault); const product = app.connections.view().products[0]!;
  const account: ConnectedAccount = { id: 'fixture-bluesky', productId: product.id, provider: 'bluesky', label: 'Lemonade Bluesky (offline fixture)', site: '', username: '', identity: 'Offline fixture', status: 'verified', detail: 'No credentials', checkedAt: Date.now(), expiresAt: null, refreshable: false, grantedScopes: [], createdAt: Date.now() };
  app.db.insert(settings).values({ key: `connections.account.${account.id}`, value: account }).run();
  app.db.insert(marketingWorkflows).values({ id: 'fixture-workflow', productId: product.id, name: 'Local campaign illustration', workflow: standardImageWorkflow('fixture-model') }).run();
  const operations = new OperationsService(app); operations.configure(product.id, { objective: 'Illustrate one buyer problem using a local model.', accountIds: [account.id], intervalHours: 24, dailyLimit: 1 });
  const image = { ...source.job.image, workflowId: branded ? BRAND_CARD_WORKFLOW : 'fixture-workflow' }; const job: Delivery = { ...source.job, id: 'fixture-image-delivery', productId: product.id, accountId: account.id, revision: operations.state(product.id).revision, status: 'queued', attempts: 0, receipt: null, image, detail: 'Offline preview fixture. No actual publication.', leaseId: '', leaseUntil: 0 };
  app.db.insert(settings).values({ key: `operations.delivery.${job.id}`, value: job }).run();
  const folder = join(process.env['SIGNAL_PROFILE_DIR']!, 'campaign-images'); mkdirSync(folder, { recursive: true }); writeFileSync(join(folder, `${image.asset!.sha256}.jpg`), bytes);
} finally { app.close(); }
