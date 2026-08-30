import type { RawVehicle, RawStopTime } from './schema';
import type {
  Alert, InfoService, NormalisedStop, NormalisedTrip, TimelineRow,
} from './types';
import { absolute, normaliseHeading } from './time';
import { typeColor } from './delay';

/* ============================================================================
   The normaliser (SPEC.md 7.1 to 7.3). Everything visible later is a renderer over
   its output, and all of it runs server-side, once per upstream fetch.

     1. group rows by canonical trip id
     2. classify each group and drop the ones that are not on the map   (retention)
     3. within a group the active leg is the one with a non-null stopRelationship
     4. resolve any vehicleId collisions that survive                   (three rules)

   `vehicleId` is NOT unique within one response and is reused across unrelated
   trains; `trip.id` is unique on every row. So identity is the canonical trip id.
   ============================================================================ */

const RETAIN_AFTER = 10 * 60;   // arrived trains stay on the map for 10 minutes
const PRE_DEPARTURE = 30 * 60;  // the feed reports trains hours before they run

/** trip.id is base64. Decode it and cut at the '.': "Trip:1:34133410". */
export const canonicalTripId = (id: string) =>
  Buffer.from(id, 'base64').toString('utf8').split('.')[0];

/** The decoded id with "Trip:" stripped, the '.' suffix KEPT. This is what the geometry
 *  query takes, and each leg only ever addresses its own piece of the shape (SPEC 1). */
const geometryId = (id: string) =>
  Buffer.from(id, 'base64').toString('utf8').replace(/^Trip:/, '');

/* ---- value sets are validated leniently, with one warning each (SPEC 1) ---- */
const warned = new Set<string>();
const warnOnce = (key: string, message: string) => {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
};

const platformColour = (v: string | null | undefined): 'green' | 'black' | 'red' => {
  if (v === 'green' || v === 'black' || v === 'red') return v;
  if (v) warnOnce(`pc:${v}`, `[normalise] unrecognised platformColor "${v}", rendering neutral`);
  return 'black';
};

const isRealtimeState = (v: string | null | undefined) => {
  if (v === 'MODIFIED' || v === 'UPDATED') return true;
  if (v === 'SCHEDULED' || v == null) return false;
  warnOnce(`rs:${v}`, `[normalise] unrecognised realtimeState "${v}", treating as SCHEDULED`);
  return false;
};

/** "19797 KEK HULLAM InterCity" = number + optional name + category. Leading digits are
 *  the number; the trailing trainCategoryName is stripped; the remainder is the name and
 *  is empty more often than not (7.3). */
export function parseShortName(shortName: string, category: string) {
  const sn = shortName.trim();
  const cat = (category ?? '').trim();
  const number = sn.match(/^\d+/)?.[0] ?? '';
  const name = cat && sn.endsWith(cat)
    ? sn.slice(number.length, sn.length - cat.length).trim()
    : sn.slice(number.length).trim();
  return { number, name };
}

/* ---- stoptimes ----------------------------------------------------------- */

function normaliseStop(st: RawStopTime): NormalisedStop {
  const day = st.serviceDay;
  const realtime = isRealtimeState(st.realtimeState);
  return {
    position: st.stopPosition,
    name: st.stop?.name ?? '',
    lat: st.stop?.lat ?? null,
    lon: st.stop?.lon ?? null,
    arrival: absolute(day, realtime ? st.realtimeArrival ?? st.scheduledArrival : st.scheduledArrival),
    departure: absolute(day, realtime ? st.realtimeDeparture ?? st.scheduledDeparture : st.scheduledDeparture),
    scheduledArrival: absolute(day, st.scheduledArrival),
    scheduledDeparture: absolute(day, st.scheduledDeparture),
    // null, not 0, on a SCHEDULED stop: the upstream 0 means *no data* and is the single
    // easiest mistake in this feed (7.2). It does not survive normalisation.
    arrivalDelay: realtime ? st.arrivalDelay ?? null : null,
    departureDelay: realtime ? st.departureDelay ?? null : null,
    isRealtime: realtime,
    platformCode: st.stop?.platformCode ?? null,
    platformColor: platformColour(st.platformColor),
    progress: 'future',
  };
}

/* ---- one canonical id's rows: the leg merge (7.1) ------------------------ */

type Leg = { row: RawVehicle; stops: NormalisedStop[]; firstPosition: number };

