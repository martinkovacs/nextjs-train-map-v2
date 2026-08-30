import * as cheerio from 'cheerio';
import { fold } from './fold';
import { yearInBudapest } from './time';
import { VW_CATEGORY } from './categories';

/** The second upstream, vagonweb.cz: the three calls and the four inputs.
 *  plan/vagonweb.md is the full document; this is the implementation, parsed with
 *  Cheerio rather than the regexes there, which are reference behaviour. */

const BASE = 'https://www.vagonweb.cz/razeni';


export type TrainKey = {
  zeme: string;
  kategorie: string | null;
  cislo: string;
  nazev: string;
  rok: string;
};

/** vlak.php only renders the composition when a Referer arrives, and does not care which
 *  one (any value but Google's works). So: a constant, no configuration, and this app's
 *  own URL stays out of someone else's logs. The User-Agent carries the honest
 *  identification, without a URL. */
export const VW_HEADERS = {
  Referer: 'https://www.vagonweb.cz/',
  'User-Agent': 'vonatinfo/1.0',
};

export const VW_TIMEOUT_MS = 10_000;

/** The four inputs, all out of the trip. `nazev` is derived but NEVER sent: it is
 *  optional on this URL and a wrong one returns the shell, and vagonweb's name is not the
 *  feed's name ("IR87 Agria" against "AGRIA"). It rides along as a checksum instead. */
export function trainKey(input: {
  agencyName: string; category: string; number: string; name: string; serviceDay?: number;
}): TrainKey | null {
  if (!input.number) return null;   // no train number, nothing to ask for
  return {
    zeme: (input.agencyName ?? '').split(' ')[0],
    kategorie: VW_CATEGORY[input.category] ?? null,   // unmapped -> omit, vagonweb defaults
    cislo: input.number,
    nazev: input.name ?? '',
    rok: input.serviceDay
      ? yearInBudapest(input.serviceDay)
      : String(new Date().getFullYear()),
  };
}

export function trainPageUrl(key: TrainKey): string {
  const q = new URLSearchParams({ zeme: key.zeme });
  if (key.kategorie) q.set('kategorie', key.kategorie);
  q.set('cislo', key.cislo);
  q.set('rok', key.rok);
  return `${BASE}/vlak.php?${q}`;
}

export const searchUrl = (rok: string, jmeno: string) =>
  // The query goes upstream UNFOLDED (SPEC 1): vagonweb folds accented vowels but not
  // Czech carons, so folding would be invisible on Hungarian names and would silently
  // empty the list on Czech and Slovak ones, which RegioJet files under.
  `${BASE}/razeni.php?${new URLSearchParams({ rok, jmeno })}`;

/** A page without this is either the no-Referer shell or a train with nothing on file.
 *  The Referer is treated as required, so with it sent a composition-less page reads as
 *  "nothing on file" (plan/vagonweb.md). */
export const hasComposition = (html: string) => html.includes("class='vlacek'")
  || html.includes('class="vlacek"');

const norm = (s: string | null | undefined) => fold((s ?? '').trim());

/** Loose name comparison, for checking an answer rather than requesting one. vagonweb's
 *  name may carry a line-code prefix the feed does not have and a different arrow
 *  character, so: fold, flatten arrows and punctuation away, then ask whether ours is
 *  contained in theirs. With an empty name this returns true unconditionally, which is
 *  the documented degrade to "first row with the right category". */
const nameKey = (s: string | null | undefined) =>
  norm(s).replace(/->|<-|[→←]/g, ' ').replace(/[^a-z0-9]+/g, '');

export const nameMatches = (vagonwebName: string | null | undefined, ours: string) =>
  !ours || nameKey(vagonwebName).includes(nameKey(ours));

/* ---- the search page ----------------------------------------------------- */

export type SearchRow = {
  href: string;
  zeme: string; kategorie: string | null; cislo: string; nazev: string; rok: string;
  route: string;    // both ends of the stop list, which is all a result row needs
};

/** Each result is one row per railway using that number:
 *    <tr onclick="window.location.href='vlak.php?zeme=MÁV&kategorie=Ex&cislo=849&…'">
 *  `zeme` arrives raw and `nazev` percent-encoded in the same href, so URLSearchParams
 *  decodes both. */
