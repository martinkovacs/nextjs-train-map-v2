# Live train map — implementation spec

The authoritative build document. `plan/plan.html` is the **visual** reference: open it in a
browser to see the selected components live.

**This file states rules, not measurements.** The counts, worked examples and collision cases
behind them are in **`plan/findings.md`** — when a rule here looks arbitrary, that is where the
evidence is. Keep the split when editing: dated per-capture prose there, timeless rules here.
The upstream API is in `plan/api.md`, the vagonweb upstream in `plan/vagonweb.md`.

Sections 1–5 of `plan.html` each show three or four alternatives. **Only the ones marked SELECTED
are built**; the rejected ones document why, and their pros/cons are not requirements.

| Part | Selected | plan.html |
| --- | --- | --- |
| Train marker | **A — fused wedge** | §1, first card |
| Search | **B — docked, with the source toggle** | §2, second card |
| Hover card | **D — icon rows + alert list** | §3, fourth card |
| Detail panel | **C — table rows** | §4, third card |
| Error surface | **B — bottom-centre toast** | §5 |
| Carriage composition | **A — strip, one tab per day** | §4b |

---

## 1. Stack and architecture

- **Next 16.2.12**, React 19.2.4, TypeScript, Tailwind v4, React Compiler on. The bundled docs at
  `node_modules/next/dist/docs/` are the source of truth for framework APIs — read the relevant
  guide before writing route handlers or client boundaries.
- **State: Zustand.** One store: normalised trains, selected trip id, current `FeedError`. The
  marker layer reads it imperatively and is never a subscriber, so a poll re-renders the hover card,
  panel, search and toast only, never 400 markers.
- **Leaflet directly, no react-leaflet** (§3). One client component owns the map and a
  `Map<canonicalTripId, L.Marker>`; markers are `L.divIcon` with inline SVG, driven imperatively.
  Needs `ssr: false` — Leaflet touches `window` at import.
- **HTML parsing: Cheerio**, server-side, for vagonweb (§6.5). Not regexes: its markup carries
  multi-line attribute values and multi-class hooks a line-based scan silently misses. The regexes
  in `plan/vagonweb.md` are reference behaviour, not the implementation to copy.
- **Styling:** Tailwind wherever a design converts faithfully; hand-written CSS only where it does
  not — the marker SVG, the timeline rail system, the delay-colour tokens. Where a piece is easier
  as typed code than classes (marker geometry, delay-bucket lookup), it is a TS helper.

**Validation: Zod**, in the route handler, on the raw response before normalisation. Invalid rows
are dropped and counted; the count is §10 #7a.

- **Strict only on what the app cannot work without:** `trip.id`, `lat`, `lon`, `heading`,
  `tripShortName`, non-empty `stoptimes`. A row missing one has nothing to render.
- **Value sets are validated leniently.** `platformColor` and `realtimeState` are typed in §7.0 as
  three values each because that is all four captures contain, but the schema takes any string and
  the normaliser falls back — unrecognised colour renders neutral, unrecognised state is treated as
  `SCHEDULED`, each with one `console.warn`. A strict enum would let one new upstream value drop
  every stoptime and empty the map, the failure §10 exists to prevent.
- **`isEstimated` and `stop.lat`/`stop.lon` are optional** — they arrived with the 12 Aug capture and
  requiring them fails every row of the older three. Missing `isEstimated` is false; a stop without
  coordinates gets no dot on the route line (§3).

### Data flow

```
browser  --30 s poll-->  app/api/vehicles/route.ts  -->  VPS proxy (pass-through)  -->  MÁV GraphQL
```

The upstream needs a Hungarian IP, hence the VPS; it does nothing else, so treat it as one hop.

- **Poll interval 30 s.** The client fetches with `cache: 'no-store'`, or the browser serves its own
  copy and the poll stops polling.
- **Route handler caches 30 s**: `public, s-maxage=30, stale-while-revalidate=30`, CDN-held, so
  upstream sees ~2 requests/min regardless of tab count. **Not `use cache`:** it needs
  `cacheComponents: true` (changes dynamic-IO rules project-wide) and its default cache is in-memory
  and therefore per instance, so it does not buy the shared guarantee it looks like it buys. No hard
  rate limit upstream, but do not lower the 30 s without a reason.
- **Worst-case data age is ~60 s, not 30**: a request 30–60 s after the last upstream fetch is
  answered stale while the refresh runs behind it, and the client holds that answer until its next
  poll. Both windows are deliberate — they keep upstream at ~2 requests/min, and minute-old
  positions on minute-resolution data (§7.3) lose nothing. Drop `stale-while-revalidate` for a
  fresher worst case, at the cost of a slower poll on expiry.
- Bounding box is **fixed** (the country box from the sample query), not viewport-driven.
- `trip.geometry` is **omitted** from the list query and fetched separately on selection.
- The response is **normalised server-side** (§7.1) — merged, deduplicated, classified once per
  upstream fetch, so the 30 s cache pays for it once and no tab repeats the work.
- Diff incoming trains by **canonical trip id**, never `vehicleId` (not unique within a response).
  Update markers in place: mutate attributes and CSS variables, never re-create the `divIcon`.

### Routes, timeouts and environment

Five route handlers and one env var. Nothing else talks to a third party.

| Route | Upstream | Cache |
| --- | --- | --- |
| `app/api/vehicles` | MÁV, via the VPS | `s-maxage=30, stale-while-revalidate=30` |
| `app/api/geometry/[tripId]` | MÁV, via the VPS | `s-maxage=86400`; a shape does not change while the trip runs, so it is fetched once per selected train and held |
| `app/api/vw-search` | vagonweb `razeni.php` | `s-maxage=86400` **and** a client session cache keyed by the folded query (§4.1) |
| `app/api/composition` | vagonweb `vlak.php` | `s-maxage=86400, stale-while-revalidate=86400` (§6.5) |
| `app/api/vehicle-image` | vagonweb GIFs | `max-age=2592000`, 30 days (§6.5) |

- **Geometry goes through the VPS too** — same MÁV endpoint, same Hungarian IP; a separate route
  only to carry a different cache lifetime. Query is
  `trip(id: "1:33315406", serviceDay: "2026-08-12") { geometry }`: the id with `Trip:` stripped, and
  the service day as `YYYY-MM-DD` in `Europe/Budapest` from `stoptimes[0].serviceDay` (§7.3).
  Verbatim query and response in `api.md`.
- **`serviceDay` travels as a query parameter** (`/api/geometry/1:33315406?serviceDay=2026-08-12`),
  from the trip's own value (§7.0), never today's date, which is wrong for a trip running past
  midnight. **It varies the cache key but never the answer** — a shape belongs to the route, not the
  day — so the worst cost is a duplicate entry of identical bytes. Do not strip it to force one entry.
- **Geometry is fetched once per *published row*, not once per trip** (measured, `findings.md`
  18 Aug 2026): §7.1's merge collapses several rows into one train, but each row owns a piece of the
  shape and only its own id addresses that piece.
  - **Merged multi-leg trip: one fetch per leg, keyed by each leg's raw `trip.id`** — decoded and
    `Trip:`-stripped but with the `.` suffix **kept**. **Never fetch by the canonical id alone:** it
    addresses the *unsuffixed* leg whichever leg is running, which on `351 DRÁVA` draws the
    Ljubljana–Graz half and leaves the Hungarian one undrawn. Legs never overlap, so the polylines
    need no reconciliation, and **no returned line ever spans a gap**.
  - **Portioned train: one fetch per portion, keyed by each portion's own canonical id** — the
    primary's line stops at the fork, so fetching it alone leaves every tail undrawn. Each portion
    returns the **whole journey from the origin** (mirroring its stoptimes, §7.1), so they share a
    trunk that a naive draw overlays N times. **Trim on the longest common prefix of the coordinate
    arrays**: shared points are byte-identical pairs, so the divergence index is an array comparison
    needing no geometry maths. Draw the primary in full, then each subsequent portion from `max`
    over the already-drawn portions of its common-prefix length with each — the shape is a tree, not
    a trunk with N branches, and two tails can run together past the fork.
- **The cache key is the id actually queried**, so every leg and portion caches independently under
  the same `s-maxage=86400`; a composite train costs 2–3 entries. **If one of several fetches fails,
  draw the ones that succeeded** and raise §10 #11 for the rest.
- **The two vagonweb routes pass their upstream's own inputs through, unchanged.**
  `/api/composition?zeme=MÁV&kategorie=Ex&cislo=849&rok=2026` is exactly the four inputs `vlak.php`
  takes (`plan/vagonweb.md`), which is also §6.5's cache key — four parameters rather than one
  composite key, so the handler cannot assemble the wrong record. `kategorie` is **optional and
  omitted when unmapped**, vagonweb.md's degrade path and not an error.
  **A fifth parameter, `nazev`, is a checksum and never a request input.** It carries the name
  derived from `tripShortName`, it is **never** put on the `vlak.php` URL (a wrong `nazev` returns
  the shell, which is why vagonweb.md forbids sending it) and it is **not** part of the cache key,
  so it cannot split one record into two entries. It exists for the two places the name is the only
  discriminator: `info_vlak`'s *verify, do not trust* check, and `pickFromSearch`, whose top two
  preference tiers are name matches and which silently degrades to "first row with the right
  category" when the name is empty.
  `/api/vw-search?jmeno=<the query as typed>&rok=2026`: year from the selected trip's `serviceDay`
  when there is one, today otherwise; always page 1, never `&s=2`. **The query goes upstream
  unfolded.** `fold()` (§4) is the local index's matcher and the session cache key, and it stops
  there. **Measured 30 Aug 2026** (`findings.md`): vagonweb folds accented vowels, so `topart` and
  `Tópart` return the same 48 rows, but it does **not** fold Czech carons, and `krakonos` returns
  **0** rows against `Krakonoš`'s 16. Folding would therefore be invisible on Hungarian names and
  silently empty the list on Czech and Slovak ones, which RegioJet files under.
- **`app/api/vehicle-image?src=<encoded path>` is an open proxy unless guarded.** Resolve the `..`
  segments in vagonweb's own paths (`../popisy/img/ELOC/../D-/…`) **before** the path becomes the
  cache key, then reject anything not resolving inside `vagonweb.cz/popisy/img/`. **The path is a
  query parameter, not a route segment**: vagonweb's paths are multi-segment and carry `..`, which
  a single `[name]` cannot hold and a catch-all would let the router normalise before the guard
  ever sees it.
- **Upstream timeout 10 s**, via `AbortSignal.timeout`; this is what §10 #4's `504` is raised from.
  vagonweb gets the same 10 s.
- **`UPSTREAM_URL`** — the MÁV endpoint via the VPS. `.env.local`, never committed.
- **No second env var.** `vlak.php` wants *a* `Referer` and does not care which, so send
  **`https://www.vagonweb.cz/`** as a constant; tile requests come from the browser, which sets its
  own. The `User-Agent` names the app, without a URL.

### Scope boundaries

- Rail only (`modes: [RAIL]`). Nothing about train type is branched on in code anyway — the colour
  comes from `route.textColor` (§2).
- No station search, clustering, filters, dark mode, tests or analytics in v1.
- Light theme only, but **every colour is a CSS custom property**, so dark mode is a second token
  block plus a basemap swap, with no component changes.
- Targets: latest Chrome, Firefox, iOS Safari. `:has()` and modern CSS are fair game.
- **UI language English.** Hungarian feed values (alerts, info services, station names) render
  verbatim inside it and are never translated.
- Basemap: standard OSM tiles. No quota, an acceptable-use policy — attribution, a real identifying
  User-Agent/Referer, no bulk downloading, OSMF may block heavy users. Carto Positron is a drop-in
  swap if traffic grows.

---

## 2. Design tokens

### Delay scale — the single most important semantic

Bucketed from the trip's **resolved delay** in seconds, which is not simply the next stop's
`arrivalDelay` — see §7.2 and do not shortcut it. Identical on the marker fill, the search list and
the timeline.

| Bucket | Seconds | Fill | Ink |
| --- | --- | --- | --- |
| Early | `< 0` | `#0ea5e9` blue | `#0369a1` |
| 0–5 min | `0 … 299` | `#16a34a` green | `#15803d` |
| 5–15 min | `300 … 899` | `#eab308` yellow | `#a16207` |
| 15–30 min | `900 … 1799` | `#f97316` orange | `#c2410c` |
| 30 min + | `≥ 1800` | `#dc2626` red | `#b91c1c` |
| No realtime | `null` | `#8b93a3` grey | `#6b7280` |

`null` means *no realtime exists*, resolved by §7.2. It is never the raw `arrivalDelay`, which is
`0` on a stop with no realtime.

