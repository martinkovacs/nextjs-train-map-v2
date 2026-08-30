'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './Sprite';
import { compositionSentence, diffComposition, type DiffEntry } from '@/lib/vw-diff';
import type { ParsedComposition, PlannedWindow, ReportedDay, Vehicle } from '@/lib/vw-parse';
import type { NormalisedTrip } from '@/lib/types';
import { yearInBudapest } from '@/lib/time';
import { categoryCode } from '@/lib/categories';

/** Carriage composition, design A: a strip, one tab per day.
 *
 *  Desktop: its own floating card at the bottom-left of the map, opening with the detail
 *  panel and closing with it, plus a close button of its own that dismisses the card
 *  WITHOUT deselecting the train. Mobile: a page of the panel, where the train runs down
 *  the screen and nothing scrolls sideways. */

/* ---- vagonweb pictogram filename -> our sprite icon. Matched by FILENAME, never by the
   Czech title, which is prose and will change. An unmapped filename is ignored silently:
   the list is known to be incomplete and a missing mark is a far smaller wrong than a
   broken icon. tr1/tr2/1sed/2sed are not here on purpose. ---------------------------- */
const AMENITY: Record<string, [string, string]> = {
  wifi: ['i-wifi', 'Free Wi-Fi'],
  usb: ['i-power', 'USB power'],
  '230V': ['i-plug', '230 V sockets'],
  klima: ['i-ac', 'Air conditioning'],
  wc: ['i-wc', 'Closed-system WC'],
  kolo: ['i-bike', 'Bicycle spaces'],
  inv_plos: ['i-wheelchair', 'Wheelchair lift'],
  jidel: ['i-dining', 'Restaurant'],
  info: ['i-service', 'On-board service'],
  kino: ['i-screen', 'On-board entertainment'],
  kocar: ['i-pram', 'Pram space'],
  kamera: ['i-camera', 'CCTV'],
};

const BAND_LABEL: Record<string, string> = {
  c1: 'First class', c2: 'Second class', club: 'Business',
  dine: 'Restaurant', none: 'Class not stated', sluz: 'Not for passengers',
};

const CX_SIDE = 112;    // the column the phone list keeps clear beside every vehicle
const SETTLE_MS = 600;  // let the selection settle before anything reaches vagonweb
const BUDGET = 10;      // fetches in a rolling minute before the card asks first

/** Per session, counting only requests that actually left; a cache hit is not a fetch. */
const fired: number[] = [];
const overBudget = () => {
  const t = Date.now();
  while (fired.length && t - fired[0] > 60_000) fired.shift();
  return fired.length >= BUDGET;
};

export type CompositionRecord = {
  zeme: string; kategorie: string | null; cislo: string; nazev: string; rok: string;
  /** set when the card was opened from a vagonweb search row, which has no live train */
  offMap?: boolean;
};

export const recordFor = (trip: NormalisedTrip): CompositionRecord => ({
  zeme: trip.agencyName.split(' ')[0],
  kategorie: null,      // filled by the server from the live category, see below
  cislo: trip.number,
  nazev: trip.name,
  rok: yearInBudapest(trip.serviceDay),
});

type State =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'ready'; data: ParsedComposition }
  | { phase: 'none' }
  | { phase: 'error'; detail: string; where: string };

