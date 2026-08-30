import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { resolveImagePath } from './vagonweb';

/** Parsing vlak.php, server-side, with Cheerio (SPEC 1). Not regexes: the markup carries
 *  multi-line attribute values (`info_vlak` on a sectioned train spans a newline) and
 *  multi-class hooks (`class='chyby odkaz odkaz_podtr'`, never a bare `chyby`) that a
 *  line-based scan silently misses.
 *
 *  The shape of the page, as served:
 *    <h4 id=v6407>Plánované řazení <b>14.12.2025</b> - <b>15.3.2026</b></h4>
 *    <table class='vlacek' id='vlacek6407'>
 *      <td class='bunka_vozu' width='245px'>
 *        <td class='tab-2tr'>                       the class band, one td per segment
 *        <img class='obrazek_vagonu' style='height:43px; width:245px'>
 *        <span class=raz-cislo>2</span> <span title=…>START</span>
 *        <span class=tab-radam>Bpee</span> <small>2044</small>
 *        <span class='tab-pocmist'><img class=pikto src=…/2sed.svg> 78 <img …/wifi.svg></span>
 *    and one <a class='chyby …' id_zaznamu='6407' info_vlak='MÁV IC 849 Tópart'> per block.
 *
 *  One request returns the planned windows the page renders and up to three reported
 *  days. That is the whole data path: no pagination, and the only second request that
 *  ever fires is the search fallback, which is looking for a different record. */

export type Vehicle = {
  no: string | null;        // the number written on the coach itself
  op: string;               // the owning railway
  type: string;             // the coach type, or the class for a locomotive
  isLoco: boolean;
  ser: string | null;       // series
  img: string | null;       // absolute vagonweb path, proxied through /api/vehicle-image
  w: number;                // the drawing's natural width: 10 px per metre, so this IS
                            // the vehicle's length and the strip comes out to scale
  h: number;
  bands: string[];          // c1 | c2 | club | dine | sluz | none, in drawn order
  am: { file: string; count: string | null }[];   // matched by FILENAME, never the title
  seats: string | null;
  note: string | null;
  alt?: Vehicle[];          // a slot vagonweb fills with either of two machines
};

export type PlannedWindow = {
  label: string;            // "14.12.2025 - 15.3.2026", as the page writes it
  section: string | null;   // "München - Salzburg" on a sectioned train
  category: string | null;  // from this block's own info_vlak
  record: string;           // the block's own info_vlak, for the verify check
  from: number | null; to: number | null;
  vehicles: Vehicle[];
};

export type ReportedDay = {
  label: string;            // "9.6.2026"
  date: number | null;
  where: string;            // the station it was reported at, when the page names one
  record: string;
  vehicles: Vehicle[];
};

export type ParsedComposition = {
  windows: PlannedWindow[];
  days: ReportedDay[];
  plannedCount: number;     // the page's own "Plánované řazení (N)"
  reportedCount: number;    // and its "Skutečné řazení (N)"
};

/* ---- dates ---------------------------------------------------------------- */

const DATE = /(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})?/g;
const toUnix = (d: number, m: number, y: number) => Date.UTC(y, m - 1, d) / 1000;

function datesIn(text: string): { unix: number; raw: string }[] {
  const out: { unix: number; raw: string }[] = [];
  let year = new Date().getFullYear();
  const matches = [...text.matchAll(DATE)];
  // A range can be written "16.3. - 27.3.2026": the year appears once, at the end.
  for (let i = matches.length - 1; i >= 0; i--) {
    const [raw, dd, mm, yy] = matches[i];
    if (yy) year = Number(yy);
    out.unshift({ unix: toUnix(Number(dd), Number(mm), year), raw: raw.trim() });
  }
  return out;
}

/* ---- one vehicle ---------------------------------------------------------- */

const BAND_CLASS: Record<string, string> = {
  'tab-1tr': 'c1', 'tab-2tr': 'c2', 'tab-club': 'club',
  'tab-jidel': 'dine', 'tab-sluz': 'sluz', 'tab-': 'none',
};
/** tr1 / tr2 / 1sed / 2sed are the class and seating-layout markers, NOT amenities.
 *  They feed the class band and the seat count, and must never render in the amenity
 *  row: an "amenity" reading 2nd class beside a seat count that already says so is
 *  noise. */