**Two tiers, and only the fill tier is a five-bucket scale.** **Fill** is for shapes: marker rings
and the 7 px dot in every written delay. It is **not** the route line's station dots, which carry
journey progress and take `--past`/`--now`/`--future`, so map and timeline agree (§3). **Ink** is
the same hue darkened for text, and exists because the fills were chosen against a basemap, not
white (`#eab308` on white is ~1.9:1; every ink clears 4.5:1). **Only three inks are ever used** —
*On time*, early, *No data* — because a written delay is `--red` in every bucket. `--di-slight`,
`--di-late` and `--di-severe` stay defined as the correct darkenings if a surface needs them, and
for dark mode. `--di-ontime` and `--di-severe` deliberately equal `--ok` and `--red`.

```ts
export const delayColor = (s: number | null) =>
  s == null ? 'var(--d-unknown)' :
  s < 0     ? 'var(--d-early)'   :
  s < 300   ? 'var(--d-ontime)'  :
  s < 900   ? 'var(--d-slight)'  :
  s < 1800  ? 'var(--d-late)'    :
              'var(--d-severe)';

/** How the delay NUMBER is coloured. NOT the same ladder: the dot beside it already
 *  carries the exact bucket, and a delay reads as red. Only the states that are not a
 *  delay take an ink of their own, because painting "On time" or "No data" red lies.
 *  Text never reads a --d-* fill token. */
export const delayInk = (s: number | null) =>
  s == null ? 'var(--di-unknown)' :   // No data
  s <= -60  ? 'var(--di-early)'   :   // early. `<=`, not `<`: the data is minute-resolution,
                                      // so exactly -60 is a real value and one minute early
                                      // must not read as On time (§7.3)
  s < 60    ? 'var(--di-ontime)'  :   // On time
              'var(--red)';           // late, whichever bucket
```

### How a delay is written, on every surface

**One component**, used by the hover card row 2, the search result row and the timeline sub-line,
so the three can never drift. Referred to below as *the dot-and-ink rule*.

- **A dot, then the number.** A 7 px dot in the bucket's **fill** colour, drawn as an element
  (`border-radius:50%`, `display:block` in the flex row) and **never a glyph**, then the delay at
  700 in **`--red`**. **The dot carries the five-bucket scale; the number does not** — red is what
  a delay means, and the dot already says how late. The number leaves red only for the states that
  are not a delay: `--di-ontime` for *On time*, `--di-early` for early, `--di-unknown` for
  *No data*. Colouring those red would lie; colouring a real delay yellow-brown made it read as a
  category rather than as lateness.
- **No background and no chip** — §5's plain-text decision stands, and the dot replaces the colour
  a filled pill would have carried.
- **Under a minute** reads `On time`, **negative** reads `−N min` early, **null** reads `No data`
  with the grey dot. The column is never blank on any surface.

### Train type colour

**Always `trip.route.textColor`**, a bare hex such as `274F96` needing a `#`. No category lookup,
nothing about train type hardcoded. It is effectively guaranteed, so the fallback is deliberately
**not** plausible-looking:

```ts
const typeColor = (hex?: string | null) => hex ? `#${hex}` : '#ffffff';
```

A white ring reads as broken against every basemap, which is the point. Do not replace it with a
category lookup or a neutral grey.

### Typefaces

**Geist and Geist Mono** via `next/font` in `app/layout.tsx` (the scaffold already does this),
exposed as `--font-geist-sans` / `--font-geist-mono`. **Both need `subsets: ['latin', 'latin-ext']`**
— the scaffold ships `['latin']` alone, which has no `ő` or `ű`, so every station name carrying one
falls back to a system font mid-word and takes the measured line boxes below with it. Every component reads two tokens:

```
--sans: var(--font-geist-sans)   --mono: var(--font-geist-mono)
```

Nothing names a family directly, so a typeface change is these two lines. The only exception is
MNR2007 below, which is data rather than typography.

**Geist Mono carries the tabular columns**: ARR/DEP cells (§6), the record line (§4.1), the toast's
technical lines (§10), all with `font-variant-numeric: tabular-nums`. **All three geometries were
re-measured against Geist on 30 Aug 2026 and hold** (`findings.md`): the 22 px line boxes against a
1.300 em natural line box and 1.068 em of worst-case ink, and the 52 px minimum time column against
a `10:29` that is 43.50 px wide, Geist Mono's advance being exactly 0.600 em. Only the toast's
character limit moved, from ~46 to **50** (§10). Nothing here needs re-checking during the build.

**`tabular-nums` is load-bearing in the sans face, not a nicety.** Geist's digits are
**proportional** by default, from 384 units for `1` to 663, so an untabulated five-character time
swings **16 px** between `11:11` and `00:00`. Its `tnum` feature maps every digit to 600 units,
which is also exactly Geist Mono's advance, so a tabular sans time and a mono time are the same
width at the same size. Every numeric column, in either family, sets it.

### Other tokens

```
/* the delay scale above, as tokens: fills for shapes */
--d-early:#0ea5e9  --d-ontime:#16a34a  --d-slight:#eab308
--d-late:#f97316   --d-severe:#dc2626  --d-unknown:#8b93a3

/* the same five buckets, darkened for text. Never used on a marker or a dot */
--di-early:#0369a1 --di-ontime:#15803d --di-slight:#a16207
--di-late:#c2410c  --di-severe:#b91c1c --di-unknown:#6b7280

--w:#ffffff  --w-2:#f5f6f8  --w-line:#e3e6ec  --w-ink:#12141a  --w-ink-2:#5b6272
--past:#c3c9d4   --now:#2563eb   --future:#94a3b8        /* timeline progress */
--marker-ink:#14161c   /* the marker's contrast rings and wedge, §3. A structural colour,
                          not an ink: in dark mode it inverts to hold contrast against a
                          dark basemap, which is exactly why it is a token and not a hex */
--ok:#15803d           /* on-time times, confirmed platform */
--muted:#9aa1ae        /* struck-through scheduled times, meta text */

/* amber: "200 OK but do not trust it" — frozen feed, quiet train, geometry failure */
--amber:#92400e   --amber-bg:#fffbeb   --amber-border:#fde68a

/* blue: informational, and the info-service blocks */
--info:#1e40af    --info-bg:#f1f5fd    --info-border:#dbe4f6   --info-range:#5b78a8

/* search: highlighted result row */
--sel-bg:#eef2ff  --sel-outline:#c7d2fe   --mark:#fde68a
```

Every colour comes from a token; a hex literal in a component means a token is missing.

### The red scale

One ramp for every red. **No red is ever hardcoded.** The delay scale is a separate semantic and
keeps its own `--d-severe: #dc2626`.

| Token | Value | Used for |
| --- | --- | --- |
| `--red-dark` | `#7F1D1D` | the *delay grew* marker only, the strongest signal in the timeline |
| `--red` | `#B91C1C` | delay amounts, late times, alert text, error text |
| `--red-soft` | `#EF4444` | the *delay fell* marker: still late, just less late |
| `--red-bg` | `#FEF2F2` | alert blocks, error toasts |
| `--red-border` | `#FECACA` | the same surfaces' borders |

### MNR2007 font

`public/fonts/MNR2007.ttf` — **convert the whole font to WOFF2 and ship that. Do not subset it.**
The TTF drops to ~40 % as WOFF2, a bigger win than subsetting at no cost in coverage, so a
pictogram cannot go missing on a day you did not sample.

- Used **only** for MÁV pictograms: `String.fromCharCode(route.fontCode)` and
  `String.fromCharCode(infoService.fontCode)`, both `fontCharSet: "MNR2007"`.
- The route pictogram renders at ~23 px **in `route.textColor`**, not knocked out white on a chip.
- **One badge component in all three places** — hover card header, panel header, search rows.
- **Font failed to load** (`document.fonts.check()`): fall back to a plain chip in the type colour
  with **no text**. There is deliberately no category-to-abbreviation table (same reasoning as the
  colour), and a blank badge is itself a visible sign the font did not load.
- **A missing glyph needs its own fallback**, which `document.fonts.check()` cannot detect: the
  font loads and the codepoint still renders `.notdef`. **Check the codepoint against the font's
  own coverage and fall back per pictogram.**
- **The coverage list is generated at build time, not measured at runtime.** The same script that
  converts the TTF reads the `cmap` and emits the covered codepoints as a `Set` the app imports:
  one lookup, no per-render cost, and unfoolable in the way a canvas width comparison against
  `.notdef` is. **Re-run it whenever `MNR2007.ttf` is replaced** — that is the whole maintenance
  story.
- **Keep the check even though the current font covers every observed code.** It is a versioning
  problem, not a fixed list: an earlier copy was missing two codes the feed actively used, and the
  current copy adds over a hundred glyphs, so MÁV extends the font and a local copy can fall
  behind. Hard-coding today's gaps would encode the wrong thing.
- **It applies to info service pictograms too**, where a blank chip beside a service name would be
  meaningless: there the fallback is **render no pictogram and keep the text**.
- **Every other icon is an inline SVG** on a 20×20 viewBox, `display:block` inside an
  `align-items:center` flex row. Never a text glyph — the source of every alignment bug during
  design. Sprite in `plan.html`, three groups:
  - **UI:** `arrow, back, up, down, pin, speed, clock, warn, search, close, flag, refresh,
    offline, locate`. `locate` is a crosshair with exactly one user, §8's re-centre control; it is
    **not** `pin`, which means *next stop* in the hover card, and one glyph never means two things.
  - **Carriage amenities (§6.5):** `wifi, power, plug, ac, wc, bike, wheelchair, pram, camera,
    dining, screen, service, seat` — ours, standing in for vagonweb's pictograms, mapped from its
    filenames by the table in `plan/vagonweb.md`.
  - **Vehicle silhouettes (§6.5):** `c-loco, c-coach`, the fallback for a vehicle vagonweb has no
    drawing for. Not 20×20: own viewBox, sized to the vehicle box.

---

## 3. Train marker — design A, fused wedge

SVG 52×52, centre `26,26`, marker Ø ≈ 24 px. The canvas is 52 px because the wedge reaches `y=5`
and must stay inside at every rotation, **not** for a hit target: there is no transparent hit box.
`pointer-events:none` on the `<svg>`, `pointer-events:visiblePainted` on the rings and wedge, so
only the drawn marker is hoverable — otherwise a 52 px transparent square captures the pointer for
a train whose visible dot is 14 px away, and with no z-index management the train you hover is not
reliably the one you point at.

```
1. halo    circle r13, stroke var(--now)         3px, hidden; pulses when selected
2. wedge   path M26 5 L38.5 24.5 L13.5 24.5 Z, fill var(--marker-ink)   (drawn FIRST)
3. rings   circle r7.6  fill   delayColour
           circle r8.4  stroke var(--marker-ink) 1.6
           circle r9.9  stroke TYPE               1.4
           circle r11.3 stroke var(--marker-ink) 1.4
```

**Every colour here is a token, including the blacks** — the dark rings hold contrast against
motorway yellow, forest green and lake blue, and a dark basemap inverts that requirement, so
literals would make dark mode a code change to the marker. The delay fill and type colour are
already CSS custom properties on the marker element.

The wedge is drawn **before** the rings so its base is covered and it reads as one object. Ring
order is *black, type, black*: the inner black keeps a red delay fill off a dark-red type colour,
the outer black is the contrast ring against the basemap.

- Rotation applies to the wedge `<g>` only, `transform: rotate(Ndeg)`,
  `transform-origin: 26px 26px`, so the card anchor never rotates.
- `heading` is **always** honoured, including at `speed === 0` — a stationary train still faces a
  direction. There is no stopped state and no stale state.
- **Normalise the heading** with `((h % 360) + 360) % 360`; the feed returns negative and
  fractional values (`-98.865…`, `30.101…`). See §9.
- **Rotate along the shortest arc.** A plain CSS transition between `359deg` and `3deg` goes the
  long way, spinning the wedge backwards every time a train passes north. Keep an accumulated angle
  per marker and add the signed delta wrapped into `-180…180`.
- **Arrived** trains (§7.1) keep the ring stack, wedge and **their delay colour** — the delay they
  finished with (§7.2). The scale means the same thing on every surface, so a train that ended
  40 minutes late is red on the map, in the search row and in the panel alike. Arrival is
  carried by the panel and the hover card's *Arrived* row, not by draining the marker's colour.
- **No zoom-dependent variants.** An earlier draft collapsed to a dot below z8; dropped, and with
  it the only thing that would have forced `setIcon()` and broken "mutate in place".
- **Route line:** selecting a train draws its route and calling points (below). Other markers are
  **not** dimmed and keep full opacity.
- Overlapping markers overlap in API order. Leaflet stacks by insertion order and nothing manages
  z-index. No clustering, no spiderfy, no delay-based stacking.

### Movement between polls

Peak load is **300–400 markers** repositioned every 30 s. Two mechanisms, because Leaflet and we
own different properties:

| Property | Owner | How it animates |
| --- | --- | --- |
| Position | **Leaflet** owns the marker root's `translate3d()` and rewrites it on zoom | `setLatLng()` **once** per poll to the true position, then an inner `<div class="mv">` carries the marker there visually |
| Rotation | **us** — the inner `<g class="rot">`, untouched by Leaflet | CSS `transition: transform .45s cubic-bezier(.2,.7,.2,1)` |

