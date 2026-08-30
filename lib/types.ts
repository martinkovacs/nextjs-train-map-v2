/** The contract between the route handler and everything that renders (SPEC.md §7.0).
 *  §7.1 and §7.2 are how it is computed; this is what comes out. Every consumer reads
 *  these fields and never the raw upstream row — that is what keeps the resolution
 *  rules in one place. */

/** What `/api/vehicles` returns. The envelope is not decoration: §10 #7a cannot be
 *  built without `dropped`, and `fetchedAt` is what separates data age from poll age
 *  across the 60 s cache window (§1). */
export type VehiclesResponse = {
  trains: NormalisedTrip[];
  meta: {
    total: number;      // rows the upstream returned, before validation
    dropped: number;    // rows Zod rejected — "12 of 431 rows failed validation"
    fetchedAt: number;  // the handler's own clock at the upstream fetch, unix seconds
  };
};

export type NormalisedTrip = {
  id: string;              // canonical trip id, "Trip:1:33315406"
  geometryIds: string[];   // every id the route line must be fetched under, "Trip:" stripped,
                           // in draw order. One per ordinary trip; one per leg on a merged
                           // trip (suffixes KEPT); one per portion on a portioned train,
                           // primary first (§1)
  serviceDay: number;      // stoptimes[0].serviceDay, unix seconds (§7.3)

  number: string;          // leading digits of tripShortName, the URL key (§8)
  name: string;            // the middle of tripShortName, "" more often than not
  category: string;        // trainCategoryName, verbatim — the vagonweb key needs it
  origin: string;          // first leg's first stop
  destination: string;     // LAST leg's last stop, never tripHeadsign (§7.1)
  agencyName: string;      // route.agency.name, the vagonweb key's other input
  routeId: string;
  routeLongName: string;   // SEARCH INDEX ONLY (§4). Never rendered
  headsign: string;        // SEARCH INDEX ONLY. Never a destination (§7.1)
  typeColor: string;       // "#274F96", already prefixed (§2)
  fontCode: number;        // route pictogram
  otherNumbers: string[];  // a portioned train's non-primary numbers (§8)

  lat: number; lon: number;
  heading: number;         // already normalised to 0…360 (§9)
  speed: number | null;    // m/s, null on the estimated batch — convert at render (§9)
  isEstimated: boolean;    // absent upstream is false (§1)
  lastUpdated: number;

  status: 'IN_TRANSIT_TO' | 'STOPPED_AT' | 'ARRIVED' | 'NOT_RUNNING';
  nextStop: string | null;
  delay: number | null;            // the RESOLVED delay in seconds (§7.2)
  delayMeasuredAt: string | null;  // stop name when the delay is carried forward, else null

  /** True when the trip is multi-leg and now falls inside a leg gap, with no leg
   *  tracking. §10 #13b needs to tell this from a train that simply vanished. */
  inLegGap: { from: string; to: string; resumesAt: number | null } | null;

  stoptimes: NormalisedStop[];
  rows: TimelineRow[];
  alerts: Alert[];
  infoServices: InfoService[];
};

export type NormalisedStop = {
  position: number;
  name: string;
  lat: number | null; lon: number | null;   // absent on the three older fixtures (§1)
  arrival: number | null; departure: number | null;        // absolute unix seconds
  scheduledArrival: number | null; scheduledDeparture: number | null;
  arrivalDelay: number | null;    // null when the stop is SCHEDULED, so it can never be
                                  // mistaken for an on-time 0 (§7.2)
  departureDelay: number | null;  // same rule; the carry-forward reads it (§7.2)
  isRealtime: boolean;            // realtimeState is MODIFIED or UPDATED
  platformCode: string | null;
  platformColor: 'green' | 'black' | 'red';
  progress: 'past' | 'now' | 'future';
};

export type Alert = {
  description: string;    // alertDescriptionText. The only field rendered
  severity: string;
  effect: string; cause: string;         // kept for the console, not rendered
  start: number; end: number;            // unix seconds, already filtered against now
};

export type InfoService = {
  name: string;
  fontCode: number;
  order: number;          // the LOWEST order of the filings collapsed into this row (§7.3)
  ranges: { from: string; till: string }[];
};

export type TimelineRow =
  | { kind: 'stop'; index: number }           // index INTO the stoptimes array, never
                                              // stopPosition, which is not unique across
                                              // a portioned trip (§7.1)
  | { kind: 'transit'; afterIndex: number; speed: number | null }
  | { kind: 'gap'; from: string; to: string; seconds: number }
  | { kind: 'fork'; tails: { destination: string; number: string;
                             stoptimes: NormalisedStop[] }[] };

/** Every failure becomes one shape and one component renders all of them, so adding a
 *  failure mode means adding a mapping, not a UI (§10). */
export type FeedError = {
  id: string;           // the failure number, "#8", so conditions dedupe by kind
  severity: 'error' | 'warning' | 'info';
  title: string;        // "Data is not updating"
  hop: [from: string, to: string] | null;   // rendered with the arrow SVG between the two
  status?: number;
  detail: string;       // may carry \n; each line stays under 50 characters
  attempt: number;
  nextRetryAt: number | null;   // null = not retried
  lastGoodAt: number | null;
  meta?: string;        // the third line, when it is not attempt/retry/last good
  icon?: string;        // sprite id; defaults to i-warn
  retry?: boolean;      // draw a Retry control
};
