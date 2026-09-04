# vonatinfo-v2

A live map of every train running in Hungary, with the delay, the route, the stop-by-stop
timetable and the carriage composition of whichever one you click.

It is a personal tool, not a product: one page, no accounts, no analytics, and error messages
that name the failing hop and the HTTP status rather than apologising.

## What it does

- **Live positions.** Every rail vehicle inside a fixed bounding box around Hungary, polled every
  30 s, drawn as a heading-oriented wedge coloured by delay. Markers move by interpolation between
  polls and are updated in place, never re-created.
- **Delay as the primary semantic.** One six-step scale (unknown, early, on time, slight, late,
  severe) that every surface reads from: marker fill, hover card, panel, search rows.
- **Search, over two sources.** *Current* searches the trains on the map, *Vagonweb* searches the
  timetable for trains that are not running right now, *Both* does both. Hungarian accent folding,
  full keyboard navigation.
- **Detail panel.** The whole journey as table rows: scheduled and actual times, platforms, an
  arrived / current / upcoming rail, service alerts and MÁV's own info-service pictograms.
- **Carriage composition.** What the train is physically made of, drawn to scale from
  vagonweb.cz: coaches in order, class, car numbers, amenities, plus a diff of each reported day
  against the planned formation.
- **Shareable URLs.** A selected train is `/?train=8995`, keyed by train number, written with
  `replaceState` so Back leaves the app instead of undoing marker clicks.

## Stack

Next 16.2 (App Router, React Compiler on), React 19, TypeScript, Tailwind v4, Zustand for state,
Leaflet directly (no react-leaflet), Zod for upstream validation, Cheerio for server-side HTML
parsing.

> `AGENTS.md` applies to this Next version: it has breaking changes against what most tooling
> assumes. The bundled docs at `node_modules/next/dist/docs/` are the source of truth.

## Architecture

```
browser  --30 s poll-->  app/api/vehicles     -->  VPS proxy  POST /           -->  MÁV GraphQL
browser  --on demand-->  app/api/vw-search    -->  VPS proxy  POST /vagonweb  -->  vagonweb.cz
```

Every call out of the app goes through a VPS proxy that does nothing else. The MÁV endpoint needs a
Hungarian IP; vagonweb does not, but it blocks the datacentre ranges this deploys into, so a direct
fetch from a route handler works locally and returns nothing in production. `POST /` carries the
GraphQL body, `POST /vagonweb` is a plain GET whose upstream status and body come back untouched;
that route refuses any host but vagonweb.cz, which is what keeps it from being an open proxy. The route handler validates, normalises and caches for 30 s, so upstream sees about two
requests a minute regardless of how many tabs are open, and the normalisation (merging legs,
deduplicating rows, resolving delays, classifying stops) runs once per upstream fetch rather than
once per client.

The Zustand store is read **imperatively** by the marker layer, which is never a subscriber, so a
poll re-renders the hover card, panel, search and toast, and not four hundred markers.

### Route handlers

| Route | Upstream | Cache |
| --- | --- | --- |
| `app/api/vehicles` | MÁV, via the VPS | `s-maxage=30, stale-while-revalidate=30` |
| `app/api/geometry/[tripId]` | MÁV, via the VPS | `s-maxage=86400` |
| `app/api/vw-search` | vagonweb `razeni.php`, via the VPS | `s-maxage=86400` |
| `app/api/composition` | vagonweb `vlak.php`, via the VPS | `s-maxage=86400, stale-while-revalidate=86400` |
| `app/api/vehicle-image` | vagonweb GIFs, via the VPS | `max-age=2592000` |

Nothing else in the app talks to a third party. Upstream timeout is 10 s everywhere.

## Getting started

Requires Node 20+ and access to the VPS proxy.

```bash
npm install
cp .env.local.example .env.local   # then fill in the four values below
npm run dev
```

Open http://localhost:3000.

### Environment