**Never put a CSS transition on the marker root** — Leaflet's positioning writes the same
`transform` and a transition there fights it. Both animations live on inner elements we own.

**The 450 ms glide.** Per poll, per marker, two style writes and **no per-frame JavaScript**:

1. `setLatLng()` to the new position, so the real coordinate is correct immediately.
2. Compute the pixel delta between old and new at the current zoom, set
   `transform: translate3d(-dx, -dy, 0)` on `.mv`, transitions suppressed.
3. Next frame, set `translate3d(0,0,0)` with `transition: transform .45s cubic-bezier(.2,.7,.2,1)`.

Two requirements: snap `.mv` to `0,0` on `zoomstart`, since a delta computed at the old zoom is
meaningless at the new one; and keep `.mv` and `.rot` separate so translation and rotation never
write the same `transform`. Preferred over a `requestAnimationFrame` loop calling `setLatLng()` per frame, and not
mainly for speed: Leaflet's `_setPos` **rounds to whole pixels**, so a slow train at low zoom steps
between integer pixels instead of gliding, while `.mv` is our transform and therefore sub-pixel and
GPU-composited.

**Why 450 ms and not the full 30 s.** The glide is a transition, not a position claim, and the
duration is what keeps that true. `trip.geometry` is not in the list query and cannot be (§1 — it
takes the payload from 1.8 MB to 6 MB every 30 s), so any available interpolation draws a straight
line between two fixes and cuts the corner: at 100 km/h a train covers 833 m between polls, and on
a 2000 m radius curve the chord sags ~44 m off the track, under a pixel at z10 and ~7 px at z14.
Over 450 ms that is a transient nobody reads as data; over 30 s it becomes a claim, the marker
sitting the whole interval at a position MÁV never reported, permanently on the wrong side of every
curve — the same category of invention as computing a foreign arrival time from a carried delay,
which §7.2 forbids. Dead reckoning from `speed` and `heading` is rejected for the same reason, and
has no answer for the estimated batch, which reports no `speed` at all (§7.3). The glide earns its
keep at high zoom, where a train jumps 129 px per poll at z14 and a teleport among 400 markers
makes it hard to see what moved. **No exception for the selected train.**

### Route line and station dots

Rendered only for the **selected** train, removed when the selection clears.

- **The line** is `trip.geometry`, fetched on selection (§1), drawn as a polyline in the type
  colour. It arrives as **`[lon, lat]` pairs, the reverse of Leaflet's `[lat, lng]`** — swap each
  pair once where the fetch lands and never again (`api.md`).
- **A composite train is several polylines, all in the type colour** (§1): one per leg on a merged
  trip, one per portion on a portioned train, trimmed at the shared trunk. Separate rather than
  joined, because joining draws a straight chord across a leg gap or back down the trunk between
  portions — track that does not exist. **Nothing bridges the gap between legs**, exactly as
  nothing substitutes for a line that failed to load.
- **A dot at every calling point**, from `stoptimes.stop.lat`/`.lon`. `stopPosition` gaps are
  stations the trip passes through (§7.3) and correctly get no dot. A few dozen points at most.
- Use `L.circleMarker` — zoom-independent, shares the polyline's renderer. **Not interactive**,
  matching the rule that timeline stops are not either (§6). Below the train marker in z-order.
- **The dots mirror the timeline's progress states**, on the same tokens:

| State | Dot |
| --- | --- |
| Past | `r 3.5`, fill `--past`, 2 px white stroke |
| Current (`STOPPED_AT`) | `r 4.5`, white fill, 2.5 px `--now` stroke |
| Future | `r 3.5`, white fill, 2 px `--future` stroke |

- **The marker is never snapped onto the line and never animated along it.** Snapping moves a train
  to a position the feed did not report; interpolating along the shape invents the whole path
  between two fixes. The line is context for the fix, not a track to run the train down.
