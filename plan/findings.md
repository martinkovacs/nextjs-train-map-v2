# Feed findings — the measured record

`SPEC.md` states the rules. This file is the dated evidence behind them: what was captured,
what was counted, and which worked examples each non-obvious rule was derived from.

SPEC.md is deliberately static and carries no per-capture numbers. When a rule there looks
arbitrary, the reason is here.

## The captures

| File | Taken | Rows | Notes |
| --- | --- | --- | --- |
| `plan/data-2026-08-04.json` | 4 Aug 2026, 14:20:34 | 290 | |
| `plan/data-2026-08-05.json` | 5 Aug 2026, 12:32:15 | 281 | |
| `plan/data-2026-08-07.json` | 7 Aug 2026, 21:33:38 | 230 | evening; the only one with `EuroNight` |
| `plan/data-2026-08-12.json` | 12 Aug 2026, 13:18:56 | 273 | first with `stop.lat`/`lon` and `isEstimated` |

Capture times are the maximum `lastUpdated` in each file, which is the best available proxy
for "now".

**None contains a bus, and the last two were asked for one.** The 4 and 5 Aug captures used
`modes: [RAIL]`. The 7 and 12 Aug captures used **`modes: [RAIL, RAIL_REPLACEMENT_BUS]`** and
came back with rail only: no bus category, no bus-like `route.longName`, nothing filling any
`stopPosition` gap. The enum value itself is valid, since GraphQL would have rejected the whole
query otherwise, so the mode exists upstream and simply returns nothing. Treated as a MÁV-side
gap, not something this app can work around.

The normaliser should be able to run against all four and reproduce the numbers below.

**The 12 Aug capture has a wider schema than the first three.** It added `isEstimated` on the
vehicle row and `lat` / `lon` on the stop, and it dropped nothing. Counts below that predate
it are marked where the difference matters.

---

## Identity and normalisation

### `vehicleId` is not unique within one response

| Capture | Duplicate ids | Rows involved |
| --- | --- | --- |
| 4 Aug | 7 | 15 |
| 5 Aug | 6 | 13 |
| 7 Aug | 3 | 8 |
| 12 Aug | 6 | 12 |

`trip.id` is unique on every row of all four files (290, 281, 230, 273 distinct).

### Canonical trip id

`trip.id` is base64. Decoded it reads `Trip:1:34252695`, and a multi-leg trip's second leg
carries a suffix: `Trip:1:34267824.30701818`. Cutting at the `.` yields the canonical id.

Multi-leg groups: 7, 5, 2 and 6. Leg position spans never overlap in any capture, so
concatenating them in `stopPosition` order is safe.

### The multi-leg trips

Two replacement-bus sections account for every multi-leg trip except `351 DRÁVA`, below.

| Capture | Trip | Leg 1 | Gap | Leg 2 |
| --- | --- | --- | --- | --- |
| 4 Aug | `9174` | 1–16 Sopron → Szombathely | 17–21 | 22–28 Körmend → Szentgotthárd |
| 4 Aug | `9156` | 1–16 Sopron → Szombathely | 17–21 | 22–28 Körmend → Szentgotthárd |
| 4 Aug | `9185` | 1–8 Szentgotthárd → Körmend | 9–13 | 14–28 Szombathely → Sopron |
| 4 Aug | `8903` | 1–19 Pécs → Vízvár | 20–23 | 24–59 Gyékényes → Szombathely |
| 4 Aug | `8995` | 1–19 Pécs → Vízvár | 20–23 | 24–59 Gyékényes → Szombathely |
| 4 Aug | `8905` | 1–19 Pécs → Vízvár | 20–23 | 24–59 Gyékényes → Szombathely |
| 4 Aug | `8994` | 1–37 Szombathely → Gyékényes | 38–41 | 42–59 Vízvár → Pécs |
| 5 Aug | `8995` `8992` `8904` `8997` `8905` | as above | | |
| 7 Aug | `8901` `8996` | as above | | |

These replacement-bus gaps span 4 or 5 skipped `stopPosition`s. Measured durations, last
arrival to next departure: 59 to 66 minutes. Departure to next arrival: 45 to 49 minutes.
SPEC.md's gap row quotes the former.

The Szombathely ↔ Körmend section appears **only in the 4 Aug capture**; the Vízvár ↔
Gyékényes PANNÓNIA section appears in all four. The western one therefore looks like
short-lived engineering work rather than a standing arrangement.

### A third replaced section, and a much larger gap

`351 DRÁVA InterCity`, 12 Aug:

| Leg | Positions | Route | Realtime |
| --- | --- | --- | --- |
| 1 | 1–26 | Ljubljana → Graz Hbf | 0/12 |
| gap | 27–46 | Graz Hbf 08:37 → Szentgotthárd 10:01, **100 min**, 20 skipped positions | |
| 2 | 47–110 | Szentgotthárd → Budapest-Kelenföld | 18/18 |

