/* global fetch, AbortSignal */
// Read-only owner audit. Does not decrypt credentials, start models, or send messages.
// Requires Node 22 with node:sqlite; output contains aggregates, not contact records.
import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const db = new DatabaseSync(join(process.env.APPDATA, 'signal', 'signal.db'), { readOnly: true });
const checkedAt = new Date().toISOString();
const iso = value => typeof value === 'number' && value > 0 ? new Date(value).toISOString() : null;
const counts = (rows, key) => rows.reduce((result, row) => {
  const value = row[key] ?? 'unspecified'; result[value] = (result[value] ?? 0) + 1; return result;
}, {});
let report;
try {
  const settings = db.prepare('SELECT key,value FROM settings').all().map(row => ({ key: row.key, value: JSON.parse(row.value) }));
  const get = key => settings.find(row => row.key === key)?.value;
  const accounts = settings.filter(row => row.key.startsWith('connections.account.')).map(row => row.value);
  const products = db.prepare('SELECT id,key,name FROM products').all();
  const runtime = get('runtime.provider.v1') ?? {};
  const video = get('video.config') ?? {};
  report = {
    checkedAt, evidence: 'Installed owner database snapshot; saved connection status is not a fresh provider check.',
    runtime: { provider: runtime.provider, device: runtime.localDevice, autoStart: runtime.autoStart, dailyCallLimit: runtime.dailyCallLimit },
    video: { renderer: video.renderer, agentCloudEnabled: video.agentCloudEnabled, h3DailyBudgetUsd: video.h3DailyBudgetUsd },
    businesses: products.map(product => {
      const operation = get('operations.policy.' + product.id) ?? {};
      const analytics = get('analytics.config.' + product.id) ?? {};
      const snapshot = get('analytics.snapshot.' + product.id) ?? {};
      const revenue = get('revenue.config.' + product.id) ?? {};
      const payments = get('revenue.snapshot.' + product.id) ?? [];
      const leads = db.prepare('SELECT value FROM studio_leads WHERE product_id=?').all(product.id).map(row => JSON.parse(row.value));
      const assets = db.prepare('SELECT status FROM studio_assets WHERE product_id=?').all(product.id);
      const rows = snapshot.rows ?? [];
      const prospects = get('prospects.website.' + product.id) ?? {};
      return {
        key: product.key, name: product.name, running: operation.running, dailyPublishLimit: operation.dailyLimit,
        destinations: (operation.accountIds ?? []).map(id => accounts.find(account => account.id === id)?.provider ?? 'unknown'),
        connections: accounts.filter(account => account.productId === product.id).map(account => ({ provider: account.provider, savedStatus: account.status })),
        leads: { total: leads.length, byStage: counts(leads, 'stage'), byPermission: counts(leads, 'permission'), overdueReminders: leads.filter(lead => lead.followUpAt && lead.followUpAt < Date.now()).length },
        assets: counts(assets, 'status'),
        campaigns: db.prepare('SELECT count(*) AS n FROM studio_campaigns WHERE product_id=?').get(product.id).n,
        recordedOutcomes: db.prepare('SELECT count(*) AS n FROM studio_outcomes WHERE product_id=?').get(product.id).n,
        deliveries: counts(settings.filter(row => row.key.startsWith('operations.delivery.') && row.value.productId === product.id).map(row => row.value), 'status'),
        analytics: { propertyId: analytics.propertyId, savedStatus: analytics.status, lastCompleteAt: iso(analytics.lastCompleteAt), startDate: snapshot.startDate, endDate: snapshot.endDate, sessions: rows.reduce((n, row) => n + row.sessions, 0), matchedCampaignRows: rows.filter(row => row.attribution === 'matched').length, limitations: snapshot.limitations },
        revenue: { savedStatus: revenue.status, lastCompleteAt: iso(revenue.lastCompleteAt), since: iso(revenue.since), live: revenue.live, storedPayments: payments.length, attributedPayments: payments.filter(payment => payment.attribution === 'matched').length },
        intake: { enabled: prospects.enabled, status: prospects.status, lastCompleteAt: iso(prospects.lastCompleteAt), added: prospects.added },
      };
    }),
  };
} finally { db.close(); }

report.runtimeHealth = await Promise.all(['http://127.0.0.1:11434/api/tags', 'http://127.0.0.1:8188/system_stats'].map(async url => {
  try { const response = await fetch(url, { signal: AbortSignal.timeout(2500) }); return { url, ok: response.ok, status: response.status }; }
  catch { return { url, ok: false, detail: 'Endpoint unavailable at audit time; no startup attempted.' }; }
}));
report.websites = await Promise.all(['https://siplemona.de/', 'https://siplemona.de/ads/lemonade-ltd/', 'https://cinegenaimedia.com/'].map(async url => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) }); const html = await response.text();
    return { url, status: response.status, scripts: [...html.matchAll(/<script[^>]*src=["']([^"']+)/g)].map(match => match[1]), analyticsMarkerInHtml: /gtag\(|googletagmanager|G-[A-Z0-9]{6,}/.test(html), limitation: 'HTML inspection does not prove whether runtime analytics events arrive.' };
  } catch { return { url, error: 'Read failed' }; }
}));
report.affiliatePrograms = await Promise.all(['https://siplemona.de', 'https://cinegenaimedia.com'].map(async origin => {
  try {
    const response = await fetch(origin + '/api/affiliates/program', { signal: AbortSignal.timeout(20000) });
    if (!response.ok) return { origin, status: response.status };
    const value = await response.json();
    return { origin, status: response.status, enabled: value.enabled, connectEnabled: value.connectEnabled, payoutsEnabled: value.payoutsEnabled, rateBps: value.rateBps, holdDays: value.holdDays, limitation: 'Public program flags do not prove Stripe onboarding or payout capability.' };
  } catch { return { origin, error: 'Read failed' }; }
}));
const folder = resolve('output/marketing-audit'); mkdirSync(folder, { recursive: true });
const path = join(folder, checkedAt.slice(0, 10) + '.json');
writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