- **If the geometry fetch fails** (§10 #11), **no line is drawn.** The station dots stay, because
  stop coordinates are real data, but nothing connects them: a polyline through the calling points
  cuts every curve and skips the shape between them. The amber bar is the whole answer.
- Both sources are **confirmed against the live API**: `stop.lat`/`stop.lon` come back populated on
  every stoptime, foreign stations included, and `trip.geometry` returns the polyline.

### Why not react-leaflet, and what to do if 400 markers is slow

The marker layer has to be imperative either way, since 300–400 markers are mutated in place every
poll and animated by transforms we write directly. Once it is, react-leaflet wraps only the tile
layer, one polyline and the station dots — near-zero benefit for a dependency, a React-version
constraint, and a `setIcon()` that replaces the marker's DOM element, breaking both the rotation
transition and "mutate in place". A hybrid (react-leaflet shell + imperative layer via `useMap()`)
performs identically and was rejected only for earning nothing.

400 `divIcon`s is roughly 2400 SVG nodes, which modern browsers handle. If it is not enough: give
the ring stack a shared `<symbol>` referenced with `<use>`, passing the delay fill and type colour
as CSS custom properties per marker, collapsing per-marker markup to one `<use>` plus the wedge.
The movement animation is already off the hot path. Only then consider a canvas renderer, which
means giving up `divIcon` entirely: hand-drawn markers, manual hit-testing, no CSS hover states.

---

## 4. Search — design B, docked with the source toggle

One card, `border-radius:12px`, floating over the map: a 42 px input row with a 17 px search icon
`#7a8496`, then a row of three pills on a `1px var(--w-line)` top border, then the results on
another one. **One surface**, so the input, pills and list cannot disagree about their edges.

**Where it sits.** Desktop **top-centre**, floating clear of the map's top edge, results dropping
beneath. Mobile: **full screen width minus a margin, capped at 400 px**, at the top, so the input, the three pills
and the result rows all have room on a narrow phone — still a floating card with its own corners
and shadow, not a bar welded to the screen edge. The list opens under it, capped to the viewport
height minus the keyboard.

**The three floating surfaces and how they avoid each other.** Search top-centre, the carriage
composition card bottom-left (§6.5), the error toast bottom-centre (§10). Only the last two can
collide, on a narrow desktop window: when they would overlap, **the toast shifts right of the
composition card**. Neither ever moves the other, and neither may cover the detail panel.

**Two sources, and the pills say which is being searched:** **Current** (the map), **Vagonweb**
(the timetable) and **Both**. It **rests on Current**. §4.1 is the second source; everything here
is the first unless it says otherwise.

**The pills:** `font: 600 12px/1 var(--sans)`, `padding: 6px 10px`, `border-radius: 99px`, `1px
var(--w-line)` border on `#fff`, `var(--w-ink-2)` label. Lit: `background:#eef2ff`,
`border-color:#c7d2fe`, `color:#3730a3`. Exactly one lit at a time; the row is
`display:flex; gap:6px` in `8px 10px 9px`.

**The `/` badge in the mock is not built** — §9's keyboard decision stands, the field is clicked.
Drop the `<kbd>/</kbd>` from the input row.

### Matching

Hungarian accent folding via an explicit map — **not** NFD, because `ő`/`ű` decompose
inconsistently and this is length-preserving, which the `<mark>` highlighter depends on.

```ts
const ACCENTS: Record<string,string> = {
  'á':'a','é':'e','í':'i','ó':'o','ö':'o','ő':'o','ú':'u','ü':'u','ű':'u',
  'Á':'a','É':'e','Í':'i','Ó':'o','Ö':'o','Ő':'o','Ú':'u','Ü':'u','Ű':'u',
};
const ACCENT_RE = new RegExp(`[${Object.keys(ACCENTS).join('')}]`,'g');
export const fold = (s: string) => s.toLowerCase().replace(ACCENT_RE, m => ACCENTS[m] ?? m);
```

Both index and query are folded, so `füred`, `fured` and `fűred` all match.

**This is the app's only folding function**, including the vagonweb operator filter in §4.1.
`plan/vagonweb.md`'s second one is reference behaviour and is not shipped. Extend `ACCENTS` with
whatever letters the operator allow list actually meets rather than reaching for `normalize('NFD')`.

- **Index**, rebuilt each poll, from the normalised fields §7.0 emits and never from raw upstream
  rows: `number`, `name`, `category` (together `tripShortName`), `headsign`, `routeLongName`. The
  last is what makes a line-code search work at all — `route.longName` is where `S440`, `IR85` and
  `Z72` live and nothing else carries them. `headsign` is indexed but **never** rendered as a
  destination (§7.1: on a merged trip each leg reports its own last stop, so it flips mid-journey);
  the field the UI shows is `destination`.
- **Ranking:** exact number `100` > number prefix `80` > word-start in the name `60` > substring
  anywhere `30 − offset×0.1`. Ties broken by distance from map centre.
- **Empty query:** the 5 nearest trains to the viewport centre, and no vagonweb request.
- **Results are computed when the query changes, and only then.** Panning or zooming does **not**
  re-rank, so the centre used for tie-breaking and the empty-query list is whatever it was when the
  query last changed. A poll refreshes the delay and destination in rows already on screen but
  never reorders them, so a row cannot move out from under the pointer.
- **No match:** "No train matches …" plus a note that only trains on the map are searchable. Not
  "currently running": arrived trains stay on the map for 10 minutes (§7.1) and stay in the index,
  because finding the train you just got off is the point of keeping it.

### List and keyboard

- Exactly **5 rows visible** (`--row: 38px`, `max-height: calc(var(--row) * 5 + 10px)`), the rest
  scroll: `overflow-y:auto; overscroll-behavior:contain`. A group heading (§4.1) is **not** a row
  and is not counted: `600 10px/1.4 var(--sans)`, `letter-spacing:.08em`, uppercase,
  `var(--w-ink-2)`, in `9px 9px 3px`, its right-hand qualifier (*2026 timetable*) at `500`,
  `#98a0b0`, not uppercased. The same box holds the group's notes: `500 11.5px/1.4 var(--sans)`,
  `#98a0b0`, in `3px 9px 7px`. Neither takes a pointer.
- Row: type badge (the same MNR pictogram component as the panel) · number + name (bold, matched
  substring in `<mark>`) · arrow icon + destination (ellipsis) · delay right-aligned per the
  dot-and-ink rule. **The delay column is never empty** — no realtime reads `No data` on grey,
  under a minute reads `On time` on green — so a row never looks like it failed to render.
- Selected row: `background:var(--sel-bg)`, `outline:2px solid var(--sel-outline);
  outline-offset:-2px`.
- `role="combobox"` + `aria-activedescendant`; the input keeps focus, the list never takes it.
- Up/Down wrap, Home/End jump, <kbd>Enter</kbd> flies to the train and opens the panel,
  <kbd>Esc</kbd> closes.
- Mobile: list capped to viewport height minus keyboard, `enterkeyhint="search"`, tapping a result
  blurs the input first so the map is not hidden.
- No `/` shortcut (§9).

---

## 4.1 The vagonweb group

The map answers "where is this train"; it cannot answer "what is train 849 made of" when 849 is
not running, which is most of the day for most trains. vagonweb's search page can, so a second
group of results sits under the live ones and pressing one **opens the composition** (§6.5) rather
than moving the map. Upstream in `plan/vagonweb.md`, mock in `plan.html` §2.

`GET https://www.vagonweb.cz/razeni/razeni.php?rok=<year>&jmeno=<query>` through
`app/api/vw-search`, parsed server-side, the Czech HTML never reaching the browser. **This page
needs no `Referer`**, unlike `vlak.php`, which is what makes it usable behind a search field.

| Concern | Rule |
| --- | --- |
| When it fires | Debounced **400 ms**, minimum **2 characters**, one request in flight with the previous aborted, answers cached for the session under the folded query **and for 24 h on the CDN**, though the request itself carries the query **as typed** (§1). Two caches catch different things: the session cache stops one person's backspacing re-asking, the CDN cache stops a query anyone has run reaching vagonweb at all. This is timetable data and it is a volunteer site. The local list draws immediately and never waits for it. Nothing is requested while **Current** is lit. |
| What it matches | vagonweb matches `jmeno` against **the number and the train name only**. Not the route, not the operator. Number matching is a substring. |
| Operator filter | Keep **MÁV, GySEV, ÖBB and RegioJet**, the last under **both** codes it files with, **`RJ` and `RJSK`** (the Slovak arm). Drop everything else **silently**: a dropped row is not a result and is not counted at the user. Compare `zeme` through the same `fold()`, so `ÖBB` and `obb` are one operator. |
| Volume | Draw at most **6** rows and count the rest **of ours** (*"18 more on vagonweb."*). Fetch **page 1 only**, never `&s=2`. |
| Ordering | Live rows first, always. Within the vagonweb group, vagonweb's own order. |
| Failure | The group carries its own error under its own heading and the live list stays interactive. §10 #15. |
| Empty query | No request. vagonweb is asked a question, never browsed. |

**Duplicate-looking rows are two records, not one.** A jointly run train is filed once per operator
(`GySEV IC 929` and `MÁV IC 929`, differing by one stop) and one number can be filed under two
categories (`Ex 849` and `IC 849`, the Balaton summer). Show both, because each is a different
composition. Never deduplicate them.

### The rows

- **Group heading** above each source, shown only on **Both**: *On the map now* and *vagonweb.cz ·
  2026 timetable*. One source, no heading — the lit pill is the heading.
- **A vagonweb row:** category badge, **outlined rather than filled** so it cannot be mistaken for
  a live row · operator · number and name, matched substring in `<mark>` · both ends of the route ·
  a coach mark on the right where a live row carries its delay. **No delay column and no space
  held for one.**
- Rows of both kinds are options of the same listbox with one running index, so the arrow keys
  cross the boundary without noticing. The headings are not options.
- When nothing on the map matches but vagonweb has rows, say so above them: *Not on the map. These
  are timetable records, and they open a composition.*
- **The empty state names the pill that would have answered.** On **Current**: *Only trains on the
  map are searchable. Switch to Vagonweb for the timetable.* On **Vagonweb**: *No MÁV, GySEV, ÖBB
  or RegioJet train matches that in the 2026 timetable. Switch to Current for trains on the map.*
  On **Both**: *Not on the map, and vagonweb has no MÁV, GySEV, ÖBB or RegioJet train with that
  number either.* A match on one source is never a no-match, and the Vagonweb pill never claims
  anything about the map, which it did not search.

### What pressing one does

It opens **the composition card of §6.5, with no train selected.** It does not move the map, select
a marker or open the route: there may be no train to select.

- **Desktop:** the same floating card at the bottom-left. The panel stays closed.
- **Mobile:** the detail panel opens **directly on its composition page**. No route page behind it,
  so **no pager dots**, and the back button returns **to the search results**.
- Both carry one line the live card never does: *Not on the map. Timetable record, no live
  position.*
- The card is built from the row's own `zeme`, `kategorie`, `cislo` and `rok` — exactly the four
  inputs `vlak.php` takes — so the request needs nothing derived and cannot land on the wrong record.
  The row's `nazev` rides along as §1's checksum, and here it is vagonweb's **own** spelling rather
  than one derived from the feed, so the `info_vlak` check is exact.
- **While the request is out**, the card is already on screen with its header, record line and *not
  on the map* strip filled in from the row, a shimmer where the vehicles go and *"Fetching from
  vagonweb.cz"* in the footer. The row was pressed, so something opens immediately.
- **The record line** under the header states those inputs back in URL order: `MÁV Ex 849` ·
  *Tópart* · *timetable 2026*, the year pushed right. **One font family at one size for the whole
  line** — `12.5px/18px var(--mono)`, `font-variant-numeric: tabular-nums`, `align-items:baseline`
  — with **weight and colour** carrying the difference: 700 `--w-ink` for the record, 700 `#4c566b`
  for the name, 500 `#9aa1ae` for the year. Mixing mono and sans at different sizes put three
  baselines on one row, which no alignment property fixes.

---

## 5. Hover card — design D, icon rows + alert list

Width **330 px**, base font 13 px.

```
┌────────────────────────────────────────┐
│ [IC]  19705 KÉK HULLÁM InterCity       │  header, border-bottom
├────────────────────────────────────────┤
│ [flag] Budapest-Déli     [speed] 7 km/h│  row 1
│ [pin]  Balatonalmádi 13:33 Pl.2 +13 min│  row 2
├────────────────────────────────────────┤
│ [warn] Vonat műszaki hibája miatti k…  │  one row per alert,
│ [warn] Pályakarbantartási munkák mia…  │  ellipsis + title attr
└────────────────────────────────────────┘
```

**The alignment rule that matters:** both middle rows are `.ttD-row`, forcing **one font family,
one size (14.5 px) and one 22 px line box on every child**.

```css
.ttD-row { display:flex; align-items:center; gap:8px; min-width:0 }
.ttD-row, .ttD-row * { font-size:14.5px; line-height:22px }
.ttD-row .num  { font-family:inherit; font-variant-numeric:tabular-nums }
.ttD-row .plat { font-size:inherit }
```

Mixing a monospace time with sans text and a smaller platform label is what threw the row off axis.
Do not reintroduce a monospace family or a distinct platform size in these rows.

- **Row 1:** flag icon, destination (bold, ellipsis), speed pushed right with a gauge icon. **On an
  `isEstimated` train the speed slot reads *Position estimated*** in `--w-ink-2` at the row's size,
  no gauge icon. Those rows carry `speed: null` anyway (§7.3), so the slot is empty regardless and
  this fills it with the reason: MÁV computed that position rather than measuring it, and
  `findings.md` measures it as visibly looser, so showing it silently as a measured fix would be
  the one place the plan presents an invention as real. The **marker is untouched** (§3's rule that
  no marker changes appearance for a data-quality reason holds), and 8–15 trains per poll are
  affected.
- **Row 2:** pin icon, station (ellipsis — this is what truncates), arrival time (bold, tabular),
  platform, delay pushed right per the dot-and-ink rule, **no background**. The `+13 min` above is
  therefore a 7 px `--d-slight` dot followed by `--red` text.
- **Alerts:** one row each, warning icon + text truncated with an ellipsis, full string in `title`.
  Card height varies with the alert count, so the anchor must be measured.
- **Desktop:** opens after 60 ms hover, closes after 120 ms grace. `pointer-events:none`.
- **Mobile:** single tap opens it and selects the marker; tap elsewhere closes. Double tap opens
  the panel (§9 suppresses Leaflet's double-tap zoom for marker targets only), so the card anchors
  **above** the dot, clear of the second tap.
- **"Next stop" wording** from `stopRelationship.status`: `IN_TRANSIT_TO` gives *Next*,
  `STOPPED_AT` gives *At*. Matched to the stoptime by stop name.
- **Arrived** trains (§7.1 clause b) have neither status and stay 10 minutes, so row 2 reads
  *Arrived*, the terminus and the arrival time: `Arrived Budapest-Déli 11:54`. The delay it
  finished with stays on the right (§7.2).
- **A train retained under clause (c)** — finished, but only the timetable says so — reads *Due*,
  the terminus and the **scheduled** arrival: `Due Budapest-Déli 11:54`, grey per the `SCHEDULED`
  rule. A different word because it is a different claim: nothing has reported this train arriving.
  Its delay is whatever §7.2 resolves — usually carried forward or `No data`, never an arrival
  delay it never had. §10 #13c is what happens when it drops.

---

## 6. Detail panel — design C, table rows

Width **420 px** desktop (confirmed), base font 15 px, max-height the viewport. Right-docked, full
height, map pans left so the train stays visible. Mobile: full-height overlay with a close button
(§9 — no drag-to-dismiss in v1).

### Contents, in order

1. **Header** — type pictogram; the train name **including the category** (`19705 KÉK HULLÁM
   InterCity`, 17.5 px bold); an **origin to destination** sub-line (`Tapolca [arrow]
   Budapest-Déli`, 14 px, arrow is the SVG); close button. Structurally identical to the hover card
   header. On a multi-leg trip the sub-line spans every leg; on a portioned train it names **every**
   destination and also lists the other train numbers, since any of them identifies the same
   physical train (§7.1, §8). When the delay is carried forward it gets one more line, `+53 min at
   Hegyeshalom` (§7.2).
2. **Alerts** — every currently-effective alert, no tabs.
3. **Info services** — every service, sorted by `order`, no tabs.
4. **`Route`** heading, then the column header `STOP · ARR · DEP`, then the table.

**No tabs over the trip's own data.** Nothing the feed says about this train is a click away.
Carriage composition (§6.5) is a separate upstream keyed by date rather than part of the trip, so
its per-day tabs do not breach this.

### Table rows

```css
.tl3 li { display:grid; grid-template-columns:1fr auto auto; align-items:center;
          gap:11px; padding:11px 2px 11px 27px; --rail:8px; --dc:50% }
```

- **Left cell:** station name (16 px, 600) with a sub-line holding platform, delay (`+21 min`, 700,
  13.5 px, per the dot-and-ink rule so the row's delay carries the same bucket colour the marker
  does) and the *delay grew* marker. The sub-line pins a **20 px line box on every child** and the
  grew marker is set at the same 13.5 px as the delay — a smaller font in a centred flex row is
  what kept it looking a pixel off.
- **ARR / DEP cells:** monospace tabular, 14.5 px, min-width 52 px. Scheduled struck through above
  the realtime value when they differ.
- **Row separator** is a background layer, not a `border-bottom`, so it stops clear of the rail
  instead of crossing it. `:last-child` drops it.
  ```css
  background-image: linear-gradient(to right, transparent 0 20px, var(--w-line) 20px);
  background-size: 100% 1px; background-position: 0 100%; background-repeat: no-repeat;
  ```

### The rail system

Each `<li>` draws **two half-connectors meeting at its dot centre** (`--dc`). `:first-child` hides
the upper half and `:last-child` the lower, so a connector can never overshoot the terminus.

```css
.tl li::before, .tl li::after { position:absolute; left:var(--rail); width:2px; margin-left:-1px }
.tl li::before { top:0; height:var(--dc) }
.tl li::after  { top:var(--dc); bottom:0 }
.tl li:first-child::before, .tl li:last-child::after { display:none }
.tl li[hidden] { display:none }   /* grid display beats the UA [hidden] rule */
```

### Progress states — design only, no words

| State | Dot | Line above | Row |
| --- | --- | --- | --- |
| Past | 9 px filled `--past`, 3 px white ring | solid `--past` | **full contrast** |
| At a station (`STOPPED_AT`) | 13 px white, 4 px `--now` ring, pulsing halo | solid | blue fade, below |
| In transit (`IN_TRANSIT_TO`) | 13 px `--now` dot **on the rail between two stops** | solid above, dashed below | — |
| Future | 11 px white, 2.5 px `--future` ring | dashed | full contrast |

Dashed = `repeating-linear-gradient(180deg, var(--future) 0 4px, transparent 4px 8px)`.

- **Past stops keep 100 % opacity.** The filled dot and solid rail carry the state. Never fade them.
- **The blue row highlight means exactly one thing: the train is standing at this station**
  (`STOPPED_AT`). While running between two stops *no row is highlighted* — instead an extra
  transit row renders the train as a pulsing blue marker on the rail itself, at the boundary where
  solid becomes dashed, labelled with the current speed. The dash always begins **at the train**.
- **The transit row renders with no label when `speed` is null** — the whole estimated batch (§7.3),
  plus international trains routinely. **On an `isEstimated` train it reads *Position estimated***,
  same wording and reason as the hover card. The pulsing marker on the rail is the row's real job;
  the number is a bonus.

The current-station highlight fades right but stays visibly blue at the far edge. It is **its own
element**, not a background layer, because a background gradient cannot have a rounded edge.
Rendered only on the `now` row, before the dot. `left: 9px` puts its edge at the right side of the
rail so the vertical status line forms its left border; `bottom: 1px` leaves the separator visible.

```css
.tl3 .hl {
  position: absolute; left: 9px; right: 0; top: 0; bottom: 1px;
  z-index: 0; pointer-events: none;
  border-radius: 11px 0 0 11px;
  background: linear-gradient(90deg, rgba(37,99,235,.26), rgba(37,99,235,.09));
}
.tl3 li > div { position: relative; z-index: 1 }
```

### Two rows that are not stops

Both come out of §7.1 and share a treatment: full row width, no dot, no rail connector through
them, `--muted` text at the ARR/DEP size.

- **Gap row**, where a multi-leg trip's `stopPosition`s jump between legs: *"No rail service
  between Vízvár and Gyékényes. 0:59 gap."* The duration is **last arrival to next departure**, the
  time with no rail service, not departure to arrival.
- **Fork row**, where a portioned train divides: *"Portions divide here"*, then the tails stacked,
  each under a `to Cluj Napoca` / `to Braşov` label. There may be **more than two** (§7.1), so this
  stacks N and does not assume a pair. A portion terminating at the fork has no tail and is
  labelled as ending there rather than given an empty stack entry.

The timeline is always the **shared prefix plus every tail**, regardless of which portion is
primary. Primary selection governs only the header, the alerts and the info services.

### Behaviour

- On open, scroll to the current stop and keep it pinned until the user scrolls. An arrived train
  has no current stop, so it opens scrolled to the terminus.
- Timeline stops are **not** interactive — clicking one does nothing.

---

## 6.5 Carriage composition — design A, strip with one tab per day

What the train is made of: coaches in order, class, amenities, drawn to scale. The upstream is
fully specified in **`plan/vagonweb.md`** (the three calls, the four inputs, the parsing, the
traps); `plan.html` §4b is the visual reference. This section is what the app renders and where it
lives.

**Placement.** Desktop: its own floating card at the bottom-left of the map, independent of the
detail panel. Mobile: **a page of the detail panel, one swipe across from the route**, with a back
control and a two-dot pager in the header; the train runs *down* the screen, one vehicle per row,
at its natural size with the number, type, seats and amenities under it. Nothing scrolls sideways
on a phone. Opened from a vagonweb search row (§4.1) there is no route page behind it, so **no
pager dots** and the back control returns to the search results.

**On desktop the card opens with the detail panel and closes with it**, so the composition is never
behind an affordance you have to find and the two never disagree about which train they describe.
The card also carries **its own close button**, which dismisses it *without* deselecting the train;
selecting the train again brings it back. Nothing else opens or closes it.

**One cached record per train per day** (`plan/vagonweb.md`, *Fetching, caching and mirroring*).
It fires on open, never as part of the poll.

**Usually one `GET`, occasionally three.** The direct `vlak.php` URL answers on its own whenever
`kategorie` is mapped and correct, which is every category the captures contain. When the direct
page comes back **without a composition**, the handler falls back to `razeni.php` and then to the
row it picks there (`plan/vagonweb.md`, *The search fallback*), because a category vagonweb filed
the train under differently is the direct URL's one failure mode and the search page is the only
thing that can read what actually exists. **Direct first, always**, and the fallback is invisible
to the card: three `GET`s still produce one record, cached under the same key for 24 h. If the
fallback also comes back empty that is *"No composition on file"*, a normal answer; if either
request fails it is §10 #16.

**On mobile "open" means the composition page, not the panel.** The desktop card is on screen the
moment the panel opens, so its fetch fires then; the mobile page sits one swipe across and is often
never reached, so **nothing is requested until the user swipes to it** and the shimmer carries the
wait. Opening from a vagonweb search row is a first swipe by another name and fetches immediately.
The two limits below apply either way.

**A click burst does not become a request burst.** Because the card opens with the panel, every
marker click would otherwise reach vagonweb, and clicking along a line is normal use. Two limits,
both client-side:

- **Let the selection settle.** The card renders immediately with header and shimmer; the request
  fires only if that train is still selected **600 ms** later.
- **Above 10 fetches in one minute, stop fetching and ask.** The card renders with its header and a
  *"Load composition"* button in place of the shimmer, and the request fires when it is pressed.
  Per session, counting only requests that actually left (a cache hit is not a fetch), decaying on
  a rolling minute, so normal use never sees the button. A courtesy limit for a volunteer site: not
  configurable, and not surfaced as an error — the button is the whole message.

### What one request returns, and what is drawn

The page carries the **planned** formation and **up to three reported days**. That is the whole
data path: nothing to page through, and no second request for *more of this record* — the only
second request that ever fires is the search fallback above, which is looking for a different
record, not for more of this one. Verified 12 Aug 2026 against `EN 462`,
`RJX 63`, `GySEV IC 937` and `MÁV IC 849`.

- **Which planned windows come back is not constant.** The page states a count, `Plánované řazení
  (N)`, then renders **only the window covering today** when one does (`937`: 1 of 3, `462`: 1 of
  2). When none is in force it renders **all of them** (`849 IC`: 4 of 4, because in August that
  number runs under its `Ex` record). A sectioned train gets one window **per section** (`RJX 63`:
  München–Salzburg, Salzburg–Wien, Wien–Budapest).
- **A reported day is diffed against the window that contained that day, never today's.** Diffing
  against the wrong baseline is worse than not diffing: a March day against the May plan reports
  three coaches missing that were never meant to be there.
- **When that window is not on the page, the day renders undiffed**, with *"No plan on file for
  that date."* — same wording as the cross-record case in `plan/vagonweb.md`. Uncommon: all twelve
  reported days measured fell inside the current window.
- **Route sections:** show only the section whose stretch overlaps the trip. A MÁV trip never
  reaches München–Salzburg, so never draw it.

### The vehicle list

- **Class indicator, mobile list only:** a segmented vertical bar down the tile's left edge, inset
  5 px, in the same colour tokens as the desktop roof band, so the two readings cannot drift. A
  locomotive has no bands and so no bar.
- **The desktop strip keeps its roof band** — the left bar is the vertical list's reading of the
  same data, not a replacement. Whatever renders the band must keep its segments stretched:
  wrapping it in a flex `align-items:center` collapses every segment to zero height, which is why
  it was invisible in the mock.
- **No class band is a control**, on either platform: 4 px of stripe is too small to aim at and too
  easy to hit when reaching for the vehicle, so both the bar and the band are plain elements with
  an `aria-label` and neither takes focus or opens a tooltip. Pictograms and the seat count keep
  theirs.
- **No word tag on a locomotive** in the mobile list — a drawing of a locomotive does not need a
  label reading *Locomotive*. The column beside it is empty, and the amenity row is not rendered
  for a vehicle with no marks.
- **No reserved locomotive height.** One vehicle per row means there is no strip of railheads to
  align, and reserving the tallest vehicle's height left ~16 px of air above every coach.
- **Vehicle label** sits under **the drawing**, in the drawing's own column, ~6 px below it. Not
  under the whole row: the amenity column is taller on most coaches, which floated the label most
  of a marks row away from the vehicle it names. Two columns: drawing over label, marks beside them
  in the fixed 100 px `CX_SIDE` gutter `cxScale` already reserves.
- **Amenities are our own sprite icons, never vagonweb's pictograms.** Its `img.pikto` files are
  matched by **filename** and mapped through the table in `plan/vagonweb.md`; the Czech `title` is
  prose and is never parsed. An unmapped filename is **ignored silently**, because the list is
  known to be incomplete and a missing amenity mark is a far smaller wrong than a broken icon.
  `tr1` / `tr2` / `1sed` / `2sed` are **not** amenities: they are the class and seating-layout
  markers that feed the class band, and they never render in the amenity row.
- **A missing drawing does not mean a missing class.** vagonweb has no image for some vehicles;
  they still have a class and must render it. Getting this wrong showed a known second-class coach
  as *"Class not stated"*. The SVG silhouette fallback is load-bearing.
- **Footer**, two lines, no separator glyph: *"Planned &lt;window&gt;"* over *"Last N of M reported
  days, newest &lt;date&gt;"*.

**Scale is not a constant.** The drawings are 10 px per metre, so an image's natural width **is**
the vehicle's length and a strip built from them is to scale. Keep that for the silhouette fallback
too, or a missing drawing changes the length of the train. Vehicles run from a 19 m locomotive to a
154 m 815 double-decker, so **each view divides its width by the longest vehicle it is about to
draw** and never exceeds its own maximum (0.6 desktop strip, 1.0 mobile list). A long train still
scrolls sideways on desktop; a single vehicle never has to. A window resize **re-scales only** and
does not re-render, or it throws away the reported day you were looking at.

### The diff against the plan

Every mark on a vehicle and every word of the sentence comes out of this. Stated in full because
getting it wrong is invisible: a mis-paired coach still renders, it just lies. `plan.html` §4b is
the working reference.

**0. Diff against the right window**, per the rule above: the window that contained *that* day,
never today's. All twenty of `849`'s reported days fall in May and June, so against its summer plan
every one reads *"A different train entirely"*.

**1. Pair on the car number, never on position.** vagonweb prints the number written on the coach
itself (`span.raz-cislo`), so it survives re-ordering, substitution and a train running short.
Position pairing does not: one substituted coach shifts everything behind it and the whole tail
reports as changed.

```
slot(v, i) =
    v.isLoco  ?  (i === 0 ? -1 : 1000 + i)   // a leading loco sorts first,
                                             // a rear or banking loco last
  : v.number  ?  parseInt(v.number, 10)      // 409, 410, 411 ...
  :              500 + i                     // no number: out of the numbered
                                             // range, still stable
```

**`parseInt`, not `Number()`.** A car number is not always a number: `937` ran twice as a single
815 unit numbered `11-16`, which `Number()` turns into `NaN` and the sort into nonsense.

**2. Each slot yields exactly one outcome**, which is what makes it impossible for one coach to be
reported twice:

| Slot is in | Vehicle kind | Outcome | Vehicle drawn | Clause |
| --- | --- | --- | --- | --- |
| both | same | **unchanged**, no mark | reported | nothing |
| both | different | **change**, amber outline | reported | *411 Apee in place of Apmz* |
| reported only | | **extra**, green outline | reported | *415 Bpmee extra* |
| planned only | | **missing**, red dashed outline | **planned**, silhouette in red, never its photo | *409 Byee missing* |

*Vehicle kind* is the coach type (`Byee`, `Apmz`) or, for a locomotive, `loco <class>`. **Nothing
else is compared:** a coach that kept its number and type but gained Wi-Fi is not a difference. A
slot vagonweb fills with **either of two machines** matches either, so `849` turning up behind its
490 is the plan and not a substitution.

**3. Draw in the reported train's own order, never in slot order.** A car number is fixed to the
coach, so which end of the train it is at depends on which way the train faces: the same set reads
21 to 27 outbound and 27 to 21 coming back, and `RJX 63` arrives in Budapest with 27 at the front.
Sorting by number draws it backwards under a heading saying FRONT OF TRAIN. vagonweb hands each
composition over head to tail and already knows the direction, so render it in the order it came
in. **A planned vehicle that did not run is put back in the gap it left**, directly after whichever
vehicle it followed in the plan, or at the head if it was first.

**4. The sentence walks that same array**, merging *neighbouring* vehicles with an identical outcome
into one clause (*409 and 410 Byee missing*), joining clauses with commas and a final "and",
capitalising, ending with a full stop. An empty array gives *"Runs exactly as planned."*

**5. Two escape hatches**, both required by real trains:

| When | What is written |
| --- | --- |
| **No slot is shared at all**, so every vehicle is either extra or missing | One sentence instead of a clause list: *"A different train entirely. 3 vehicles planned, 8 vehicles ran, and not one of them lines up."* The vehicles are still coloured normally |
| **More than four clauses** | The first four in train order, then *"and N more differences"* |

Worked examples for three of `849`'s reported days are in `plan/findings.md`. **The 7 July case is
the one to check an implementation against:** `411` must produce **one amber change and nothing
else**, where a position-paired version produced an amber change *and* a red missing coach for that
single substitution.

### Failure states

Four outcomes, never collapsed (`plan/vagonweb.md`):

| Outcome | Rendering |
| --- | --- |
| A composition came back | The strip |
| **A planned window, but no reported days** | The planned strip renders normally, **no day tabs**, footer's second line reads *"No reported days on file for 2026."* A normal answer: `MÁV Sz 7224` really does return 1 planned window and 0 reported days |
| vagonweb has no record for this train | *"No composition on file."* A normal answer, not a failure |
| The fetch failed, or the no-`Referer` shell came back | §10 #16, the amber inline bar |

The inverse of the second row — reported days with no window to diff them against — is not a state
of its own: those days render undiffed with *"No plan on file for that date"*.

While the request is out the card is **already on screen** with its header, record line and, when
opened from a search row, its *not on the map* strip, a shimmer where the vehicles go and
*"Fetching from vagonweb.cz"* in the footer.

**Attribution is required** wherever the drawings appear: the card names vagonweb.cz and links to
the URL it was built from.

---

## 7. Data rules

Everything in §7.1 and §7.2 was derived against real captures. The evidence is in
**`plan/findings.md`**; the fixtures are `plan/data-2026-08-04.json`, `plan/data-2026-08-05.json`,
`plan/data-2026-08-07.json` and `plan/data-2026-08-12.json`, the last being the widest schema and
the one to develop against.
findings.md's pipeline totals are a sanity check while writing the normaliser, not a test suite —
§1's "no tests in v1" stands.

### 7.0 What the route handler emits

The contract between the route handler and everything that renders. §7.1 and §7.2 are how it is
computed; this is what comes out. **Every consumer reads these fields and never the raw upstream
row** — that is what keeps the resolution rules in one place.

```ts
/** What `/api/vehicles` returns. The envelope is not decoration: §10 #7a cannot be
 *  built without `dropped`, and `fetchedAt` is what separates data age from poll age
 *  across the 60 s cache window (§1). */
type VehiclesResponse = {
  trains: NormalisedTrip[];
  meta: {
    total: number;      // rows the upstream returned, before validation
    dropped: number;    // rows Zod rejected — "12 of 431 rows failed validation"
    fetchedAt: number;  // the handler's own clock at the upstream fetch, unix seconds
  };
};

type NormalisedTrip = {
  id: string;              // canonical trip id, "Trip:1:33315406" — the marker map,
                           // the search index and the geometry fetch all key on it
  geometryIds: string[];   // every id the route line must be fetched under, "Trip:" stripped,
                           // in draw order. ONE entry for an ordinary trip; one per leg on a
                           // merged trip (suffixes kept); one per portion on a portioned train,
                           // primary first. An array because the merge collapses rows that each
                           // own a piece of the shape, and only that row's id addresses it (§1)
  serviceDay: number;      // stoptimes[0].serviceDay, unix seconds (§7.3)

  number: string;          // leading digits of tripShortName, the URL key (§8)
  name: string;            // the middle of tripShortName, "" more often than not
  category: string;        // trainCategoryName, verbatim — the vagonweb key needs it (§6.5)
  origin: string;          // first leg's first stop
  destination: string;     // LAST leg's last stop, never tripHeadsign (§7.1)
  agencyName: string;      // route.agency.name, the vagonweb key's other input
  routeId: string;         // used by the collision rules, kept for debugging
  routeLongName: string;   // route.longName. SEARCH INDEX ONLY (§4): it names the route, not
                           // the trip, so it can carry five names or 24 numbers. Never rendered
  headsign: string;        // tripHeadsign. SEARCH INDEX ONLY. Never a destination: on a merged
                           // trip each leg reports its own last stop and it flips (§7.1)
  typeColor: string;       // "#274F96", already prefixed (§2)
  fontCode: number;        // route pictogram
  otherNumbers: string[];  // a portioned train's non-primary numbers, for the header and §8

  lat: number; lon: number;
  heading: number;         // already normalised to 0…360 (§9)
  speed: number | null;    // m/s, null on the estimated batch — convert at render (§9)
  isEstimated: boolean;    // absent upstream is false (§1)
  lastUpdated: number;

  status: 'IN_TRANSIT_TO' | 'STOPPED_AT' | 'ARRIVED' | 'NOT_RUNNING';
  nextStop: string | null;         // stopRelationship.stop.name
  delay: number | null;            // the RESOLVED delay in seconds (§7.2), never a raw field
  delayMeasuredAt: string | null;  // stop name when the delay is carried forward, else null

  stoptimes: NormalisedStop[];     // every leg concatenated in stopPosition order
  rows: TimelineRow[];             // stoptimes with gap and fork rows interleaved (§6)
  alerts: Alert[];                 // in effect now, unioned across legs (§7.3)
  infoServices: InfoService[];     // unioned, collapsed by name + fontCode, sorted by order
};

type NormalisedStop = {
  position: number;
  name: string;
  lat: number | null; lon: number | null;   // absent on the three older fixtures (§1)
  arrival: number | null; departure: number | null;        // absolute unix seconds
  scheduledArrival: number | null; scheduledDeparture: number | null;
  arrivalDelay: number | null;    // null when the stop is SCHEDULED, so it can never be
                                  // mistaken for an on-time 0 (§7.2)
  isRealtime: boolean;            // realtimeState is MODIFIED or UPDATED
  platformCode: string | null;
  platformColor: 'green' | 'black' | 'red';
  progress: 'past' | 'now' | 'future';
};

type Alert = {
  description: string;    // alertDescriptionText. The only field rendered: header is "" and
                          // url is null on every alert of every capture (§7.3)
  severity: string;       // alertSeverityLevel, verbatim. WARNING throughout so far
  effect: string; cause: string;         // kept for the console, not rendered
  start: number; end: number;            // unix seconds, already filtered against now (§7.3)
};

type InfoService = {
  name: string;
  fontCode: number;       // MNR2007 pictogram, with the per-codepoint coverage check (§2)
  order: number;          // the LOWEST order of the filings collapsed into this row (§7.3)
  ranges: { from: string; till: string }[];   // every distinct stop range this name + fontCode
                          // was filed under. One entry spanning the whole trip renders no
                          // sub-line; several render one each. Never merged across a differing
                          // name or fontCode, whatever the ranges (§7.3)
};

type TimelineRow =
  | { kind: 'stop'; index: number }           // index INTO the stoptimes array. Not a copy of
                                              // the stop, or rows and stoptimes would carry
                                              // every train's timeline twice on every poll.
                                              // And not `stopPosition`, which is NOT unique
                                              // across a portioned trip (§7.1)
  | { kind: 'transit'; afterIndex: number; speed: number | null }      // §6. An array index
                                              // into stoptimes, exactly like a stop row and for
                                              // the same reason: stopPosition collides across a
                                              // portioned trip's tails (§7.1)
  | { kind: 'gap'; from: string; to: string; seconds: number }         // §7.1
  | { kind: 'fork'; tails: { destination: string; number: string;
                             stoptimes: NormalisedStop[] }[] };        // §7.1
```

Four things this shape is deliberately doing:

- **The counts live in `meta`, not headers** — a header is the kind of thing a CDN or proxy quietly
  drops, and #7a's toast is the only place a dropped row is ever reported.
- **`arrivalDelay` is `null`, not `0`, on a `SCHEDULED` stop.** The upstream `0` is the single
  easiest mistake in this feed (§7.2), so it does not survive normalisation.
- **Times are absolute unix seconds**, converted once from `serviceDay + offset` by the one helper
  §7.3 requires, so no component ever sees an offset and nothing can forget the conversion.
- **`rows` is computed server-side and carries positions, not stops.** Where a gap, fork or transit
  row belongs is a data question answered by §6 and §7.1, and answering it once per fetch keeps the
  panel a renderer. A stop row holds only its **array index** and the panel looks it up, because
  embedding the stop object would ship every train's full timeline **twice** in every poll, for
  ~300 trains, to serve the one panel that might be open. The fork row's `tails` are the exception
  and carry their own stoptimes: a tail is not in the primary's `stoptimes` at all. **The index is
  the array index, never `stopPosition`**, which collides across a portioned train's tails (§7.1).

### 7.1 Vehicle identity and normalisation

**`vehicleId` is not unique within one response** and is reused across unrelated trains; `trip.id`
*is* unique on every row. So a train's identity on the map, in the URL, in the marker map and in the
search index is the **canonical trip id**, and all of §7.1 runs in the route handler.

```
1. group rows by canonical trip id
2. classify each group, and drop the ones that are not on the map        (retention, below)
3. within a group the active leg is the one with a non-null stopRelationship
     -> position, heading, speed, status, next stop, resolved delay
   stoptimes = every leg concatenated in stopPosition order
4. resolve any vehicleId collisions that survive                          (three rules below)
```

#### Canonical trip id, and multi-leg trips

`trip.id` is base64. Decode it and cut at the `.`:

```ts
const canonicalTripId = (id: string) =>
  Buffer.from(id, 'base64').toString().split('.')[0];   // "Trip:1:34133410"
```

A trip with a section it does not run under `modes: [RAIL]` is filed as two RAIL trips sharing a
canonical id, both published the whole time. Merging them is exact, so it happens silently.

The signature is a jump in `stopPosition` between legs. **Do not assume the gap is small** (4 to 20
skipped positions, under an hour to well over one, domestic or cross-border). **Leg position spans
never overlap**, so concatenating in `stopPosition` order is safe. The split is **temporary** — the
trip runs continuous again once the engineering work ends — so nothing may treat a train as
permanently multi-leg or cache that shape.

- Origin is the **first** leg's first stop, destination the **last** leg's last stop.
- One **gap row** where the positions jump (§6). The feed never says "bus", so neither does the
  wording: *"No rail service between Vízvár and Gyékényes. 0:59 gap."* (Every replaced section
  observed is in fact a published replacement bus, so it is accurate as well as literal.)
- **A finished leg loses its realtime** and reverts to `SCHEDULED` at every stop while later legs
  keep theirs. A fully `SCHEDULED` past leg is normal, not evidence the leg did not run.

**Which row supplies the trip-level fields.** Legs agree on `route.id`, `route.textColor`,
`tripShortName` and `alerts` in every capture, so read those off any leg. Two do not:

- **`tripHeadsign` is never read on a merged trip** — each leg reports its own last stop, so
  `351 DRÁVA` says `Graz Hbf` on one leg and `Budapest-Kelenföld` on the other and the destination
  flips mid-journey. **The destination is the last leg's last stop**, derived once and used by the
  panel header, hover card and search index alike.
- **`infoServices` are scoped per leg and must be unioned**; they differ materially (on `351 DRÁVA`,
  15 on the Hungarian leg against 7 on the international one, with the domestic services
  (*Országbérlettel igénybe vehető*, the `Csatlakozásra nem vár` rows) existing only on the leg
  they apply to). Concatenate, collapse per §7.3, sort by `order`. `alerts` are
  unioned too on the same exact-match dedupe.

#### `stopRelationship: null` means the trip is not running

It has finished or not started, with no exceptions observed; it never appears on a trip whose
running window contains now, and is most often the idle leg of a multi-leg trip.

**A finished row keeps a fresh `lastUpdated` over a frozen position**, by hours in the worst case.
`lastUpdated` tracks publication, not movement, and is **not** a valid tie-break between rows. Use
`stopRelationship`.

#### Retention: when a train leaves the map

Trains stay visible after they arrive. Earlier positions are acceptable; a train vanishing the
instant it berths is not.

> A trip stays on the map if **any** of
> a) any leg has a non-null `stopRelationship`, so MÁV is still tracking it, **and** it
>    departs within the next **30 min** or has already departed, **or**
> b) its final stoptime is realtime-backed (`MODIFIED` / `UPDATED`) and
>    `now <= that arrival + 10 min`, **or**
> c) `scheduled final arrival <= now <= scheduled final arrival + 10 min`, whatever the
>    final stoptime's state.
>
> A trip counts as **arrived** only under (b). Under (c) the end time is a timetable value,
> so the trip is retained but its arrival is not asserted.