**This is a replacement bus, confirmed by GYSEV's own notice.** Track construction closes the
Szentgotthárd–Graz line from 11 Jul to 6 Aug 2026 and again from 8 Aug to 12 Sep 2026, and for
the affected `MURA` and `DRÁVA` InterCity services replacement buses run between Szentgotthárd
and Graz Hbf. So the gap row's *"No rail service between X and Y"* wording is accurate here.

The feed corroborates the closure windows. On **5 Aug** `351 DRÁVA` is a **single continuous
leg**, positions 1–110 Ljubljana → Budapest-Kelenföld, with no gap at all, and `354 MURA` is
likewise unbroken. On **12 Aug** the same trip is split. The multi-leg shape appears and
disappears with the engineering work, exactly as the Szombathely ↔ Körmend section does.

**What this changes: the gap is much bigger than the domestic ones.** 20 skipped positions and
100 minutes, against 4 or 5 positions and about an hour. Any rule that assumes a small gap is
wrong.

**The western section.** The feed places that gap between **Szombathely and Körmend** across
`9174`, `9156` and `9185`, and `9174`'s Körmend → Szentgotthárd leg is 7/7 realtime-backed, so
trains run that section. This was previously flagged as conflicting with a recollection that
Szentgotthárd–Körmend was the bus; that recollection most likely referred to the
**Szentgotthárd–Graz** closure above, which is a different section on the same line and is now
documented. Nothing contradicts the feed, so it is taken at face value. The section has not
reappeared in any capture since 4 Aug.

### Untracked legs

Half the multi-leg legs across the captures are entirely `SCHEDULED`, and in every
case it is the leg that has **already finished**. Future legs carry realtime; completed ones
lose it. This is the ordinary pattern, not a data error.

Example: `9185` leg 1 (Szentgotthárd → Körmend, 12:36–12:58) is 0/7 realtime-backed at a
14:20 capture, while leg 2 (Szombathely → Sopron) is 11/11.

### `stopRelationship: null`

Null on 7, 8 and 3 rows. Verified with no exceptions: the trip has either finished or has
not yet started, and it never appears on a trip whose running window contains now. Across the
first two captures, 8 were finished and 7 not yet started; 12 of those 15 were the idle leg
of a multi-leg trip.

`8997 PANNÓNIA` on 5 Aug reports a `lastUpdated` 0 minutes old against a position it last
occupied 181 minutes earlier. This is why `lastUpdated` tracks publication rather than
movement and is never a valid tie-break between rows.

### Retention

Applied to the fixtures, the retention rule keeps 283 of 283, 273 of 276, 227 of 228 and
265 of 267.

The 5 Aug drops are `35714` (arrived 11 min ago), `18407 DÉLI <- PARTI` (38 min) and
`78 MUNTENIA` (393 minutes pre-departure, dropped by the 30-minute window). `36424` is the
case that motivated clause (c): it arrived 3 minutes before the capture with no
`stopRelationship` and a `SCHEDULED` final stoptime, so without that clause it would vanish
the moment it berthed. Clause (c) keeps it.

The 12 Aug drops are `17895 KISKUN` and `8314 GEMENC`, both untracked with scheduled arrivals
66 and 80 minutes in the future, correctly excluded because clause (a) does not cover them.

The realtime-backed qualifier on the arrival clause is load-bearing in the other direction.
13 to 22 trips per capture end on a non-realtime stoptime, and a cutoff computed from
the timetable alone would delete running international trains: `140 HORTOBÁGY EuroCity`
reads as 32 minutes past its final arrival while it is `IN_TRANSIT_TO Wien Hbf`, 53 minutes
late.

The 30-minute pre-departure window: 17 to 31 trips per capture are pre-departure, and
the window drops only one or two of them. `78 MUNTENIA` appears 393 minutes ahead of its
first departure and `8225` 72 minutes ahead.

### `vehicleId` collisions surviving the leg merge

All six collision groups across the captures, and how `route.id` plus position
classifies them:

| Capture | Trips | Same `route.id` | Same position | Verdict |
| --- | --- | --- | --- | --- |
| 5 Aug | `75 CLAUDIOPOLIS` ×2 | yes | yes | portion split |
| 7 Aug | `50462` / `462` / `40462 KÁLMÁN IMRE` | yes | yes | portion split |
| 4 Aug | `9185` / `9113` | no | no | two trains |
| 5 Aug | `8992` / `8905 PANNÓNIA` | yes | no | two trains |
| 7 Aug | `37601` / `37648` | yes | no | two trains |
| 5 Aug | `29792` / `19792 KÉK HULLÁM` | no | yes | hybrid IC + Ex |

The 12 Aug capture has six duplicate `vehicleId`s at row level but **no collisions that
survive the leg merge**, so all six are ordinary multi-leg trips.

Neither field works alone. `route.id` by itself wrongly merges `8992`/`8905` and
`37601`/`37648`, which are the same route in opposite directions. Position by itself wrongly
merges the IC + Ex hybrid.

**Signals that were tried and rejected.** Shared stop prefix fails: `9185` and `9113` share a
7-stop prefix and are two different trains. Train number fails: `KÁLMÁN IMRE` runs as one
train under three numbers. Identical planned times fail: the two `75 CLAUDIOPOLIS` portions
share 19 stop names but their booked times diverge two stops before the fork
(Orastie 15:45 vs 15:56).

