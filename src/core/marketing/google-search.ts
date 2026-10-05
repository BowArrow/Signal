import { z } from 'zod';
import type { PaidSearchJob, SearchRun } from '../../shared/paid-search.js';
import { boundedJson } from '../connections/network.js';

const integer = z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export function accountDate(time: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(time);
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type)!.value).join('-');
}
export function searchRun(job: PaidSearchJob, now: number, timeZone: string): SearchRun {
  const day = Date.parse(accountDate(now, timeZone) + 'T00:00:00Z');
  return { name: 'Signal-' + job.id, timeZone, startDateTime: new Date(day + 86400000).toISOString().slice(0, 10) + ' 00:00:00', endDateTime: new Date(day + job.settings.durationDays * 86400000).toISOString().slice(0, 10) + ' 23:59:59' };
}
export function searchOperations(job: PaidSearchJob): Record<string, unknown>[] {
  const customer = `customers/${job.settings.customerId}`;
  if (!job.run) throw Error('Campaign dates are not fixed.');
  const budget = `${customer}/campaignBudgets/-1`, campaign = `${customer}/campaigns/-2`, group = `${customer}/adGroups/-3`;
  const operations: Record<string, unknown>[] = [
    { campaignBudgetOperation: { create: { resourceName: budget, name: job.run.name, deliveryMethod: 'STANDARD', period: 'CUSTOM_PERIOD', totalAmountMicros: String(job.settings.capCents * 10000), explicitlyShared: false } } },
    { campaignOperation: { create: { resourceName: campaign, name: job.run.name, status: 'PAUSED', advertisingChannelType: 'SEARCH', campaignBudget: budget, manualCpc: {}, startDateTime: job.run.startDateTime, endDateTime: job.run.endDateTime, containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING', networkSettings: { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false, targetPartnerSearchNetwork: false }, geoTargetTypeSetting: { positiveGeoTargetType: 'PRESENCE' } } } },
    { adGroupOperation: { create: { resourceName: group, campaign, name: job.run.name, status: 'ENABLED', type: 'SEARCH_STANDARD', cpcBidMicros: String(job.settings.maxCpcCents * 10000) } } },
    { adGroupAdOperation: { create: { adGroup: group, status: 'ENABLED', ad: { finalUrls: [job.destination], responsiveSearchAd: { headlines: job.creative.headlines.map(a => ({ text: a.text })), descriptions: job.creative.descriptions.map(a => ({ text: a.text })) } } } } },
    ...job.creative.keywords.map(text => ({ adGroupCriterionOperation: { create: { adGroup: group, status: 'ENABLED', keyword: { text, matchType: 'EXACT' } } } })),
    { campaignCriterionOperation: { create: { campaign, location: { geoTargetConstant: 'geoTargetConstants/2840' } } } },
    { campaignCriterionOperation: { create: { campaign, language: { languageConstant: 'languageConstants/1000' } } } },
    ...['MOBILE', 'TABLET', 'CONNECTED_TV'].map(type => ({ campaignCriterionOperation: { create: { campaign, device: { type }, bidModifier: 0 } } })),
  ];
  return operations;
}

/** Fixed, bounded Google Ads endpoints. A read/validation never calls the write guard. */
export class GoogleSearchClient {
  constructor(private readonly customerId: string, private readonly token: string, private readonly developerToken: string, private readonly loginCustomerId: string, private readonly transport: typeof fetch, private readonly signal: AbortSignal, private readonly allowed: () => void) {
    z.string().regex(/^\d{10}$/).parse(customerId); if (loginCustomerId) z.string().regex(/^\d{10}$/).parse(loginCustomerId);
  }
  private async request(method: 'search' | 'mutate', body: unknown, write?: () => void) {
    this.signal.throwIfAborted(); this.allowed(); write?.();
    let response: Response;
    try { response = await this.transport(`https://googleads.googleapis.com/v23/customers/${this.customerId}/googleAds:${method}`, { method: 'POST', redirect: 'error', signal: AbortSignal.any([this.signal, AbortSignal.timeout(20000)]), headers: { authorization: `Bearer ${this.token}`, 'developer-token': this.developerToken, ...(this.loginCustomerId ? { 'login-customer-id': this.loginCustomerId } : {}), 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
    catch { throw Error('Google Ads request was interrupted. Reconcile before attempting another creation.'); }
    const value = await boundedJson(response); this.signal.throwIfAborted(); this.allowed();
    if (value.partialFailureError) throw Error('Google Ads returned an unexpected partial result.');
    return value;
  }
  private async rows(query: string) {
    const value = await this.request('search', { query });
    if (value.nextPageToken) throw Error('Google Ads returned more records than this bounded query supports.');
    return z.array(z.record(z.unknown())).max(100).parse(value.results ?? []);
  }
  async customer() {
    const rows = await this.rows('SELECT customer.id, customer.currency_code, customer.time_zone, customer.test_account, customer.manager, customer.status FROM customer LIMIT 1');
    const customer = z.object({ id: z.string(), currencyCode: z.literal('USD'), timeZone: z.string(), testAccount: z.boolean().optional(), manager: z.boolean().optional(), status: z.literal('ENABLED') }).parse(rows[0]?.customer);
    if (customer.id !== this.customerId || customer.testAccount || customer.manager) throw Error('Choose an enabled live USD advertising customer, not a manager or test account.');
    accountDate(Date.now(), customer.timeZone); return customer;
  }
  async validate(job: PaidSearchJob) { await this.request('mutate', { mutateOperations: searchOperations(job), partialFailure: false, validateOnly: true }); }
  async createPaused(job: PaidSearchJob, write: () => void) {
    const result = await this.request('mutate', { mutateOperations: searchOperations(job), partialFailure: false, validateOnly: false }, write);
    const values = z.array(z.record(z.unknown())).parse(result.mutateOperationResponses);
    const resource = z.object({ resourceName: z.string() }).parse(values.find(v => v.campaignResult)?.campaignResult).resourceName;
    this.campaignId(resource); return resource;
  }
  private campaignId(resource: string) { const match = new RegExp(`^customers/${this.customerId}/campaigns/(\\d+)$`).exec(resource); if (!match) throw Error('Campaign receipt belongs to a different customer or is malformed.'); return match[1]!; }
  async find(name: string) {
    z.string().regex(/^Signal-[A-Za-z0-9_-]{1,100}$/).parse(name);
    const rows = await this.rows(`SELECT campaign.resource_name FROM campaign WHERE campaign.name = '${name}' AND campaign.status != 'REMOVED' LIMIT 2`);
    if (rows.length > 1) throw Error('Multiple campaigns have this immutable Signal name. Resolve them in Google Ads.');
    if (!rows.length) return undefined;
    const resource = z.object({ resourceName: z.string() }).parse(rows[0]!.campaign).resourceName; this.campaignId(resource); return resource;
  }
  async status(resource: string, status: 'ENABLED' | 'PAUSED', write: () => void) {
    this.campaignId(resource);
    await this.request('mutate', { mutateOperations: [{ campaignOperation: { update: { resourceName: resource, status }, updateMask: 'status' } }], partialFailure: false, validateOnly: false }, write);
  }
  async inspect(job: PaidSearchJob) {
    const resource = job.run?.resource; if (!resource) throw Error('No confirmed campaign receipt.'); const id = this.campaignId(resource);
    const rows = await this.rows(`SELECT campaign.resource_name, campaign.name, campaign.status, campaign.start_date_time, campaign.end_date_time, campaign.advertising_channel_type, campaign.manual_cpc, campaign.network_settings, campaign.geo_target_type_setting, campaign_budget.period, campaign_budget.total_amount_micros, campaign_budget.explicitly_shared, metrics.cost_micros, metrics.clicks, metrics.impressions FROM campaign WHERE campaign.id = ${id} LIMIT 1`);
    const row = rows[0]; if (!row) throw Error('The campaign could not be found.');
    const result = z.object({ campaign: z.object({ resourceName: z.string(), name: z.string(), status: z.enum(['ENABLED', 'PAUSED', 'REMOVED']), startDateTime: z.string(), endDateTime: z.string(), advertisingChannelType: z.string(), manualCpc: z.record(z.unknown()).optional(), networkSettings: z.object({ targetGoogleSearch: z.boolean().optional(), targetSearchNetwork: z.boolean().optional(), targetContentNetwork: z.boolean().optional(), targetPartnerSearchNetwork: z.boolean().optional() }), geoTargetTypeSetting: z.object({ positiveGeoTargetType: z.string() }) }), campaignBudget: z.object({ period: z.string(), totalAmountMicros: integer, explicitlyShared: z.boolean().optional() }), metrics: z.object({ costMicros: integer.optional(), clicks: integer.optional(), impressions: integer.optional() }).optional() }).parse(row);
    const c = result.campaign, b = result.campaignBudget, n = c.networkSettings;
    const intact = c.resourceName === resource && c.name === job.run!.name && c.startDateTime === job.run!.startDateTime && c.endDateTime === job.run!.endDateTime && c.advertisingChannelType === 'SEARCH' && Boolean(c.manualCpc) && n.targetGoogleSearch === true && !n.targetSearchNetwork && !n.targetContentNetwork && !n.targetPartnerSearchNetwork && c.geoTargetTypeSetting.positiveGeoTargetType === 'PRESENCE' && b.period === 'CUSTOM_PERIOD' && b.totalAmountMicros === job.settings.capCents * 10000 && !b.explicitlyShared;
    return { status: c.status, intact, costCents: Math.ceil((result.metrics?.costMicros ?? 0) / 10000), clicks: result.metrics?.clicks ?? 0, impressions: result.metrics?.impressions ?? 0 };
  }
  async creativeIntact(job: PaidSearchJob) {
    const id = this.campaignId(job.run!.resource!);
    const ads = await this.rows(`SELECT ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad, ad_group.cpc_bid_micros FROM ad_group_ad WHERE campaign.id = ${id} AND ad_group_ad.status != 'REMOVED' LIMIT 10`);
    const ad = z.object({ adGroupAd: z.object({ ad: z.object({ finalUrls: z.array(z.string()), responsiveSearchAd: z.object({ headlines: z.array(z.object({ text: z.string() })), descriptions: z.array(z.object({ text: z.string() })) }) }) }), adGroup: z.object({ cpcBidMicros: integer }) }).safeParse(ads[0]);
    const sort = (values: string[]) => JSON.stringify([...values].sort());
    if (ads.length !== 1 || !ad.success || ad.data.adGroup.cpcBidMicros !== job.settings.maxCpcCents * 10000 || sort(ad.data.adGroupAd.ad.finalUrls) !== sort([job.destination]) || sort(ad.data.adGroupAd.ad.responsiveSearchAd.headlines.map(a => a.text)) !== sort(job.creative.headlines.map(a => a.text)) || sort(ad.data.adGroupAd.ad.responsiveSearchAd.descriptions.map(a => a.text)) !== sort(job.creative.descriptions.map(a => a.text))) return false;
    const keywords = await this.rows(`SELECT ad_group_criterion.keyword, ad_group_criterion.negative FROM keyword_view WHERE campaign.id = ${id} AND ad_group_criterion.status != 'REMOVED' LIMIT 100`);
    const parsed = z.array(z.object({ adGroupCriterion: z.object({ negative: z.boolean().optional(), keyword: z.object({ text: z.string(), matchType: z.string() }) }) })).parse(keywords);
    if (parsed.some(k => k.adGroupCriterion.negative || k.adGroupCriterion.keyword.matchType !== 'EXACT') || sort(parsed.map(k => k.adGroupCriterion.keyword.text.toLowerCase())) !== sort(job.creative.keywords.map(k => k.toLowerCase()))) return false;
    const targeting = await this.rows(`SELECT campaign_criterion.type, campaign_criterion.negative, campaign_criterion.location, campaign_criterion.language, campaign_criterion.device, campaign_criterion.bid_modifier FROM campaign_criterion WHERE campaign.id = ${id} AND campaign_criterion.status != 'REMOVED' LIMIT 100`);
    const criteria = targeting.map(r => z.record(z.unknown()).parse(r.campaignCriterion));
    const desired = [{ type: 'LOCATION', key: 'location', value: { geoTargetConstant: 'geoTargetConstants/2840' } }, { type: 'LANGUAGE', key: 'language', value: { languageConstant: 'languageConstants/1000' } }, ...['MOBILE', 'TABLET', 'CONNECTED_TV'].map(type => ({ type: 'DEVICE', key: 'device', value: { type } }))];
    return criteria.length === desired.length && desired.every(d => criteria.some(c => c.type === d.type && !c.negative && JSON.stringify(c[d.key]) === JSON.stringify(d.value) && (d.type !== 'DEVICE' || Number(c.bidModifier) === 0)));
  }
}