**A (c) trip is `NOT_RUNNING` and has its own wording throughout**, because "the timetable says it
should be there" is a weaker claim than "MÁV reported it arriving": *Due* rather than *Arrived*
(§5), carry-forward rather than the final stop's delay (§7.2), and §10 **#13c** rather than #13 when
it drops. Nothing about it is an error state.

Every clause is load-bearing:

- **(b) stops the timetable deleting a running train.** A significant minority of trips end on a
  non-realtime stoptime, and a scheduled-times cutoff removes international trains still moving:
  `140 HORTOBÁGY EuroCity` reads half an hour past its final arrival while `IN_TRANSIT_TO Wien Hbf`.
- **(c) gives a train that quietly finishes its ten minutes.** A domestic trip whose final stoptime
  never became realtime-backed fails (b) and would vanish the moment it berths.
- **(c)'s lower bound is the important half.** Ten minutes *after* a scheduled arrival that has
  already passed, not "any time before scheduled arrival + ten minutes" — without it every
  unfinished trip qualifies, repealing (a)'s window and parking trains on the map hours early.
- **(a)'s 30 minutes** exists because the feed reports trains hours, in one case most of a day,
  before they run. Boarding at the origin belongs on the map; parked six hours early does not.

Retention costs ~1 % more markers than a strict filter, so the 10 minutes is a comfort setting, not
a load budget.