#### `9185` / `9113`, 4 Aug — the case that rules out shared prefix

One GYSEV `vehicleId`, `1:945514355060`, carrying three rows: `9185` leg 2 (active,
`IN_TRANSIT_TO Bük`), `9113` (active, `IN_TRANSIT_TO Rátót`), and `9185` leg 1 (idle).

After the leg merge, `9185`'s stop list begins with its untracked leg 1 — Szentgotthárd,
Haris, Alsórönök, Rátót, Csákánydoroszló, Horvátnádalja, Körmend — which is the *entire* stop
list of `9113`. Hence the 7-stop prefix. Everything else separates them:

- positions 52.8 km apart
- `route.id` differs; `route.longName` is `Sz 9156/…/9185` versus `Sz 9113/…/9124`
- scheduled times 90 minutes apart (leg 1 runs 12:36–13:03, `9113` runs 14:06–14:32)
- leg 1 is 0/7 realtime-backed, `9113` is 7/7

#### `KÁLMÁN IMRE`, 7 Aug — the case that rules out train number

One `vehicleId`, one `route.id`, identical coordinates, identical `IN_TRANSIT_TO Tatabánya`.
11 shared stops with identical scheduled times, Budapest-Keleti 20:30 through
Salzburg Hbf 02:07, then a three-way fork:

| Number | Stops | Realtime | Destination | infoServices |
| --- | --- | --- | --- | --- |
| `50462` | 17 | 12/17 | Stuttgart Hbf | 11 |
| `462` | 11 | 6/11 | Salzburg Hbf (terminates at the fork) | 14 |
| `40462` | 15 | 10/15 | Zürich HB | 11 |

`462` is the lowest number and therefore the primary, and it is also the portion that ends at
the divergence point with no tail of its own. Note that the primary carries the fewest
realtime-backed stops and the most info services, so primary selection and data richness do
not agree here, unlike the IC + Ex hybrid.

#### `29792` / `19792 KÉK HULLÁM`, 5 Aug — the hybrid

Identical 22-stop list, identical delays, identical position, both `STOPPED_AT Tapolca`.
The InterCity row carries 13 infoServices against the Expresszvonat's 8, and it is the record
vagonweb holds the composition under.

### Pipeline totals

| Capture | Rows | After leg merge | After retention | Final | Distinct numbers |
| --- | --- | --- | --- | --- | --- |
| 4 Aug | 290 | 283 | 283 | 283 | 283 |
| 5 Aug | 281 | 276 | 273 | 271 | 271 |
| 7 Aug | 230 | 228 | 227 | 225 | 225 |
| 12 Aug | 273 | 267 | 265 | 265 | 265 |

7 Aug loses two more at the collision step because the `KÁLMÁN IMRE` three-way portion split
merges to one train.

Retention figures use the **bounded** clause (c). The 12 Aug capture is what exposed the
unbounded form: it retained `17895 KISKUN` and `8314 GEMENC`, whose scheduled arrivals were
66 and 80 minutes in the *future* and which have no `stopRelationship`, because
`now <= scheduled arrival + 10 min` is trivially true for any unfinished journey. That form
also kept `78 MUNTENIA` on 5 Aug, silently repealing clause (a)'s 30 minute window.

The 12 Aug capture has **no surviving `vehicleId` collisions at all**, so final equals
retained.

Train numbers are unique across every retained trip in all four captures, which is what
makes `/?train=N` resolvable. This holds only *after* normalisation: in the raw feed several
numbers are carried by two rows each.

---

## Delay resolution

### Realtime coverage

| Capture | Realtime-backed stoptimes | Total | Share |
| --- | --- | --- | --- |
| 4 Aug | 3600 | 3774 | 95.4 % |
| 5 Aug | 3599 | 3824 | 94.1 % |
| 7 Aug | 3108 | 3306 | 94.0 % |

`arrivalDelay` is never null in any capture, so on a `SCHEDULED` stoptime it is `0` and that
`0` means *no data*, not *on time*.

`SCHEDULED` occurs in two situations, both measured:

- **Domestically, a train MÁV has not started tracking.** Four rows per capture are
  `SCHEDULED` at every stop, including `78 MUNTENIA InterCity` at 27 of 27. Between 20 and 28
  trips per capture have a `SCHEDULED` next stop.
- **Realtime that stops at the border.** `140 HORTOBÁGY EuroCity` leaves Hegyeshalom 53
  minutes late and its three Austrian stops all read `0`; `64 railjet xpress` does the same at
  20 minutes.

Early running is real: 141, 140 and 92 stoptimes carry a negative `arrivalDelay`, down to
−840 s.

### Worked example: `140 HORTOBÁGY EuroCity`, 5 Aug 2026 at 12:32

The hardest case in any capture, and the fixture to render against. It is
`IN_TRANSIT_TO Wien Hbf`.

- `heading` is `-87.69533…`, normalising to **272.30°**
- `speed` is null: 140 is in the estimated-position batch
- `route.textColor` is `274F96`
- resolved delay **+53 min**, so the marker fill is `--d-severe`

