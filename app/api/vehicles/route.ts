import { NextResponse } from 'next/server';
import { validateRows } from '@/lib/schema';
import { normalise } from '@/lib/normalise';
import { failure, postUpstream, VEHICLES_QUERY } from '@/lib/upstream';
import type { VehiclesResponse } from '@/lib/types';

/**
 * browser --30 s poll--> here --> VPS proxy (pass-through) --> MÁV GraphQL
 *
 * The response is normalised server-side (SPEC 7.1), so the 30 s CDN cache pays for the
 * merge, the deduplication and the classification once per upstream fetch and no tab
 * repeats the work. `s-maxage=30, stale-while-revalidate=30` holds upstream at about two
 * requests a minute regardless of how many tabs are open; the worst-case data age of
 * ~60 s is deliberate and loses nothing on minute-resolution data.
 *
 * Not `use cache`: it needs cacheComponents (which changes dynamic-IO rules
 * project-wide) and its default cache is per instance, so it does not buy the shared
 * guarantee it looks like it buys.
 */
export async function GET() {
  const out = await postUpstream(VEHICLES_QUERY);

  if (out.kind === 'no-env') {
    return failure(500, {
      failure: '#2', title: 'Data is not updating', hop: ['/api/vehicles', 'VPS'],
      detail: out.detail, retry: true,
    });
  }
  if (out.kind === 'timeout') {
    return failure(504, {
      failure: '#4', title: 'Data is not updating', hop: ['VPS', 'MÁV'],
      detail: out.detail, retry: true,
    });
  }
  if (out.kind === 'network') {
    return failure(502, {
      failure: '#3', title: 'Data is not updating', hop: ['/api/vehicles', 'VPS'],
      detail: out.detail, retry: true,
    });
  }

  const { res } = out;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return failure(res.status, {
      failure: '#5', title: 'Data is not updating', hop: ['VPS', 'MÁV'],
      upstreamStatus: res.status,
      detail: `upstream returned ${body.length} bytes`,
      // Retrying a rejected query just burns requests.
      retry: res.status !== 403,
    });
  }

  let json: { data?: { vehiclePositions?: unknown }; errors?: { message?: string }[] };
  try {
    json = await res.json();
  } catch (e) {
    return failure(502, {
      failure: '#7', title: 'Response could not be read', hop: ['/api/vehicles', 'MÁV'],
      upstreamStatus: 200, detail: `not JSON: ${(e as Error).message}`, retry: true,
    });
  }

  if (json.errors?.length) {
    // Usually schema drift. Never retried: show it and stop until a manual retry.
    return failure(502, {
      failure: '#6', title: 'Query rejected by the API', hop: ['/api/vehicles', 'MÁV'],
      upstreamStatus: 200,
      detail: json.errors.map((e) => e.message ?? '').filter(Boolean).join('\n'),
      retry: false,
    });
  }

  const rows = json.data?.vehiclePositions;
  if (!Array.isArray(rows)) {
    return failure(502, {
      failure: '#7', title: 'Response could not be read', hop: ['/api/vehicles', 'MÁV'],
      upstreamStatus: 200, detail: 'data.vehiclePositions was null', retry: true,
    });
  }

  const fetchedAt = Math.floor(Date.now() / 1000);
  const { ok, dropped } = validateRows(rows);
  const body: VehiclesResponse = {
    trains: normalise(ok, fetchedAt),
    meta: { total: rows.length, dropped, fetchedAt },
  };

  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=30' },
  });
}
