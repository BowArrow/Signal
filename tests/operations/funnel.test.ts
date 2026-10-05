import { expect, it, vi } from 'vitest';
import { Ga4Reader } from '../../src/core/analytics/ga4.js';

const window = { startDate: '2026-08-25', endDate: '2026-09-23', timeZone: 'America/Los_Angeles', currencyCode: 'USD' };
function fixture() {
  return { dimensionHeaders: [{ name: 'sessionManualCampaignName' }, { name: 'eventName' }], metricHeaders: [{ name: 'eventCount' }], rowCount: 1,
    rows: [{ dimensionValues: [{ value: 'known-campaign' }, { value: 'sign_up' }], metricValues: [{ value: '4' }] }], metadata: { timeZone: window.timeZone, currencyCode: window.currencyCode } as Record<string, unknown> };
}
it('uses exact hostname, event allowlist, and the traffic snapshot calendar window', async () => {
  const send = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    expect(body.dateRanges).toEqual([{ startDate: window.startDate, endDate: window.endDate }]);
    expect(body.dimensionFilter.andGroup.expressions[0].filter).toMatchObject({ fieldName: 'hostName', stringFilter: { value: 'siplemona.de', matchType: 'EXACT' } });
    expect(body.dimensionFilter.andGroup.expressions[1].filter.inListFilter.values).toContain('product_activation');
    expect(init?.redirect).toBe('error'); return Response.json(fixture());
  });
  const value = await new Ga4Reader('private', send, new AbortController().signal, () => {}).funnel('1234', 'siplemona.de', window);
  expect(value.rows).toEqual([{ campaign: 'known-campaign', event: 'sign_up', count: 4 }]);
});
it.each(['duplicate', 'fractional', 'negative', 'overflow', 'event', 'columns', 'truncated', 'restricted', 'timezone'])('rejects invalid %s events instead of treating them as conversions', async fault => {
  const data = fixture();
  if (fault === 'duplicate') { data.rows.push(data.rows[0]!); data.rowCount = 2; }
  if (fault === 'fractional') data.rows[0]!.metricValues[0]!.value = '1.5';
  if (fault === 'negative') data.rows[0]!.metricValues[0]!.value = '-1';
  if (fault === 'overflow') data.rows[0]!.metricValues[0]!.value = '9999999999999999';
  if (fault === 'event') data.rows[0]!.dimensionValues[1]!.value = 'untrusted_event';
  if (fault === 'columns') data.metricHeaders[0]!.name = 'totalUsers';
  if (fault === 'truncated') data.rowCount = 10001;
  if (fault === 'restricted') data.metadata.schemaRestrictionResponse = { activeMetricRestrictions: [{}] };
  if (fault === 'timezone') data.metadata.timeZone = 'UTC';
  const send = vi.fn<typeof fetch>(async () => Response.json(data));
  await expect(new Ga4Reader('private', send, new AbortController().signal, () => {}).funnel('1234', 'siplemona.de', window)).rejects.toThrow();
});
it('preserves threshold and sampling limitations on otherwise valid events', async () => {
  const data = fixture(); data.metadata.subjectToThresholding = true; data.metadata.samplingMetadatas = [{}];
  const send = vi.fn<typeof fetch>(async () => Response.json(data));
  const report = await new Ga4Reader('private', send, new AbortController().signal, () => {}).funnel('1234', 'siplemona.de', window);
  expect(report.limitations).toHaveLength(2);
});
