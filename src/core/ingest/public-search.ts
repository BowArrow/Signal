import type { HttpClient } from '../lib/http.js';
import { boundedJson } from '../connections/network.js';

/** Bound both headers and response-body reads for the public search endpoints. */
export async function publicSearchJson(http: HttpClient, url: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const timeout = AbortSignal.timeout(30000);
  const response = await http.request(url, { official: true, redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  return boundedJson(response);
}
