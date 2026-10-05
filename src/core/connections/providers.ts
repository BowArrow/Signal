import type { ConnectedAccount, ProviderId } from '../../shared/connections.js';
import { boundedJson, customSiteFetch, publicOrigin } from './network.js';

export interface AccountCredential { accessToken: string; refreshToken?: string; clientId?: string; clientSecret?: string; developerToken?: string; }
export interface OAuthConfig { clientId: string; clientSecret: string; developerToken: string; }
export interface OAuthSpec { authorize: string; token: string; scopes: string[]; pkce: boolean; basic?: boolean; extra?: Record<string, string>; }
const google = (scope: string): OAuthSpec => ({ authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', scopes: [scope], pkce: true, extra: { access_type: 'offline', prompt: 'consent' } });
export const OAUTH: Partial<Record<ProviderId, OAuthSpec>> = {
  gmail: google('https://www.googleapis.com/auth/gmail.readonly'), youtube: google('https://www.googleapis.com/auth/youtube.readonly'),
  ga4: google('https://www.googleapis.com/auth/analytics.readonly'), 'search-console': google('https://www.googleapis.com/auth/webmasters.readonly'), 'google-ads': google('https://www.googleapis.com/auth/adwords'),
  outlook: { authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', scopes: ['https://graph.microsoft.com/User.Read', 'https://graph.microsoft.com/Mail.Read', 'offline_access'], pkce: true },
  linkedin: { authorize: 'https://www.linkedin.com/oauth/v2/authorization', token: 'https://www.linkedin.com/oauth/v2/accessToken', scopes: ['openid', 'profile', 'email'], pkce: false },
  x: { authorize: 'https://x.com/i/oauth2/authorize', token: 'https://api.x.com/2/oauth2/token', scopes: ['tweet.read', 'users.read', 'offline.access'], pkce: true },
  reddit: { authorize: 'https://www.reddit.com/api/v1/authorize', token: 'https://www.reddit.com/api/v1/access_token', scopes: ['identity', 'read'], pkce: false, basic: true, extra: { duration: 'permanent' } },
  pinterest: { authorize: 'https://www.pinterest.com/oauth/', token: 'https://api.pinterest.com/v5/oauth/token', scopes: ['user_accounts:read', 'boards:read', 'pins:read'], pkce: false, basic: true },
};
export const PUBLISH_SCOPES: Partial<Record<ProviderId, string[]>> = {
  gmail: ['https://www.googleapis.com/auth/gmail.send'], outlook: ['https://graph.microsoft.com/Mail.ReadWrite', 'https://graph.microsoft.com/Mail.Send'],
  youtube: ['https://www.googleapis.com/auth/youtube.upload'], linkedin: ['w_member_social'], x: ['tweet.write'],
  reddit: ['submit'], pinterest: ['pins:write', 'boards:write'],
};
export function oauthBody(provider: ProviderId, config: OAuthConfig, values: Record<string, string>) {
  const spec = OAUTH[provider]; if (!spec) throw new Error('Provider does not use Signal OAuth');
  const body = new URLSearchParams({ ...values, client_id: config.clientId });
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'SignalDesktop/0.4 (owner-authorized account connection)' };
  if (spec.basic || (provider === 'x' && config.clientSecret)) headers.authorization = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`;
  else if (config.clientSecret) body.set('client_secret', config.clientSecret);
  return { body: body.toString(), headers };
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const records = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.map(record) : [];
const text = (value: unknown): string => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
export type AccountProbe = { identity: string; detail: string; rows: { title: string; detail: string }[]; facebookPage?: { id: string; canPost: boolean } };
export async function probeAccount(account: ConnectedAccount, credential: AccountCredential, transport: typeof fetch = fetch, preview = false): Promise<AccountProbe> {
  const token = credential.accessToken;
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, 'user-agent': 'SignalDesktop/0.4 (owner-authorized account connection)' };
  let url = ''; let custom = false;
  switch (account.provider) {
    case 'gmail': url = 'https://gmail.googleapis.com/gmail/v1/users/me/profile'; break;
    case 'outlook': url = 'https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName'; break;
    case 'youtube': url = 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=25'; break;
    case 'linkedin': url = 'https://api.linkedin.com/v2/userinfo'; break;
    case 'x': url = 'https://api.x.com/2/users/me'; break;
    case 'facebook': url = 'https://graph.facebook.com/v24.0/me?fields=id,name,category,can_post'; break;
    case 'instagram': url = 'https://graph.instagram.com/v24.0/me?fields=user_id,username'; break;
    case 'threads': url = 'https://graph.threads.net/v1.0/me?fields=id,username'; break;
    case 'tiktok': url = 'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name'; break;
    case 'pinterest': url = 'https://api.pinterest.com/v5/user_account'; break;
    case 'reddit': url = 'https://oauth.reddit.com/api/v1/me'; break;
    case 'bluesky': url = 'https://bsky.social/xrpc/com.atproto.server.getSession'; break;
    case 'mastodon': url = `${publicOrigin(account.site)}/api/v1/accounts/verify_credentials`; custom = true; break;
    case 'discord': url = 'https://discord.com/api/v10/users/@me'; headers.authorization = `Bot ${token}`; break;
    case 'slack': url = 'https://slack.com/api/auth.test'; headers['content-type'] = 'application/x-www-form-urlencoded'; break;
    case 'resend': url = 'https://api.resend.com/domains'; break;
    case 'brevo': url = 'https://api.brevo.com/v3/account'; delete headers.authorization; headers['api-key'] = token; break;
    case 'mailchimp': {
      const dc = /-(us\d+)$/.exec(token)?.[1]; if (!dc) throw new Error('Mailchimp API key must include its data-center suffix, such as -us21.');
      url = `https://${dc}.api.mailchimp.com/3.0/`; headers.authorization = `Basic ${Buffer.from(`signal:${token}`).toString('base64')}`; break;
    }
    case 'stripe': url = 'https://api.stripe.com/v1/balance'; break;
    case 'ga4': url = 'https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=50'; break;
    case 'search-console': url = 'https://www.googleapis.com/webmasters/v3/sites'; break;
    case 'posthog': {
      if (!['https://us.posthog.com', 'https://eu.posthog.com'].includes(account.site)) throw new Error('Choose https://us.posthog.com or https://eu.posthog.com.');
      url = `${account.site}/api/projects/`; break;
    }
    case 'hubspot': url = 'https://api.hubapi.com/crm/v3/objects/contacts?limit=5&properties=email,firstname,lastname'; break;
    case 'wordpress': url = `${publicOrigin(account.site)}/wp-json/wp/v2/users/me?context=edit`; custom = true; headers.authorization = `Basic ${Buffer.from(`${account.username}:${token}`).toString('base64')}`; break;
    case 'signal-blog': if (!['https://siplemona.de', 'https://cinegenaimedia.com'].includes(account.site)) throw new Error('Unrecognized website publishing destination'); url = `${account.site}/api/content/posts?slug=signal-connection-check`; break;
    case 'meta-ads': url = 'https://graph.facebook.com/v24.0/me/adaccounts?fields=id,name,account_status&limit=25'; break;
    case 'google-ads': url = 'https://googleads.googleapis.com/v23/customers:listAccessibleCustomers'; if (!credential.developerToken) throw new Error('Save a Google Ads developer token in OAuth app setup before connecting.'); headers['developer-token'] = credential.developerToken; break;
    case 'cloudflare': url = 'https://api.cloudflare.com/client/v4/zones?per_page=25'; break;
  }
  const get = async (target: string) => boundedJson(await transport(target, { headers, redirect: 'error', signal: AbortSignal.timeout(15000) }));
  const response = custom && transport === fetch ? await customSiteFetch(url, headers) : await transport(url, { headers, ...(account.provider === 'slack' ? { method: 'POST', body: '' } : {}), redirect: 'error', signal: AbortSignal.timeout(15000) });
  // Signal's content API authenticates before looking up the slug. A missing
  // probe slug is therefore a successful credential check, with no mutation.
  if (account.provider === 'signal-blog' && response.status === 404) {
    const data = await boundedJson(new Response(response.body, { status: 200 }));
    if (data.error !== 'Post not found') throw new Error('Unexpected website API response');
    return { identity: account.site, detail: 'Website credential accepted; probe article does not exist.', rows: [] };
  }
  const data = await boundedJson(response);
  if (data.ok === false || data.success === false || (data.error && record(data.error).code !== 'ok')) throw new Error('Provider rejected the connection. Check the token permissions or renew authorization.');
  let identity = ''; let rows: AccountProbe['rows'] = [];
  const row = (title: unknown, detail: unknown = '') => ({ title: text(title), detail: text(detail) });
  switch (account.provider) {
    case 'gmail': identity = text(data.emailAddress); break;
    case 'outlook': identity = text(data.mail) || text(data.userPrincipalName); break;
    case 'youtube': rows = records(data.items).map(item => row(record(item.snippet).title, item.id)); identity = rows.map(r => r.title).join(', '); break;
    case 'linkedin': identity = text(data.name) || text(data.sub); break;
    case 'x': identity = text(record(data.data).username); break;
    case 'instagram': case 'threads': case 'pinterest': identity = text(data.username); break;
    case 'facebook': if (!data.category) throw new Error('Use a Facebook Page token, not a personal user token.'); identity = text(data.name); break;
    case 'tiktok': identity = text(record(record(data.data).user).display_name); break;
    case 'reddit': identity = text(data.name); break;
    case 'bluesky': identity = text(data.handle); break;
    case 'mastodon': identity = text(data.acct); break;
    case 'discord': if (data.bot !== true) throw new Error('Connect an authorized bot account.'); identity = text(data.username); break;
    case 'slack': identity = `${text(data.team)} / ${text(data.user)}`; break;
    case 'brevo': identity = text(data.email); break;
    case 'mailchimp': identity = text(data.account_name) || text(data.email); break;
    case 'stripe': if (typeof data.livemode !== 'boolean') throw new Error('Unexpected Stripe account response'); identity = data.livemode ? 'Stripe live account' : 'Stripe test account'; rows = records(data.available).map(item => row(item.currency, `${text(item.amount)} minor units available`)); break;
    case 'resend': rows = records(data.data).map(item => row(item.name, item.status)); identity = `Resend: ${rows.length} domains in this page`; break;
    case 'ga4': rows = records(data.accountSummaries).flatMap(item => records(item.propertySummaries).map(p => row(p.displayName, p.property))); identity = `Google Analytics: ${rows.length} accessible properties in this page`; break;
    case 'search-console': rows = records(data.siteEntry).map(item => row(item.siteUrl, item.permissionLevel)); identity = `Search Console: ${rows.length} accessible sites`; break;
    case 'posthog': rows = records(data.results).map(item => row(item.name, item.id)); identity = `PostHog: ${rows.length} projects in this page`; break;
    case 'hubspot': rows = records(data.results).map(item => row(record(item.properties).email, `${text(record(item.properties).firstname)} ${text(record(item.properties).lastname)}`)); identity = 'HubSpot contacts API'; break;
    case 'wordpress': identity = text(data.name) || text(data.slug); break;
    case 'signal-blog': identity = account.site; break;
    case 'meta-ads': rows = records(data.data).map(item => row(item.name, item.id)); identity = `Meta Ads: ${rows.length} accessible ad accounts in this page`; break;
    case 'google-ads': rows = Array.isArray(data.resourceNames) ? data.resourceNames.map(item => row(item)) : []; identity = `Google Ads: ${rows.length} accessible customers`; break;
    case 'cloudflare': rows = records(data.result).map(item => row(item.name, item.status)); identity = `Cloudflare: ${rows.length} zones in this page`; break;
  }
  if (!identity.trim()) throw new Error('The provider did not return an accessible account identity. Check account type and permissions.');
  if (account.provider === 'facebook') {
    const pageId = text(data.id);
    if (!/^\d{1,30}$/.test(pageId)) throw new Error('The provider did not return a valid Facebook Page ID.');
    return { identity, facebookPage: { id: pageId, canPost: data.can_post === true }, detail: data.can_post === true ? 'Facebook Page identity and posting capability checked. Publishing still requires a valid Page token with pages_manage_posts and an enabled Operations policy.' : 'Facebook Page read access verified. Check Page posting capability and token permissions before publishing.', rows: [row('Page ID', pageId), row('Page posting capability', data.can_post === true ? 'Available' : 'Not confirmed')] };
  }
  if (preview && account.provider === 'gmail') {
    const inbox = await get('https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=INBOX&maxResults=10');
    rows = await Promise.all(records(inbox.messages).map(async item => {
      const message = await get(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(text(item.id))}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`);
      const values = records(record(message.payload).headers);
      return row(values.find(h => h.name === 'Subject')?.value ?? '(No subject)', values.find(h => h.name === 'From')?.value);
    }));
  }
  if (preview && account.provider === 'outlook') {
    const inbox = await get('https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=10&$select=subject,from&$orderby=receivedDateTime%20desc');
    rows = records(inbox.value).map(item => row(item.subject, record(record(item.from).emailAddress).address));
  }
  return { identity, detail: 'Account read access verified. This does not prove publishing permission or enable automatic sending.', rows: rows.slice(0, 50) };
}
