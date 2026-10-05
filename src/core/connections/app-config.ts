import { z } from 'zod';
import type { ProviderId } from '../../shared/connections.js';
import type { OAuthConfig } from './providers.js';

export const GOOGLE_PROVIDERS: ProviderId[] = ['gmail', 'youtube', 'ga4', 'search-console', 'google-ads'];
export const isGoogleProvider = (provider: ProviderId) => GOOGLE_PROVIDERS.includes(provider);
const clientId = z.string().trim().min(1).max(500);
const publicClient = z.object({ clientId }).strict();
// Only native/public registrations belong in a desktop distribution. A Google
// Desktop client's secret is not confidential. Web-client secrets never belong here.
const googleClient = z.object({ clientId: clientId.regex(/\.apps\.googleusercontent\.com$/), clientSecret: z.string().min(1).max(4000) }).strict();
export const connectionAppsSchema = z.object({
  google: googleClient.optional(), outlook: publicClient.optional(),
  x: publicClient.optional(), reddit: publicClient.optional(),
}).strict();
export type ConnectionApps = z.infer<typeof connectionAppsSchema>;

export function parseConnectionApps(input: unknown): ConnectionApps {
  const result = connectionAppsSchema.safeParse(input);
  if (!result.success) throw new Error('Invalid Signal connection app configuration. Use native/public clients; do not include web-client secrets or account tokens.');
  return result.data;
}
export function parseGoogleDesktopClient(input: unknown): OAuthConfig {
  const result = z.object({ installed: z.object({
    client_id: clientId.regex(/\.apps\.googleusercontent\.com$/),
    client_secret: z.string().min(1).max(4000),
    auth_uri: z.literal('https://accounts.google.com/o/oauth2/auth').optional(),
    token_uri: z.literal('https://oauth2.googleapis.com/token').optional(),
  }), web: z.never().optional() }).safeParse(input);
  if (!result.success) throw new Error('Choose the original Google Desktop app JSON download. Web application and service-account credentials cannot be used for this sign-in.');
  return { clientId: result.data.installed.client_id, clientSecret: result.data.installed.client_secret, developerToken: '' };
}
export function bundledOAuth(apps: ConnectionApps, provider: ProviderId): OAuthConfig | null {
  const client = isGoogleProvider(provider) ? apps.google : provider === 'outlook' || provider === 'x' || provider === 'reddit' ? apps[provider] : undefined;
  return client ? { clientId: client.clientId, clientSecret: 'clientSecret' in client && typeof client.clientSecret === 'string' ? client.clientSecret : '', developerToken: '' } : null;
}