type Merged = {
  canonicalId: string;
  legs: Leg[];
  active: RawVehicle | null;       // the leg with a non-null stopRelationship
  head: RawVehicle;                // any leg: legs agree on route, tripShortName, alerts
  stops: NormalisedStop[];         // every leg concatenated in stopPosition order
  gaps: { afterIndex: number; from: string; to: string; seconds: number }[];
  geometryIds: string[];
  vehicleId: string;
};

function mergeLegs(canonicalId: string, rows: RawVehicle[]): Merged {
  const legs: Leg[] = rows
    .map((row) => {
      const stops = [...row.trip.stoptimes]
        .sort((a, b) => a.stopPosition - b.stopPosition)
        .map(normaliseStop);
      return { row, stops, firstPosition: stops[0].position };
    })
    .sort((a, b) => a.firstPosition - b.firstPosition);

  // Leg position spans never overlap, so concatenating in stopPosition order is safe.
  const stops: NormalisedStop[] = [];
  const gaps: Merged['gaps'] = [];
  legs.forEach((leg, i) => {
    if (i > 0) {
      const last = stops[stops.length - 1];
      const next = leg.stops[0];
      // The gap's duration is last arrival to next departure, the time with no rail
      // service, not departure to arrival (7.1).
      const from = last.arrival ?? last.departure;
      const to = next.departure ?? next.arrival;
      gaps.push({
        afterIndex: stops.length - 1,
        from: last.name,
        to: next.name,
        seconds: from != null && to != null ? Math.max(0, to - from) : 0,
      });
    }
    stops.push(...leg.stops);
  });

  const active = legs.find((l) => l.row.stopRelationship?.status)?.row ?? null;
  return {
    canonicalId,
    legs,
    active,
    head: active ?? legs[0].row,
    stops,
    gaps,
    geometryIds: legs.map((l) => geometryId(l.row.trip.id)),
    vehicleId: (active ?? legs[0].row).vehicleId ?? '',
  };
}

/* ---- retention (7.1) ----------------------------------------------------- */

type Retention = { keep: boolean; arrived: boolean };

function retention(m: Merged, now: number): Retention {
  const first = m.stops[0];
  const final = m.stops[m.stops.length - 1];
  const firstDeparture = first.scheduledDeparture ?? first.scheduledArrival;
  const finalArrival = final.arrival ?? final.scheduledArrival;
  const finalScheduled = final.scheduledArrival ?? final.scheduledDeparture;

  // (a) MAV is still tracking it, and it departs within the next 30 min or has departed.
  const a = m.active != null && firstDeparture != null && firstDeparture <= now + PRE_DEPARTURE;
  // (b) the final stoptime is realtime-backed and we are inside its 10 minute window.
  const b = final.isRealtime && finalArrival != null && now <= finalArrival + RETAIN_AFTER;
  // (c) the timetable says it finished, within the same 10 minutes. The LOWER bound is
  //     the important half: without it every unfinished trip qualifies.
  const c = finalScheduled != null && finalScheduled <= now && now <= finalScheduled + RETAIN_AFTER;

  // A trip counts as arrived only under (b). Under (c) the end time is a timetable value,
  // so the trip is retained but its arrival is not asserted (10 #13c).
  const arrived = b && m.active == null && finalArrival != null && now >= finalArrival;
  return { keep: a || b || c, arrived };
}

/* ---- alerts and info services (7.3) -------------------------------------- */