const CLASS_PICTO: Record<string, string> = { tr1: 'c1', tr2: 'c2', tr1p1: 'c1' };
const LAYOUT_PICTO = new Set(['1sed', '2sed']);

const fileOf = (src: string) =>
  (src.split('/').pop() ?? '').replace(/\.(svg|gif|png|jpg)$/i, '');

const pxOf = (v: string | undefined, prop: string) =>
  Number((v ?? '').match(new RegExp(`${prop}\\s*:\\s*(\\d+(?:\\.\\d+)?)`))?.[1] ?? 0);

/** A slot vagonweb fills with either of two machines is ONE cell whose drawing is cycled
 *  by a small script, with each alternative's own image, height and class band declared in
 *  it and each alternative's own description block separated by an <hr>. It is never two
 *  slots, because the train is not two locomotives long. */
type AltScript = { images: string[]; heights: number[]; bands: string[][] };

export function readAltScripts(html: string): Map<string, AltScript> {
  const out = new Map<string, AltScript>();
  const keys = new Set([...html.matchAll(/var\s+obr_(\d+_\d+)\s*=/g)].map((m) => m[1]));
  for (const key of keys) {
    const images = [...html.matchAll(new RegExp(`obr_${key}\\[(\\d+)\\]\\.src\\s*=\\s*'([^']+)'`, 'g'))]
      .map((m) => m[2]);
    const heights = [...html.matchAll(new RegExp(`vyska_${key}\\[(\\d+)\\]\\s*=\\s*"(\\d+)"`, 'g'))]
      .map((m) => Number(m[2]));
    const bands = [...html.matchAll(new RegExp(`tridy_${key}\\[(\\d+)\\]\\s*=\\s*"([^"]*)"`, 'g'))]
      .map((m) => [...m[2].matchAll(/class=['"]?(tab-[a-z0-9]*)/g)]
        .map((c) => BAND_CLASS[c[1]] ?? '').filter(Boolean));
    out.set(key, { images, heights, bands });
  }
  return out;
}

/** One alternative's description block: its own type, operator, series, seats and marks. */
function readBlock($: cheerio.CheerioAPI, radam: Element) {
  const $radam = $(radam);
  const block = $radam.closest('div').parent();
  const type = ($radam.clone().children('sup').remove().end().text() || '').trim();
  const ser = ($radam.next('small').text() || '').trim() || null;
  const op = ($radam.prev('span').text() || '').trim();
  const note = ($radam.nextAll('i').first().text() || '').trim() || null;

  const am: Vehicle['am'] = [];
  const seatCounts: string[] = [];
  const bands: string[] = [];
  const marks = block.find('.tab-pocmist').contents().toArray();
  for (let i = 0; i < marks.length; i++) {
    const node = marks[i];
    if (node.type !== 'tag' || node.name !== 'img') continue;
    const file = fileOf($(node).attr('src') ?? '');
    if (!file) continue;
    const cls = CLASS_PICTO[file];
    // tr1 / tr2 / 1sed / 2sed are the class and seating-layout markers, NOT amenities:
    // they feed the class band and the seat count and never render in the amenity row.
    if (cls) { if (!bands.includes(cls)) bands.push(cls); continue; }
    if (LAYOUT_PICTO.has(file)) {
      const after = marks.slice(i + 1).find((n) => n.type === 'text' && /\d/.test(n.data));
      const found = after && after.type === 'text' ? after.data.match(/\d+(\+\d+)?/) : null;
      // one count per layout pictogram: a coach with two sections seats each separately
      if (found) seatCounts.push(found[0]);
      continue;
    }
    const next = marks[i + 1];
    const count = next && next.type === 'text'
      ? next.data.match(/^\s*(\d+)/)?.[1] ?? null : null;
    am.push({ file, count });   // matched by FILENAME, never by the Czech title
  }
  return { type, ser, op, note, am, seats: seatCounts.length ? seatCounts.join(' / ') : null,
    bands };
}

function parseVehicle($: cheerio.CheerioAPI, cell: Element, alts: Map<string, AltScript>):
  Vehicle | null {
  const $cell = $(cell);
  const image = $cell.find('img.obrazek_vagonu').first();
  const no = ($cell.find('span.raz-cislo').first().text() || '').trim() || null;
  const blocks = $cell.find('span.tab-radam').toArray();
  if (!image.length && !no && !blocks.length) return null;

  // the class band, a row of SEGMENTS: the railjet Afmpz carries Business over first
  // class, so a single-class coach is the one-segment case and a locomotive has none
  const cellBands: string[] = [];
  $cell.find('td[class^="tab-"]').each((_, td) => {
    const band = BAND_CLASS[($(td).attr('class') ?? '').trim()];
    if (band) cellBands.push(band);
  });

  const cellWidth = Number(($cell.attr('width') ?? '').replace(/[^\d]/g, '')) || 0;
  const scriptKey = (image.attr('id') ?? '').replace(/^obraz_/, '');
  const script = alts.get(scriptKey);
  const style = image.attr('style');

  const build = (i: number): Vehicle => {
    const parsed = blocks[i] ? readBlock($, blocks[i]) : null;
    const rawSrc = script?.images[i] ?? image.attr('src') ?? '';
    const type = parsed?.type || fileOf(rawSrc).split(/[-_,]/)[0];
    const bands = parsed?.bands.length ? parsed.bands
      : script?.bands[i]?.length ? script.bands[i]
      : cellBands;
    // A locomotive is drawn out of vagonweb's loco folders. The fallback is deliberately
    // narrow: a 415 Flirt unit is numbered like a class and is not a locomotive, and its
    // seats and class band both disqualify it.
    const isLoco = /\/(ELOC|DLOC|PARNI)\//i.test(rawSrc)
      || (!parsed?.seats && !no && bands.every((b) => b === 'none') && /^\d{3}$/.test(type));
    return {
      no,
      op: parsed?.op ?? '',
      type,
      isLoco,
      ser: parsed?.ser ?? null,
      img: rawSrc ? resolveImagePath(rawSrc) : null,
      // vagonweb draws at 10 px per metre, so the natural width IS the length. The
      // fallback keeps the same box, or a missing drawing would change the length of the
      // train. An alternating slot takes the cell's width, which vagonweb sizes to the
      // longest alternative, so the strip does not jump as the drawing cycles.
      w: cellWidth || pxOf(style, 'width') || (isLoco ? 190 : 264),
      h: script?.heights[i] || pxOf(style, 'height') || (isLoco ? 58 : 40),
      bands: bands.filter((b) => b !== 'none'),
      am: parsed?.am ?? [],
      seats: parsed?.seats ?? null,
      note: parsed?.note ?? null,
    };
  };

  const count = Math.max(script?.images.length ?? 0, blocks.length, 1);
  if (count > 1) {
    const list = Array.from({ length: count }, (_, i) => build(i));
    return { ...list[0], alt: list };
  }
  return build(0);
}

/* ---- one composition block ------------------------------------------------ */

const vehiclesIn = ($: cheerio.CheerioAPI, block: Element,
                    alts: Map<string, AltScript>): Vehicle[] =>
  // Rendered in the reported train's own order, head to tail, never re-sorted: a car
  // number is fixed to the coach, so which end it is at depends on which way the train
  // faces, and vagonweb already knows the direction.
  $(block).find('td.bunka_vozu').toArray()
    .map((cell) => parseVehicle($, cell, alts))
    .filter((v): v is Vehicle => v != null);

const sectionOf = (heading: string, infoVlak: string) => {
  const inSection = heading.match(/v\s+úseku:?\s*([^|]+)/i);
  if (inSection) return inSection[1].trim();
  // info_vlak carries the section after the name on a sectioned train, across a newline
  const parts = infoVlak.split(/\s+-\s+/);
  return parts.length > 1 ? parts.slice(1).join(' - ').trim() : null;
};

/** `<operators> <category> <number>[ <name>]`, and where it carries `<op>:<cat>` pairs,
 *  our own operator's segment. */
function categoryFrom(infoVlak: string, zeme: string): string | null {
  const tokens = infoVlak.split(/\s+/);
  if (tokens.length < 2) return null;
  const cat = tokens[1];
  if (!cat.includes(':')) return cat;
  for (const pair of cat.split('/')) {
    const [op, c] = pair.split(':');
    if (op && c && op.toLowerCase() === zeme.toLowerCase()) return c;
  }
  return cat.split('/')[0]?.split(':')[1] ?? null;
}

const text = ($: cheerio.CheerioAPI, el: Element) =>
  $(el).text().replace(/\s+/g, ' ').trim();

export function parseCompositionPage(html: string, zeme: string): ParsedComposition {
  const $ = cheerio.load(html);
  const page = $.root().text();
  const plannedCount = Number(page.match(/Plánované\s+řazení\s*\((\d+)\)/)?.[1] ?? 0);
  const reportedCount = Number(page.match(/Skutečné\s+řazení\s*\((\d+)\)/)?.[1] ?? 0);

  const alts = readAltScripts(html);
  const windows: PlannedWindow[] = [];
  const days: ReportedDay[] = [];

  // h4 and the composition tables interleave in document order, so each block takes the
  // last heading before it. The info_vlak anchor is matched exactly, by record id.
  let heading = '';
  for (const el of $('h4, table.vlacek').toArray()) {
    if (el.name === 'h4') { heading = text($, el); continue; }

    const vehicles = vehiclesIn($, el, alts);
    if (!vehicles.length) continue;
    const recordId = ($(el).attr('id') ?? '').replace(/\D/g, '');
    const infoVlak = ($(`a.chyby[id_zaznamu="${recordId}"]`).first().attr('info_vlak') ?? '')
      .replace(/\s+/g, ' ').trim();
    const dates = datesIn(heading);

    if (/Plánované/.test(heading) || dates.length >= 2) {
      windows.push({
        label: dates.length >= 2 ? `${dates[0].raw} - ${dates[dates.length - 1].raw}`
          : heading.replace(/^Plánované řazení\s*/, '') || 'composition',
        section: sectionOf(heading, infoVlak),
        category: categoryFrom(infoVlak, zeme),
        record: infoVlak,
        from: dates[0]?.unix ?? null,
        to: dates[dates.length - 1]?.unix ?? null,
        vehicles,
      });
    } else {
      // "Skutečné řazení vlaku dne: út 9.6.2026 ve stanici: Székesfehérvár"
      const where = heading.match(/ve stanici:\s*(.+)$/)?.[1]?.trim() ?? '';
      days.push({
        label: dates[0]?.raw ?? heading,
        date: dates[0]?.unix ?? null,
        where: where ? `reported at ${where}` : '',
        record: infoVlak,
        vehicles,
      });
    }
  }

  days.sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
  return {
    windows,
    days,
    plannedCount: plannedCount || windows.length,
    reportedCount: reportedCount || days.length,
  };
}

/** A reported day is diffed against the window that contained THAT day, never today's.
 *  Diffing against the wrong baseline is worse than not diffing: a March day against the
 *  May plan reports three coaches missing that were never meant to be there. */
export function windowForDay(windows: PlannedWindow[], day: ReportedDay): PlannedWindow | null {
  if (day.date == null) return null;
  return windows.find((w) => w.from != null && w.to != null
    && day.date! >= w.from && day.date! <= w.to + 86399) ?? null;
}

/** Verify, do not trust: drop any block whose number or name is not ours. Insurance
 *  against a dropped `kategorie` or a loose name match (plan/vagonweb.md). A block with
 *  no info_vlak at all is kept, since the attribute is what would have disqualified it. */
export function isOurs(record: string, cislo: string, nameMatches: (a: string) => boolean) {
  if (!record) return true;
  const number = record.match(/\b\d+\b/)?.[0] ?? '';
  if (number && number !== cislo) return false;
  const after = record.slice(record.indexOf(number) + number.length).trim();
  return nameMatches(after);
}