Its stop list, abridged:

| Stop | State | Sch. arr | Arr delay | Dep delay |
| --- | --- | --- | --- | --- |
| Nyíregyháza | MODIFIED | 04:27 | 0 | 0 |
| Debrecen | MODIFIED | 04:58 | +1 | +1 |
| Szolnok | MODIFIED | 06:23 | +11 | +16 |
| Budapest-Keleti | MODIFIED | 07:55 | **+18** | **+4** |
| Budapest-Kelenföld | MODIFIED | 08:47 | +1 | +2 |
| Tatabánya | MODIFIED | 09:25 | +25 | +25 |
| Győr | MODIFIED | 10:00 | +46 | +46 |
| Mosonmagyaróvár | MODIFIED | 10:19 | +48 | +48 |
| Hegyeshalom | MODIFIED | 10:29 | **+50** | **+53** |
| Wien Hbf | SCHEDULED | 11:20 | 0 | 0 |
| Wien Meidling | SCHEDULED | 11:36 | 0 | 0 |
| Wien Westbf | SCHEDULED | 12:00 | 0 | 0 |

14 realtime rows from Nyíregyháza to Hegyeshalom, then three Austrian stops that must render
grey with no delay chip. The `+18` at Budapest-Keleti falling to `+1` at Kelenföld is a real
recovery absorbed by a booked 35-minute dwell.

Budapest-Keleti is also the case that forces the timeline row to name its delay field:
`arrivalDelay` is 18 and `departureDelay` is 4.

---

## Field observations

### Estimated positions

One batch per response carries a computed position instead of a measured one. Every signal
picks out exactly the same rows:

| Capture | `isEstimated: true` | `speed: null` rows | Fractional or negative `heading` rows | Distinct `lastUpdated` in the batch |
| --- | --- | --- | --- | --- |
| 4 Aug | *field absent* | 11 | 11 | 1 |
| 5 Aug | *field absent* | 15 | 15 | 1 |
| 7 Aug | *field absent* | 11 | 11 | 1 |
| 12 Aug | **8** | 8 | 8 | 1 |

`isEstimated` arrived with the 12 Aug capture and is an exact match for both older heuristics:
no estimated row has a speed, and no speed-null row is unestimated. It is now the test, and the
others are corroboration.

The batch shares one `lastUpdated`, but that timestamp is **not unique to the batch**: 6, 9 and
15 non-estimated rows share it. It is also not always the fleet maximum, trailing it in three
of the four captures. Neither fact matters now that `isEstimated` exists, but both are why the
timestamp was never a safe way to find the batch.

### `speed` is metres per second

Confirmed from the distribution across all four captures, 758 non-zero values:

| | Raw | `× 3.6` |
| --- | --- | --- |
| p50 | 17 | 61 km/h |
| p95 | 33 | 119 km/h |
| max | 44 | **158 km/h** |

158 km/h against Hungary's 160 km/h mainline limit is the confirmation. Read as km/h instead,
the fastest train in the country would be doing 44 km/h.

### Field coverage is not category-dependent

`route.textColor` and `infoServices` are populated on **every row of every category** across
all four captures, `személyvonat` included. There is no premium-only happy path.

`platformCode` is the one field with real gaps, and they run opposite to intuition:

| Category | Stoptimes with a null `platformCode` |
| --- | --- |
| `railjet` | 70 % |
| `EuroNight` | 58 % |
| `railjet xpress` | 56 % |
| `InterCity` | 36 % |
| `személyvonat` | 33 % |
| `InterRégió` | 27 % |

The premium categories are worse because they call at foreign stations, which publish no
platform. This is why a null `platformCode` must render nothing regardless of `platformColor`.

Empty `alerts` are normal rather than a gap: most trains carry none at any moment.

### `heading`

Never null. Negative on 6, 9 and 6 rows, fractional on 11, 15 and 11, with a minimum of
−159.10571…, hence the normalisation rule.

**Compass degrees clockwise from north, confirmed against the geometry.** For every
`IN_TRANSIT_TO` train in the 12 Aug capture — the only one carrying `stop.lat`/`lon` — the true
bearing from the vehicle to its next stop was compared with the normalised `heading`, over
1.5 to 40 km so the bearing is meaningful:

| Reading | Median deviation | Within 30° |
| --- | --- | --- |
| **`h` clockwise from north** | **8.6°** | **80 %** |
| `-h` (counter-clockwise) | 129.9° | 13 % |
| `h` from east | 89.3° | 5 % |

n = 110, estimated-position rows excluded. The 8.6° residual is the track itself: a railway does
not run straight at the next station. The estimated batch is looser (median 38.5° over 5 rows),
which is consistent with a computed position rather than a measured one.

### Time fields

Every time and delay field in all four captures is an exact multiple of 60, confirming
minute resolution.

Seconds past `86400` do occur: 0, 20 and 104 stoptimes, with a maximum of 132600 s (36.8 h).
This is what rules out clamping or a modulo in the `serviceDay + seconds` conversion.

### Timezone

