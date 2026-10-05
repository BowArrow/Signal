import { and, eq, or } from 'drizzle-orm';
import type { App } from '../app.js';
import { engineeringRequests, marketingCash, marketingCommitments, marketingDrafts, marketingEdges, marketingMemory, marketingWorkflows } from '../db/schema.js';
import { marketingActionSchema } from '../../shared/marketing.js';
import { newId } from '../lib/id.js';
import { budget, initializeMarketing, marketingView, queueMarketing, remember, requireProduct, saveMarketingSettings } from './store.js';
import { parseWorkflow, submitMedia } from './comfy.js';

export async function marketingAction(app: App, input: unknown) {
  initializeMarketing(app);
  const action = marketingActionSchema.parse(input);
  if (action.type === 'settings') { saveMarketingSettings(app, action.value); return marketingView(app); }
  requireProduct(app, action.productId);
  if (action.type === 'chat' || action.type === 'cycle') {
    queueMarketing(app, action.productId, action.type === 'chat' ? action.message : 'Run a practical zero-cash marketing cycle. Review current product facts and memory, create one useful draft or engineering request, and explain what changed.');
  } else if (action.type === 'memory') remember(app, action.productId, action.value);
  else if (action.type === 'forget') {
    app.db.transaction((tx) => {
      const node = tx.select().from(marketingMemory).where(and(eq(marketingMemory.id, action.id), eq(marketingMemory.productId, action.productId))).get();
      if (!node) throw new Error('Memory not found');
      tx.delete(marketingEdges).where(or(eq(marketingEdges.fromId, node.id), eq(marketingEdges.toId, node.id))).run();
      tx.update(marketingMemory).set({ status: 'forgotten', title: 'Forgotten memory', body: '', source: '', confidence: 0 }).where(eq(marketingMemory.id, node.id)).run();
    });
  } else if (action.type === 'requestStatus') {
    const row = app.db.select().from(engineeringRequests).where(and(eq(engineeringRequests.id, action.id), eq(engineeringRequests.productId, action.productId))).get();
    if (!row) throw new Error('Engineering request not found');
    app.db.update(engineeringRequests).set({ status: action.status }).where(eq(engineeringRequests.id, row.id)).run();
    if (action.status === 'shipped') remember(app, action.productId, { title: row.value.title, body: `Owner marked this engineering request shipped: ${row.value.acceptance.join('; ')}. Verify in the product before using it in a public claim.`, kind: 'observation', source: `engineering:${row.id}`, confidence: 0.8 });
  } else if (action.type === 'draftEdit') {
    const row = app.db.select().from(marketingDrafts).where(and(eq(marketingDrafts.id, action.id), eq(marketingDrafts.productId, action.productId))).get();
    if (!row || !['draft', 'approved'].includes(row.status)) throw new Error('Only an unpublished draft can be edited');
    app.db.update(marketingDrafts).set({ value: { ...row.value, body: action.body }, status: 'draft', publishedUrl: null }).where(eq(marketingDrafts.id, row.id)).run();
  } else if (action.type === 'draftStatus') {
    const row = app.db.select().from(marketingDrafts).where(and(eq(marketingDrafts.id, action.id), eq(marketingDrafts.productId, action.productId))).get();
    if (!row) throw new Error('Draft not found');
    if (action.status === 'published' && (!action.publishedUrl || row.status !== 'approved')) throw new Error('Approve the draft and provide its actual published URL first');
    app.db.update(marketingDrafts).set({ status: action.status, publishedUrl: action.publishedUrl ?? null }).where(eq(marketingDrafts.id, row.id)).run();
  } else if (action.type === 'cash') {
    app.db.transaction((tx) => {
      const existing = tx.select().from(marketingCash).where(and(eq(marketingCash.productId, action.productId), eq(marketingCash.reference, action.value.reference))).get();
      if (existing) throw new Error('This cash reference is already recorded; use a new reference for a correction');
      tx.insert(marketingCash).values({ id: newId(), productId: action.productId, ...action.value, createdAt: app.clock.now() }).run();
      if (action.value.kind === 'spend') tx.update(marketingCommitments).set({ status: 'settled' }).where(and(eq(marketingCommitments.productId, action.productId), eq(marketingCommitments.reference, action.value.reference))).run();
    });
  } else if (action.type === 'reserve') {
    app.db.transaction((tx) => {
      const funds = budget(app, action.productId);
      if (['bootstrap', 'organic'].includes(funds.tier) || action.amountCents > funds.availableCents) throw new Error('This commitment is not funded by the current cash tier');
      if (action.amountCents <= 0) throw new Error('Reserve a positive amount');
      tx.insert(marketingCommitments).values({ id: newId(), productId: action.productId, amountCents: action.amountCents, reference: action.reference, note: action.note }).run();
    });
  } else if (action.type === 'release') {
    app.db.update(marketingCommitments).set({ status: 'released' }).where(and(eq(marketingCommitments.id, action.id), eq(marketingCommitments.productId, action.productId), eq(marketingCommitments.status, 'reserved'))).run();
  } else if (action.type === 'workflow') {
    const workflow = parseWorkflow(action.workflow);
    app.db.insert(marketingWorkflows).values({ id: newId(), productId: action.productId, name: action.name, workflow }).run();
  } else if (action.type === 'media') await submitMedia(app, action.productId, action.workflowId, action.prompt);
  return marketingView(app);
}