function unionAlerts(legs: Leg[], now: number): Alert[] {
  const seen = new Set<string>();
  const out: Alert[] = [];
  for (const leg of legs) {
    for (const a of leg.row.trip.alerts ?? []) {
      const start = a.effectiveStartDate ?? 0;
      const end = a.effectiveEndDate ?? 0;
      // Only those currently in effect. Expired alerts are present on most polls.
      if (start && start > now) continue;
      if (end && end < now) continue;
      const description = a.alertDescriptionText ?? '';
      if (!description) continue;
      const key = `${description}|${start}|${end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        description,
        severity: a.alertSeverityLevel ?? '',
        effect: a.alertEffect ?? '',
        cause: a.alertCause ?? '',
        start, end,
      });
    }
  }
  return out;
}

function unionInfoServices(legs: Leg[]): InfoService[] {
  // One row per name + fontCode, carrying every distinct stop range it was filed under.
  // Nothing else is ever merged: differing name or fontCode means two rows, whatever the
  // ranges. The collapsed row sorts on the LOWEST order of its filings, since a merged
  // trip's legs need not agree (7.3).
  const byKey = new Map<string, InfoService>();
  for (const leg of legs) {
    for (const s of leg.row.trip.infoServices ?? []) {
      if (s.displayable === false) continue;      // render only displayable: true
      const name = s.name ?? '';
      const fontCode = s.fontCode ?? 0;
      if (!name) continue;
      const key = `${name} ${fontCode}`;
      const from = s.fromStop?.name ?? '';
      const till = s.tillStop?.name ?? '';
      const order = s.order ?? 0;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { name, fontCode, order, ranges: [{ from, till }] });
      } else {
        existing.order = Math.min(existing.order, order);
        if (!existing.ranges.some((r) => r.from === from && r.till === till)) {
          existing.ranges.push({ from, till });
        }
      }
    }
  }
  return [...byKey.values()].sort((a, b) => a.order - b.order);
}

/* ---- delay resolution (7.2) ---------------------------------------------- */

type Resolved = { delay: number | null; measuredAt: string | null };

/** Carry the last realtime-backed stop's delay forward, labelled with where it was
 *  measured. Its departureDelay if the train has left that stop, its arrivalDelay if it
 *  is still standing there. Never compute a foreign arrival time from it. */
function carryForward(stops: NormalisedStop[], standingAt: number | null): Resolved {
  for (let i = stops.length - 1; i >= 0; i--) {
    const s = stops[i];
    if (!s.isRealtime) continue;
    const left = standingAt == null || standingAt !== i;
    const delay = left ? s.departureDelay ?? s.arrivalDelay : s.arrivalDelay;
    if (delay == null) continue;
    return { delay, measuredAt: s.name };
  }
  return { delay: null, measuredAt: null };
}

function resolveDelay(
  stops: NormalisedStop[],
  status: NormalisedTrip['status'],
  currentIndex: number | null,
): Resolved {
  if (status === 'IN_TRANSIT_TO' || status === 'STOPPED_AT') {
    const standingAt = status === 'STOPPED_AT' ? currentIndex : null;
    const next = currentIndex != null ? stops[currentIndex] : undefined;
    // STOPPED_AT reads that stop's arrivalDelay, how late it arrived, which is what the
    // platform display says right now. Not its departureDelay, not the following stop's.
    if (next?.isRealtime && next.arrivalDelay != null) {
      return { delay: next.arrivalDelay, measuredAt: null };
    }
    return carryForward(stops, standingAt);
  }
  if (status === 'ARRIVED') {
    const final = stops[stops.length - 1];
    if (final.isRealtime && final.arrivalDelay != null) {
      return { delay: final.arrivalDelay, measuredAt: null };
    }
    return carryForward(stops, null);
  }
  // Clause (c) and everything else: never the final stop's arrivalDelay, the 0 that
  // means no data.
  return carryForward(stops, null);
}

/* ---- the timeline rows (6, 7.0) ------------------------------------------ */

function buildRows(
  stops: NormalisedStop[],
  gaps: Merged['gaps'],
  transitBefore: number | null,
  speed: number | null,
  fork: Extract<TimelineRow, { kind: 'fork' }> | null,
): TimelineRow[] {
  const gapAfter = new Map(gaps.map((g) => [g.afterIndex, g]));
  const rows: TimelineRow[] = [];
  stops.forEach((_, i) => {
    if (transitBefore === i && i > 0) rows.push({ kind: 'transit', afterIndex: i - 1, speed });
    rows.push({ kind: 'stop', index: i });
    const gap = gapAfter.get(i);
    if (gap) rows.push({ kind: 'gap', from: gap.from, to: gap.to, seconds: gap.seconds });
  });
  if (fork) rows.push(fork);
  return rows;
}

/* ---- one merged group -> one trip ---------------------------------------- */

function toTrip(m: Merged, now: number, arrived: boolean): NormalisedTrip {
  const row = m.head;
  const trip = row.trip;
  const category = trip.trainCategoryName ?? '';
  const { number, name } = parseShortName(trip.tripShortName, category);
  const stops = m.stops;

  const relStatus = m.active?.stopRelationship?.status ?? null;
  const relName = m.active?.stopRelationship?.stop?.name ?? null;
  // stopRelationship.stop.name matches exactly one stoptime on every row of every capture,
  // with no trip calling twice at the same station, so matching by name is safe (7.3).
  const found = relName != null ? stops.findIndex((s) => s.name === relName) : -1;
  const currentIndex = found < 0 ? null : found;

  const status: NormalisedTrip['status'] =
    relStatus === 'IN_TRANSIT_TO' ? 'IN_TRANSIT_TO'
    : relStatus === 'STOPPED_AT' ? 'STOPPED_AT'
    : arrived ? 'ARRIVED'
    : 'NOT_RUNNING';

  // progress: the map's route-line dots and the timeline read the same three states.
  stops.forEach((s, i) => {
    if (status === 'ARRIVED') { s.progress = 'past'; return; }
    if (currentIndex != null) {
      s.progress = i < currentIndex ? 'past'
        : i === currentIndex ? (status === 'STOPPED_AT' ? 'now' : 'future')
        : 'future';
      return;
    }
    const t = s.departure ?? s.arrival;
    s.progress = t != null && t <= now ? 'past' : 'future';
  });

  const { delay, measuredAt } = resolveDelay(stops, status, currentIndex);
  const active = m.active ?? row;

  // #13b needs to tell a train inside a multi-leg gap from one that simply vanished.
  let inLegGap: NormalisedTrip['inLegGap'] = null;
  if (m.active == null && m.gaps.length) {
    for (const g of m.gaps) {
      const last = stops[g.afterIndex];
      const next = stops[g.afterIndex + 1];
      const from = last?.arrival ?? last?.scheduledArrival;
      const to = next?.departure ?? next?.scheduledDeparture;
      if (from != null && to != null && now >= from && now <= to) {
        inLegGap = { from: g.from, to: g.to, resumesAt: to };
      }
    }
  }

  return {
    id: m.canonicalId,
    geometryIds: m.geometryIds,
    serviceDay: trip.stoptimes[0].serviceDay,
    number,
    name,
    category,
    origin: stops[0]?.name ?? '',
    // the LAST leg's last stop, derived once. Never tripHeadsign, which flips mid-journey
    // on a merged trip (7.1).
    destination: stops[stops.length - 1]?.name ?? '',
    agencyName: trip.route?.agency?.name ?? '',
    routeId: trip.route?.id ?? '',
    routeLongName: trip.route?.longName ?? '',
    headsign: trip.tripHeadsign ?? '',
    typeColor: typeColor(trip.route?.textColor),
    fontCode: trip.route?.fontCode ?? 0,
    otherNumbers: [],
    lat: active.lat,
    lon: active.lon,
    heading: normaliseHeading(active.heading),
    speed: active.speed ?? null,
    isEstimated: active.isEstimated === true,
    lastUpdated: active.lastUpdated ?? 0,
    status,
    nextStop: relName,
    delay,
    delayMeasuredAt: measuredAt,
    inLegGap,
    stoptimes: stops,
    rows: buildRows(stops, m.gaps, status === 'IN_TRANSIT_TO' ? currentIndex : null,
                    active.speed ?? null, null),
    alerts: unionAlerts(m.legs, now),
    infoServices: unionInfoServices(m.legs),
  };
}

/* ---- vehicleId collisions that survive the merge (7.1) ------------------- */

const positionKey = (t: NormalisedTrip) => `${t.lat.toFixed(5)},${t.lon.toFixed(5)}`;

/** The primary portion is the lowest train number, which MAV itself treats as primary;
 *  on a tie, the most realtime-backed stops, then the lowest canonical trip id. */
function pickPrimary(portions: NormalisedTrip[]) {
  return [...portions].sort((a, b) => {
    const na = parseInt(a.number, 10), nb = parseInt(b.number, 10);
    const fa = Number.isFinite(na) ? na : Infinity;
    const fb = Number.isFinite(nb) ? nb : Infinity;
    if (fa !== fb) return fa - fb;
    const ra = a.stoptimes.filter((s) => s.isRealtime).length;
    const rb = b.stoptimes.filter((s) => s.isRealtime).length;
    if (ra !== rb) return rb - ra;
    return a.id.localeCompare(b.id);
  })[0];
}

/** Each portion is a COMPLETE journey from the origin, not a tail, so the shared prefix
 *  arrives once per portion and naive concatenation renders the origin N times. The merge
 *  is therefore a deduplication: the leading run every portion agrees on, compared on stop
 *  name and stopPosition, taken from the primary and stored once. Everything after it is a
 *  tail belonging to the fork row. */
function mergePortions(portions: NormalisedTrip[]): NormalisedTrip {
  const primary = pickPrimary(portions);
  const others = portions.filter((p) => p !== primary);

  let prefixLength = primary.stoptimes.length;
  for (const p of others) {
    let i = 0;
    while (i < prefixLength && i < p.stoptimes.length
           && p.stoptimes[i].name === primary.stoptimes[i].name
           && p.stoptimes[i].position === primary.stoptimes[i].position) i++;
    prefixLength = Math.min(prefixLength, i);
  }

  const prefix = primary.stoptimes.slice(0, prefixLength);
  const tails = [primary, ...others].map((p) => ({
    destination: p.stoptimes.length > prefixLength
      ? p.stoptimes[p.stoptimes.length - 1].name
      : prefix[prefix.length - 1]?.name ?? '',
    number: p.number,
    // A portion terminating at the fork has no tail and is labelled as ending there
    // rather than given an empty stack entry.
    stoptimes: p.stoptimes.slice(prefixLength),
  }));

  const fork: Extract<TimelineRow, { kind: 'fork' }> | null =
    tails.some((t) => t.stoptimes.length) ? { kind: 'fork', tails } : null;

  const nextName = primary.nextStop;
  const forkIndex = primary.status === 'IN_TRANSIT_TO' && nextName
    ? prefix.findIndex((s) => s.name === nextName)
    : -1;

  return {
    ...primary,
    // The timeline is always the shared prefix plus every tail, regardless of which
    // portion is primary. Primary selection governs only the header, the alerts and the
    // info services.
    stoptimes: prefix,
    rows: buildRows(prefix, [], forkIndex < 0 ? null : forkIndex, primary.speed, fork),
    // one fetch per portion, primary first: the primary's line stops at the fork, so
    // fetching it alone leaves every tail undrawn (SPEC 1)
    geometryIds: [primary, ...others].flatMap((p) => p.geometryIds),
    otherNumbers: others.map((p) => p.number).filter(Boolean),
  };
}

function resolveCollisions(
  trips: NormalisedTrip[],
  byVehicle: Map<string, string[]>,
): NormalisedTrip[] {
  const byId = new Map(trips.map((t) => [t.id, t]));
  const out: NormalisedTrip[] = [];
  const consumed = new Set<string>();

  for (const [vehicleId, ids] of byVehicle) {
    const group = ids.map((id) => byId.get(id)).filter((t): t is NormalisedTrip => !!t);
    if (group.length < 2) continue;

    // Two fields decide all of it: route.id and position. Neither suffices alone.
    const clusters = new Map<string, NormalisedTrip[]>();
    for (const t of group) {
      const key = positionKey(t);
      const list = clusters.get(key);
      if (list) list.push(t); else clusters.set(key, [t]);
    }
    if (clusters.size > 1) {
      // Different positions: not a collision. Render both.
      console.warn(`[normalise] vehicleId ${vehicleId} carries ${group.length} trains at `
        + `${clusters.size} positions, rendering each`);
    }

    for (const cluster of clusters.values()) {
      if (cluster.length < 2) continue;
      const routes = new Set(cluster.map((t) => t.routeId));
      if (routes.size === 1) {
        // Same route.id, identical position, divergent tails: one train that splits en
        // route. Merge to one marker. ANY number of portions, not just two.
        console.warn(`[normalise] vehicleId ${vehicleId}: portion split, merging `
          + cluster.map((t) => t.number).join('/'));
        cluster.forEach((t) => consumed.add(t.id));
        out.push(mergePortions(cluster));
      } else {
        // Different route.id, identical stop list, identical position: a combined
        // InterCity and Expresszvonat working. Keep the InterCity row and drop the other:
        // richer info services, and the record vagonweb holds the composition under.
        // A normal MAV working, so no warning.
        const keep = cluster.find((t) => t.category === 'InterCity') ?? cluster[0];
        cluster.forEach((t) => { if (t !== keep) consumed.add(t.id); });
      }
    }
  }

  for (const t of trips) if (!consumed.has(t.id)) out.push(t);
  return out;
}

/* ---- the whole pipeline -------------------------------------------------- */

export function normalise(rows: RawVehicle[], now: number): NormalisedTrip[] {
  // 1. group rows by canonical trip id
  const groups = new Map<string, RawVehicle[]>();
  for (const row of rows) {
    const id = canonicalTripId(row.trip.id);
    const list = groups.get(id);
    if (list) list.push(row); else groups.set(id, [row]);
  }

  // 2 + 3. merge each group's legs, then keep the ones that are on the map
  const trips: NormalisedTrip[] = [];
  const byVehicle = new Map<string, string[]>();
  for (const [id, rowsForId] of groups) {
    const merged = mergeLegs(id, rowsForId);
    const { keep, arrived } = retention(merged, now);
    if (!keep) continue;
    trips.push(toTrip(merged, now, arrived));
    if (merged.vehicleId) {
      const list = byVehicle.get(merged.vehicleId);
      if (list) list.push(id); else byVehicle.set(merged.vehicleId, [id]);
    }
  }

  // 4. resolve any vehicleId collisions that survive the merge
  return resolveCollisions(trips, byVehicle);
}
