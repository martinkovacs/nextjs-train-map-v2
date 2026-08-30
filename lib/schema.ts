import { z } from 'zod';

/** Validation runs in the route handler, on the raw response before normalisation
 *  (SPEC.md §1). The split is exact:
 *
 *  - STRICT only on what the app cannot work without: trip.id, lat, lon, heading,
 *    tripShortName, non-empty stoptimes. A row missing one has nothing to render.
 *  - Value sets are validated LENIENTLY. `platformColor` and `realtimeState` are typed
 *    as three values each in §7.0 because that is all four captures contain, but the
 *    schema takes any string and the normaliser falls back with one console.warn. A
 *    strict enum would let one new upstream value drop every stoptime and empty the map.
 *  - `isEstimated` and `stop.lat`/`lon` are OPTIONAL: they arrived with the 12 Aug
 *    capture and requiring them fails every row of the older three.
 *
 *  Invalid rows are dropped and counted; the count is §10 #7a. */

const num = z.number().nullish();
const str = z.string().nullish();

export const StopTimeSchema = z.object({
  stopPosition: z.number(),
  scheduledArrival: num,
  realtimeArrival: num,
  arrivalDelay: num,
  scheduledDeparture: num,
  realtimeDeparture: num,
  departureDelay: num,
  realtimeState: str,
  platformColor: str,
  serviceDay: z.number(),
  stop: z.object({
    name: str,
    timezone: str,
    platformCode: str,
    lat: num,
    lon: num,
  }).nullish(),
});

export const AlertSchema = z.object({
  feed: str,
  alertHeaderText: str,
  alertDescriptionText: str,
  alertUrl: str,
  alertEffect: str,
  alertCause: str,
  alertSeverityLevel: str,
  effectiveStartDate: num,
  effectiveEndDate: num,
});

export const InfoServiceSchema = z.object({
  name: str,
  fontCode: num,
  displayable: z.boolean().nullish(),
  order: num,
  fromStop: z.object({ name: str, id: str }).nullish(),
  tillStop: z.object({ name: str, id: str }).nullish(),
  fontCharSet: str,
});

export const VehicleSchema = z.object({
  vehicleId: str,
  isEstimated: z.boolean().optional().nullable(),
  lat: z.number(),
  lon: z.number(),
  speed: num,
  heading: z.number(),
  lastUpdated: num,
  trip: z.object({
    id: z.string().min(1),
    tripHeadsign: str,
    tripShortName: z.string().min(1),
    stoptimes: z.array(StopTimeSchema).min(1),
    alerts: z.array(AlertSchema).nullish(),
    infoServices: z.array(InfoServiceSchema).nullish(),
    trainCategoryName: str,
    route: z.object({
      id: str,
      longName: str,
      fontCharSet: str,
      fontCode: num,
      textColor: str,
      agency: z.object({ id: str, name: str }).nullish(),
    }).nullish(),
  }),
  stopRelationship: z.object({
    status: str,
    stop: z.object({ name: str }).nullish(),
  }).nullish(),
});

export type RawVehicle = z.infer<typeof VehicleSchema>;
export type RawStopTime = z.infer<typeof StopTimeSchema>;

/** Rows that fail are dropped and counted, never thrown. */
export function validateRows(rows: unknown[]): { ok: RawVehicle[]; dropped: number } {
  const ok: RawVehicle[] = [];
  let dropped = 0;
  for (const row of rows) {
    const r = VehicleSchema.safeParse(row);
    if (r.success) ok.push(r.data);
    else {
      dropped++;
      if (dropped <= 3) console.warn('[vehicles] row failed validation', r.error.issues[0]);
    }
  }
  return { ok, dropped };
}
