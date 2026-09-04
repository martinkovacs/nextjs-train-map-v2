/** The VPS proxy, which is the only way out of this app to either upstream.
 *
 *  It answers two routes and this module is the contract for both:
 *
 *    POST /           { url, headers, query }   the MÁV GraphQL POST (lib/upstream.ts)
 *    POST /vagonweb   { url, headers }          a plain GET, body handed back verbatim
 *
 *  MÁV needs the Hungarian IP. vagonweb does not, but it rate-limits and blocks the
 *  datacentre ranges the app itself is deployed in, so both upstreams now leave from the
 *  same address and there is one hop to name in an error message rather than two.
 *
 *  `/vagonweb` is named for what it is allowed to reach, not for what it does: the proxy
 *  refuses any other host on it, so a route that GETs an arbitrary URL and hands the
 *  bytes back cannot become an open proxy. It returns the UPSTREAM's status and body
 *  untouched, so a caller can keep treating the answer as if it had fetched the page
 *  itself. Only the proxy's own failures arrive as 502 or 504 with a JSON body. */

/** PROXY_ENDPOINT is the GraphQL route at the proxy root; /vagonweb sits beside it. */
export const PROXY_VARS = [
  'PROXY_ENDPOINT', 'CF_ACCESS_CLIENT_ID', 'CF_ACCESS_CLIENT_SECRET',
] as const;

export const missingEnv = (names: readonly string[]) =>
  names.filter((n) => !process.env[n]);

/** The two CF-Access-Client-* headers are OURS TO THE PROXY, which sits behind Cloudflare
 *  Access. They are never put in the body's `headers`, which is what the upstream sees. */
export function proxyHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'User-Agent': 'vonatinfo/1.0',
    'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID!,
    'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET!,
  };
}

/** Resolved against PROXY_ENDPOINT rather than configured separately: the two routes are
 *  one deployment and a second variable is a second thing to get wrong. */
export const vagonwebUrl = () => new URL('vagonweb', process.env.PROXY_ENDPOINT!).toString();

/** A GET through the proxy's vagonweb route. Throws the way fetch() does, with the
 *  missing configuration named, so every caller's existing catch keeps naming the hop and
 *  the raw error. */
export async function proxyGet(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<Response> {
  const missing = missingEnv(PROXY_VARS);
  if (missing.length) throw new Error(`Missing ${missing.join(', ')}`);
  return fetch(vagonwebUrl(), {
    method: 'POST',
    headers: proxyHeaders(),
    body: JSON.stringify({ url, headers }),
    signal: AbortSignal.timeout(timeoutMs),
    cache: 'no-store',
  });
}