export function parseSearchRows(html: string): SearchRow[] {
  const $ = cheerio.load(html);
  const rows: SearchRow[] = [];
  $('tr').each((_, el) => {
    const onclick = $(el).attr('onclick') ?? '';
    const m = onclick.match(/vlak\.php\?[^']+/);
    if (!m) return;
    const p = new URLSearchParams(m[0].slice('vlak.php?'.length));
    const cells = $(el).find('td').map((__, td) => $(td).text().replace(/\s+/g, ' ').trim()).get();
    rows.push({
      href: `${BASE}/${m[0]}`,
      zeme: p.get('zeme') ?? '',
      kategorie: p.get('kategorie'),
      cislo: p.get('cislo') ?? '',
      nazev: p.get('nazev') ?? '',
      rok: p.get('rok') ?? '',
      route: cells.filter(Boolean).slice(-1)[0] ?? '',
    });
  });
  return rows;
}

/** Narrow by operator, then category, then name. Never guesses a URL: it follows the
 *  row's own href, which is how IR 554 is reached as nazev=IR87+Agria. */
export function pickFromSearch(html: string, key: TrainKey): SearchRow | null {
  const rows = parseSearchRows(html)
    .filter((r) => r.cislo === key.cislo && norm(r.zeme) === norm(key.zeme));
  if (!rows.length) return null;
  return rows.find((r) => r.kategorie === key.kategorie && nameMatches(r.nazev, key.nazev))
    ?? rows.find((r) => r.kategorie === key.kategorie)
    ?? rows.find((r) => nameMatches(r.nazev, key.nazev))
    ?? rows[0];
}

/** Keep MÁV, GySEV, ÖBB and RegioJet, the last under BOTH codes it files with. Drop
 *  everything else silently: a dropped row is not a result and is not counted at the
 *  user. Compared through the app's one fold(), so ÖBB and obb are one operator. */
const VW_OPERATORS = ['máv', 'gysev', 'öbb', 'rj', 'rjsk'].map(fold);
export const keptOperator = (zeme: string) => VW_OPERATORS.includes(fold(zeme.trim()));

/* ---- fetching the composition (up to three GETs, usually one) ------------- */

export type Fetched =
  | { ok: true; found: true; url: string; html: string; via: 'direct' | 'search' }
  | { ok: true; found: false; url: string }
  | { ok: false; url: string; status?: number; reason: string; where: string };

const get = async (url: string) =>
  fetch(url, { headers: VW_HEADERS, signal: AbortSignal.timeout(VW_TIMEOUT_MS) });

/** Direct first, ALWAYS. The search page is the recovery for the direct URL's one
 *  failure mode, a category vagonweb filed the train under differently, and it must
 *  never become the primary path. The three outcomes are deliberately distinct:
 *  `found: false` is a normal answer the card renders as "No composition on file";
 *  `ok: false` is SPEC 10 #16 and must never render as that. */
export async function fetchComposition(key: TrainKey): Promise<Fetched> {
  const direct = trainPageUrl(key);
  let res: Response;
  try {
    res = await get(direct);
  } catch (e) {
    return { ok: false, url: direct, reason: reason(e), where: 'vlak.php' };
  }
  if (!res.ok) {
    return { ok: false, url: direct, status: res.status,
      reason: `${res.status} ${res.statusText}`, where: 'vlak.php' };
  }
  const html = await res.text();
  if (hasComposition(html)) return { ok: true, found: true, url: direct, html, via: 'direct' };

  // Almost always a wrong or unmapped category. The search page carries vagonweb's own
  // spelling of the name in each row's href, so the retry uses that rather than ours.
  let sres: Response;
  try {
    sres = await get(searchUrl(key.rok, key.cislo));
  } catch (e) {
    return { ok: false, url: direct, reason: reason(e), where: 'razeni.php' };
  }
  if (!sres.ok) {
    return { ok: false, url: direct, status: sres.status,
      reason: `${sres.status} ${sres.statusText}`, where: 'razeni.php' };
  }
  const hit = pickFromSearch(await sres.text(), key);
  if (!hit) return { ok: true, found: false, url: direct };

  let hres: Response;
  try {
    hres = await get(hit.href);
  } catch (e) {
    return { ok: false, url: hit.href, reason: reason(e), where: 'vlak.php' };
  }
  if (!hres.ok) {
    return { ok: false, url: hit.href, status: hres.status,
      reason: `${hres.status} ${hres.statusText}`, where: 'vlak.php' };
  }
  const hhtml = await hres.text();
  return hasComposition(hhtml)
    ? { ok: true, found: true, url: hit.href, html: hhtml, via: 'search' }
    : { ok: true, found: false, url: hit.href };
}

const reason = (e: unknown) => {
  const err = e as Error & { cause?: { code?: string } };
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'aborted after 0:10';
  return `${err.cause?.code ?? err.name} ${err.message}`.trim();
};

/** Image paths are not normalised upstream (`../popisy/img/ELOC/../D-/…`). Resolve the
 *  `..` segments BEFORE the path becomes a cache key, or the same drawing is stored
 *  twice, and reject anything that escapes vagonweb.cz/popisy/img/ or the proxy route is
 *  an open proxy. */
export function resolveImagePath(src: string): string | null {
  let url: URL;
  try {
    url = new URL(src, 'https://www.vagonweb.cz/razeni/');
  } catch {
    return null;
  }
  if (url.hostname !== 'www.vagonweb.cz' && url.hostname !== 'vagonweb.cz') return null;
  if (!url.pathname.startsWith('/popisy/img/')) return null;
  return `https://www.vagonweb.cz${url.pathname}`;
}
