import { NextResponse } from 'next/server';

/** The MÁV side of the app. Both queries are in api.md verbatim; both go through the
 *  VPS, which needs a Hungarian IP and does nothing else, so it is one hop. */

export const UPSTREAM_TIMEOUT_MS = 10_000;

/** The bounding box is FIXED around Hungary and does not follow the viewport (SPEC 1).
 *  `trip.geometry` is deliberately not here: it takes the response from 1.8 MB to 6 MB
 *  every 30 s to carry a line for the one train that might be selected. */
export const VEHICLES_QUERY = `query VehiclePositions {
  vehiclePositions(swLat: 45.50, swLon: 15.50, neLat: 49.00, neLon: 23.50, modes: [RAIL]) {
    vehicleId
    isEstimated
    lat
    lon
    speed
    heading
    lastUpdated
    trip {
      id
      tripHeadsign
      tripShortName
      stoptimes {
        stopPosition
        scheduledArrival
        realtimeArrival
        arrivalDelay
        scheduledDeparture
        realtimeDeparture
        departureDelay
        realtimeState
        platformColor
        serviceDay
        stop { name timezone platformCode lat lon }
      }
      alerts {
        feed alertHeaderText alertDescriptionText alertUrl
        alertEffect alertCause alertSeverityLevel
        effectiveStartDate effectiveEndDate
      }
      infoServices {
        name fontCode displayable order
        fromStop { name id }
        tillStop { name id }
        fontCharSet
      }
      trainCategoryName
      route { id longName fontCharSet fontCode textColor agency { id name } }
    }
    stopRelationship { status stop { name } }
  }
}`;

/** Two arguments, and neither is the raw trip.id: the id is decoded and "Trip:"-stripped
 *  (the '.' suffix kept or cut depending on what is being asked for, SPEC 1), and
 *  serviceDay is YYYY-MM-DD in Europe/Budapest from the trip's own value. */
export const geometryQuery = (id: string, serviceDay: string) =>
  `query { trip(id: ${JSON.stringify(id)}, serviceDay: ${JSON.stringify(serviceDay)}) { geometry } }`;

/** The shape the client turns into a FeedError (SPEC 10). The route handler names the
 *  hop, the status and the raw error; it never says "Something went wrong". */
export type ApiFailure = {
  failure: string;                    // "#3", the row in SPEC 10's table
  title: string;
  hop: [string, string];
  upstreamStatus?: number;            // what the upstream actually answered
  detail: string;
  retry: boolean;                     // false for a GraphQL errors[] or a 403
};

export const failure = (status: number, body: ApiFailure) => {
  // Every failure also emits one console.error carrying the full body: the toast is a
  // summary, the console is the record.
  console.error(`[upstream] ${body.failure} ${body.title}`, body);
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
};

type UpstreamResult =
  | { kind: 'no-env'; detail: string }
  | { kind: 'timeout'; detail: string; elapsed: number }
  | { kind: 'network'; detail: string; elapsed: number }
  | { kind: 'response'; res: Response; elapsed: number };

/** POST the query through the VPS with the 10 s timeout SPEC 10 #4's 504 is raised from.
 *
 *  The proxy takes one JSON body, `{ url, headers, query }`: it POSTs `{query}` to `url`
 *  with `headers` attached and hands the answer back unchanged, so GRAPHQL_ENDPOINT is
 *  data in the request rather than part of the address. `headers` is what MÁV sees; the
 *  two CF-Access-Client-* headers are ours to the proxy, which sits behind Cloudflare
 *  Access, and must not be forwarded on. All four vars are required: without any one of
 *  them the request cannot be made, so it fails as #2 rather than silently degrading. */
export async function postUpstream(query: string): Promise<UpstreamResult> {
  const proxy = process.env.PROXY_ENDPOINT;
  const endpoint = process.env.GRAPHQL_ENDPOINT;
  const cfId = process.env.CF_ACCESS_CLIENT_ID;
  const cfSecret = process.env.CF_ACCESS_CLIENT_SECRET;
  const missing = (
    [
      ['PROXY_ENDPOINT', proxy],
      ['GRAPHQL_ENDPOINT', endpoint],
      ['CF_ACCESS_CLIENT_ID', cfId],
      ['CF_ACCESS_CLIENT_SECRET', cfSecret],
    ] as const
  )
    .filter(([, v]) => !v)
    .map(([name]) => name);
  if (missing.length) {
    return {
      kind: 'no-env' as const,
      detail: `Error: Missing ${missing.join(', ')}`,
    };
  }
  const started = Date.now();
  try {
    const res = await fetch(proxy!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'vonatinfo/1.0',
        'CF-Access-Client-Id': cfId!,
        'CF-Access-Client-Secret': cfSecret!,
      },
      body: JSON.stringify({
        url: endpoint,
        headers: { 'User-Agent': 'vonatinfo/1.0' },
        query,
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      cache: 'no-store',
    });
    return { kind: 'response' as const, res, elapsed: Date.now() - started };
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    const code = err.cause?.code ?? err.name;
    return {
      kind: err.name === 'TimeoutError' || err.name === 'AbortError' ? ('timeout' as const)
        : ('network' as const),
      detail: err.name === 'TimeoutError' || err.name === 'AbortError'
        ? `aborted after ${elapsed(started)}`
        : `${code}${err.message ? ' ' + err.message : ''}`,
      elapsed: Date.now() - started,
    };
  }
}

/** Relative and elapsed values are m:ss everywhere (CLAUDE.md). */
const elapsed = (startedMs: number) => {
  const s = Math.round((Date.now() - startedMs) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