All four are required; a missing one surfaces as a configuration error toast rather than an empty
map. `.env.local` is never committed.

| Variable | What it is |
| --- | --- |
| `PROXY_ENDPOINT` | The VPS proxy's root, which is also its MÁV route: every MÁV call is a `POST` of `{ url, headers, query }` to it, rate-limited to 10/min and 100/day, which the 30 s poll behind the 30 s CDN cache fits under. `/vagonweb` is resolved against this same address for the vagonweb calls and carries its own 60/min, 2000/day budget. |
| `GRAPHQL_ENDPOINT` | The MÁV OTP2 GraphQL endpoint, sent as the `url` field of that body. |
| `CF_ACCESS_CLIENT_ID` | Cloudflare Access service token for the proxy. |
| `CF_ACCESS_CLIENT_SECRET` | The matching secret. Sent to the proxy only, never in the body's `headers`. |

### Scripts

| Command | |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm run lint` | ESLint |
| `npm run build:font` | Regenerates `public/fonts/MNR2007.woff2` and `lib/mnr-coverage.ts` from `MNR2007.ttf`. Re-run whenever the TTF is replaced. That is the whole maintenance story. |

## Layout

```
app/           page shell, layout, and the five route handlers
components/    App shell, MapView (Leaflet), Search, HoverCard, DetailPanel,
               Composition, Toasts, Badge, Delay, Sprite
lib/           upstream queries, Zod schema, the normaliser, the poll, the store,
               the vagonweb client/parser/diff, time and delay helpers
scripts/       build-mnr-font.mjs
plan/          the design and implementation documents (below)
public/fonts/  MNR2007, MÁV's pictogram font
```

`lib/normalise.ts` is the centre of the app: everything visible is a renderer over its output.

## The documents

The build is specified before it is written, and the specification is kept current.

- **`plan/SPEC.md`** is the build document: selected designs, exact tokens and geometry, data
  rules, error handling. It states rules and carries no dated per-capture prose.
- **`plan/findings.md`** is the measured record behind it: the captures, the counts, the worked
  examples. When a rule in SPEC.md looks arbitrary, this is where the evidence is.
- **`plan/plan.html`** is the visual reference. Open it in a browser. Each section shows three or
  four alternatives and **only the ones marked SELECTED are built**; the rest document why not.
- **`plan/api.md`** is the MÁV upstream: both queries verbatim, the response shape, the traps.
- **`plan/vagonweb.md`** is the vagonweb upstream: the three calls, the four inputs, the parsing.

When editing: measurements go in `findings.md`, timeless rules go in `SPEC.md`.

## Conventions

Enforced, and easy to break by accident. `CLAUDE.md` has the full text.

- **No text glyphs for icons.** Every icon is an inline SVG from the shared sprite, including
  arrows inside monospace strings. The only font glyphs anywhere are the MNR2007 pictograms, which
  are MÁV's own data and cannot be replaced.
- **No em-dashes in user-facing strings.** A full stop or a comma instead.
- **Relative times are `m:ss`**: `4:08 ago`, `retry in 0:08`. Fixed intervals stay plain:
  `polls every 30 s`.
- **Error text is technical.** It names the failing hop, the status and the raw error. Never
  "Something went wrong".

## Not in v1

Deliberately deferred, none of them blocked: dark mode (a token block plus a basemap swap, no
component changes), station search, marker clustering, filters, tests, analytics. Rail only.
Light theme only, though every colour is already a CSS custom property. UI language is English;
Hungarian feed values render verbatim inside it and are never translated.

## Attribution

Positions, timetables and pictograms are MÁV's. Carriage compositions and vehicle drawings are
from [vagonweb.cz](https://www.vagonweb.cz), a volunteer site, treated as such: composition is
fetched on open, cached for 24 h, and rate-limited client-side. The basemap is standard OSM
tiles under the OSMF acceptable-use policy.
