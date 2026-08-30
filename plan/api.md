# The upstream API

MÁV's OTP-style GraphQL endpoint. Reachable only from a Hungarian IP, so every call goes
`browser -> app/api/vehicles/route.ts -> VPS proxy (pass-through) -> MÁV`.

What the responses actually contain, field by field and with counts, is in
**`plan/findings.md`**. This file is the query and the contract.

Neither the MÁV endpoint nor the proxy's address is **in this repo**. Both come from env
vars in `.env.local`, gitignored and never committed: `GRAPHQL_ENDPOINT` and
`PROXY_ENDPOINT`, plus `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` for the
Cloudflare Access service token the proxy is behind. The route handler POSTs
`{ url: GRAPHQL_ENDPOINT, headers: { 'User-Agent': ... }, query }` to `PROXY_ENDPOINT`
with the two `CF-Access-Client-*` headers on its own request, and the proxy hands MÁV's
answer back unchanged. Full rules in `SPEC.md` §1.

---

## The list query

One query per poll, every 30 s, cached 30 s in the route handler. The bounding box is fixed
around Hungary and does not follow the viewport.

```graphql
query VehiclePositions {
    vehiclePositions(
        swLat: 45.50
        swLon: 15.50
        neLat: 49.00
        neLon: 23.50
        modes: [RAIL]
    ) {
        vehicleId
        isEstimated       # true = computed position, not a measured one. See SPEC.md §7.3
        lat
        lon
        speed
        heading
        lastUpdated
        trip {
            id
            tripHeadsign
            # geometry            <- deliberately NOT fetched here: 1.8 MB -> 6 MB. See below
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
                stop {
                    name
                    timezone
                    platformCode
                    lat            # station dots on the selected train's route line
                    lon            # see SPEC.md §3
                }
            }
            alerts {
                feed
                alertHeaderText
                alertDescriptionText
                alertUrl
                alertEffect
                alertCause
                alertSeverityLevel
                effectiveStartDate
                effectiveEndDate
            }
            infoServices {
                name
                fontCode
                displayable
                order
                fromStop { name id }
                tillStop { name id }
                fontCharSet
            }
            trainCategoryName
            route {
                id
                longName
                fontCharSet
                fontCode
                textColor
                agency {          # needed by the carriage composition, see plan/vagonweb.md
                    id
                    name
                }
            }
        }
        stopRelationship {
            status
            stop { name }
        }
    }
}
```

Returns roughly 300–400 trains at peak traffic for the whole country, each with its full stop
list: **about 1.8 MB of JSON** for 270 to 290 vehicles, very roughly 6 KB each. Compressed it
is far smaller — **~75 KB brotli, 4 % of minified** (`findings.md`), since the response is the
same keys and station names repeated thousands of times. Still, do not add fields casually:
the parse and normalise cost is paid on the uncompressed bytes.

The capture files in `plan/` are pretty-printed and run about 4.9 MB on disk. That is a
formatting artefact, not the response size. Measure against the minified length.

`label` was removed: it is returned as `""` or `null` on every row of every capture and
nothing reads it. Display text derives from `tripShortName` (`SPEC.md` §7.3).

`stop.lat` / `stop.lon` are **confirmed** as of `plan/data-2026-08-12.json`: populated on every
stoptime, foreign stations included, as ordinary floats.

```json
"stop": { "name": "Székesfehérvár", "timezone": "Europe/Budapest",
          "platformCode": "7", "lat": 47.183611, "lon": 18.424722 }
```

