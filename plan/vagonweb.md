# vagonweb.cz — the carriage composition upstream

How the app gets a train's carriage composition. **What is rendered** is `SPEC.md` §6.5;
**how it is drawn** — the strip, the diff, the empty states — is `plan/plan.html` §4b. This
file is the upstream.

Verified live on **2 and 4 Aug 2026** against `Ex/IC 849 Tópart`, `IC 937 Savaria` (GySEV and
MÁV), `RJX 63`, `IR 554/3045/18504`, `Ex/IR 1972` and `Sz 7224`. The input rules were derived
and scored against `plan/data-2026-08-04.json`, a real feed response holding **290 vehicles**.

---

## The request

One `GET` of a server-rendered page. No JavaScript, no `POST`, no headless browser.

```
GET https://www.vagonweb.cz/razeni/vlak.php?zeme=<operator>&kategorie=<code>&cislo=<number>&rok=<year>
Referer:    https://www.vagonweb.cz/
User-Agent: <honest, naming the app>
```

```
browser  --on panel open-->  app/api/composition/route.ts  -->  www.vagonweb.cz
```

A different site and a different hop from the MÁV feed, and **not** through the Hungarian VPS.

### The `Referer` is required

Without one, `vlak.php` returns a **shell**: breadcrumb, train number, route, operator, and no
composition at all. The composition markup is simply absent. Measured against `Ex 849 Tópart`,
everything else held constant:

| `Referer` sent | Response |
| --- | --- |
| *(none)* | 34 KB, **0** compositions |
| `https://www.google.com/` | 34 KB, **0** compositions |
| `https://www.vagonweb.cz/` | **59 KB, full composition** |
| `https://example.com/` | **59 KB, full composition** |
| `x` | **59 KB, full composition** |

Any referer except Google's. It reads like a crawler heuristic rather than a security check.
Nothing else affects it: `User-Agent`, `Accept-Language`, a warmed `PHPSESSID`, requesting the
same page twice in one session and `lang=cs|en|de|hu` all made no difference.

**Send `https://www.vagonweb.cz/`**, as a constant. It is one of the values measured to work,
it needs no configuration, and it keeps this app's own URL out of a third party's logs. The
honest identification goes in the `User-Agent`, which is the header meant to carry it.

The politeness that actually matters here is volume, not headers: one `GET` per train per day
(see *Fetching, caching and mirroring*), no prefetching, no warming, no parallel bursts.

**The shell has a visible face.** Paste one of these URLs into an address bar and the page offers
a single link, **» megjelenítés** (*zobrazit* in Czech, "show"). Clicking it reveals the
composition at the same URL, because the link is a **bare self-link** with an identical query
string:

```html
<h2>&raquo; <a href=../razeni/vlak.php?zeme=M%C3%81V&kategorie=IC&cislo=849&nazev=T%C3%B3part&rok=2026>zobrazit</a></h2>
```

(That is vagonweb's own markup, quoted as served — it carries a `nazev` because vagonweb built
the link from its own record. We do not send one; see below.)

Its only effect is that clicking it makes the browser send a `Referer`. Our fetch never sees the
stub: the `IR 554` URL that shows "megjelenítés" in a browser returned 57,717 bytes and four
composition blocks to the code, on the first request.