export function Composition({ trip, record, active, variant, onClose }: {
  trip?: NormalisedTrip;
  record?: CompositionRecord;
  active: boolean;
  variant: 'card' | 'page';
  onClose?: () => void;
}) {
  const rec: CompositionRecord | null = record
    ?? (trip ? { ...recordFor(trip), kategorie: null } : null);
  const category = trip?.category ?? '';
  const [state, setState] = useState<State>({ phase: 'idle' });
  const [tab, setTab] = useState(0);
  const [asked, setAsked] = useState(false);
  const key = rec ? `${rec.zeme}|${rec.cislo}|${rec.rok}|${category}` : '';

  const load = useCallback(() => {
    if (!rec) return;
    setState({ phase: 'loading' });
    const q = new URLSearchParams({ zeme: rec.zeme, cislo: rec.cislo, rok: rec.rok });
    // kategorie travels as the LIVE category mapped server-side, and is simply omitted
    // when unmapped: vagonweb then picks its own default, which is the degrade path.
    const kategorie = rec.kategorie ?? categoryCode(category);
    if (kategorie) q.set('kategorie', kategorie);
    if (rec.nazev) q.set('nazev', rec.nazev);      // the checksum, never a request input
    fired.push(Date.now());
    fetch(`/api/composition?${q}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          console.error('[composition] failed', body);
          setState({ phase: 'error', detail: body.detail ?? `${res.status} ${res.statusText}`,
            where: body.where ?? 'vlak.php' });
          return;
        }
        if (!body.found) { setState({ phase: 'none' }); return; }
        setState({ phase: 'ready', data: body as ParsedComposition });
        setTab(0);
      })
      .catch((e) => setState({ phase: 'error', detail: String(e), where: 'vlak.php' }));
    // rec and category are the four inputs; the record cannot change without them
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!active || !key) return;
    // The card renders immediately; the request fires only if this train is still
    // selected 600 ms later, so a click burst along a line does not become a request
    // burst at a volunteer site.
    const t = setTimeout(() => {
      if (overBudget()) { setState({ phase: 'idle' }); setAsked(true); return; }
      load();
      // Opening from a vagonweb search row is a first swipe by another name: the row was
      // pressed deliberately, so there is no selection to let settle.
    }, rec?.offMap ? 0 : SETTLE_MS);
    return () => clearTimeout(t);
  }, [key, active, load, rec?.offMap]);

  if (!rec) return null;

  const url = 'https://www.vagonweb.cz/razeni/vlak.php?'
    + new URLSearchParams({ zeme: rec.zeme, cislo: rec.cislo, rok: rec.rok });

  const body = (
    <>
      <div className="vwCtx">
        <span className="rec">
          {[rec.zeme, rec.kategorie ?? categoryCode(category) ?? '', rec.cislo].filter(Boolean).join(' ')}
        </span>
        {rec.nazev && <span className="nm">{rec.nazev}</span>}
        <span className="yr">timetable {rec.rok}</span>
      </div>

      {rec.offMap && (
        <div className="vwOff">
          <Icon id="i-offline" size={15} />
          <span>Not on the map. Timetable record, no live position.</span>
        </div>
      )}

      {state.phase === 'error' && (
        <div className="warnbar" style={{ margin: 11 }}>
          <Icon id="i-warn" size={15} style={{ marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            Composition unavailable.
            <span className="err-tech" style={{ marginTop: 4 }}>
              {state.detail} · {state.where}
            </span>
            <span className="err-meta">Not the same as no composition on file</span>
          </div>
          {/* one-shot: vagonweb is never auto-retried */}
          <button className="err-btn" onClick={load}>
            <Icon id="i-refresh" size={13} />Retry
          </button>
        </div>
      )}

      {state.phase === 'none' && (
        <div className="cxState">
          <div className="t">No composition on file</div>
          <span className="err-tech">
            vagonweb has no {rec.rok} entry for<br />{rec.zeme} {rec.cislo}
          </span>
        </div>
      )}

      {asked && state.phase === 'idle' && (
        <div className="cxLoad">
          <button className="err-btn" onClick={() => { setAsked(false); load(); }}>
            <Icon id="i-refresh" size={13} />Load composition
          </button>
        </div>
      )}

      {state.phase === 'loading' && (
        <div className="vwSkel">
          <i className="l" />
          <i style={{ width: 104 }} /><i style={{ width: 112 }} /><i style={{ width: 98 }} />
        </div>
      )}

      {state.phase === 'ready' && (
        <Loaded data={state.data} trip={trip} variant={variant} tab={tab} setTab={setTab} />
      )}

      <div className="cxFoot">
        {state.phase === 'ready'
          ? <Footer data={state.data} url={url} />
          : <span>Fetching from vagonweb.cz</span>}
      </div>
    </>
  );

  if (variant === 'page') return <div className="cxCard">{body}</div>;

  return (
    <div className="cxDock">
      <div className="card cxCard">
        <div className="cxHead">
          <svg className="ic" width="26" height="18" viewBox="0 0 264 40"
               style={{ color: '#8d97a8' }} aria-hidden="true"><use href="#c-coach" /></svg>
          <span className="t">Composition</span>
          <span className="cxSrc">
            <a href={url} target="_blank" rel="noreferrer noopener">vagonweb.cz</a>
          </span>
          {onClose && (
            <button className="x" onClick={onClose} aria-label="Close the composition">
              <Icon id="i-close" size={15} />
            </button>
          )}
        </div>
        {body}
      </div>
    </div>
  );
}


/* ---- the loaded card ----------------------------------------------------- */

function Loaded({ data, trip, variant, tab, setTab }: {
  data: ParsedComposition; trip?: NormalisedTrip; variant: 'card' | 'page';
  tab: number; setTab: (n: number) => void;
}) {
  // Route sections: show only the section whose stretch overlaps the trip. A MÁV trip
  // never reaches München to Salzburg, so never draw it.
  const stops = new Set((trip?.stoptimes ?? []).map((s) => s.name.toLowerCase()));
  const windows = data.windows.filter((w) => {
    if (!w.section || !stops.size) return true;
    return w.section.split(/\s*-\s*/).some((end) => stops.has(end.trim().toLowerCase()));
  });
  // Show the window containing today when one is in force; when none is, the page has
  // rendered all of them and the first is the one to draw (SPEC 6.5).
  const [today] = useState(() => Math.floor(Date.now() / 1000));
  const planned = windows.find((w) => w.from != null && w.to != null
    && today >= w.from && today <= w.to + 86399) ?? windows[0] ?? null;
  const days = data.days;

  const sets = [
    { label: 'Planned', sub: planned?.label ?? '', vehicles: planned?.vehicles ?? [], day: null as ReportedDay | null },
    ...days.map((d) => ({ label: d.label, sub: '', vehicles: d.vehicles, day: d })),
  ];
  const set = sets[Math.min(tab, sets.length - 1)];

  // A reported day is diffed against the window that CONTAINED THAT DAY, never today's.
  const baseline = set.day ? windowForDay(windows, set.day) : null;
  const seq: DiffEntry[] = set.day
    ? (baseline
        ? diffComposition(baseline.vehicles, set.vehicles)
        : set.vehicles.map((v, i) => ({ v, mark: '' as const, slot: i })))
    : set.vehicles.map((v, i) => ({ v, mark: '' as const, slot: i }));

  return (
    <>
      {/* A planned window with no reported days renders the planned strip normally and
          simply has no day tabs. */}
      {sets.length > 1 && (
        <div className="cxTabs cxScroll">
          {sets.map((s, i) => (
            <button key={s.label + i} className={`cxTab${i === tab ? ' on' : ''}`}
                    onClick={() => setTab(i)}>
              {s.label}{s.sub && <small>{s.sub}</small>}
            </button>
          ))}
        </div>
      )}

      <div className="cxDelta">
        {set.day
          ? (baseline
              ? <span dangerouslySetInnerHTML={{
                  __html: compositionSentence(baseline.vehicles, set.vehicles) }} />
              : 'No plan on file for that date.')
          : `Planned composition, ${planned?.label ?? ''}`}
      </div>

      <div className="cxFront">front of train</div>
      {variant === 'card'
        ? <Strip seq={seq} />
        : <VerticalList seq={seq} />}
    </>
  );
}

function windowForDay(windows: PlannedWindow[], day: ReportedDay) {
  if (day.date == null) return null;
  return windows.find((w) => w.from != null && w.to != null
    && day.date! >= w.from && day.date! <= w.to + 86399) ?? null;
}

function Footer({ data, url }: { data: ParsedComposition; url: string }) {
  const [today] = useState(() => Math.floor(Date.now() / 1000));
  const planned = data.windows.find((w) => w.from != null && w.to != null
    && today >= w.from && today <= w.to + 86399) ?? data.windows[0];
  return (
    <>
      <span>
        Planned {planned?.label ?? 'composition'}
        {planned?.section ? ` (${planned.section})` : ''}
      </span>
      <span>
        {data.days.length
          ? `Last ${data.days.length} of ${data.reportedCount} reported days, `
            + `newest ${data.days[0].label}`
          : `No reported days on file for ${new Date().getFullYear()}.`}
      </span>
      <span>
        Drawings by <a href={url} target="_blank" rel="noreferrer noopener">vagonweb.cz</a>
      </span>
    </>
  );
}

/* ---- the vehicles -------------------------------------------------------- */

/** Scale is NOT a constant: each view divides its width by the longest vehicle it is
 *  about to draw and never exceeds its own maximum. A resize re-scales only and does not
 *  re-render, or it would throw away the reported day you were looking at. */
function useScale<T extends HTMLElement>(vehicles: Vehicle[], max: number, reserve = 0) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => {
      const widest = Math.max(...vehicles.map((v) => v.w || 264), 1);
      const room = Math.max(el.clientWidth - 26 - reserve, 120);
      el.style.setProperty('--sc', Math.min(max, room / widest).toFixed(3));
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, [vehicles, max, reserve]);
  return ref;
}

function Strip({ seq }: { seq: DiffEntry[] }) {
  const ref = useScale<HTMLDivElement>(seq.map((x) => x.v), 0.6);
  return (
    <div className="cxStrip cxScroll" ref={ref}>
      {seq.map((x, i) => <Tile key={i} v={x.v} mark={x.mark} />)}
    </div>
  );
}

function VerticalList({ seq }: { seq: DiffEntry[] }) {
  const ref = useScale<HTMLUListElement>(seq.map((x) => x.v), 1, CX_SIDE);
  return (
    <ul className="cxVlist" ref={ref}>
      {seq.map((x, i) => (
        <li key={i}>
          {/* the vertical list's reading of the class band: a segmented bar down the
              tile's left edge. A locomotive has no bands and so no bar. */}
          {!x.v.isLoco && x.v.bands.length > 0 && (
            <span className="cxVbar" role="img"
                  aria-label={x.v.bands.map((b) => BAND_LABEL[b]).join(' and ')}>
              {x.v.bands.map((b, j) => <i className={`b-${b}`} key={j} />)}
            </span>
          )}
          <div className={tileClass(x.v, x.mark)} style={tileStyle(x.v)}>
            <div className="cxTop">
              <div className="cxLeft">
                <div className="cxMark"><Drawing v={x.v} missing={x.mark === 'miss'} /></div>
                <div className="cxNo">
                  {x.v.no ? <b>{x.v.no}</b> : x.v.isLoco ? <b className="none">loco</b> : null}
                  {x.v.op && <span className="op">{x.v.op}</span>}
                  {!x.v.isLoco && <span className="ty">{x.v.type}</span>}
                  {x.v.ser && <span className="cxSer">{x.v.ser}</span>}
                </div>
              </div>
              <div className="cxSide">
                {x.mark === 'miss'
                  ? <div className="cxSer">did not run</div>
                  : <><Seats v={x.v} /><div className="cxAm"><Amenities v={x.v} /></div></>}
              </div>
            </div>
            {x.v.note && <div className="cxNote">{x.v.note}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

const tileClass = (v: Vehicle, mark: string) =>
  ['cxTile', v.isLoco ? 'loco' : v.bands[0] === 'c1' ? 'c1' : v.bands[0] === 'c2' ? 'c2' : 'c0',
    v.img || v.alt ? '' : 'noimg', mark === 'miss' ? 'miss' : mark]
    .filter(Boolean).join(' ');

const tileStyle = (v: Vehicle) => ({ ['--w' as string]: v.w } as React.CSSProperties);

function Tile({ v, mark }: { v: Vehicle; mark: string }) {
  return (
    <div className={tileClass(v, mark)} style={tileStyle(v)}>
      <div className="cxMark">
        {/* the class band, a plain element with an aria-label: 4 px of roof stripe is too
            small to aim at, so it is not a control and takes no focus */}
        <div className="cxBand" role="img"
             aria-label={v.isLoco ? 'Locomotive' : v.bands.map((b) => BAND_LABEL[b]).join(' and ')}>
          {v.bands.map((b, i) => <i className={`b-${b}`} key={i} />)}
        </div>
        <Drawing v={v} missing={mark === 'miss'} />
      </div>
      <div className="cxNo">
        {v.no ? <b>{v.no}</b> : v.isLoco ? <b className="none">loco</b> : null}
        {v.op && <span className="op">{v.op}</span>}
        <span className="ty">{v.type}</span>
      </div>
      <div className="cxSer">{mark === 'miss' ? 'did not run' : v.ser ?? ''}</div>
      <Seats v={v} />
      <div className="cxAm"><Amenities v={v} /></div>
      {v.note && <div className="cxNote">{v.note}</div>}
    </div>
  );
}

/** vagonweb's drawing when there is one, our silhouette when there is not. A missing
 *  drawing does not mean a missing class, and the silhouette keeps the vehicle's own box
 *  so a missing drawing does not change the length of the train. */
function Drawing({ v, missing }: { v: Vehicle; missing: boolean }) {
  const list = v.alt ?? [v];
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (list.length < 2) return;
    // vagonweb swaps the drawing every 1500 ms where a slot holds either of two machines
    const t = setInterval(() => setShown((n) => (n + 1) % list.length), 1500);
    return () => clearInterval(t);
  }, [list.length]);

  const current = list[Math.min(shown, list.length - 1)];
  return (
    <div className="cxPic">
      {current.img && !missing && (
        // proxied through our own origin, never hotlinked
        // eslint-disable-next-line @next/next/no-img-element
        <img className="av on" alt={`${current.op} ${current.type}`.trim()}
             src={`/api/vehicle-image?src=${encodeURIComponent(current.img)}`}
             width={current.w} height={current.h}
             onError={(e) => {
               (e.currentTarget.closest('.cxTile') as HTMLElement)?.classList.add('noimg');
             }} />
      )}
      <svg className="cxVeh" width={v.isLoco ? 190 : 264} height={v.isLoco ? 58 : 40}
           viewBox={v.isLoco ? '0 0 190 58' : '0 0 264 40'} role="img"
           aria-label={v.isLoco ? 'locomotive' : 'coach'}
           style={missing ? { display: 'block' } : undefined}>
        <use href={v.isLoco ? '#c-loco' : '#c-coach'} />
      </svg>
      {v.alt && (
        <>
          <div className="cxAltHd">
            {v.alt.length === 2 ? 'either of these two' : `one of these ${v.alt.length}`}
          </div>
          <div className="cxAlt">
            {v.alt.map((a, i) => (
              <div className={`a${i === shown ? ' on' : ''}`} key={i}>
                <i className="cdot" /><span className="op">{a.op}</span>
                <span className="ty">{a.type}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Seats({ v }: { v: Vehicle }) {
  if (!v.seats) return null;
  return (
    <div className="cxSeats">
      <Tip label={`${v.seats} seats`}>
        <Icon id="i-seat" size={15} /><span>{v.seats}</span>
      </Tip>
    </div>
  );
}

function Amenities({ v }: { v: Vehicle }) {
  return (
    <>
      {v.am.map((a, i) => {
        const hit = AMENITY[a.file];
        if (!hit) return null;      // unmapped: ignored silently, never an error
        return (
          <Tip key={i} label={hit[1] + (a.count ? ` (${a.count})` : '')}>
            <Icon id={hit[0]} size={15} />
            {a.count && <span className="n">{a.count}</span>}
          </Tip>
        );
      })}
    </>
  );
}

/** Every pictogram and the seat count carries its own label, which is what removes the
 *  legend. The class band is deliberately not one of them. */
function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <button className="p" type="button" aria-label={label}>
      {children}
      <span className="tip">{label}</span>
    </button>
  );
}