They put a dot at every calling point on the selected train's route line. They are **not** a
fallback for the line itself: when the geometry fetch fails the dots render and nothing
connects them (`SPEC.md` §3, §10 #11).

`isEstimated` is the other confirmed addition. It replaces the `speed: null` heuristic the
spec used to infer the estimated-position batch, and matches it exactly.

## The geometry query

`trip.geometry` is **confirmed** and is fetched separately when a train is selected, never in
the list query.

### Why it is not in the list query

Adding it takes the response from **1.8 MB to 6 MB**, a 233 % increase, on every poll, to carry
a route line for the one train that might be selected. That settles it: one small per-trip
query on selection instead.

### The query

```graphql
query {
  trip(id: "1:33315406", serviceDay: "2026-08-12") {
    geometry
  }
}
```

Two arguments, and **neither is the raw `trip.id`**:

- `id` is a **trip id with the `Trip:` prefix stripped**. Decode `trip.id` from base64 and
  drop `Trip:`. **Whether you also cut at the `.` depends on what you are asking for**, and
  this is the part that was guessed wrong until it was measured (`findings.md`, 18 Aug 2026):
  the canonical id, cut at the `.`, addresses only the **unsuffixed** leg of a multi-leg trip
  and returns that leg's shape alone. Each leg's **raw, suffixed** id resolves too and returns
  that leg exactly. So geometry is fetched **once per published row**, not once per trip:
  one call per leg on a merged trip, one per portion on a portioned train. The full rule,
  including how to trim the trunk two portions share, is `SPEC.md` §1.
- `serviceDay` is `YYYY-MM-DD` in `Europe/Budapest`, from `stoptimes[0].serviceDay`
  (`SPEC.md` §7.3). It is required by the query but is **not** part of the cache key: a
  trip's shape belongs to the route, not to the day, so the id alone identifies the answer.

**Settled 18 Aug 2026.** It returns the shape of the one row addressed, never a merged one.
A multi-leg trip's canonical id gives the unsuffixed leg, which is **not** always the active
leg: on `351 DRÁVA` it is the Ljubljana to Graz half while the train is running the Hungarian
one. A portioned train's ids each give that portion's **whole journey from the origin**, so
they share a trunk. No returned line ever spans a multi-leg gap. Measurements in
`findings.md`, rule in `SPEC.md` §1. **The responses themselves were not kept**, so the
trimming rule is developed against the live endpoint rather than a fixture.

### The shape

An array of `[lon, lat]` pairs:

```json
"geometry": [
  [18.424949, 47.183294],
  [18.425886, 47.183605],
  [18.426361, 47.183746]
]
```

> **Longitude first.** This is GeoJSON order and it is the **reverse** of Leaflet's
> `[lat, lng]`. Passing the array straight into `L.polyline` puts the route off the coast of
> Africa. Swap each pair once, at the edge of the fetch, and never again.

The line starts at the trip's first stop and shares a coordinate space with `stop.lat` /
`stop.lon`, so the polyline and the station dots line up: the first point above is ~35 m from
Székesfehérvár, whose stop record reads `lat 47.183611, lon 18.424722`. Only the pair order
differs between the two.

---

## The second upstream: vagonweb.cz (carriage composition)

Moved to its own document: **`plan/vagonweb.md`**. It is a different site, a different hop, and
it grew larger than everything above it. The only thing it needs from this file is one field on
the list query, noted in the block above: `route.agency { id name }`.

## Sample response

One vehicle, verbatim from the live API. Useful as a fixture: it exercises skipped
`stopPosition` values (6, 8, 9 … 20, 25, 37), a mid-trip delay, an alert, duplicate
`infoServices` with different stop ranges, and both `platformColor` values.

Note `label` is empty here. It is empty on every row of every capture and has since been
dropped from the query; it is left in this sample because the sample is verbatim.

**This sample predates `stop.lat` / `stop.lon` and `isEstimated`**, so its stops carry no
coordinates and a fixture built from it alone renders no station dots. It is a shape reference,
not the development fixture. **Develop against `plan/data-2026-08-12.json`**, which has the
widest schema.

```json
[
  {
    "vehicleId": "1:915504800136",
    "label": "",
    "lat": 46.9757004,
    "lon": 17.9332199,
    "speed": 0,
    "heading": 49,
    "lastUpdated": 1785576362,
    "trip": {
      "id": "VHJpcDoxOjMzMTUzNTA3",
      "tripHeadsign": "Budapest-Déli",
      "tripShortName": "19797 KÉK HULLÁM InterCity",
      "stoptimes": [
        { "stopPosition": 1, "scheduledArrival": 34680, "realtimeArrival": 34680, "arrivalDelay": 0, "scheduledDeparture": 34680, "realtimeDeparture": 34680, "departureDelay": 0, "realtimeState": "MODIFIED", "platformColor": "black", "serviceDay": 1785535200, "stop": { "name": "Tapolca", "timezone": "Europe/Budapest", "platformCode": null } },
        { "stopPosition": 2, "scheduledArrival": 35040, "realtimeArrival": 35040, "arrivalDelay": 0, "scheduledDeparture": 35100, "realtimeDeparture": 35100, "departureDelay": 0, "realtimeState": "MODIFIED", "platformColor": "black", "serviceDay": 1785535200, "stop": { "name": "Nemesgulács-Kisapáti", "timezone": "Europe/Budapest", "platformCode": null } },
        { "stopPosition": 3, "scheduledArrival": 35280, "realtimeArrival": 35280, "arrivalDelay": 0, "scheduledDeparture": 35340, "realtimeDeparture": 35340, "departureDelay": 0, "realtimeState": "MODIFIED", "platformColor": "black", "serviceDay": 1785535200, "stop": { "name": "Badacsonytördemic-Szigliget", "timezone": "Europe/Budapest", "platformCode": "2" } },
        { "stopPosition": 6, "scheduledArrival": 36000, "realtimeArrival": 36000, "arrivalDelay": 0, "scheduledDeparture": 36060, "realtimeDeparture": 36600, "departureDelay": 540, "realtimeState": "MODIFIED", "platformColor": "black", "serviceDay": 1785535200, "stop": { "name": "Badacsonytomaj", "timezone": "Europe/Budapest", "platformCode": "2" } },
        { "stopPosition": 8, "scheduledArrival": 36360, "realtimeArrival": 36840, "arrivalDelay": 480, "scheduledDeparture": 36420, "realtimeDeparture": 36900, "departureDelay": 480, "realtimeState": "MODIFIED", "platformColor": "black", "serviceDay": 1785535200, "stop": { "name": "Ábrahámhegy", "timezone": "Europe/Budapest", "platformCode": null } },
        { "stopPosition": 20, "scheduledArrival": 39300, "realtimeArrival": 39480, "arrivalDelay": 180, "scheduledDeparture": 40080, "realtimeDeparture": 40680, "departureDelay": 600, "realtimeState": "MODIFIED", "platformColor": "green", "serviceDay": 1785535200, "stop": { "name": "Balatonfüred", "timezone": "Europe/Budapest", "platformCode": "5" } },
        { "stopPosition": 25, "scheduledArrival": 40800, "realtimeArrival": 41520, "arrivalDelay": 720, "scheduledDeparture": 40860, "realtimeDeparture": 41580, "departureDelay": 720, "realtimeState": "MODIFIED", "platformColor": "black", "serviceDay": 1785535200, "stop": { "name": "Balatonalmádi", "timezone": "Europe/Budapest", "platformCode": "2" } },
        { "stopPosition": 37, "scheduledArrival": 43560, "realtimeArrival": 44280, "arrivalDelay": 720, "scheduledDeparture": 43620, "realtimeDeparture": 44340, "departureDelay": 720, "realtimeState": "MODIFIED", "platformColor": "green", "serviceDay": 1785535200, "stop": { "name": "Székesfehérvár", "timezone": "Europe/Budapest", "platformCode": "9" } },
        { "stopPosition": 56, "scheduledArrival": 45960, "realtimeArrival": 46680, "arrivalDelay": 720, "scheduledDeparture": 46020, "realtimeDeparture": 46740, "departureDelay": 720, "realtimeState": "MODIFIED", "platformColor": "black", "serviceDay": 1785535200, "stop": { "name": "Budapest-Kelenföld", "timezone": "Europe/Budapest", "platformCode": "5" } },
        { "stopPosition": 57, "scheduledArrival": 46440, "realtimeArrival": 47160, "arrivalDelay": 720, "scheduledDeparture": 46440, "realtimeDeparture": 47160, "departureDelay": 720, "realtimeState": "MODIFIED", "platformColor": "black", "serviceDay": 1785535200, "stop": { "name": "Budapest-Déli", "timezone": "Europe/Budapest", "platformCode": "5" } }
      ],
      "alerts": [
        {
          "feed": "1",
          "alertHeaderText": "",
          "alertDescriptionText": "Vonat műszaki hibája miatti késés",
          "alertUrl": null,
          "alertEffect": "UNKNOWN_EFFECT",
          "alertCause": "UNKNOWN_CAUSE",
          "alertSeverityLevel": "WARNING",
          "effectiveStartDate": 1785571924,
          "effectiveEndDate": 1785582360
        }
      ],
      "infoServices": [
        { "name": "A vonatban 1. osztályú kocsi is közlekedik", "fontCode": 221, "displayable": true, "order": 1, "fromStop": { "name": "Tapolca", "id": "U3RvcDoxOjAwNTUwNDU5OF8w" }, "tillStop": { "name": "Budapest-Déli", "id": "U3RvcDoxOjAwNTUwMTAxNl8w" }, "fontCharSet": "MNR2007" },
        { "name": "Helyjegy váltása kötelező", "fontCode": 197, "displayable": true, "order": 18, "fromStop": { "name": "Tapolca", "id": "U3RvcDoxOjAwNTUwNDU5OF8w" }, "tillStop": { "name": "Budapest-Déli", "id": "U3RvcDoxOjAwNTUwMTAxNl8w" }, "fontCharSet": "MNR2007" },
        { "name": "Belföldi utazásra a kijelölt viszonylaton helyjegy váltása nélkül igénybe vehető 2. kocsiosztályon.", "fontCode": 200, "displayable": true, "order": 23, "fromStop": { "name": "Budapest-Kelenföld", "id": "U3RvcDoxOjAwNTUwMTAyNF8w" }, "tillStop": { "name": "Budapest-Déli", "id": "U3RvcDoxOjAwNTUwMTAxNl8w" }, "fontCharSet": "MNR2007" },
        { "name": "Belföldi utazásra a kijelölt viszonylaton helyjegy váltása nélkül igénybe vehető 2. kocsiosztályon.", "fontCode": 200, "displayable": true, "order": 23, "fromStop": { "name": "Tapolca", "id": "U3RvcDoxOjAwNTUwNDU5OF8w" }, "tillStop": { "name": "Balatonalmádi", "id": "U3RvcDoxOjAwNTUwNDM2Nl8w" }, "fontCharSet": "MNR2007" },
        { "name": "Csatlakozásra nem vár", "fontCode": 168, "displayable": true, "order": 34, "fromStop": { "name": "Székesfehérvár", "id": "U3RvcDoxOjAwNTUwMzI2OV8w" }, "tillStop": { "name": "Székesfehérvár", "id": "U3RvcDoxOjAwNTUwMzI2OV8w" }, "fontCharSet": "MNR2007" },
        { "name": "Bisztrószolgáltatás", "fontCode": 193, "displayable": true, "order": 41, "fromStop": { "name": "Tapolca", "id": "U3RvcDoxOjAwNTUwNDU5OF8w" }, "tillStop": { "name": "Budapest-Déli", "id": "U3RvcDoxOjAwNTUwMTAxNl8w" }, "fontCharSet": "MNR2007" }
      ],
      "trainCategoryName": "InterCity",
      "route": {
        "id": "Um91dGU6MTpFMjg1MjA0NzM",
        "longName": "IC KÉK HULLÁM",
        "fontCharSet": "MNR2007",
        "fontCode": 474,
        "textColor": "274F96"
      }
    },
    "stopRelationship": {
      "status": "IN_TRANSIT_TO",
      "stop": { "name": "Balatonalmádi" }
    }
  }
]
```

The `stoptimes` list above is abridged; the real trip has 22 calls. Everything else is
verbatim.

---

## Things to verify against the live API on day one

1. ~~**`speed` is metres per second.**~~ **Settled.** Confirmed against the captures: the
   fastest train across all four is `44`, which is 158 km/h at `× 3.6` and matches the 160 km/h
   Hungarian mainline limit exactly. p95 is 33, or 119 km/h. Read as km/h the whole country's
   fastest train would be doing 44 km/h.
2. ~~**Field coverage outside InterCity.**~~ **Settled.** `route.textColor` and `infoServices`
   are populated on **every row of every category** across all four captures, `személyvonat`
   included, so there is no premium-only happy path to worry about.

   `platformCode` is the exception and is null on 27 % to 70 % of stoptimes depending on
   category. It is *worse* for premium trains, since `railjet` (70 %) and `EuroNight` (58 %)
   call at foreign stations that publish no platform. Handled by `SPEC.md` §7.3: a null
   `platformCode` renders nothing whatever `platformColor` says.
3. ~~**The geometry query.**~~ **Settled.** Confirmed, `[lon, lat]` pairs, fetched per trip on selection. See the section above.
4. ~~**`heading` is compass degrees clockwise from north.**~~ **Settled.** Checked against the
   geometry rather than against the live map: for every `IN_TRANSIT_TO` train, the true bearing
   from its position to its next stop was compared with its normalised `heading`. The median
   deviation is **8.6°** over 110 trains, and 80 % are within 30° — the residual being that a
   railway does not run in a straight line to the next station. The two rival readings are ruled
   out flat: counter-clockwise gives a median of 129.9°, and degrees-from-east 89.3°.
   Note the captures contain negative and fractional values, so normalise as `SPEC.md` §9 says.
5. ~~**`stop.lat` / `stop.lon` exist and are populated.**~~ **Settled.** Confirmed in
   `plan/data-2026-08-12.json`, populated on all 3616 stoptimes including foreign stations.
6. ~~**Whether a replacement bus section is queryable.**~~ **Investigated, and the answer is
   no.** The 7 and 12 Aug captures were taken with
   **`modes: [RAIL, RAIL_REPLACEMENT_BUS]`** and returned rail only: no bus category, no
   bus-like `route.longName`, and nothing filling any `stopPosition` gap. The enum is valid,
   or GraphQL would have rejected the query outright, so the mode exists upstream and simply
   yields nothing.

   Treated as a MÁV-side gap. The gap row therefore cannot name the replacement service and
   describes the hole instead, which is what `SPEC.md` §7.1 already specifies. Worth revisiting
   after v1 ships, but nothing here is blocked on it.
7. ~~**What `geometry` returns for a merged or portioned trip.**~~ **Settled**, against
   `8995 PANNÓNIA`, `351 DRÁVA` and `EN 462` with its two tails. One row, one shape: a merged
   trip's canonical id returns the unsuffixed leg only and each leg's suffixed id returns that
   leg, while each portion returns its whole journey from the origin. So it is one fetch per
   published row. Nothing on this list is open now. See the geometry section above,
   `findings.md` and `SPEC.md` §1.
