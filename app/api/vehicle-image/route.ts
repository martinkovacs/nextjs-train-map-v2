import { proxyGet } from '@/lib/proxy';
import { resolveImagePath, VW_HEADERS, VW_TIMEOUT_MS } from '@/lib/vagonweb';

/**
 * vagonweb's own vehicle drawings, proxied through our origin and never hotlinked: an
 * <img src> pointing at their host is a request to their server for every vehicle on
 * every panel open. The browser and the CDN are the mirror; nothing is stored
 * server-side, which a serverless filesystem would not keep anyway.
 *
 * The path travels as a QUERY PARAMETER, not a route segment: vagonweb's paths are
 * multi-segment and carry `..` (`../popisy/img/ELOC/../D-/…`), which one dynamic segment
 * cannot hold and a catch-all would let the router normalise before the guard ever sees
 * it. resolveImagePath resolves the `..` first, so the same drawing is not stored twice,
 * then rejects anything not inside vagonweb.cz/popisy/img/ — without that this route is
 * an open proxy.
 */
export async function GET(request: Request) {
  const src = new URL(request.url).searchParams.get('src') ?? '';
  const target = resolveImagePath(src);
  if (!target) {
    console.error('[vehicle-image] rejected path outside popisy/img/', { src });
    return new Response('not a vagonweb vehicle drawing', { status: 400 });
  }

  try {
    // Through the VPS proxy, like every other vagonweb call. The drawing is cached for
    // 30 days by the browser and the CDN, so this is one proxied request per drawing per
    // month rather than one per panel open.
    const res = await proxyGet(target, VW_HEADERS, VW_TIMEOUT_MS);
    if (!res.ok) {
      console.error('[vehicle-image] upstream error', { target, status: res.status });
      // The card falls back to our own silhouette, which is load-bearing rather than
      // decorative: vagonweb has no drawing for some vehicles either.
      return new Response('', { status: res.status });
    }
    return new Response(res.body, {
      headers: {
        'Content-Type': res.headers.get('content-type') ?? 'image/gif',
        // 30 days: a drawing effectively never changes under its filename, and a month
        // keeps a corrected drawing from being pinned for a year.
        'Cache-Control': 'public, max-age=2592000',
      },
    });
  } catch (e) {
    console.error('[vehicle-image] request failed', { target, error: e });
    return new Response('', { status: 504 });
  }
}
