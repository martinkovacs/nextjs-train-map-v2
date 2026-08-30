import { NextResponse } from 'next/server';
import { failure, geometryQuery, postUpstream } from '@/lib/upstream';

/**
 * The route line for one published row. Same MÁV endpoint and same Hungarian IP as
 * /api/vehicles; a separate route only to carry a different cache lifetime, because a
 * shape does not change while the trip runs.
 *
 * `serviceDay` travels as a query parameter, from the trip's own value and never today's
 * date, which is wrong for a trip running past midnight. It varies the cache key but
 * never the answer, so the worst cost is a duplicate entry of identical bytes.
 *
 * The id is whatever the caller asked for: a merged trip is fetched once per leg by each
 * leg's SUFFIXED id, a portioned train once per portion. Never by canonical id alone on a
 * merged trip, which addresses the unsuffixed leg whichever leg is running (SPEC 1).
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ tripId: string }> },
) {
  const { tripId } = await ctx.params;
  const id = decodeURIComponent(tripId);
  const serviceDay = new URL(request.url).searchParams.get('serviceDay') ?? '';

  const out = await postUpstream(geometryQuery(id, serviceDay));

  if (out.kind === 'no-env') {
    return failure(500, {
      failure: '#11', title: 'Route line unavailable', hop: ['/api/geometry', 'VPS'],
      detail: out.detail, retry: true,
    });
  }
  if (out.kind === 'timeout' || out.kind === 'network') {
    return failure(out.kind === 'timeout' ? 504 : 502, {
      failure: '#11', title: 'Route line unavailable',
      hop: out.kind === 'timeout' ? ['VPS', 'MÁV'] : ['/api/geometry', 'VPS'],
      detail: out.detail, retry: true,
    });
  }

  const { res } = out;
  if (!res.ok) {
    return failure(res.status, {
      failure: '#11', title: 'Route line unavailable', hop: ['VPS', 'MÁV'],
      upstreamStatus: res.status, detail: `${res.status} on trip geometry`, retry: true,
    });
  }

  const json = await res.json().catch(() => null) as
    { data?: { trip?: { geometry?: [number, number][] | null } | null };
      errors?: { message?: string }[] } | null;

  if (!json || json.errors?.length) {
    return failure(502, {
      failure: '#11', title: 'Route line unavailable', hop: ['/api/geometry', 'MÁV'],
      upstreamStatus: 200,
      detail: json?.errors?.[0]?.message ?? 'geometry response could not be read',
      retry: true,
    });
  }

  const geometry = json.data?.trip?.geometry;
  // The pairs arrive as [lon, lat], GeoJSON order and the reverse of Leaflet's
  // [lat, lng]. Swapped ONCE, here at the edge of the fetch, and never again.
  const line = Array.isArray(geometry)
    ? geometry.map(([lon, lat]) => [lat, lon] as [number, number])
    : [];

  return NextResponse.json({ id, line }, {
    headers: { 'Cache-Control': 'public, s-maxage=86400' },
  });
}
