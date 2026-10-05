import { z } from 'zod';
import { boundedJson } from '../connections/network.js';
import { analyticsConfigSchema, FUNNEL_EVENTS, type AnalyticsMetrics } from '../../shared/analytics.js';

const METRICS = ['sessions', 'engagedSessions', 'keyEvents', 'ecommercePurchases', 'purchaseRevenue'] as const;
const metadataSchema = z.object({
  timeZone: z.string().min(1).max(100), currencyCode: z.string().regex(/^[A-Z]{3}$/),
  dataLossFromOtherRow: z.boolean().optional(), subjectToThresholding: z.boolean().optional(),
  samplingMetadatas: z.array(z.unknown()).optional(), dataTruncationReasons: z.array(z.unknown()).optional(),
  schemaRestrictionResponse: z.object({ activeMetricRestrictions: z.array(z.unknown()).optional() }).optional(),
  emptyReason: z.string().optional(),
});
const reportSchema = z.object({
  dimensionHeaders: z.array(z.object({ name: z.string() })).length(1),
  metricHeaders: z.array(z.object({ name: z.string() })).length(5),
  rows: z.array(z.object({ dimensionValues: z.array(z.object({ value: z.string().max(500) })).length(1), metricValues: z.array(z.object({ value: z.string().regex(/^-?\d+(?:\.\d+)?$/) })).length(5) })).max(10000).default([]),
  rowCount: z.number().int().nonnegative().default(0), metadata: metadataSchema,
});
/** Calendar arithmetic uses the property's local date, never 24-hour subtraction across DST. */
export function analyticsLocalDate(now: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => Number(parts.find(p => p.type === type)!.value);
  return new Date(Date.UTC(part('year'), part('month') - 1, part('day'))).toISOString().slice(0, 10);
}
export function analyticsDates(now: number, timeZone: string) {
  const today = Date.parse(analyticsLocalDate(now, timeZone) + 'T00:00:00Z');
  const date = (days: number) => new Date(today - days * 86400000).toISOString().slice(0, 10);
  return { startDate: date(30), endDate: date(1) };
}
export class Ga4Reader {
  constructor(private readonly token: string, private readonly transport: typeof fetch, private readonly signal: AbortSignal, private readonly allowed: () => void) {}
  private async json(url: string, body?: unknown) {
    this.signal.throwIfAborted(); this.allowed();
    const data = await boundedJson(await this.transport(url, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${this.token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.any([this.signal, AbortSignal.timeout(20000)]) }));
    this.signal.throwIfAborted(); this.allowed(); return data;
  }
  async funnel(propertyId: string, hostname: string, window: { startDate: string; endDate: string; timeZone: string; currencyCode: string }) {
    analyticsConfigSchema.shape.propertyId.parse(propertyId);
    if (!hostname || new URL(`https://${hostname}`).hostname !== hostname) throw new Error('Invalid analytics hostname.');
    const schema = z.object({
      dimensionHeaders: z.array(z.object({ name: z.string() })).length(2),
      metricHeaders: z.array(z.object({ name: z.string() })).length(1),
      rows: z.array(z.object({ dimensionValues: z.tuple([z.object({ value: z.string().max(500) }), z.object({ value: z.enum(FUNNEL_EVENTS) })]), metricValues: z.tuple([z.object({ value: z.string().regex(/^\d+$/) })]) })).max(10000).default([]),
      rowCount: z.number().int().nonnegative().default(0), metadata: metadataSchema,
    });
    const report = schema.parse(await this.json(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
      dimensions: [{ name: 'sessionManualCampaignName' }, { name: 'eventName' }], metrics: [{ name: 'eventCount' }],
      dateRanges: [{ startDate: window.startDate, endDate: window.endDate }], currencyCode: window.currencyCode, limit: '10000',
      dimensionFilter: { andGroup: { expressions: [
        { filter: { fieldName: 'hostName', stringFilter: { matchType: 'EXACT', value: hostname, caseSensitive: false } } },
        { filter: { fieldName: 'eventName', inListFilter: { values: [...FUNNEL_EVENTS], caseSensitive: true } } },
      ] } },
    }));
    if (report.rowCount !== report.rows.length || report.dimensionHeaders[0]!.name !== 'sessionManualCampaignName' || report.dimensionHeaders[1]!.name !== 'eventName' || report.metricHeaders[0]!.name !== 'eventCount') throw new Error('Invalid funnel report columns or capacity.');
    const meta = report.metadata;
    if (meta.timeZone !== window.timeZone || meta.currencyCode !== window.currencyCode || meta.schemaRestrictionResponse?.activeMetricRestrictions?.length) throw new Error('Funnel settings or access changed.');
    const limitations: string[] = [];
    if (meta.subjectToThresholding) limitations.push('Some funnel events may be withheld by reporting thresholds.');
    if (meta.dataLossFromOtherRow) limitations.push('Some funnel campaigns are grouped into other.');
    if (meta.samplingMetadatas?.length) limitations.push('Funnel events are sampled.');
    if (meta.dataTruncationReasons?.length || meta.emptyReason) limitations.push('Funnel data is truncated or constrained.');
    const seen = new Set<string>();
    const rows = report.rows.map(row => {
      const campaign = row.dimensionValues[0].value, event = row.dimensionValues[1].value, count = Number(row.metricValues[0].value);
      const key = JSON.stringify([campaign, event]);
      if (seen.has(key) || !Number.isSafeInteger(count) || count > Number.MAX_SAFE_INTEGER / 10000) throw new Error('Invalid or duplicate funnel observation.');
      seen.add(key); return { campaign, event, count };
    });
    return { rows, limitations };
  }
  async report(propertyId: string, hostname: string, now: number) {
    analyticsConfigSchema.shape.propertyId.parse(propertyId);
    if (!hostname || new URL(`https://${hostname}`).hostname !== hostname) throw new Error('Invalid analytics hostname.');
    const property = z.object({ name: z.string(), timeZone: z.string().min(1).max(100), currencyCode: z.string().regex(/^[A-Z]{3}$/) }).parse(await this.json(`https://analyticsadmin.googleapis.com/v1beta/properties/${propertyId}`));
    if (property.name !== `properties/${propertyId}`) throw new Error('Analytics property mismatch.');
    const dates = analyticsDates(now, property.timeZone);
    const report = reportSchema.parse(await this.json(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
      dimensions: [{ name: 'sessionManualCampaignName' }], metrics: METRICS.map(name => ({ name })),
      dateRanges: [dates], dimensionFilter: { filter: { fieldName: 'hostName', stringFilter: { matchType: 'EXACT', value: hostname, caseSensitive: false } } },
      currencyCode: property.currencyCode, limit: '10000',
    }));
    if (report.rowCount !== report.rows.length) throw new Error('Analytics report exceeds bounded snapshot capacity.');
    if (report.dimensionHeaders[0]!.name !== 'sessionManualCampaignName' || report.metricHeaders.some((h, i) => h.name !== METRICS[i])) throw new Error('Analytics report columns changed.');
    const meta = report.metadata;
    if (meta.timeZone !== property.timeZone || meta.currencyCode !== property.currencyCode) throw new Error('Analytics reporting settings changed during sync.');
    if (meta.schemaRestrictionResponse?.activeMetricRestrictions?.length) throw new Error('Analytics metric access is restricted.');
    const limitations: string[] = [];
    if (meta.subjectToThresholding) limitations.push('Some data may be withheld by reporting thresholds.');
    if (meta.dataLossFromOtherRow) limitations.push('High-cardinality campaign data has been grouped into other.');
    if (meta.samplingMetadatas?.length) limitations.push('This report uses sampled data.');
    if (meta.dataTruncationReasons?.length) limitations.push('Google reports truncated data.');
    if (meta.emptyReason) limitations.push('Google returned an empty report with a reporting limitation.');
    const seen = new Set<string>();
    const rows = report.rows.map(row => {
      const campaign = row.dimensionValues[0]!.value;
      if (seen.has(campaign)) throw new Error('Duplicate campaign row.'); seen.add(campaign);
      const values = row.metricValues.map((v, i) => {
        const n = Number(v.value);
        if (!Number.isFinite(n) || Math.abs(n) > Number.MAX_SAFE_INTEGER / 10000 || (i !== 4 && n < 0)) throw new Error('Invalid analytics metric.');
        return n;
      });
      return { campaign, ...Object.fromEntries(METRICS.map((name, i) => [name, values[i]!])) as unknown as AnalyticsMetrics };
    });
    return { ...dates, timeZone: meta.timeZone, currencyCode: meta.currencyCode, limitations, rows };
  }
}
