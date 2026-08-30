'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon, Sprite } from './Sprite';
import { Search } from './Search';
import { HoverCard } from './HoverCard';
import { DetailPanel } from './DetailPanel';
import { Composition, type CompositionRecord } from './Composition';
import { Toasts } from './Toasts';
import { startPolling } from '@/lib/poll';
import { useStore } from '@/lib/store';
import type { NormalisedTrip } from '@/lib/types';
import type { MapHandle } from './MapView';

/** Leaflet touches `window` at import, so the map is loaded client-side only. */
const MapView = dynamic(() => import('./MapView'), {
  ssr: false,
  loading: () => <div className="mapwrap" />,
});

export function App() {
  const trains = useStore((s) => s.trains);
  const byId = useStore((s) => s.byId);
  const selectedId = useStore((s) => s.selectedId);
  const frozen = useStore((s) => s.frozen);
  const select = useStore((s) => s.select);
  const raise = useStore((s) => s.raise);
  const clear = useStore((s) => s.clear);

  const mapRef = useRef<MapHandle | null>(null);
  const [hover, setHover] = useState<{ trip: NormalisedTrip; point: { x: number; y: number } } | null>(null);
  const [followPaused, setFollowPaused] = useState(false);
  const [cardOpen, setCardOpen] = useState(true);
  const [record, setRecord] = useState<CompositionRecord | null>(null);
  const [panelWanted, setPanelWanted] = useState(true);
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const check = () => setNarrow(window.innerWidth <= 900);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  const wanted = useRef<string | null>(null);      // the ?train= number, until it resolves

  useEffect(() => startPolling(), []);

  const trip = selectedId ? byId.get(selectedId) ?? frozen?.trip ?? null : null;

  /* ---- URL and selection state (SPEC 8) --------------------------------- */

  // On load, keep the number until the feed can answer it.
  useEffect(() => {
    const n = new URLSearchParams(window.location.search).get('train');
    if (n) wanted.current = n;
  }, []);

  /** Resolution is a lookup against the NORMALISED list, never against raw rows, which is
   *  what makes it work: after the merge and the collision rules, train numbers are
   *  unique across every retained trip. A portioned train's other numbers resolve to the
   *  same train rather than 404. */
  const resolve = useCallback((number: string): NormalisedTrip | null => {
    const hits = trains.filter(
      (t) => t.number === number || t.otherNumbers.includes(number),
    );
    if (hits.length <= 1) return hits[0] ?? null;
    console.warn(`[url] train ${number} matches ${hits.length} retained trips`);
    const now = Math.floor(Date.now() / 1000);
    const running = hits.filter((t) => {
      const first = t.stoptimes[0]?.scheduledDeparture ?? 0;
      const last = t.stoptimes[t.stoptimes.length - 1]?.scheduledArrival ?? 0;
      return first <= now && now <= last;
    });
    if (running.length) return running[0];
    return [...hits].sort((a, b) =>
      (a.stoptimes[0]?.scheduledDeparture ?? 0) - (b.stoptimes[0]?.scheduledDeparture ?? 0)
      || a.id.localeCompare(b.id))[0];
  }, [trains]);

  useEffect(() => {
    if (!wanted.current || !trains.length) return;
    const hit = resolve(wanted.current);
    if (hit) {
      // fly to the train and open the panel, exactly as pressing a search result does
      clear('#17');
      wanted.current = null;
      setPanelWanted(true);
      select(hit.id);
      mapRef.current?.flyTo(hit);
    } else if (!useStore.getState().conditions['#17']) {
      // The one toast that is not a live condition, so it is also the one that can be
      // cleared. The parameter stays in the URL, so the link still explains itself.
      raise({
        id: '#17', severity: 'info', title: `Train ${wanted.current} is not on the map`,
        hop: null, attempt: 1, nextRetryAt: null, lastGoodAt: null, icon: 'i-clock',
        detail: 'It may have finished, or it may not be\nrunning today.',
        meta: 'From the ?train= link',
      });
    }
  }, [trains, resolve, select, raise, clear]);

  // replaceState only, never pushState: Back leaves the app rather than becoming an undo
  // stack for marker clicks. An unresolved ?train= is KEPT, so the URL still explains
  // itself while #17 is up.
  useEffect(() => {
    if (trip) { window.history.replaceState(null, '', `/?train=${trip.number}`); return; }
    if (wanted.current) return;
    window.history.replaceState(null, '', '/');
  }, [trip]);

  const pick = useCallback((t: NormalisedTrip) => {
    clear('#17');
    setPanelWanted(true);
    setRecord(null);
    setCardOpen(true);
    setFollowPaused(false);
    select(t.id);
    mapRef.current?.flyTo(t);
  }, [clear, select]);

  const close = useCallback(() => {
    select(null);
    setHover(null);
    setRecord(null);
  }, [select]);

  const onMapSelect = useCallback((id: string, openPanel: boolean) => {
    clear('#17');
    setRecord(null);
    setCardOpen(true);
    setFollowPaused(false);
    setPanelWanted(openPanel);
    select(id);
  }, [clear, select]);

  const panelOpen = !!trip && panelWanted;
  // Only the composition card and the toast can collide, on a narrow desktop window: the
  // toast shifts right of the card. Neither ever moves the other.
  const compositionShown = (panelOpen && cardOpen) || !!record;

  return (
    <>
      <Sprite />
      <MapView
        onHover={(t, point) => setHover(t && point ? { trip: t, point } : null)}
        onSelect={onMapSelect}
        handleRef={mapRef}
        panelOpen={panelOpen}
        following={!followPaused}
        onPan={() => setFollowPaused(true)}
      />

      <Search onPick={pick} onOpenRecord={(r) => { setRecord(r); clear('#17'); }} />

      {hover && <HoverCard trip={hover.trip} point={hover.point} />}

      {trip && panelWanted && (
        <DetailPanel trip={trip} onClose={close} followPaused={followPaused}
                     onRecentre={() => { setFollowPaused(false); mapRef.current?.recentre(); }} />
      )}

      {/* Desktop: the composition card opens with the panel and closes with it, and its
          own close button dismisses it WITHOUT deselecting the train. A vagonweb search
          row opens the same card with no train selected. */}
      {/* Mobile: a vagonweb row opens the panel DIRECTLY on its composition page. No
          route page behind it, so no pager dots, and the back control returns to the
          search results. */}
      {record && narrow && (
        <aside className="panel card" aria-label="Composition">
          <div className="cxSheetHd">
            <button className="cxBack" onClick={() => setRecord(null)}
                    aria-label="Back to the search results">
              <Icon id="i-back" size={19} />
            </button>
            <div><span className="ttl">Composition
              <span className="sub">{[record.zeme, record.kategorie, record.cislo,
                record.nazev].filter(Boolean).join(' ')}</span></span></div>
          </div>
          <div className="p-body" style={{ padding: 0 }}>
            <Composition record={record} active variant="page" />
          </div>
        </aside>
      )}

      {record && !narrow
        ? <Composition record={record} active variant="card" onClose={() => setRecord(null)} />
        : (trip && panelWanted && cardOpen && !narrow
            ? <Composition trip={trip} active variant="card" onClose={() => setCardOpen(false)} />
            : null)}

      <Toasts shifted={compositionShown} />
    </>
  );
}