#### Three rules for `vehicleId` collisions that survive the merge

Heuristics, unlike the leg merge. The portion rule and the two-trains case emit a `console.warn`;
the hybrid rule does not, being a normal MÁV working. Two fields decide all of it: **`route.id` and
position.**

| Collision | Detection | Rule |
| --- | --- | --- |
| **Hybrid IC + Ex working** | one `vehicleId`, **different `route.id`**, identical stop list, identical position | A combined InterCity and Expresszvonat. **Keep the InterCity row**, drop the other: richer info services, and the record vagonweb holds the composition under |
| **A train in portions** | one `vehicleId`, **same `route.id`**, **identical lat/lon**, divergent tails | One train that splits en route. **Merge to one marker.** **Any number** of portions, not just two |
| **Two genuinely different trains** | one `vehicleId`, **different positions** | Not a collision. Render both |

**Do not detect a portion split by shared stop prefix, `tripShortName` or scheduled times.** All
three were tried and are wrong: **prefix** merges two real trains into one marker and deletes one
from the map (the leg merge concatenates an untracked earlier leg duplicating another train's whole
route); **number** fails because portions can each run under a different one; **scheduled times**
fail because real portions carry slightly different booked times approaching the fork. Coupled
portions must share a route and a coordinate, so `route.id` + position is causally correct. Neither
suffices alone: `route.id` alone merges one route running in opposite directions, position alone
merges the IC + Ex hybrid.

**Each portion is a complete journey from the origin, not a tail.** The feed publishes whole trips
that happen to begin with the same stops, so **the shared prefix arrives once per portion** and
naive concatenation renders the origin N times. Worked case, `KÁLMÁN IMRE` 7 Aug: `462` carries 11
stops to Salzburg Hbf, `50462` 17 to Stuttgart Hbf, `40462` 15 to Zürich HB, and the first 11 of all
three are identical in stop, position, scheduled time and delay. So the merge is a **deduplication,
not a concatenation**:

- **The shared prefix is the leading run every portion agrees on**, compared on stop name and
  `stopPosition`, taken from the primary and stored **once**. Where a portion terminates at the
  divergence point, as `462` does, its whole stop list *is* the prefix.
- **Everything after it is a tail**, belonging to the fork row (§6) and not to `stoptimes` — which
  is why the fork `TimelineRow` carries its own stoptimes while a stop row carries only an index.
- **Prefix conflicts need no resolution rule, because there are none.** Every field matches except
  `realtimeState` (`MODIFIED` vs `UPDATED`), which §7.3 treats identically. Should a real
  disagreement appear, take the primary's value and `console.warn`; never average or merge.

**`stopPosition` is not unique across a portioned trip, and nothing may key on it.** The tails reuse
the numbers: on `KÁLMÁN IMRE` position `67` is **Rosenheim** on the Stuttgart tail and **Innsbruck
Hbf** on the Zürich one, `74` is **Göppingen** and **Feldkirch**. Non-overlapping position spans are
a fact about **multi-leg** trips and do not carry over. Address a stop by array index (§7.0).

