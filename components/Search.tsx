'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Sprite';
import { RouteBadge } from './Badge';
import { Delay } from './Delay';
import { fold } from '@/lib/fold';
import { yearInBudapest } from '@/lib/time';
import { useStore, type Source } from '@/lib/store';
import type { NormalisedTrip } from '@/lib/types';
import type { SearchRow } from '@/lib/vagonweb';
import type { CompositionRecord } from './Composition';

/** Search, design B: docked, with the source toggle. One surface, so the input, the pills
 *  and the list cannot disagree about their edges. It rests on Both.
 *
 *  At rest it is one 42 px input and nothing else. Focus opens the pills and the results
 *  together; the clear control closes both and empties the field, which is the only way
 *  back to rest.
 *
 *  The index is rebuilt each poll from the NORMALISED fields and never from raw upstream
 *  rows. `headsign` and `routeLongName` are indexed but never rendered: the field the UI
 *  shows is `destination`. */

const DEBOUNCE_MS = 400;
const VW_CAP = 6;

type Hit = { trip: NormalisedTrip; score: number; hay: string };

const indexOf = (t: NormalisedTrip) =>
  fold([t.number, t.name, t.category, t.headsign, t.routeLongName].filter(Boolean).join(' '));

export function Search({ onPick, onOpenRecord }: {
  onPick: (trip: NormalisedTrip) => void;
  onOpenRecord: (rec: CompositionRecord) => void;
}) {
  const trains = useStore((s) => s.trains);
  const source = useStore((s) => s.source);
  const setSource = useStore((s) => s.setSource);
  const [query, setQuery] = useState('');
  // The field is a plain input until it is clicked into. Focus is what opens the
  // results and the source pills; the clear control closes both again.
  const [focused, setFocused] = useState(false);
  // The highlighted row is keyed by the query it belongs to, so a new query starts at
  // the first row without an effect resetting it a render later.
  const [activeRow, setActiveRow] = useState({ q: '', i: 0 });
  const [vwRows, setVwRows] = useState<SearchRow[]>([]);
  const [vwError, setVwError] = useState<string | null>(null);
  const [vwLoading, setVwLoading] = useState(false);
  const [vwAttempt, setVwAttempt] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cache = useRef(new Map<string, SearchRow[]>());
  const abort = useRef<AbortController | null>(null);

  // Rebuilt each poll, from normalised fields only.
  const index = useMemo(() => trains.map((t) => ({ trip: t, hay: indexOf(t) })), [trains]);

  /** Results are computed WHEN THE QUERY CHANGES, and only then. Panning does not
   *  re-rank, so a row cannot move out from under the pointer; a poll refreshes the delay
   *  and destination in rows already on screen but never reorders them. */
  const rank = useCallback((q: string) => {
    const folded = fold(q.trim());
    if (!folded) {
      // empty query: the 5 nearest trains to the viewport centre, and no vagonweb request
      const c = centre();
      return [...trains]
        .sort((a, b) => distance(a, c) - distance(b, c))
        .slice(0, 5);
    }
    const c = centre();
    const hits: Hit[] = [];
    for (const { trip, hay } of index) {
      const number = fold(trip.number);
      const name = fold(trip.name);
      let score = 0;
      if (number === folded) score = 100;
      else if (number.startsWith(folded)) score = 80;
      else if (new RegExp(`(^|\\s)${escape(folded)}`).test(name)) score = 60;
      else {
        const at = hay.indexOf(folded);
        if (at >= 0) score = 30 - at * 0.1;
      }
      if (score > 0) hits.push({ trip, score, hay });
    }
    return hits
      .sort((a, b) => b.score - a.score || distance(a.trip, c) - distance(b.trip, c))
      .slice(0, 25)
      .map((h) => h.trip);
  }, [index, trains]);

  // Computed WHEN THE QUERY CHANGES and only then: rank() closes over the current index,
  // but re-ranking on a poll is exactly what must not happen, so the memo keys on the
  // query alone. A poll refreshes the delay and destination in a row already on screen
  // without reordering it, because the trips in this list are the store's own objects.
  const live = useMemo(() => {
    // #17 is the one toast that reports something already over, so a search clears it
    if (query.trim()) useStore.getState().clear('#17');
    return rank(query);
    // `rank` is deliberately NOT a dependency: it closes over the index, which is rebuilt
    // every poll, and re-ranking on a poll is exactly what must not happen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const active = activeRow.q === query ? activeRow.i : 0;
  const setActive = (next: number | ((i: number) => number)) =>
    setActiveRow((cur) => ({
      q: query,
      i: typeof next === 'function' ? next(cur.q === query ? cur.i : 0) : next,
    }));

  // the vagonweb group: debounced, minimum two characters, one request in flight with the
  // previous aborted, answers cached for the session under the FOLDED query while the
  // request itself carries the query as typed
  useEffect(() => {
    const q = query.trim();
    const key = fold(q);
    const nothingToAsk = source === 'current' || q.length < 2;

    const t = setTimeout(() => {
      if (nothingToAsk) { setVwRows([]); setVwError(null); return; }
      const hit = cache.current.get(key);
      if (hit) { setVwRows(hit); setVwError(null); return; }
      abort.current?.abort();
      abort.current = new AbortController();
      setVwLoading(true);
      // year from the selected trip's serviceDay when there is one, today otherwise
      const year = vwYear();
      const q2 = q;
      fetch(`/api/vw-search?jmeno=${encodeURIComponent(q2)}&rok=${year}`,
            { signal: abort.current.signal })
        .then(async (res) => {
          const body = await res.json().catch(() => ({}));
          if (!res.ok) {
            console.error('[vw-search] failed', body);
            setVwError(`${body.detail ?? res.status} · ${body.where ?? 'razeni.php'}`);
            setVwRows([]);
            return;
          }
          cache.current.set(key, body.rows);
          setVwRows(body.rows);
          setVwError(null);
        })
        .catch((e) => { if ((e as Error).name !== 'AbortError') setVwError(String(e)); })
        .finally(() => setVwLoading(false));
    }, nothingToAsk ? 0 : DEBOUNCE_MS);
    return () => clearTimeout(t);
    // vwAttempt is the Retry control: neither vagonweb call ever auto-retries, so the
    // only thing that fires a second request is the user pressing it.
  }, [query, source, vwAttempt]);

  const showLive = source !== 'vagonweb';
  const showVw = source !== 'current';
  const vwShown = vwRows.slice(0, VW_CAP);
  const options = [
    ...(showLive ? live.map((t) => ({ kind: 'live' as const, trip: t })) : []),
    ...(showVw ? vwShown.map((r) => ({ kind: 'vw' as const, row: r })) : []),
  ];

  const choose = (i: number) => {
    const o = options[i];
    if (!o) return;
    if (o.kind === 'live') onPick(o.trip);
    else {
      // A vagonweb row opens the COMPOSITION, with no train selected: it does not move
      // the map, select a marker or open the route, because there may be no train to
      // select. Built from the row's own four inputs, so it cannot land on the wrong
      // record, with the row's nazev, which is vagonweb's own spelling, as the checksum.
      onOpenRecord({
        zeme: o.row.zeme, kategorie: o.row.kategorie, cislo: o.row.cislo,
        nazev: o.row.nazev, rok: o.row.rok, offMap: true,
      });
    }
    inputRef.current?.blur();
    setFocused(false);
  };

  /** The clear control: empties the field AND closes it, so the pills and the results go
   *  with it. Blurring alone would leave the text behind. */
  const close = () => {
    setQuery('');
    setFocused(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % Math.max(options.length, 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + options.length) % Math.max(options.length, 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(Math.max(options.length - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
    else if (e.key === 'Escape') { close(); }
  };

  useEffect(() => {
    const el = listRef.current?.querySelector('[aria-selected="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, options.length]);

  const empty = !options.length && query.trim().length > 0 && !vwLoading;
  const open = focused;

  return (
    <div className="sfield">
      <div className="card scard">
        <div className="srow">
          <Icon id="i-search" style={{ color: '#7a8496' }} />
          <input
            ref={inputRef}
            className="sinput"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Train number, name or destination"
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            role="combobox"
            aria-expanded={open && options.length > 0}
            aria-controls="search-list"
            aria-activedescendant={options.length ? `opt-${active}` : undefined}
            aria-autocomplete="list"
            autoComplete="off"
            enterKeyHint="search"
          />
          {(query || focused) && (
            // mousedown is swallowed so the blur it would cause cannot unmount this
            // button before its own click lands
            <button className="x sclear" aria-label="Clear the search"
                    onMouseDown={(e) => e.preventDefault()} onClick={close}>
              <Icon id="i-close" size={17} />
            </button>
          )}
        </div>

        {open && (
          <div className="spills">
            {(['both', 'current', 'vagonweb'] as Source[]).map((s) => (
              <button key={s} className={`fchip${source === s ? ' on' : ''}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setSource(s)}>
                {s === 'both' ? 'Both' : s === 'current' ? 'Map' : 'Vagonweb'}
              </button>
            ))}
          </div>
        )}

        <div className="spop" hidden={!open}>
          <ul className="slist" id="search-list" role="listbox" ref={listRef}>
            {showLive && source === 'both' && live.length > 0 && (
              <li className="sgrp" role="presentation">On the map now</li>
            )}
            {showLive && live.map((t, i) => (
              <LiveRow key={t.id} trip={t} query={query} index={i}
                       selected={active === i}
                       onSelect={() => { setActive(i); choose(i); }} />
            ))}

            {showVw && source === 'both' && vwShown.length > 0 && (
              <>
                {live.length === 0 && query.trim() && (
                  <li className="snote" role="presentation">
                    Not on the map. These are timetable records, and they open a composition.
                  </li>
                )}
                <li className="sgrp" role="presentation">
                  vagonweb.cz<span className="c">{vwYear()} timetable</span>
                </li>
              </>
            )}
            {showVw && vwError && (
              <li className="snote" role="presentation">
                <span style={{ color: 'var(--amber)' }}>vagonweb search failed. {vwError}.</span>{' '}
                <button className="err-btn" style={{ marginLeft: 6 }}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          cache.current.delete(fold(query.trim()));
                          setVwAttempt((n) => n + 1);
                        }}>
                  <Icon id="i-refresh" size={13} />Retry
                </button>
              </li>
            )}
            {showVw && vwShown.map((r, j) => {
              const i = (showLive ? live.length : 0) + j;
              return (
                <VwRow key={`${r.zeme}-${r.kategorie}-${r.cislo}-${j}`} row={r} query={query}
                       index={i} selected={active === i}
                       onSelect={() => { setActive(i); choose(i); }} />
              );
            })}
            {showVw && vwRows.length > VW_CAP && (
              <li className="snote" role="presentation">
                {vwRows.length - VW_CAP} more on vagonweb.
              </li>
            )}

            {empty && (
              <li className="sempty" role="presentation">
                {source === 'current'
                  ? 'Only trains on the map are searchable. Switch to Vagonweb for the timetable.'
                  : source === 'vagonweb'
                    ? `No MÁV, GySEV, ÖBB or RegioJet train matches that in the ${vwYear()} `
                      + 'timetable. Switch to Map for trains on the map.'
                    : 'Not on the map, and vagonweb has no MÁV, GySEV, ÖBB or RegioJet train '
                      + 'with that number either.'}
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

function LiveRow({ trip, query, index, selected, onSelect }: {
  trip: NormalisedTrip; query: string; index: number; selected: boolean; onSelect: () => void;
}) {
  return (
    <li className="sitem" id={`opt-${index}`} role="option" aria-selected={selected}
        onMouseDown={(e) => { e.preventDefault(); onSelect(); }}>
      <RouteBadge fontCode={trip.fontCode} typeColor={trip.typeColor} size={18} />
      <span className="nm">
        <Mark text={[trip.number, trip.name].filter(Boolean).join(' ')} query={query} />
      </span>
      <span className="to">
        <Icon id="i-arrow" size={14} />
        <span>{trip.destination}</span>
      </span>
      <Delay seconds={trip.delay} className="sdelay" />
    </li>
  );
}

/** A vagonweb row: category badge OUTLINED rather than filled so it cannot be mistaken
 *  for a live row, operator, number and name, both ends of the route, and a coach mark
 *  where a live row carries its delay. No delay column and no space held for one. */
function VwRow({ row, query, index, selected, onSelect }: {
  row: SearchRow; query: string; index: number; selected: boolean; onSelect: () => void;
}) {
  return (
    <li className="sitem vw" id={`opt-${index}`} role="option" aria-selected={selected}
        onMouseDown={(e) => { e.preventDefault(); onSelect(); }}>
      <span className="badge">{row.kategorie ?? ''}</span>
      <span className="op">{row.zeme}</span>
      <span className="nm">
        <Mark text={[row.cislo, row.nazev].filter(Boolean).join(' ')} query={query} />
      </span>
      <span className="to">
        <span>{ends(row.route)[0]}</span>
        <Icon id="i-arrow" size={14} />
        <span>{ends(row.route)[1]}</span>
      </span>
      <svg className="ic go" width="22" height="15" viewBox="0 0 264 40" aria-hidden="true">
        <use href="#c-coach" />
      </svg>
    </li>
  );
}

/** fold() is length-preserving, which is exactly what lets the highlighter use its
 *  offsets against the original string. */
function Mark({ text, query }: { text: string; query: string }) {
  const q = fold(query.trim());
  if (!q) return <>{text}</>;
  const at = fold(text).indexOf(q);
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  );
}

/** The vagonweb year: the selected trip's own service day when there is one, today
 *  otherwise. A trip that departed on 31 December belongs to the old timetable year. */
function vwYear() {
  const s = useStore.getState();
  const trip = s.selectedId ? s.byId.get(s.selectedId) : null;
  return trip ? Number(yearInBudapest(trip.serviceDay)) : new Date().getFullYear();
}

/** vagonweb prints the whole stop list with times and elides the middle itself on a long
 *  route. A result row only needs both ends. */
const ends = (route: string): [string, string] => {
  const stops = route.split(',').map((s) => s.replace(/\s*\d{1,2}:\d{2}.*$/, '').trim())
    .filter(Boolean);
  return [stops[0] ?? '', stops.length > 1 ? stops[stops.length - 1] : ''];
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The centre used for the tie-break and the empty-query list is whatever the map centre
 *  was when the query last changed. */
let mapCentre: [number, number] = [47.2, 19.4];
export const setSearchCentre = (lat: number, lon: number) => { mapCentre = [lat, lon]; };
const centre = () => mapCentre;
const distance = (t: NormalisedTrip, c: [number, number]) =>
  (t.lat - c[0]) ** 2 + ((t.lon - c[1]) * 0.68) ** 2;