Rendering everything in `Europe/Budapest` is a correctness requirement, not a shortcut.
`serviceDay + seconds` is a genuine absolute instant, so a Romanian or Ukrainian stop
rendered in its own `stop.timezone` produces impossible running times:

| Train | Border hop | In Budapest time | In `stop.timezone` |
| --- | --- | --- | --- |
| `75 CLAUDIOPOLIS` | Lőkösháza dep → Curtici arr | 12:27 → 12:37, 10 min | 12:27 → 13:37, 70 min |
| `374 MAROS` | Curtici dep → Lőkösháza arr | 13:16 → 13:26, 10 min | 14:16 → 13:26, negative |
| `33 LATORCA` | Chop dep → Záhony arr | 11:02 → 11:20, 18 min | 12:02 → 11:20, negative |

The consequence is that a Romanian station shows a time one hour behind its local departure
board. For this tool that is the right trade.

Foreign timezones observed: `Europe/Bratislava`, `Europe/Prague`, `Europe/Bucharest`,
`Europe/Berlin`, `Europe/Kiev`, `Europe/Zagreb`, `Europe/Zurich`. Austrian stops are returned
as `Europe/Budapest`.

### `platformColor`

| Capture | black | green | red |
| --- | --- | --- | --- |
| 4 Aug | 2603 | 1035 | 136 |
| 5 Aug | 2571 | 1132 | 121 |
| 7 Aug | 2042 | 1116 | 148 |

`red` is a normal state, not an edge case. Between 1054 and 1307 stoptimes per capture have a
null `platformCode`, and 50 to 66 of those still carry `platformColor: green`, which is why a
confirmation with no platform value renders nothing.

### `tripShortName`

Parses cleanly on every row of all four captures: leading digits are the number, the trailing
`trainCategoryName` is always an exact suffix, and the remainder is the name. The name is
empty on 183, 158 and 144 rows, so an empty name is the common case rather than an edge one.

`stopRelationship.stop.name` matches exactly one stoptime on every row, with no trip in any
capture calling twice at the same station, so matching the next stop by name is safe.

### Stop lists

`stopPosition` is always ascending with no duplicates, and no trip has zero stoptimes.
Median calling points 12, 12 and 13; maximum 46, 36 and 47.

### `trainCategoryName`

Ten values across the captures, all mapped in `vagonweb.md`:

`személyvonat`, `InterCity`, `InterRégió`, `Expresszvonat`, `sebesvonat`, `EuroCity`,
`railjet xpress`, `EuroRegio`, `EuroNight`, `railjet`.

Two agencies: `MÁV Személyszállítási Zrt.` and `GYSEV Zrt.` Both appear in the captures but
never within one collision group.

**`EuroNight` is now confirmed.** `vagonweb.md` listed the `EN` category mapping as
unverified for want of a night train in the sample; the 7 Aug 21:33 capture contains three
`EuroNight` rows.

### `route.textColor`

Present and well-formed on every row of all four captures. Six distinct values:
`00A0E3`, `29803C`, `000000`, `C82227`, `274F96`, `B0CB1F`. The white-ring fallback in
SPEC.md §2 therefore never fires against these fixtures, which is the point of it.

### Alerts

| Capture | Alerts | In effect at capture | Expired |
| --- | --- | --- | --- |
| 4 Aug | 113 | 110 | 3 |
| 5 Aug | 150 | 140 | 10 |
| 7 Aug | 131 | 126 | 5 |

So the effective-window filter does real work. No alert in any capture is future-dated.
`alertSeverityLevel` is `WARNING` on all 394. `alertHeaderText` is `""` and `alertUrl` is
`null` on all 394, which is why `alertDescriptionText` is what gets rendered and the URL gets
no affordance.

### MNR2007

The shipped `public/fonts/MNR2007.ttf` has 528 glyphs and 526 cmap entries, spanning
codepoints 0 to 2164.

**The font was updated on 12 Aug 2026 and now covers everything.** All 84 distinct `fontCode`
values used across the four captures resolve to a glyph.

| | Old file | Current file |
| --- | --- | --- |
| Size | 146,060 bytes | 182,744 bytes |
| Glyphs | 528 | 636 |
| cmap entries | 526 | 634 |
| Missing codes in use | 2 | **0** |

The two that used to be missing:

| Code | Where | Meaning |
| --- | --- | --- |
| 605 | `route.fontCode`, route `S447`, all four captures | the route badge |
| 602 | `infoService.fontCode`, `33 LATORCA`, 12 Aug only | *"Átszállás egyik a vonatszerelvényről vagy autóbuszról a másikra."* |

**Keep the per-pictogram coverage check anyway.** The point was never those two codes, it is
that the font is versioned and the feed is not. MÁV added 108 glyphs between the two copies, so
a local file can fall behind the feed at any time, and `document.fonts.check()` cannot detect
it: the font loads fine and the codepoint still renders as `.notdef`. 602 also showed the gap
can land on an **info service** rather than a route badge, where the "blank chip in the type
colour" fallback makes no sense.

As WOFF2 the current file is **76,568 bytes, 42 % of the TTF**. That is a larger saving than
subsetting would give, and it costs no coverage, which is why SPEC.md §2 ships the whole font.