**The primary portion is the lowest train number**, which MÁV itself treats as primary; on a tie,
the most realtime-backed stops, then the lowest canonical trip id. It supplies the **header, alerts
and info services** and keys the URL (§8). It does **not** decide the timeline, which is always the
shared prefix plus every tail (§6), and it is not necessarily the longest or best-covered portion —
it can be the one terminating at the fork. The fork renders like the leg gap: *"Portions divide
here"*, then the tails stacked under a `to <destination>` label each. The header sub-line names
every destination and lists the other numbers. No tabs, per §6.

### 7.2 Delay resolution

**`arrivalDelay` is authoritative wherever the stoptime is realtime-backed**, ~95 % of stoptimes.
Inside Hungary, on a train MÁV is tracking, read it directly and trust it.

Check `realtimeState` first. `arrivalDelay` is **never null**, so on a `SCHEDULED` stoptime it is
`0`, and that `0` means *no data*, not *on time* — reading it without the check paints a train green
that is not. `SCHEDULED` occurs **domestically** on a train MÁV has not started tracking (usually
the whole trip before departure, sometimes the tail of one; a handful of trains per poll are
`SCHEDULED` throughout and a few dozen have a `SCHEDULED` next stop), and at **the border**, where
MÁV publishes nothing for foreign stations so those rows carry scheduled times with
`arrivalDelay: 0`, erasing a known delay — rare, but wrong by up to an hour.

So the delay is **resolved**, in this order:

| Case | Resolved delay |
| --- | --- |
| `IN_TRANSIT_TO` a realtime-backed stop (`MODIFIED` / `UPDATED`) | that stop's `arrivalDelay` |
| `STOPPED_AT` a realtime-backed stop | **that stop's `arrivalDelay`**, how late it arrived, matching the platform display right now. Not its `departureDelay`, not the following stop's |
| Next stop is `SCHEDULED`, an earlier realtime-backed stop exists | **carry the last such stop's delay forward**, labelled with where it was measured: `+53 min at Hegyeshalom`. Its **`departureDelay`** if the train has left that stop, its `arrivalDelay` if still standing there |
| Trip is arrived (§7.1 clause **b**) | the **final** stop's `arrivalDelay`, the delay it finished with |
| Trip finished under clause **c**, so its final stop is `SCHEDULED` | the carry-forward rule above, labelled. **Never the final stop's `arrivalDelay`**, the `0` that means no data. Usually the last Hungarian stop's delay, or `null` |
| No realtime-backed stop anywhere on the trip | `null`, the grey `--d-unknown` bucket |

The label is not optional: carrying a number forward silently implies MÁV is tracking the train
abroad, which it is not. **Never compute a foreign arrival time from a carried delay** — Wien Hbf
stays at its scheduled `11:20`, grey per the `realtimeState` rule. A fabricated `12:13` is the
plausible-looking invention §2's white-ring fallback exists to prevent.

**What a carried-forward trip must look like.** The hardest shape in the feed: tracked across
Hungary, `IN_TRANSIT_TO` a foreign stop, realtime stopping at the border. `findings.md` works
`140 HORTOBÁGY EuroCity` end to end and it is the fixture to render against. The marker takes the
**carried** delay's bucket, not the next stop's `0`; the hover card's next-stop time renders grey
with the carried delay beside it; the panel header carries the full `+53 min at Hegyeshalom`; every
foreign stop renders grey with **no delay chip at all**; and since such a train is typically in the
estimated batch, the speed slot and transit row label are **empty**, not `0 km/h`.

### 7.3 Field rules

| Concern | Rule |
| --- | --- |
| `tripShortName` | `"19797 KÉK HULLÁM InterCity"` = number + optional name + category. Leading digits are the number; strip the trailing `trainCategoryName`; the remainder is the name and **is empty more often than not**. All display text derives from this field. |
| `stopPosition` gaps | `1,2,…,6,8,…` — stops this trip does not call at. Render nothing, no placeholders. |
| `platformColor` | `green` = confirmed live by the station system, render `#15803d`. `black` = timetable value, neutral. `red` = **platform changed from the timetable**, render `--red`; normal, not an edge case. Never use the API string as a CSS colour. **A null `platformCode` renders nothing at all, whatever the colour** — `green` with a null code is common, and a confirmation with no value to confirm is not something to show. |
| `realtimeState` | `MODIFIED`/`UPDATED`: show realtime. `SCHEDULED`: one grey time, no strike-through, and **no usable delay on that stop** (§7.2). |
| Info services | **Render only `displayable: true`**, then sort by `order`. (Every service in every capture is `true`; the filter is for the day one is not.) **One row per `name` + `fontCode`, carrying every distinct stop range it was filed under**, each a `fromStop.name` to `tillStop.name` sub-line, the sub-line hidden when a single range spans the whole trip. The same service is legitimately filed several times over different stretches — `351 DRÁVA` carries *Csatlakozásra nem vár* five times at five stations, and a merged trip adds one filing per leg — and five identical rows differing only in a range read as a rendering bug. **Nothing else is ever merged:** differing name or `fontCode` means two rows, whatever the ranges. **The collapsed row sorts on the lowest `order` of its filings**, since a merged trip's legs need not agree: the lowest keeps the row where MÁV put it at its highest and stops the list reshuffling as a leg loses its realtime. |
| Alerts | Only those currently in effect, filtered on `effectiveStartDate`/`effectiveEndDate` against now, which does real work: expired alerts are present on most polls. Render **`alertDescriptionText`**; `alertHeaderText` is empty and `alertUrl` null throughout, so no header fallback and no URL affordance. |
| Headline delay | The trip's **resolved delay**, §7.2. Based on the next stop, which is what a waiting passenger cares about, but never read straight off `arrivalDelay`. |
| `stopRelationship` | Null means the trip is not running. Never a data error, never a reason to hide a train on its own. §7.1. |
| `speed` | Null on the estimated batch. Render no speed rather than `0 km/h`; a missing speed is not a stopped train. |
| **Estimated positions** | The feed carries **`isEstimated`** on the vehicle row. **Use it. Do not infer the batch.** A row with `isEstimated: true` has a computed rather than measured position and also carries `speed: null`, a fractional or negative `heading` and **one shared `lastUpdated` for the whole batch`** — those three older signals identify exactly the same rows, so they are corroboration, not the test. **It is said out loud:** the hover card's speed slot and the panel's transit row read *Position estimated* (§5, §6), because a computed position rendered like a measured one presents an invention as data. The marker never changes. Two consequences: the shared timestamp makes these rows look fresher than their positions are, and if the batch lags every train in it trips §10 #8b at once. Treat that timestamp as a property of the batch, never a per-train freshness signal. |
| `lastUpdated` | Tracks publication, not movement; a finished trip keeps a fresh timestamp over a position hours old. Never use it to choose between rows, and compute §10 #8 over retained trips only. |
| **Timezone** | Render everything in `Europe/Budapest` and ignore `stop.timezone`, cross-border trips included. **A correctness requirement, not a shortcut:** `serviceDay + seconds` is a genuine absolute instant, so rendering a Romanian or Ukrainian stop in its own zone produces impossible running times, including negative ones. The trade is that such a station shows a time an hour behind its local departure board. Do not "fix" this. |
| Null `trip` | Expected never to happen. Defensive fallback only: hide the vehicle. Do not build a toggle. |
| **Time arithmetic** | `serviceDay` is the day the trip departs its **first** station. **It is a field on the stoptime, not the trip**, carrying the same value on every stoptime in every capture, so `stoptimes[0].serviceDay` and the row's own are interchangeable. The seconds fields are plain offsets and simply run past `86400` after midnight. So `serviceDay + seconds`, **no clamping and no modulo**, formatted in `Europe/Budapest`. Keep it in one helper anyway. |
| **Time resolution** | The fields are seconds but the data is **minute-resolution**, always a multiple of 60. Render `HH:mm` with no seconds and treat delays as exact whole minutes (`delay / 60`) rather than rounding an approximation. |
| **Delay change marker** | Shown when a stop's row delay differs from the **previous rendered** stop's by ≥ 60 s either way (not `stopPosition - 1`, usually a skipped stop), and only between two realtime-backed stops, beside the delay amount in the sub-line: an arrow SVG plus the delta in minutes. **Time lost:** `#i-up`, `+N`, `--red-dark`. **Time recovered:** `#i-down`, `−N`, `--red-soft`. Under a minute shows nothing. Both are dedicated glyphs, **not** a rotated arrow icon, which never centres. |
| **Row delay** | **`arrivalDelay`, on every row, always** — it answers what the row's own position asks, how late the train got *here*. One field everywhere, so the delay amount and the change marker can never disagree and no row changes meaning as the train passes it. The consequence is deliberate: a delay absorbed during a long dwell is not shown per row, so a stop can read `+18` after the train left it 4 minutes down. The headline delay (§7.2) is a **separate** rule and does use `departureDelay` when carrying forward. |


---

## 8. URL and selection state

- A selected train gets its own URL, keyed by **train number**: `/?train=8995`. Short, shareable,
  and the number is what you would say out loud.
  - This works **because of the normalisation in §7.1, not despite it.** In the raw feed several
    numbers are carried by two rows each; after the leg merge and the collision rules, train numbers
    are **unique across every retained trip** in every capture. So resolution is a lookup against
    the normalised list, never against raw rows.
  - **A portioned train uses its primary portion's number** (§7.1), and the other portions' numbers
    resolve to the same train rather than 404. One canonical link, but every number a passenger
    might quote still works.
  - **If a number ever does match more than one retained trip**, resolve in this order and
    `console.warn`: the trip whose running window contains now, then the one departing soonest, then
    the lower canonical trip id. The plausible cause is a trip running past midnight into the next
    day's instance of the same number.
  - Numbers repeat daily; that is accepted. A stale link resolves to that day's train or to the
    "not currently running" state.
- **The URL is written with `replaceState`, never `pushState`.** Selecting rewrites it, closing the
  panel clears it, neither leaves a history entry, so Back leaves the app rather than becoming an
  undo stack for marker clicks. The mobile panel's close button and Esc are the way out of a panel.
- **On load with a `?train=` that resolves**, fly to the train and open the panel, exactly as
  pressing a search result does. **If it does not resolve**, keep the parameter, show the map, and
  raise §10 **#17**, the blue "not currently running" toast naming the number, so the URL still
  explains itself.
- **When the open train disappears** from the feed (trip ended, left the bbox, dropped): **freeze**
  the panel, grey the last known marker position, show a last-seen time. Do not silently close.
  Which message depends on why: §10 #13, #13a, #13b, #13c.
- **Follow the train:** desktop only, and only while the panel is open. Mobile never follows. A
  manual pan **pauses** following and surfaces a re-centre control in the panel header — a map that
  fights your drag is worse than one that stops following.

---

## 9. Resolved implementation details

These came out of writing this spec rather than from the design review.

| Item | Decision |
| --- | --- |
| **Speed unit** | The API returns **metres per second**. Multiply by `3.6` for the `km/h` shown in the hover card and the transit row. Keep the conversion in one helper. |
| **Speed unit, missing** | Null on the estimated batch. Render nothing where the speed would go, in the hover card and the transit row. Never `0 km/h`. |
| **`heading` semantics** | Compass degrees clockwise from north — `0` points the wedge straight up, `90` is east. This is what the marker rotation assumes. Never null, but **not always an integer in that range**: negative and fractional values are routine, so normalise with `((h % 360) + 360) % 360` and rotate along the shortest arc (§3). |
| **Mobile double-tap** | Keep double-tap on a train to open the panel. Leaflet's `doubleClickZoom` is overridden **only when the gesture starts on a marker**: disable it on the marker's `touchstart`/`mousedown` and re-enable after, with `touch-action:none` on the marker element so iOS does not treat it as a page zoom. Double-tapping empty map still zooms normally. |
| **Polling while hidden** | Pause on `visibilitychange`; fire one immediate fetch when the tab regains focus. |
| **Initial map view** | Fixed view framing Hungary. No geolocation, no remembered last view, nothing in `localStorage`. |
| **Mobile panel** | Full-height overlay with a close button. **No** drag-to-dismiss and no 45 % / 92 % snap points — the mockup's snapping sheet is out of scope for v1. |
| **Keyboard shortcut** | **No** `/` shortcut. The search bar is clicked like anything else. Arrow / Enter / Esc / Home / End inside the field still work as specced in §4. |
| **Trip with no `stoptimes`** | Still open the panel: render the header, alerts and info services, and replace the table with a short "no stop information" line. Never an empty table. |

---

## 10. Error and failure handling

Visual reference `plan.html` §5. Because this is your own tool, messages are technical — they name
the hop, the HTTP status and the raw error. Never "Something went wrong".

### The surface: a bottom-centre toast

One toast, horizontally centred against the bottom edge of the map, max ~390 px. On mobile it sits
**above** the detail sheet and is never hidden by it — a sheet covering a failure the map is
currently having is exactly what this section exists to prevent, and the panel's inline bars report
different conditions, so a suppressed toast means a fleet-wide failure goes unreported on a phone.