**A shell response is a fetch failure, not "no composition on file".** The two are hard to tell
apart — neither has a `class='vlacek'` table and both are ~32-34 KB, so size will not separate
them. **Assume the `Referer` is simply required** and treat a composition-less page from a
train that should have one as the failure it is (§10 #16). No deploy-time assertion and no
canary train: if the heuristic ever changes, every card shows the amber bar at once, which is
loud enough for a personal tool.

---

## The four inputs

| Param | From | Rule |
| --- | --- | --- |
| `zeme` | `trip.route.agency.name` | The first word, URL-encoded. `MÁV Személyszállítási Zrt.` gives `MÁV`, `GYSEV Zrt.` gives `GYSEV`. **No spelling map:** matching is case- and accent-insensitive, so vagonweb's own `GySEV` spelling need not be reproduced. |
| `kategorie` | `trip.trainCategoryName`, through the map below | The filter that separates two records sharing a number. A **wrong** one returns the shell; **omitting** it makes vagonweb pick its own default record, so an unmapped category degrades rather than dies. |
| `cislo` | `trip.tripShortName` | The leading digits. Parses on **290 of 290** trips in `plan/data-2026-08-04.json`. |
| `rok` | first stoptime's `serviceDay` | Calendar year of that instant in `Europe/Budapest`. Not `new Date().getFullYear()`: a trip that departed on 31 December belongs to the old timetable year. |

**`nazev` is not sent.** It is optional on this URL, and a derived one is actively harmful.

It is still **carried**, though: `SPEC.md` §1 passes it to `app/api/composition` as a fifth
parameter that never reaches vagonweb and never enters the cache key. `info_vlak`'s *verify, do
not trust* check and `pickFromSearch` both compare on the name, and with an empty one
`nameMatches` returns `true` unconditionally, so the fallback quietly degrades to "first row with
the right category". The name is a checksum for the answer, not an input to the question.

### Why `nazev` is not sent

A wrong `nazev` returns the shell, so sending a derived name can only break a request that would
otherwise have worked — and the derived name is wrong more often than it looks, because
vagonweb's name is not the feed's name:

| Train | Feed says | vagonweb's name |
| --- | --- | --- |
| `IR 554` | `AGRIA` | **`IR87 Agria`** — the line code from `route.longName`, then the name |
| `IR 3045` | `MÁTRA` | **`IR85 Mátra`** |
| `IR 18504` | `DÉLI -> PARTI` | **`Déli → Parti`** — a real arrow glyph, not the feed's ASCII `->` |

All three return the shell with the derived name, and all three work with **no `nazev` at all**:
4, 3 and 4 composition blocks.

Two more behaviours of this URL:

- **`nazev=_n_` does not work here.** The page takes it as a literal name and returns the shell.
- **A wrong `kategorie` returns the shell.** `kategorie=IR&cislo=849` comes back empty.

The name is still derived from `tripShortName` — it is what checks the answer and picks a search
row — but it stays out of the URL.

**Residual risk:** one operator filing two same-numbered trains under **one** category with
different names, where vagonweb would hand us its default. Whether that ever happens is unproven
in both directions; the `info_vlak` check and the search fallback are what cover it.

### Deriving the number and the name from the feed

Use **`tripShortName`**. Not `route.longName`, which names the *route* and so carries many trains:

| `route.longName` | Trip it was on | What a `longName` rule produces |
| --- | --- | --- |
| `Ex TÓPART` | 845 TÓPART | `TÓPART` — right, but only for this shape |
| `IC KAPOS/KRESZ GÉZA/RIPPL-RÓNAI` | 824 RIPPL-RÓNAI | **three names in one string**; `EC BARTÓK BÉLA/CSÁRDÁS/LEHÁR FERENC/LISZT FERENC/SEMMELWEIS IGNÁC` carries five |
| `Sz 7202/7207/…/7255` | 7224, unnamed | a list of 24 numbers as a "name" |
| `S440`, `IR85`, `Z72` | 34125, 554 AGRIA, 2084 | a **line code** — not a category, and for a named train it is the *first half* of vagonweb's name |

`tripShortName` is `<number>[ <NAME>] <trainCategoryName>`, and the category word is in the same
object, so both ends are known rather than guessed. **290 of 290 parse**, no exceptions.

Names carry spaces, hyphens and ASCII arrows (`DÉLI -> PARTI`, `HERNÁD - ZEMPLÉN`,
`TISZA - SZAMOS`). Since the name is only ever **compared**, never sent, comparison must survive
vagonweb's line-code prefixes and its different arrow glyph — that is what `nameMatches` in the
code below is for.

---

## Mapping `trainCategoryName` to vagonweb's code

Each row confirmed against the `info_vlak` vagonweb returns for a real train of that category:

| `trainCategoryName` | Code | Confirmed by |
| --- | --- | --- |
| InterCity | `IC` | `MÁV IC 845 Tópart` |
| InterRégió | `IR` | `MÁV IR 8903 Pannónia` |
| Expresszvonat | `Ex` | `MÁV Ex 845 Tópart` |
| EuroCity | `EC` | `EC …` leading token, feed |
| EuroRegio | `ER` | `MÁV,ÖBB MÁV:ER/ÖBB:REX 9444` |
| railjet | `RJ` | `MÁV,ZSSK,ČD RJ 274 Metropolitan` |
| railjet xpress | `RJX` | `ÖBB,MÁV,DB RJX 66` |
| sebesvonat | `S` | `MÁV S 19724 Vízipók`, `MÁV S 5226 Bodrog` |
| személyvonat | `Sz` | `MÁV Sz 7224` |
| EuroNight | `EN` | `MÁV,ÖBB EN 462 Kálmán Imre` |

**Do not derive the code from `longName`.** For an unnamed train its leading letters are the
**line** prefix: `S440`, `Z72`, `G43` and `Sz 7202/…` are all `személyvonat`, while `S VÍZIPÓK`
is a `sebesvonat`.

vagonweb lists four more MÁV categories that `plan/data-2026-08-04.json` did not contain. Only one matters:

| Category | Status |
| --- | --- |
| `EN` | **Confirmed.** The evening capture `plan/data-2026-08-07.json` carries three `EuroNight` rows, so the `trainCategoryName` string is exactly `EuroNight`. Note all three are portions of one physical train under three numbers, which `SPEC.md` §7.1 merges before a composition is ever looked up. |
| `Gy` | **Extinct.** No standalone *gyorsvonat* services remain; what is left is folded into IC as unreserved seating. |
| `Kü` | Charter or special working. Not carried by the realtime feed. |
| `TramTrain` | The Szeged tram-train, not part of this GraphQL query. |

An unmapped value must not throw: it drops `kategorie` and lands on the search fallback.

---

## What comes back

Measured 4 Aug 2026, with a referer:

| Train | Size | Planned | Reported | "more" |
| --- | --- | --- | --- | --- |
| `MÁV Ex 849 Tópart` | 56 KB | 1 | 1 | yes |
| `MÁV IC 849 Tópart` | 159 KB | 4 | 3 | yes |
| `GySEV IC 937 Savaria` | 107 KB | 1 | 3 | yes |
| `MÁV RJX 63` | 232 KB | 3 sections | 3 | yes |
| `MÁV Sz 7224` | 42 KB | 1 | 0 | yes |

**Every planned window on that record, and up to three reported days.** §4b draws **three**, so
this one `GET` is the entire data path: no second request, nothing to page through, nothing to
merge.

That is a decision, not a coincidence. More than three means the page's "show more" control,
which is `POST razeni/ajax_dalsi_razeni_vlak.php` with `datum=dalsi`, and it is expensive:
`celkem` is **not** a limit (`celkem=4` and `celkem=20` both returned all 208 KB of remaining
days for 849; `start` only shifts the first one), so it is all-or-nothing. It also takes no
`kategorie`, so it can return the *other* record's days, which would then need filtering by
`info_vlak`. Three days answers "is this train what the timetable says this week?" and avoids all
of it. **If §4b ever wants more, that call is how, with those caveats.**

### Every block names its own record: `info_vlak`

Every composition carries its identity in the attribute behind vagonweb's "found an error?" link:

```html
<a class='chyby odkaz odkaz_podtr' id_zaznamu='131596' rok='2026' autor='kemenymate'
   info_vlak='GySEV IC 937 Savaria' kategorie='razeni'>
```

`info_vlak` is `<operators> <category> <number>[ <name>]`, one per composition, already in the
bytes we fetch. **Present on every composition of every train checked** — 4 of 4 on `462`,
6 of 6 on `RJX 63`, 4 of 4 on `937`, 7 of 7 on `849`, planned windows and reported days alike.

Three things about this tag that a regex gets wrong, and a parser does not:

- **The class is `chyby odkaz odkaz_podtr`**, not a bare `chyby`. Match on the class list
  containing `chyby`, never on equality.
- **On a sectioned train the value spans a newline**, carrying the section after the name:
  `info_vlak='ÖBB,MÁV,DB RJX 63 ⏎ München - Salzburg'`. So it is **not** always
  `<operators> <category> <number>[ <name>]`, and a line-based scan finds nothing at all on
  `RJX 63` while working perfectly on the other three. That is exactly the failure that looks
  like "vagonweb changed their markup" and is not.
- There are more `id_zaznamu` links than compositions (7 against 4 on `462`), because a block
  carries more than one of them. Anchor on the composition table, not on the link count.

| Train | `info_vlak` |
| --- | --- |
| `8802` Fenyves | `MÁV S 8802 Fenyves` for 14.12.–19.06., `MÁV Ex 8802 Fenyves` for 20.06.–30.08. |
| `63` | `ÖBB,MÁV,DB RJX 63` — **multi-operator** |
| `9444` | `MÁV,ÖBB MÁV:ER/ÖBB:REX 9444` — **a category per operator**, written `<op>:<cat>` |
| `19421` | `ÖBB,MÁV ÖBB:REX/MÁV:ER 19421` and `MÁV Sz 19421` — two records, **neither dated**, separable only by category |

Uses:

- **Verify, do not trust.** Drop any block whose number or name is not ours — insurance against
  a dropped `kategorie` or a loose name match.
- **Label each window with its own category** rather than the card with one.
- **Filter the extra reported days** if §4b ever fetches them, since that call is not
  category-scoped.

Match case-insensitively, and where the string carries `<op>:<cat>` pairs, read our own
operator's segment.

### Route sections

A railjet's composition varies by **stretch of route**, not only by timetable window. `RJX 63`
carries sections headed `v úseku:` — München–Salzburg (8 vehicles), Salzburg–Wien (**16**, two
sets coupled), Wien–Budapest (8). **A MÁV trip only ever reaches Wien–Budapest**, so show the
section whose stretch overlaps the trip and never draw one the passenger cannot board.

Reported days are not sectioned the same way: each carries the station it was reported at, so a
day reported before Wien simply contains sixteen vehicles.

**Verified 12 Aug 2026, and the explanation is broader than sectioning.** The page prints a
count, `Plánované řazení (N)`, and then renders **only the window in force today** — not all
`N`. It is not a railjet quirk:

| Train | `(N)` | Planned blocks rendered |
| --- | --- | --- |
| `GySEV IC 937` | 3 | **1**, 26.5.2026–12.12.2026 |
| `MÁV EN 462` | 2 | **1**, 13.6.2026–12.12.2026 |
| `MÁV RJX 63` | 2 | **3**, one per section, all 14.6.2026–12.12.2026 |
| `MÁV IC 849` | 4 | **4**, 14.12.2025–15.3., 16.3.–27.3., 28.3.–30.4., 1.5.–19.6.2026 |

849 is the case that shows the rule: in August that number runs as `Ex`, so **no** window on
the `IC` record is in force, and the page falls back to rendering all four. So: **one window
when one is current, all of them when none is**, and a sectioned train gets one per section.

The consequence for the diff is small in practice. A reported day whose window is not on the
page renders **undiffed** with *"no plan on file for that date"* (`SPEC.md` §6.5) — but all
twelve reported days across those four trains fell inside the current window, so the normal
case has its baseline.

### One record can hold several planned windows

A train is planned per **timetable window**, not per year, and the windows differ materially.
849's `IC` record alone holds four: a locomotive and **seven** coaches for most of the year, but
a locomotive and **four** for the twelve days from 16 to 27 March. So:

- **show** the window containing today;
- **diff a reported day against the window that contained that day**, never today's.

Get that wrong and the diff is computed correctly against the wrong baseline, which is worse than
no diff at all: a March day compared to the May plan reports three coaches missing that were
never meant to be there. The effect is larger still across records — 849's summer `Ex` plan is
three 415 units with no locomotive, so any day from the `IC` season differs in *every* vehicle.

---

## The operator

The first word of the agency name, and no retries:

```ts
const zeme = agencyName.split(' ')[0];   // "MÁV Személyszállítási Zrt." -> "MÁV"
```

**Ask the operator the feed gives and take that answer.** The page scopes by operator exactly as
it does by category: `zeme=GySEV&cislo=937` and `zeme=MÁV&cislo=937` are two different records
for the same named train, with different planned windows. Numbers also repeat across unrelated
railways, and a wrong operator answers with a straight face — `cislo=130` is **EC 130** to Praha
under MÁV and **RJX 130** to Venezia under ÖBB, with nothing in either response admitting which
you asked for. So: no retry under a second operator, and no merging two operators' answers.

**Railjets need no special handling.** A jointly run train is filed **once, against every
operator that runs it**, and the response says so: `info_vlak` for 63 is `ÖBB,MÁV,DB RJX 63`.
Asking as MÁV and asking as ÖBB reach the same single record, so it does not matter which the
feed names — and it names MÁV.

**Do not switch the operator to ÖBB when the route looks like a railjet.** It is unnecessary, and
for one train it is fatal: **`RJ 274 Metropolitan` is `MÁV,ZSSK,ČD`**, Budapest to Praha, with no
ÖBB in it at all.

---

## Two records, one number

The same number can exist under two categories, and the category is then the only thing
separating them. `849 Tópart` is the case to know:

| Record | Runs | Planned windows |
| --- | --- | --- |
| **IC 849** Tópart | the rest of the year | **Four**: 14.12.2025 to 19.06.2026 |
| **Ex 849** Tópart | `jede: od 20.VI. do 30.VIII.` — the Balaton summer only | **One**: 20.06. to 30.08.2026 |

Same name, same route, same times: MÁV rebrands the train `Ex` for the summer season, and
vagonweb keeps a record per category. Sending the feed's category lands on the right one — `Ex`
in August, `IC` in November — and the header, the card and the attribution link then all agree,
because they are built from one request.

**One consequence when diffing.** We hold only **one record's** windows, so a reported day from
the other record's season has no window to match. That is rare, because vagonweb attributes each
reported day to the record whose window contained it and each page carries its own. When it does
happen, render *"no plan on file for that date"* rather than diffing against the wrong window.

### Where each category comes from

| Where | Category from | Why |
| --- | --- | --- |
| Header, search list, §7 badge | `trainCategoryName` | The live one: what the train is running as **today**. |
| The composition request | The same live one, mapped to vagonweb's code | It is the filter. |
| The attribution link | The same live one | It is literally the URL we fetched, so it is right by construction. |

We never *render* vagonweb's category. The feed already answers "what is this train", and every
window we draw is dated, which is the part the category was standing in for. It is used to ask
the right question, not to answer one.

---

## The search fallback

Needed, but only as a fallback.

Of the four inputs, three cannot fail: operator, number and year come straight out of the trip.
So the direct URL has essentially **one** failure mode — **a category that does not match what
vagonweb filed the train under** — which happens two ways:

- **An unmapped `trainCategoryName`.** The code omits `kategorie`, and vagonweb picks *a* record,
  not necessarily ours.
- **A category the two sources disagree on.** vagonweb is maintained carefully and is usually
  current, but it keeps a different editorial calendar from MÁV's, so a train reclassified
  mid-year could briefly exist under only one of them.

The search page is the cheapest recovery: one `GET`, **no `Referer` needed**, and it lists every
record vagonweb holds for that number with its real category **and its real name**. So the
fallback does not guess — it reads what exists and follows that row's own href, which is how
`IR 554` is reached as `nazev=IR87+Agria` without anyone reconstructing that string.

```
GET https://www.vagonweb.cz/razeni/razeni.php?rok=<year>&jmeno=<number>
```

Each result is one row per railway using that number:

```html
<tr onclick="window.location.href='vlak.php?zeme=MÁV&kategorie=Ex&cislo=849&nazev=T%C3%B3part&rok=2026';" class='tr_razeni'>
```

Note `zeme` arrives raw and `nazev` percent-encoded in the same href — let `URLSearchParams`
decode both.

**No pagination handling for the fallback**, and none is needed: a **whole** number returns a
handful of rows, 5 to 7 in every case measured, and no number is plausibly used by more than a
dozen railways.

**But the page does paginate**, and the search field in `SPEC.md` §4.1 can reach it, because a
user types fragments and names where the fallback only ever sends a complete number. Measured
12 Aug 2026: `jmeno=1` returns **150 rows on page 1** and offers **six pages**; `jmeno=Savaria`
returns 24 rows and `jmeno=Tópart` 48, both on one page. So the rule for both callers is the
same: **request page 1 and never follow `&s=2`.** 150 rows before filtering is far more than any
result list should draw, and the operator filter cuts most of them anyway.

**What it must not become:** the primary path. It costs a second round trip and returns every
operator's train with that number, so choosing among its rows re-introduces exactly the ambiguity
the direct URL avoids. Direct first, always.

---

## Searching, as a feature and not only a fallback

`razeni.php` is also the **second source in the search field** (`SPEC.md` §4.1,
`plan.html` §2). Same URL, same parse, different reason: the map only knows the trains running
now, and vagonweb knows the whole timetable year, so a search for a train that is not running
still answers with something worth opening.

The properties that make it usable there, all measured 12 Aug 2026:

- **No `Referer` needed.** `vlak.php` returns the shell without one; this page does not care.
  That is the whole reason a search field can reach it.
- **It matches the number and the name, and nothing else.** `jmeno` is one field over both.
  Number matching is a substring, so `1` matches 1021 and 1972. The route column is *displayed*
  but not searched: `jmeno=Győr` returns nothing, and station search is a separate `relace`
  parameter this app does not use.
- **Each row carries what a result row needs**, in the `onclick` href and the three cells:
  operator, category, number, name, and the stop list with times. Both ends of that list are
  enough for a result row; the middle is elided by vagonweb itself on long routes.
- **Cost.** One `GET`, ~29 KB for a number search. **Debounced 400 ms**, minimum two
  characters, cached per session and never fired for an empty query, because this is still a
  volunteer site behind Cloudflare.

### The operator filter

A train number is a train number all over Europe, and vagonweb holds all of them. `jmeno=929`
returns **seven** rows, of which **two** are ours:

| Row | Kept |
| --- | --- |
| `SNCB IC 929`, Namur to Tournai | no |
| **`GySEV IC 929 Savaria`**, Szentgotthárd to Budapest-Kelenföld | **yes** |
| **`MÁV IC 929 Savaria`**, Szentgotthárd to Budapest-Keleti | **yes** |
| `DB ICE 929`, Dortmund to Regensburg | no |
| `ČD R 929 Krakonoš`, Praha to Trutnov | no |
| `SNCF TGV 929`, Paris to Bourg Saint Maurice | no |
| `WSTBA WEST 929`, Saalfelden to Wien Westbahnhof | no |

Keep **MÁV, GySEV, ÖBB and RegioJet**, and drop the rest **silently**. A dropped row is not a
result and is not counted at the user: how many trains numbered 929 exist in Belgium is not a
fact this map owes anybody. Compare `zeme` case- and accent-insensitively, the same folding the
query gets, so `ÖBB` matches `obb`.

**RegioJet files under two codes**, and both are kept: `RJ`, and **`RJSK`** for its Slovak arm.
Same operator, same trains, and which code a given number lands under is not predictable from
anything we hold — `1021 RegioJet` is `RJ` and `1020 RegioJet`, the other direction of the same
Praha to Košice working, is `RJSK`. So the allow list is five strings for four railways.

**Two rows for one train is normal.** A jointly run train is filed once per operator, and the
two are not identical: GySEV's 929 ends at Budapest-Kelenföld and MÁV's runs on to
Budapest-Keleti. One number under two categories is normal too (`Ex 849` and `IC 849`). Each is
a separate record with its own composition, so neither is deduplicated.

### Other operators' codes seen while measuring

`SNCB`, `DB`, `ČD`, `ČDC`, `SNCF`, `WSTBA`, `ZSSK`, `SJ`, `VR`, `ONCF`, `PKPIC`, `Vy`. The full
list is on the year index page and runs to hundreds. Do not try to enumerate it: the filter is
an allow list, never a deny list.

---

## The whole thing, in code

`lib/vagonweb.ts`. Derives the key from one `trip` of the list query, builds the direct URL, and
falls back to the search page when the direct one comes back without a composition.

> **The regexes below are verified behaviour, not the implementation.** Ship this parsed with
> Cheerio (`SPEC.md` §1), matching what these produce. A line-based scan is what missed
> `info_vlak` entirely on `RJX 63`, whose value contains a newline, and what a bare
> `class='chyby'` match misses on every train, since the real class list is
> `chyby odkaz odkaz_podtr`.

Verified against all 290 trips in `plan/data-2026-08-04.json`: every one produces a key with a mapped
category. Compiled and run live, one train per category — **direct, 9 of 9**, 43 to 229 KB each.
The fallback was exercised by forcing a wrong category (`kategorie=IR` on 849): the direct page
came back without a composition and `pickFromSearch` selected the `Ex` row. `nameMatches` was
checked against vagonweb's real spellings — `IR87 Agria` vs `AGRIA`, `Déli → Parti` vs
`DÉLI -> PARTI` and `Hernád - Zemplén` vs `HERNÁD - ZEMPLÉN` all match, `Savaria` vs `TÓPART`
does not. Type-checks under `tsc --strict`.

```ts
const BASE = 'https://www.vagonweb.cz/razeni';

/** trainCategoryName -> vagonweb's category code. See the mapping table above. */
const CATEGORY: Record<string, string> = {
  'InterCity': 'IC',      'InterRégió': 'IR',   'Expresszvonat': 'Ex',
  'EuroCity' : 'EC',      'EuroRegio' : 'ER',   'railjet'      : 'RJ',
  'railjet xpress': 'RJX', 'sebesvonat': 'S',   'személyvonat' : 'Sz',
  'EuroNight': 'EN',
};

/** Only the shape this needs; it is a subset of the list query's `trip`. */
export type Trip = {
  tripShortName?: string | null;
  trainCategoryName?: string | null;
  stoptimes?: { serviceDay?: number | null }[] | null;
  route?: { agency?: { name?: string | null } | null } | null;
};

export type TrainKey = {
  zeme: string; kategorie: string | null; cislo: string; nazev: string; rok: string;
};

const yearInBudapest = (unixSeconds: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Budapest', year: 'numeric' })
    .format(new Date(unixSeconds * 1000));

/**
 * "849 TÓPART Expresszvonat" -> { cislo: '849', nazev: 'TÓPART', kategorie: 'Ex' }
 * "7224 személyvonat"        -> { cislo: '7224', nazev: '',      kategorie: 'Sz' }
 * The category word is a known suffix and the number a known prefix, so neither end
 * is guessed. Do NOT use route.longName: it names the route, not the trip.
 */
export function trainKey(trip: Trip): TrainKey | null {
  const cat = (trip.trainCategoryName ?? '').trim();
  const sn  = (trip.tripShortName ?? '').trim();

  const cislo = sn.match(/^\d+/)?.[0];
  if (!cislo) return null;                       // no number, nothing to ask for

  const nazev = (cat && sn.endsWith(cat))
    ? sn.slice(cislo.length, sn.length - cat.length).trim()
    : sn.slice(cislo.length).trim();

  const serviceDay = trip.stoptimes?.[0]?.serviceDay;

  return {
    zeme:      (trip.route?.agency?.name ?? '').split(' ')[0],
    kategorie: CATEGORY[cat] ?? null,            // unmapped -> omit, vagonweb picks a default
    cislo,
    nazev,
    rok: serviceDay ? yearInBudapest(serviceDay) : String(new Date().getFullYear()),
  };
}

/**
 * The direct page. `nazev` is deliberately NOT sent: it is optional here, and a derived one
 * is often wrong (vagonweb calls 554 "IR87 Agria" and 18504 "Déli → Parti"), and a wrong
 * `nazev` returns the shell. Never send `_n_` here either — it is taken literally.
 */
export function trainPageUrl(key: TrainKey): string {
  const q = new URLSearchParams({ zeme: key.zeme });
  if (key.kategorie) q.set('kategorie', key.kategorie);
  q.set('cislo', key.cislo);
  q.set('rok', key.rok);
  return `${BASE}/vlak.php?${q}`;
}

export const searchUrl = (key: TrainKey) =>
  `${BASE}/razeni.php?${new URLSearchParams({ rok: key.rok, jmeno: key.cislo })}`;

/**
 * vlak.php only renders the composition when a Referer arrives, and does not care which one
 * (any value but Google's works). So: a constant, no configuration, and this app's own URL
 * stays out of someone else's logs. The User-Agent is where the honest identification goes.
 */
const HEADERS = {
  Referer: 'https://www.vagonweb.cz/',
  'User-Agent': 'vonatinfo/1.0',
};

/** A page without this is either the no-Referer shell or a train with nothing on file. */
export const hasComposition = (html: string) => /class='vlacek'/.test(html);

/* Reference behaviour only. The app ships ONE folding function, SPEC.md §4's explicit
   `fold()`, and this calls through to it. Do not ship a second folder built on NFD:
   `ő` and `ű` decompose inconsistently, and decomposition changes string length, which
   the search highlighter depends on not doing. Extend §4's ACCENTS map instead. */
const norm = (s: string | null) => fold((s ?? '').trim());

/**
 * Loose name comparison, for checking an answer rather than requesting one. vagonweb's name
 * may carry a line-code prefix the feed does not have ("IR87 Agria" vs "AGRIA") and a different
 * arrow character ("Déli → Parti" vs "DÉLI -> PARTI"), so: strip accents and case, flatten
 * arrows and punctuation away, then ask whether ours is contained in theirs.
 */
const nameKey = (s: string | null) =>
  norm(s).replace(/->|<-|[→←]/g, ' ').replace(/[^a-z0-9]+/g, '');

export const nameMatches = (vagonwebName: string | null, ours: string) =>
  !ours || nameKey(vagonwebName).includes(nameKey(ours));

/**
 * The search page lists every operator's train with that number, one row each:
 *   <tr onclick="window.location.href='vlak.php?zeme=MÁV&kategorie=Ex&cislo=849&nazev=T%C3%B3part&rok=2026';"
 * Note `zeme` arrives raw and `nazev` percent-encoded in the same href, so let
 * URLSearchParams decode both. Narrow by operator, then category, then name.
 */
export function pickFromSearch(html: string, key: TrainKey) {
  const rows = [...html.matchAll(/<tr onclick="window\.location\.href='(vlak\.php\?[^']+)'/g)]
    .map(m => {
      const p = new URLSearchParams(m[1].slice('vlak.php?'.length));
      return {
        href: `${BASE}/${m[1]}`,
        zeme: p.get('zeme'), kategorie: p.get('kategorie'),
        cislo: p.get('cislo'), nazev: p.get('nazev'),
      };
    })
    .filter(r => r.cislo === key.cislo && norm(r.zeme) === norm(key.zeme));

  if (!rows.length) return null;
  return rows.find(r => r.kategorie === key.kategorie && nameMatches(r.nazev, key.nazev))
      ?? rows.find(r => r.kategorie === key.kategorie)
      ?? rows.find(r => nameMatches(r.nazev, key.nazev))
      ?? rows[0];
}

export type Fetched =
  /** vagonweb has a composition and here it is */
  | { ok: true; found: true;  url: string; html: string; via: 'direct' | 'search' }
  /** the page rendered fine and vagonweb simply has no composition for this train */
  | { ok: true; found: false; url: string }
  /** the request failed, or the page came back as the no-Referer shell */
  | { ok: false; url?: string; reason: string };

/**
 * Direct first, search only if the direct page came back without a composition.
 * The three outcomes are deliberately distinct: `found: false` is a normal state the
 * card renders as "no composition on file", `ok: false` is a failure and must never
 * render as that.
 */
export async function fetchComposition(trip: Trip): Promise<Fetched> {
  const key = trainKey(trip);
  if (!key) return { ok: false, reason: 'no train number in tripShortName' };

  const direct = trainPageUrl(key);
  const res = await fetch(direct, { headers: HEADERS });
  if (!res.ok) return { ok: false, url: direct, reason: `vagonweb ${res.status} on vlak.php` };
  const html = await res.text();
  if (hasComposition(html)) return { ok: true, found: true, url: direct, html, via: 'direct' };

  // Almost always a wrong or unmapped category. The search page carries vagonweb's own
  // spelling of the name in each row's href, so the retry uses that rather than ours.
  const sres = await fetch(searchUrl(key), { headers: HEADERS });
  if (!sres.ok) return { ok: false, url: direct, reason: `vagonweb ${sres.status} on razeni.php` };
  const hit = pickFromSearch(await sres.text(), key);
  if (!hit) return { ok: true, found: false, url: direct };

  const hres = await fetch(hit.href, { headers: HEADERS });
  if (!hres.ok) return { ok: false, url: hit.href, reason: `vagonweb ${hres.status} on vlak.php` };
  const hhtml = await hres.text();
  return hasComposition(hhtml)
    ? { ok: true, found: true, url: hit.href, html: hhtml, via: 'search' }
    : { ok: true, found: false, url: hit.href };
}
```

`fetchComposition` returns `ok: false` for a genuine fetch failure and `found: false` for a train
vagonweb has no entry for. §4b renders those differently; never collapse them.

**It cannot tell the shell from a train with nothing on file**, since both lack the `vlacek`
table and both are ~32-34 KB. The `Referer` is treated as required, so with it sent a
composition-less page is read as "nothing on file"; see "The `Referer` is required".

---

## Fetching, caching and mirroring

| Concern | Rule |
| --- | --- |
| When it fetches | On panel open on desktop, on the **first swipe to the composition page** on mobile (`SPEC.md` §6.5), once, and only after the selection has held for 600 ms. Above 10 fetches in a rolling minute the card asks before fetching (`SPEC.md` §6.5). **Not** part of the 30 s poll: a coach list does not change while you watch it. |
| Where from | `app/api/composition/route.ts`, sending the `Referer` and `User-Agent`. The Czech HTML is parsed **server-side** and never reaches the browser. |
| What is stored | Every planned window with its date range and section, and every reported day fetched. Older windows are kept even when only the current one is drawn, because a reported day is diffed against the window in force on *that* day. |
| Cache | Keyed on `operator + category + number + year` — the URL's own inputs — for **24 h**. This is timetable data. **No server-side store.** The handler sets `Cache-Control: public, s-maxage=86400, stale-while-revalidate=86400` and lets the browser and the CDN hold it. Nothing is written to disk, which would not survive a serverless filesystem anyway. |
| **Load** | **One `GET` per train per day**, and that is the whole budget. vagonweb is a volunteer site behind Cloudflare and it noticeably slowed under the verification traffic that produced this document, so treat that as the ceiling. No prefetching for trains the user has not opened, no warming the cache across the map, no parallel bursts. Serve stale while revalidating rather than blocking on a refetch. |
| Language | vagonweb answers in Czech. **Match on pictogram filenames**, never on the Czech `title` text, which is prose and will change. |
| Images | vagonweb's own drawings, **proxied through our origin, never hotlinked.** `app/api/vehicle-image?src=<encoded path>` fetches the GIF from vagonweb and returns it with `Cache-Control: public, max-age=2592000` (**30 days**), so the **browser and the CDN** are the mirror and nothing is stored server-side. A drawing effectively never changes under its filename, so a month costs one refetch per drawing per month at worst and keeps a corrected drawing from being pinned for a year. An `<img src>` pointing at vagonweb is a request to their server for every vehicle on every panel open, which is the thing being avoided; a cold cache costing one fetch is not. **Normalise the path before it becomes the cache key** (`../popisy/img/ELOC/../D-/…`, see below) and reject anything that escapes `vagonweb.cz/popisy/img/`, or the route is an open proxy. The path travels as a **query parameter** rather than a route segment: these paths are multi-segment and carry `..`, which one dynamic segment cannot hold and a catch-all would normalise before the guard runs (`SPEC.md` §1). |
| Missing drawings | Some vehicles have **none** on file (both Byee coaches in the 31 July and 28 July Savaria compositions), so the SVG silhouette fallback in `plan.html` §4b is load-bearing, not decorative. |
| Attribution | Required wherever the drawings appear. The card names vagonweb.cz and links to the same URL it was built from, which carries the right `kategorie` by construction. |

---

## Parsing the page

Per vehicle, the HTML gives: the car number (`span.raz-cislo`), operator, UIC type code and
series, a class band (`tab-1tr`, `tab-2tr`, `tab-club`, `tab-jidel`, `tab-sluz`), amenities as
pictogram filenames with an optional count, and **the vehicle drawing** (`img.obrazek_vagonu`,
e.g. `../popisy/img/START/Bpmee-2070-m-a.gif`).

Pictogram filenames seen across the trains checked — **not exhaustive**, so treat an unknown
one as "ignore", never as an error: `tr1`, `tr2`, `tr1p1`, `1sed`, `2sed`, `klima`, `230V`,
`usb`, `wifi`, `wc`, `inv_plos`, `jidel`, `info`, `kolo`, `kocar`, `kino`, `kamera`.

### The pictogram map

Pictograms live at **`https://www.vagonweb.cz/popisy/ico/<name>.svg`**, on `img.pikto`, each
carrying a Czech `title`. Confirmed 12 Aug 2026 against `GySEV IC 937` (109 KB), which serves
`1sed`, `2sed`, `230V`, `usb`, `inv_plos`, `kamera`, `klima`, `kocar`, `kolo`, `tr1`, `tr2`,
`wc` and `wifi`.

**They are never proxied and never rendered.** Only the vehicle *drawings* under `popisy/img/`
go through `app/api/vehicle-image?src=…`; a pictogram is matched by filename and drawn from
our own sprite, so its file is never fetched. **Match on the filename, never on the `title`**,
which is Czech prose and will change.

| vagonweb file | Sprite icon | Label |
| --- | --- | --- |
| `wifi` | `i-wifi` | Free Wi-Fi |
| `usb` | `i-power` | USB power |
| `230V` | `i-plug` | 230 V sockets |
| `klima` | `i-ac` | Air conditioning |
| `wc` | `i-wc` | Closed-system WC |
| `kolo` | `i-bike` | Bicycle spaces |
| `inv_plos` | `i-wheelchair` | Wheelchair lift |
| `kocar` | `i-pram` | Pram space |
| `kamera` | `i-camera` | CCTV |
| `jidel` | `i-dining` | Restaurant |
| `info` | `i-service` | On-board service |
| `kino` | `i-screen` | On-board entertainment |

**`tr1`, `tr2`, `tr1p1`, `1sed` and `2sed` are not in this table on purpose.** `tr1` / `tr2`
are the class markers (*1. třída*, *2. třída*) and `1sed` / `2sed` the seating layout
(compartment against open saloon). They feed the class band and the vehicle label, and they
must never appear in the amenity row — an "amenity" reading *2nd class* beside a seat count
that already says so is noise.

**An unmapped filename is ignored silently.** The list above is what has been measured, not
what exists, so a vehicle quietly missing one mark is the expected failure and is a much
smaller wrong than a broken icon or a thrown parse.

`plan.html`'s `CX_AM` map has since been brought onto these filenames and matches the table
above. It keeps a small `CX_ALIAS` layer (`v230`, `invp`, `pram`, `cam`) purely so the mock's
own hand-written sample data still resolves; **those aliases are not vagonweb filenames and
nothing in the app should carry them.** Match the real names only.

Three gotchas, each found by checking a second train rather than trusting one sample:

- **A car number is not always a number.** 937 ran twice as a single 815 unit numbered `11-16`.
  Take the leading digits; `Number()` gives `NaN`.
- **Image paths are not normalised.** Some are `../popisy/img/ELOC/../D-/ELOC/193-633-a.gif`.
  Resolve the `..` before using the path as a cache key, or the same drawing is stored twice.
- **One slot can hold two vehicles.** Where vagonweb fills a position with either of two
  machines, it emits a small `<script>` cycling the drawing between them every 1500 ms, with each
  alternative's own image, height and class band. `plan.html` §4b reproduces this.

The drawings are vagonweb's own work, one per vehicle in its correct livery, drawn to **10 px per
metre** — so an image's natural width *is* the vehicle's length and a strip built from them is to
scale. Lengths run from a 19 m locomotive to a 154 m 815 double-decker, so nothing rendering them
can assume a fixed scale.

---

## Verified 12 Aug 2026

Four questions that were open here are now answered, against `EN 462` / `50462` / `40462`,
`MÁV RJX 63`, `GySEV IC 937` and `MÁV IC 849`.

- **A portioned train's composition is filed under the lowest number**, which is the same
  portion `SPEC.md` §7.1 already picks as primary. `EN 462` returns 182 KB and four
  compositions; `50462` and `40462` return ~32 KB with **no composition at all**. So the
  merged train looks its composition up under the number it is already keyed by, and nothing
  extra is needed. Its `info_vlak` reads `MÁV,ÖBB MÁV:EN/ÖBB:EC 462 Kálmán Imre`, one category
  per operator, so read our own operator's segment as the table above says.
- **A sectioned train's past windows are not on the page**, and neither are anyone else's.
  See the block under "Route sections" for the actual rule.
- **`info_vlak` is on every composition**, 21 of 21 across the four trains.
- **GySEV runs the whole pipeline.** `GySEV IC 937 Savaria`: 109 KB, one planned window,
  three reported days, `info_vlak='GySEV IC 937 Savaria'`.
- **Reported days: three** on all four trains, so with the earlier 0 and 1 the rule stays "up
  to three".

## Left to verify

- The referer heuristic itself: undocumented behaviour on someone else's site, which can change
  without notice. That is why the shell has its own error state. Nothing asserts on it at
  deploy: the header is always sent, and if the rule changes the amber bar appears everywhere
  at once.
- **Whether vagonweb rate-limits, and at what threshold.** It appeared to slow under the
  verification traffic for this document; nothing was ever refused, so no limit was confirmed.
  The steady state (one cached request per train per day) is far below anything that would
  matter. Any future verification should be batched, spaced, and kept to the few trains that
  actually answer the question.