### Geometry

`trip.geometry` is confirmed. It returns an array of **`[lon, lat]` pairs** (GeoJSON order,
the reverse of Leaflet's `[lat, lng]`), starting at the trip's first stop.

It stays out of the list query because it takes the response from **1.8 MB to 6 MB**, a 233 %
increase every 30 s to carry a line for the one train that might be selected.

It shares a coordinate space with `stop.lat` / `stop.lon`: for a trip starting at
Székesfehérvár the first geometry point is `[18.424949, 47.183294]`, about 35 m from the stop
record's `lat 47.183611, lon 18.424722`. Only the pair order differs.

### Geist, measured 30 Aug 2026

Against the woff2 files Google serves for `Geist` and `Geist Mono` — the same ones `next/font`
downloads. This closes SPEC.md §2's "re-check these three against Geist while building".

**The subsets are not interchangeable.** `ő` U+0151 and `ű` U+0171 are in **latin-ext only**;
`ö` and `á` are in **latin only**. Neither subset alone renders a Hungarian station list, which
is why `app/layout.tsx` loads both.

**Vertical metrics**, identical across both families and every weight: hhea gives
ascent + descent + lineGap = **1.300 em**, so a "normal" line box is 1.3 × the size. Worst-case
ink over the glyphs that matter — `Ő`/`Ű` reach yMax **906**, `g` reaches yMin **−162** — is
**1.068 em**. The double acute is the tallest thing in the Hungarian set and it is only 15 units
above `Á`, so it costs nothing.

| Claim | Size | Box | Natural line box | Worst ink | Verdict |
| --- | --- | --- | --- | --- | --- |
| §5 hover row, §6 station name | 14.5 px | 22 px | 18.85 px | 15.49 px | **holds**, 3.15 px spare |
| §6 sub-line | 13.5 px | 20 px | 17.55 px | 14.42 px | **holds**, 2.45 px spare |
| §10 `.err-tech` | 12 px | 18 px | 15.60 px | 12.82 px | **holds** |

**Geist Mono's advance is exactly 0.600 em**, every glyph, so `10:29` at 14.5 px is **43.50 px**
and §6's 52 px minimum ARR/DEP column holds with 8.5 px to spare. Unchanged.

**The toast's technical line fits 50 characters, not 46.** The card is 390 px with 12 px padding
and a 1 px border, so 364 px of text at 7.200 px per character. The specimen meta line
(*Attempt 3 · retry in 0:08 · last good 13:41:02*, 46 characters, 331.2 px) fits with 32.8 px
spare. A line carrying the hop arrow loses ~2 characters to the 12 px SVG and its 2 px margins.
SPEC.md §10 has been raised to 50.

**Geist's sans digits are proportional, and `tnum` is real work.** Default advances run from
**384** (`1`) to **663**, so an untabulated 5-character time swings **16.18 px** between `11:11`
(26.58 px) and `00:00` (42.76 px) — a column that visibly jitters every minute. The font carries
a `tnum` feature that maps every digit to **600 units**, so §5's
`font-variant-numeric: tabular-nums` on `.num` is load-bearing rather than a nicety. 600 units is
also exactly Geist Mono's advance, so a tabular sans time and a mono time are the same width at
the same size.

### vagonweb's search does not fold every accent, 30 Aug 2026

`razeni.php` matches `jmeno` **accent-insensitively for accented vowels and case-sensitively
for nothing**, but it does **not** fold Czech carons. Six queries, `rok=2026`, counted on
`tr_razeni` rows:

| Query | Rows | Against |
| --- | --- | --- |
| `Tópart` | 48 | |
| `topart` | **48** | identical record set, byte for byte |
| `Körös` | 2 | |
| `koros` | **2** | identical |
| `Krakonoš` | 16 | `ČD R 920/929 Krakonoš` |
| `krakonos` | **0** | **every row lost** |

`zzqqxx` returns 0, so the engine does filter and the identical counts above are matches, not
an ignored parameter.

The split is exactly a Czech collation: `č`, `ř`, `š`, `ž` and `ch` are distinct letters in
Czech and do not fold, while accented vowels are not and do. Hungarian's `á é í ó ö ú ü` are
all accented vowels, so they fold; **`ő` and `ű` are untested** — no train carrying one is on
file (`SZABOLCSI TEKERGŐ` returns 0 rows in both spellings, which proves nothing either way).

**This is why SPEC.md §1 sends the query as typed.** Folding would have been invisible on
every Hungarian name tried and would have silently deleted all 16 Krakonoš rows, and RegioJet,
one of the four operators the filter keeps, files under Czech and Slovak names.

### The composition diff, three worked days

`MÁV IC 849 Tópart`, measured 4 Aug 2026. These are the examples behind `SPEC.md` §6.5's
pairing rule, and the third is the one that rules out position pairing.

| Day | What the slots produce | Sentence |
| --- | --- | --- |
| 31 Jul | 409 planned only · 415 reported only · rest identical | *409 Byee missing and 415 Bpmee extra.* |
| 28 Jul | loco slot `-1` differs · 409 and 410 planned only · 415 reported only | *Loco 470 in place of 471, 409 and 410 Byee missing and 415 Byee extra.* |
| 7 Jul | 409 planned only · 411 and 413 differ · slot `1006` reported only | *409 Byee missing, 411 Apee in place of Apmz, 413 Bmz in place of Bpmee and an extra loco 471.* |

**7 July is the check.** `411` is one amber change and nothing else. An earlier
position-paired version produced an amber change *and* a red missing coach for that single
substitution, which is the specific bug the car-number pairing exists to prevent.

Two more measured constraints on the same train set: `937` ran twice as a single 815 unit
whose car number is the range `11-16`, so the slot function takes the leading digits; and one
composition spans a 19 m locomotive, a 26 m coach, a 75 m 415 unit and a 154 m 815
double-decker, which is why the strip's scale is per view rather than a constant.

### Payload size

| | Pretty-printed on disk | Minified | gzip | **brotli, i.e. the wire** |
| --- | --- | --- | --- | --- |
| `data-2026-08-04.json`, 290 rows | 4.68 MB | 1.79 MB | 0.16 MB | **0.07 MB** |
| `data-2026-08-12.json`, 273 rows | 4.89 MB | 1.85 MB | 0.18 MB | **0.08 MB** |

Two corrections to the figure everyone quotes. The capture files are pretty-printed, so their
size on disk overstates the payload by about 2.7×. And the payload is **served compressed**:
brotli takes it to **4 %** of minified, roughly **75 KB per poll**, because the response is
thousands of repetitions of the same keys and the same station names. So an open tab costs on
the order of 150 KB/min, not the 3.5 MB/min the raw figure suggests.

The uncompressed 1.8 MB still matters in one place: it is the basis of the 1.8 MB → 6 MB
comparison that keeps `trip.geometry` out of the list query. That comparison is relative and
both sides compress, so the conclusion is unaffected — but the raw numbers are not wire sizes.

### Schema shape, checked field by field

A full pass over the captures against every field `SPEC.md` names. Everything held except
where noted, and both exceptions are now closed:

| Claim | Result |
| --- | --- |
| `route.agency { id name }` | Present and populated, both fields. Two agencies only, `MÁV Személyszállítási Zrt.` and `GYSEV Zrt.` |
| `trip.geometry` absent from the list query | Correct, and confirmed fetchable per trip |
| Delays in seconds, `textColor` a bare 6-digit hex, `fontCode` numeric | All correct on every row |
| Alerts always carry `effectiveStartDate` / `effectiveEndDate` | Correct, which is what makes the effective-window filter possible |
| **Stops carry `lat` / `lon`** | Absent from the first three captures, **present and populated on all 3616 stoptimes of the 12 Aug capture**, foreign stations included. This was once thought to block the station dots; it does not |
| **A separate `platform` field** | **Does not exist, and is not needed.** The only platform value is `stop.platformCode`, a bare string such as `"3"`, and `platformColor` is a sibling of it on the stoptime. `SPEC.md` renders `Pl. <platformCode>`; there is no field it is failing to read |
| `modes` on the route | Not returned, and not wanted. `modes: [RAIL]` is a **query argument**, so the filtering happens upstream and never in the client |

### Fields present but never varying

Observed on 100 % of records in all four captures, with a single value throughout:

| Field | Records | Only value seen |
| --- | --- | --- |
| `displayable` | 1879 / 1989 / 1556 | `true` |
| `alertUrl` | 113 / 150 / 131 | `null` |
| `alertHeaderText` | 113 / 150 / 131 | `""` |
| `label` | 290 / 281 / 230 | `""` or `null` |

`realtimeState` is present on every stoptime and takes exactly three values: `MODIFIED`,
`UPDATED` and `SCHEDULED`. Nothing else occurs in any capture.

`label` is never populated in any capture, so it has been dropped from the query rather than
described as unreliable.

### How a portioned train arrives in the feed

`KÁLMÁN IMRE`, 7 Aug, `vehicleId 1:918111161348`, three rows sharing one `route.id` and one
position, all three `IN_TRANSIT_TO Tatabánya`. This is the evidence behind SPEC.md §7.1's
prefix-deduplication rule and behind `TimelineRow` keying on an array index.

**Each portion is a whole journey, so the shared prefix arrives three times.**

| Number | Stops | Route | Positions |
| --- | --- | --- | --- |
| `462` | 11 | Budapest-Keleti to Salzburg Hbf | 1, 3, 15, 30, 35, 37, 50, 51, 53, 56, 61 |
| `50462` | 17 | Budapest-Keleti to Stuttgart Hbf | the same 11, then 67, 68, 71, 73, 74, 76 |
| `40462` | 15 | Budapest-Keleti to Zürich HB | the same 11, then 67, 74, 79, 81 |

The first eleven rows are identical across all three in stop name, `stopPosition`,
`scheduledArrival`, `arrivalDelay`, `departureDelay` and `platformCode`. The **only** field
that differs is `realtimeState`: `MODIFIED` on `462` against `UPDATED` on the other two, on all
six realtime-backed prefix stops. §7.3 treats those two values identically, so there is no
observed conflict for the merge to resolve.

**The tails reuse each other's `stopPosition` values**, which is what rules positions out as a
key on a merged trip:

| Position | On the Stuttgart tail | On the Zürich tail |
| --- | --- | --- |
| 67 | Rosenheim | Innsbruck Hbf |
| 74 | Göppingen | Feldkirch |

Note this does **not** contradict the multi-leg finding that leg position spans never overlap.
That holds for legs of one trip under one canonical id. Portions carry **different** canonical
ids (`Trip:1:33694752`, `Trip:1:33723799`, `Trip:1:33723770`), so they are three separate
groups that the `vehicleId` collision rules merge afterwards, and nothing guarantees their
numbering is disjoint.

### Geometry, settled against the live API on 18 Aug 2026

Both questions SPEC.md §11 left open are now measured, against the live endpoint. The numbers
below are the record; **the responses themselves were not kept**, so there is no geometry
fixture and the route line is developed against the live query.

**Canonical trip ids are stable across days.** `8995` is `1:34133410` and `8905` is
`1:34133409` in the 4, 5 and 12 Aug captures alike, so an id from a capture still resolves
today. `351 DRÁVA` is the exception (`1:34237477` on 5 Aug, `1:34710053` on 12 Aug) because
the engineering closure changed the trip itself, which is consistent with §7.1's rule that the
multi-leg split is temporary.

#### A merged multi-leg trip returns ONE leg, and not necessarily the active one

| Query | Points | Line runs | Which leg |
| --- | --- | --- | --- |
| `1:34133410` (`8995` canonical) | 217 | Pécs to Vízvár | positions 1 to 19 |
| `1:34133410.30576991` | 649 | Gyékényes to Szombathely | positions 24 to 59 |
| `1:34710053` (`351` canonical) | 2744 | Ljubljana to Graz Hbf | positions 1 to 26 |
| `1:34710053.30705463` | 1215 | Szentgotthárd to Budapest-Kelenföld | positions 47 to 110 |

Endpoints match the stop records exactly: `8995`'s line begins at `46.065833, 18.223611`
against Pécs's `46.06583, 18.22361`, and `351`'s second leg ends at `47.46444, 19.02000`
against Budapest-Kelenföld's identical pair.

Three findings, in order of how much they change:

- **The canonical id addresses the leg whose raw `trip.id` carries no `.` suffix**, and returns
  that leg's shape alone. It is **not** "the active leg", which is what `api.md` guessed. On
  `351 DRÁVA` the unsuffixed leg is the **foreign** one, Ljubljana to Graz, while the leg the
  train is actually running, 18/18 realtime-backed and the only half a Hungarian user cares
  about, is the suffixed one. Fetching by canonical id alone draws the wrong half of that train.
- **The suffixed id is queryable and returns the other leg**, exactly. So a merged trip is
  **one fetch per leg**, keyed by each leg's raw id, and `api.md`'s claim that it "needs one
  fetch, not one per leg" is wrong.
- **No returned line ever spans a gap.** The feared case, where the base trip's unbroken
  original route is returned and the map draws rail through a closed section, does not occur:
  `8995` stops dead at Vízvár and `351` at Graz Hbf. Legs never overlap either, so the per-leg
  lines need no trimming.

#### A portioned train returns the whole journey per portion, sharing a trunk

`KÁLMÁN IMRE`, the three ids verified in the portion section above:

| Query | Points | Line runs | Length |
| --- | --- | --- | --- |
| `1:33694752` (`462`, primary) | 3527 | Budapest-Keleti to Salzburg Hbf | 568.0 km |
| `1:33723799` (`50462`) | 6899 | Budapest-Keleti to Stuttgart Hbf | 956.3 km |
| `1:33723770` (`40462`) | 9539 | Budapest-Keleti to Zürich HB | 1071.9 km |

All three begin at the identical point `19.084167, 47.500278`. So geometry mirrors how the feed
publishes stoptimes: **each portion is a complete journey from the origin**, not a tail. The
primary's line does stop at the fork, as expected, so one fetch by the primary's id leaves the
Stuttgart and Zürich portions undrawn.

**The overlap is exact, which makes trimming trivial.** The shared points are byte-identical
coordinate pairs, so the divergence point is a longest common prefix over the arrays and needs
no geometry maths:

| Pair | Common leading points |
| --- | --- |
| `462` vs `50462` | 3520 |
| `462` vs `40462` | 3520 |
| `50462` vs `40462` | 4346 |

Two details worth keeping. `462` is **not** a strict prefix of the others: it shares 3520 points
and then has 7 of its own, the approach into the platform it terminates at. And `50462` and
`40462` run together for a further 826 points past Salzburg, toward Rosenheim, before splitting,
so the shape is a genuine tree rather than one trunk and N branches.

#### What did not resolve

`75 CLAUDIOPOLIS`'s two portion ids from the 5 Aug capture (`1:32391220`, `1:32485101`) return
`trip: null` on every service day tried. Stale ids for a trip whose shape has since changed, the
same thing that happened to `351`. Not pursued: `462` answered the question.