```
┌──────────────────────────────────────────┐
│ [warn] Data is not updating      [Retry] │
│ 502 Bad Gateway · /api/vehicles [>] VPS  │
│ ECONNREFUSED 10.0.0.4:8080               │
│ attempt 3 · retry in 0:08 · last good …  │
└──────────────────────────────────────────┘
```

Three lines: title, technical detail (monospace, `#6b7280`), meta (attempt / next retry / last good
time). Severity is a border + icon colour:

| Severity | Meaning | Border / bg / text |
| --- | --- | --- |
| Red | not getting data | `--red-border` / `--red-bg` / `--red` |
| Amber | getting data, do not trust it | `--amber-border` / `--amber-bg` / `--amber` |
| Blue | informational | `--info-border` / white / `--info` |

**Every failure becomes one shape** and one component renders all of them, so adding a failure mode
means adding a mapping, not a UI:

```ts
type FeedError = {
  severity: 'error' | 'warning' | 'info';
  title: string;        // "Data is not updating"
  hop: [from: string, to: string];   // ["/api/vehicles", "VPS"] — rendered with the
                                     // arrow SVG between the two, never a literal "->"
  status?: number;      // 502
  detail: string;       // "ECONNREFUSED 10.0.0.4:8080"
  attempt: number;
  nextRetryAt: number | null;   // null = not retried
  lastGoodAt: number | null;
};
```

### What is detected, and where it shows

| # | Failure | Detection | Severity | Surface |
| --- | --- | --- | --- | --- |
| 1 | Browser cannot reach our API | `fetch` rejects (`TypeError: Failed to fetch`) | red | toast |
| 2 | Route handler threw | `500` from `/api/vehicles` | red | toast |
| 3 | Route handler cannot reach the VPS | `502`, cause `ECONNREFUSED`/`ENOTFOUND` | red | toast |
| 4 | VPS did not answer in time | `504` after the handler's own timeout | red | toast |
| 5 | MÁV returned an HTTP error | upstream status forwarded: `403`, `429`, `5xx` | red | toast |
| 6 | GraphQL `errors[]` on a `200` | `body.errors` non-empty — usually schema drift | red | toast, message verbatim |
| 7 | Unexpected response shape | `data.vehiclePositions` missing or null, so there is nothing to render | red | toast |
| 7a | **Some rows failed validation** | rows dropped by the Zod schema while others survived | amber | toast, `"12 of 431 rows failed validation"` |
| 8 | **Whole feed frozen** | `max(lastUpdated)` **across the entire fleet** has not advanced for **3:00**. Computed over **retained trips only** (§7.1): dropped rows keep publishing fresh timestamps and would mask a frozen feed | amber | toast |
| 8b | **Open train has gone quiet** | that train's own `lastUpdated` is more than **3:00** old | amber | inline in the panel |
| 9 | Zero vehicles returned | `200`, valid, empty array | amber | toast, including the local time so you can judge whether it is plausible |
| 10 | Nothing has ever loaded | the first poll failed | red | full-area state, **over the map, not instead of it** |
| 11 | Route geometry fetch failed | non-`200` on the per-trip query | amber | inline in the panel. No line is drawn and none is substituted (§3); the calling-point dots still render |
| 12 | Basemap tiles unavailable | **10 or more** Leaflet `tileerror` events within 0:30 | amber | toast, stating that train data is unaffected |
| 13 | Open train left the feed | canonical trip id absent from a successful poll, **and** the trip was not arrived | blue | inline in the panel |
| 13a | **Open train reached its destination** | the trip was arrived (§7.1) when it dropped at the 10 min mark | blue | inline, *"Arrived at Budapest-Déli 11:54."* Never #13's "no longer reporting", which is for a train that vanishes mid-journey |
| 13b | **Open train is inside a multi-leg gap** | the trip is multi-leg (§7.1), **no** leg has a `stopRelationship`, and now falls between the last arrival of one leg and the first departure of the next | blue | inline, *"Not running between Vízvár and Gyékényes. Rail service resumes at 14:32."* The train is on a replacement service and is not lost, so this must never render as #13. The gap runs about an hour on the domestic sections and 100 minutes on `351 DRÁVA`, so it is a long state, not a blip |
| 13c | **Open train finished, but only the timetable says so** | the trip was retained under clause (c) (§7.1), never asserted as arrived, when it dropped at the 10 min mark | blue | inline, *"Scheduled to have arrived at Budapest-Déli 11:54. No realtime confirmation."* Distinct from #13a, which reports an arrival MÁV actually published, and from #13. 13 to 22 trips per capture end this way, so this is common, not an edge case |
| 14 | MNR2007 failed to load | `document.fonts.check()` | silent | text fallback, no message |
| 15 | **vagonweb search failed** | non-`200` from `/api/vw-search`, or it timed out | amber | **inline, under the vagonweb heading in the result list.** Never a toast and never the live rows: *"vagonweb search failed. 503 Service Unavailable."* with a **Retry** control beside it. No countdown, no self-retry, per the backoff rule below. The live list stays interactive throughout |
| 16 | **vagonweb composition failed** | non-`200` from `/api/composition` on any of its up to three upstream `GET`s (`vlak.php`, the `razeni.php` fallback, the picked row), or the no-`Referer` shell came back (`plan/vagonweb.md`) | amber | inline in the composition card, **with a Retry button**, for #11's reason: this is a one-shot fetch and nothing else will fix it. Distinct from *"no composition on file"*, a normal answer |
| 17 | **A `?train=` link does not resolve** | on load, the number matches no retained trip (§8) | blue | toast, *"Train 8995 is not on the map. It may have finished, or it may not be running today."* **The one toast that is not a live condition**, so it is also the one that can be cleared: it goes on the next selection, on a search, or when a poll brings that number back, and it never blocks the map behind it. No retry control, and the parameter stays in the URL |

### Two things about staleness — easy to get wrong

- **Per-train staleness is not a map state.** A single train with an old `lastUpdated` is normal —
  parked, in a tunnel, no signal. The marker is **never** faded, dimmed or annotated for it. This
  was explicitly rejected during design.
- **The fleet-wide check (#8) is different** and is the one failure here that is genuinely
  invisible: MÁV's realtime source dies while their API keeps serving its last snapshot, so every
  poll returns `200` with hundreds of plausible trains that never move. Only `max(lastUpdated)`
  over the whole response catches it, and no single quiet train can trigger it.
- **#8b surfaces per-train staleness only in the open panel**, where you have asked about that
  train, as an amber bar reading *"Position may be out of date. This train last reported 4:08 ago"*,
  with a note that times and delays are unaffected.
- **Both thresholds are measured in elapsed time, never in polls**, because a poll is not evidence
  of anything: the response is CDN-held for `s-maxage=30` and served stale for another 30 s, so
  three consecutive polls can legitimately return one identical payload with an unchanged
  `max(lastUpdated)`. #8 fires on 3:00 of wall clock without the maximum advancing, which no cache
  window can span. **3:00 is also why #8b is not 60 s:** worst-case data age is ~60 s from the
  caching alone (§1), before MÁV's own publication interval, so a 60 s bar would be up on nearly
  every panel open and mean nothing by the time it mattered.
- **Per-train staleness cannot be read off `lastUpdated` alone** (§7.3). #8b must be measured
  against a train the normaliser retained *and* whose `isEstimated` is false, or the whole estimated
  batch trips it together on one shared timestamp.

### Inline panel bars (#8b, #11, #13, #13a, #13b, #13c)

Same bar component, directly under the panel header, above the alerts, amber or blue by severity.
`#11` carries a Retry button; `#8b` does not (the next poll fixes it or does not); `#16` carries one
too. `#13` is the blue "no longer reporting" state described in §8 — panel freezes, marker greys,
last-seen time shown. `#13a`, `#13b` and `#13c` are blue and carry no button: all three are normal
states of a train doing what it is supposed to be doing.

### Writing the messages

- **No em-dashes** in any warning or error string. Use a full stop or a comma. *"Route line
  unavailable. Everything below is still live."*
- **No text arrows anywhere, including inside monospace technical strings.** The hop arrow in
  `/api/vehicles [svg] VPS` is an inline SVG at 12 px with `vertical-align:-2px` and `opacity:.75`;
  ASCII `->` inherits the mono font's metrics and sits visibly off centre.
- **Relative times are `m:ss`**: `4:08 ago`, `6:12 old`, `retry in 0:08`, `aborted after 0:12`,
  `backing off to 2:00`. Fixed configuration intervals stay plain (`polls every 30 s`).
- Name the hop, the status and the raw error. Never "Something went wrong".
- **Keep each technical line under 50 characters** — the toast is 390 px with 12 px of padding and
  a 1 px border, so the line has 364 px and Geist Mono is 7.2 px per character at 12 px (measured,
  `findings.md`). A line carrying the hop arrow loses about two characters to the 12 px SVG.
  Anything longer wraps. Break lines **deliberately** at a clause boundary rather than
  letting a stray word fall onto its own line, and never mid-phrase. `overflow-wrap: break-word`
  with `word-break: normal`, so only genuinely unbreakable tokens (base64 trip ids) are split.

### Behaviour rules

| Concern | Rule |
| --- | --- |
| **First load, before any answer** | The map, basemap tiles and search box render **immediately** and are usable; there are simply no markers yet. A single unobtrusive line sits where the toast goes, reading *Loading trains*. It clears on the first successful poll, or is replaced by #10's full-area state if that poll fails. Nothing blocks on the fetch: a spinner over a working map makes the app feel slower than it is, and a silent empty map is indistinguishable from a country with no trains running. |
| Never blank the map | Once trains have loaded, a failed poll **keeps the last known positions on screen**; the toast is the only change. |
| **#10 overlays, it does not replace** | The basemap and the search box rendered on the first frame and are not torn down: #10 is a centred card **over** the map carrying the full technical detail and a Retry, with the backoff ladder still running behind it. There are simply no markers. Removing the map chrome on the one failure where the user has seen the least would be a visible regression, and the tiles are not the thing that failed. (`plan.html` §5.1 says "no map chrome"; this supersedes it.) |
| Backoff | 0:02, 0:04, 0:08, 0:16, 0:30, then hold. Reset to the normal 30 s poll on the first success. Honour `Retry-After` when present. **This ladder is the `/api/vehicles` poll's alone.** |
| **Neither vagonweb call ever auto-retries** | #15 and #16 are one-shot and both carry a **Retry** control the user presses. vagonweb is a volunteer site and `plan/vagonweb.md` sets the budget at one `GET` per train per day, so an unattended failed card must not fire five more requests at it; and a failed composition is a single deliberate open, where "nothing else will fix it" is true. A fresh keystroke is not a retry: typing a new query fires immediately and is never held back by anything the previous one did. |
| What is never retried | GraphQL `errors[]` (#6) and `403`. Retrying a rejected query just burns requests — show it and stop until a manual retry. |
| One toast at a time | Highest severity wins and is the only one rendered at rest. A red data error **takes precedence over** the amber frozen-feed warning rather than deleting it. The resting position stays at the bottom edge and the stack grows upward behind it, so expanding never moves the toast you just pressed. |
| Seeing the ones behind it | When more than one condition is live the visible toast carries a **`+N` control on its title row**; pressing it expands the whole stack upward, most severe at the bottom, in the same card shape, and pressing again collapses it. Nothing is ever suppressed without a trace, and the resting state is still one toast. The count is conditions currently true, recomputed each poll, and disappears with them. |
| Dismissal | **There is none**, with one exception. A toast is a readout of a live condition, not a notification: it is up exactly as long as the condition holds and clears itself the moment the data moves again. A close button would let the map hide a failure it is currently having. **#17 is the exception** because it is the one toast reporting something that already happened rather than something still true, so nothing will ever clear it on its own: it goes on the next selection, on a search, or if a poll brings that number back. |
| Recovery | On the first successful poll the toast disappears silently. No "back online" confirmation — the data moving again is the confirmation. |
| Console | Every failure also emits one `console.error` with the full response body. The toast is a summary; the console is the record. |

---

## 11. Open items

**Nothing blocks the build.** Everything that once did is now a rule in a section above, including
both pre-build reviews (16 and 18 Aug 2026) and the two geometry questions measured against the
live API on 18 Aug (written up in `findings.md`, rule in §1). Those responses were **not** kept,
so the route line is the one piece with no fixture behind it and is developed against the live
query. `UPSTREAM_URL` is supplied and verified.

Two closures worth keeping, because they look like open questions:

- **A replacement bus section is not queryable.** `modes: [RAIL, RAIL_REPLACEMENT_BUS]` returns rail
  only, so the gap row describes the hole rather than naming a service (`api.md` item 6). Upstream
  gap, revisit after v1.
- **Carriage composition is settled** as §6.5, verified end to end (`plan/vagonweb.md`). The only
  change it made to anything above is `route.agency { id name }` on the list query.

**Deferred past v1, deliberately:** dark mode (a token block plus a basemap swap, no component
changes), station search, clustering, filters, tests and analytics.
