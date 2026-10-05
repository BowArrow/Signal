import type { App } from '../app.js';
import type { Delivery, OperationState, OperationTraffic } from '../../shared/operations.js';
import type { AnalyticsRow } from '../../shared/analytics.js';
import { analyticsDates, analyticsLocalDate } from '../analytics/ga4.js';
import { requireProduct } from '../marketing/store.js';

const DAY = 86400000;
/** Positive observations can suggest a follow-up experiment; missing rows never prove failure. */
export function chooseTrafficExperiment(app: App, state: OperationState, deliveries: Delivery[]): { traffic: OperationTraffic; candidate?: OperationTraffic['accounts'][number] } {
  const now = app.clock.now();
  const unavailable = (detail: string) => ({ traffic: { status: 'unavailable' as const, detail, observedAt: null, accounts: [] } });
  const config = app.analytics?.states().find(s => s.productId === state.productId);
  const snapshot = app.analytics?.snapshot(state.productId);
  if (!config || !snapshot) return unavailable('Connect and sync GA4 to use visitor interest while collecting purchase evidence.');
  const account = app.connections?.accounts().find(a => a.id === config.accountId && a.productId === state.productId && a.provider === 'ga4' && a.status === 'verified' && (!a.expiresAt || a.expiresAt > now || a.refreshable));
  const hostname = new URL(requireProduct(app, state.productId).utmBase).hostname;
  if (!account || config.status !== 'current' || config.lastCompleteAt !== snapshot.observedAt || snapshot.productId !== state.productId || snapshot.accountId !== config.accountId || snapshot.propertyId !== config.propertyId || config.hostname !== hostname || snapshot.hostname !== hostname || !Number.isFinite(snapshot.observedAt) || snapshot.observedAt > now || now - snapshot.observedAt > 36 * 3600000 || snapshot.limitations.length) return unavailable('Visitor-interest selection needs a current, complete, unrestricted report for this business and its verified GA4 connection. Missing or limited tracking is not a failed campaign.');
  try {
    const dates = analyticsDates(snapshot.observedAt, snapshot.timeZone);
    if (dates.startDate !== snapshot.startDate || dates.endDate !== snapshot.endDate) return unavailable('The analytics report dates do not match its recorded property time zone and observation time. Sync again.');
  } catch { return unavailable('The analytics report time zone is invalid. Sync again.'); }
  const rows = new Map<string, AnalyticsRow>();
  for (const row of snapshot.rows) {
    if (row.attribution !== 'matched' || !row.campaignId) continue;
    if (rows.has(row.campaignId) || !Number.isSafeInteger(row.sessions) || !Number.isSafeInteger(row.engagedSessions) || row.sessions > Number.MAX_SAFE_INTEGER / 10000 || row.sessions < 0 || row.engagedSessions < 0 || row.engagedSessions > row.sessions) return unavailable('Campaign session observations are inconsistent. Sync again before selecting a visitor-interest experiment.');
    rows.set(row.campaignId, row);
  }
  const history = deliveries.filter(d => d.productId === state.productId && state.accountIds.includes(d.accountId));
  const eligible = history.filter(d => {
    if (d.status !== 'published' || !d.receipt || !Number.isFinite(d.receipt.confirmedAt) || d.receipt.confirmedAt > snapshot.observedAt - 7 * DAY || d.receipt.confirmedAt < now - 30 * DAY) return false;
    const date = analyticsLocalDate(d.receipt.confirmedAt, snapshot.timeZone);
    return date >= snapshot.startDate && date <= snapshot.endDate;
  });
  const tracked = (d: Delivery) => [...d.body.matchAll(/https:\/\/[^\s)<>]+/g)].some(match => { try { const url = new URL(match[0]); return url.hostname === hostname && url.searchParams.get('utm_campaign') === d.id; } catch { return false; } });
  const accounts = state.accountIds.map(accountId => {
    const campaigns = eligible.filter(d => d.accountId === accountId);
    const observed = campaigns.flatMap(d => { const row = rows.get(d.id); return row && tracked(d) ? [row] : []; });
    const sessions = observed.reduce((total, row) => total + row.sessions, 0);
    const engagedSessions = observed.reduce((total, row) => total + row.engagedSessions, 0);
    return { accountId, campaigns: campaigns.length, observedCampaigns: observed.length, engagedCampaigns: observed.filter(row => row.engagedSessions >= 10).length, sessions, engagedSessions, engagedPerCampaign: observed.length ? engagedSessions / observed.length : 0 };
  });
  const traffic: OperationTraffic = { status: 'usable', observedAt: snapshot.observedAt, startDate: snapshot.startDate, endDate: snapshot.endDate, timeZone: snapshot.timeZone, accounts,
    detail: 'Latest single GA4 report; publications must be at least seven days old at observation and within the report dates. Missing campaign rows are unknown, not zero traffic. Sessions are not unique buyers, leads or payments. Report processing, consent and attribution can change the counts.' };
  if (accounts.some(a => a.campaigns < 2) || eligible.some(d => !tracked(d))) { traffic.detail += ' Keep exploring until each selected destination has two mature tracked publications.'; return { traffic }; }
  const ranked = accounts.filter(a => a.engagedCampaigns >= 2 && a.sessions >= 40).sort((a, b) => b.engagedPerCampaign - a.engagedPerCampaign);
  const candidate = ranked[0];
  if (!candidate || ranked.some(a => a.accountId !== candidate.accountId && a.engagedPerCampaign >= candidate.engagedPerCampaign)) return { traffic };
  const reference = eligible.filter(d => d.accountId === candidate.accountId && (rows.get(d.id)?.engagedSessions ?? 0) >= 10).sort((a, b) => rows.get(b.id)!.engagedSessions - rows.get(a.id)!.engagedSessions || b.createdAt - a.createdAt)[0]!;
  const observed = rows.get(reference.id)!;
  traffic.reference = { id: reference.id, title: reference.title, description: reference.description, sessions: observed.sessions, engagedSessions: observed.engagedSessions };
  return { traffic, candidate };
}
