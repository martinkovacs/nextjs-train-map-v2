'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useStore } from '@/lib/store';
import type { NormalisedTrip } from '@/lib/types';
import { delayColor } from '@/lib/delay';
import { fmtServiceDay, mss } from '@/lib/time';
import { setSearchCentre } from './Search';

/** The map and the marker layer. Leaflet directly, no react-leaflet: 300 to 400 markers
 *  are mutated in place every poll and animated by transforms we write ourselves, so the
 *  layer has to be imperative either way and the wrapper would earn nothing.
 *
 *  This component reads the store IMPERATIVELY through subscribe() and is never a
 *  subscriber, which is what keeps a poll from re-rendering 400 markers. */

const HUNGARY: L.LatLngBoundsExpression = [[45.7, 16.0], [48.7, 22.9]];
const GLIDE_MS = 450;
/** Picking a train zooms IN on it. The zoom is a floor rather than a target, so a fly
 *  never pulls the map back out from a closer view the user chose themselves. */
const SELECT_ZOOM = 12;
const FLY_MS = 800;
/** The panel covers the right 420 px on desktop, so a fly that will be followed by the
 *  panel opening aims 210 px right of the train and leaves it centred in what is left. */
const PANEL_SHIFT = 210;

type MarkerState = {
  marker: L.Marker;
  root: HTMLElement;
  mv: HTMLElement;
  rot: SVGGElement;
  angle: number;      // accumulated, so rotation goes the short way round
  lat: number; lon: number;
};

const markerHtml = () => `
  <div class="mv">
    <svg width="52" height="52" viewBox="0 0 52 52">
      <circle class="halo" cx="26" cy="26" r="13" fill="none" stroke="var(--now)" stroke-width="3"/>
      <g class="rot"><path class="hit" d="M26 5 L38.5 24.5 L13.5 24.5 Z" fill="var(--marker-ink)"/></g>
      <circle class="hit" cx="26" cy="26" r="7.6" fill="var(--delay)"/>
      <circle class="hit" cx="26" cy="26" r="8.4" fill="none" stroke="var(--marker-ink)" stroke-width="1.6"/>
      <circle class="hit" cx="26" cy="26" r="9.9" fill="none" stroke="var(--type)" stroke-width="1.4"/>
      <circle class="hit" cx="26" cy="26" r="11.3" fill="none" stroke="var(--marker-ink)" stroke-width="1.4"/>
    </svg>
  </div>`;

/** Rotate along the SHORTEST arc: a plain transition between 359deg and 3deg goes the long
 *  way, spinning the wedge backwards every time a train passes north. */
const shortestArc = (from: number, to: number) => {
  let d = (to - from) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return from + d;
};

export type MapHandle = {
  flyTo: (trip: NormalisedTrip, willOpenPanel?: boolean) => void;
  recentre: () => void;
};

export default function MapView({ onHover, onSelect, handleRef, cardRef, panelOpen,
                                  following, onPan }: {
  onHover: (trip: NormalisedTrip | null, point: { x: number; y: number } | null) => void;
  onSelect: (id: string, openPanel: boolean) => void;
  handleRef: React.RefObject<MapHandle | null>;
  /** The hover card's own element. The card opens through React, but from then on THIS
   *  component writes its position every frame: the card has to track a marker that is
   *  gliding and a map that is flying under it, and neither is a React event. */
  cardRef: React.RefObject<HTMLDivElement | null>;
  panelOpen: boolean;
  following: boolean;
  onPan: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef(new Map<string, MarkerState>());
  const lineRef = useRef<L.LayerGroup | null>(null);
  const dotsRef = useRef<L.LayerGroup | null>(null);
  const drawnFor = useRef<string | null>(null);
  const followingRef = useRef(following);
  const panelOpenRef = useRef(panelOpen);
  const onHoverRef = useRef(onHover);
  const hoverIdRef = useRef<string | null>(null);
  const rafRef = useRef(0);
  /** Wall-clock deadline of a fly started by a selection. Nothing else may pan the map
   *  until it passes, or the follow pan and the panel shift abort the fly halfway. */
  const flyingUntil = useRef(0);

  useEffect(() => { followingRef.current = following; }, [following]);
  useEffect(() => { panelOpenRef.current = panelOpen; }, [panelOpen]);
  useEffect(() => { onHoverRef.current = onHover; }, [onHover]);

  /* ---- the hover card, positioned from the marker's real screen box ------- */

  /** Read where the marker actually IS on screen, which is the inner .mv element: the
   *  root carries Leaflet's transform and .mv carries our glide, so only .mv's own box
   *  is where the wedge is being drawn this frame. */
  function markerPoint(id: string) {
    const state = markersRef.current.get(id);
    const host = hostRef.current;
    if (!state || !host) return null;
    const r = state.mv.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    return { x: r.left + r.width / 2 - h.left, y: r.top + r.height / 2 - h.top };
  }

  /** Open, move or close the card. Opening goes through React once, for the content;
   *  every frame after that is a style write on the card's own element, so a poll does
   *  not re-render 400 markers to move one card. */
  function trackHover() {
    rafRef.current = 0;
    const id = hoverIdRef.current;
    if (!id) return;
    const p = markerPoint(id);
    const el = cardRef.current;
    if (p && el) {
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
    }
    rafRef.current = requestAnimationFrame(trackHover);
  }

  function emitHover(id: string | null) {
    hoverIdRef.current = id;
    if (!id) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      onHoverRef.current(null, null);
      return;
    }
    const { byId, frozen } = useStore.getState();
    const trip = byId.get(id) ?? (frozen?.trip.id === id ? frozen.trip : null);
    const p = markerPoint(id);
    if (!trip || !p) { emitHover(null); return; }
    onHoverRef.current(trip, p);
    if (!rafRef.current) rafRef.current = requestAnimationFrame(trackHover);
  }

  /* ---- markers: mutate in place, never setIcon() ------------------------- */

  function syncMarkers(trains: NormalisedTrip[]) {
    const map = mapRef.current;
    if (!map) return;
    const markers = markersRef.current;
    const seen = new Set<string>();

    for (const trip of trains) {
      seen.add(trip.id);
      let state = markers.get(trip.id);

      if (!state) {
        const icon = L.divIcon({
          className: 'mk mk-root',
          html: markerHtml(),
          iconSize: [52, 52],
          iconAnchor: [26, 26],
        });
        const marker = L.marker([trip.lat, trip.lon], { icon, keyboard: false })
          .addTo(map);
        const root = marker.getElement() as HTMLElement;
        const mv = root.querySelector('.mv') as HTMLElement;
        const rot = root.querySelector('.rot') as unknown as SVGGElement;
        state = { marker, root, mv, rot, angle: trip.heading, lat: trip.lat, lon: trip.lon };
        markers.set(trip.id, state);
        attachPointer(state, trip.id);
        rot.style.transform = `rotate(${trip.heading}deg)`;
      } else {
        // Position: setLatLng once per poll to the TRUE position, then the inner .mv
        // carries the marker there visually over 450 ms. Two style writes, no per-frame
        // JavaScript, and .mv is our transform so it is sub-pixel where Leaflet's
        // _setPos rounds to whole pixels.
        if (state.lat !== trip.lat || state.lon !== trip.lon) {
          const from = map.latLngToLayerPoint([state.lat, state.lon]);
          const to = map.latLngToLayerPoint([trip.lat, trip.lon]);
          state.marker.setLatLng([trip.lat, trip.lon]);
          const dx = to.x - from.x, dy = to.y - from.y;
          const mv = state.mv;
          mv.classList.add('nofx');
          mv.style.transform = `translate3d(${-dx}px,${-dy}px,0)`;
          requestAnimationFrame(() => {
            mv.classList.remove('nofx');
            mv.style.transform = 'translate3d(0,0,0)';
          });
          state.lat = trip.lat; state.lon = trip.lon;
        }
        // Rotation is ours, on the inner .rot group Leaflet never touches.
        const next = shortestArc(state.angle, trip.heading);
        if (next !== state.angle) {
          state.angle = next;
          state.rot.style.transform = `rotate(${next}deg)`;
        }
      }

      // heading is ALWAYS honoured, including at speed === 0: a stationary train still
      // faces a direction. There is no stopped state and no stale state.
      state.root.style.setProperty('--delay', delayColor(trip.delay));
      state.root.style.setProperty('--type', trip.typeColor);
      state.root.classList.remove('gone');
      state.root.dataset.trip = trip.id;
      // glide timing lives in CSS; this only documents the value the spec fixes
      state.mv.style.transitionDuration = `${GLIDE_MS}ms`;
    }

    // A train that left the feed with its panel open keeps its last known position,
    // greyed; everything else is removed.
    const frozen = useStore.getState().frozen;
    for (const [id, state] of markers) {
      if (seen.has(id)) continue;
      if (frozen && frozen.trip.id === id) {
        state.root.classList.add('gone');
        continue;
      }
      state.marker.remove();
      markers.delete(id);
    }
    syncSelection();
  }

  function syncSelection() {
    const { selectedId } = useStore.getState();
    for (const [id, state] of markersRef.current) {
      state.root.classList.toggle('sel', id === selectedId);
    }
    drawRoute();
    followSelected();
  }

  function attachPointer(state: MarkerState, id: string) {
    const map = mapRef.current!;
    let openTimer: ReturnType<typeof setTimeout> | null = null;
    let closeTimer: ReturnType<typeof setTimeout> | null = null;
    const el = state.root;
    el.style.touchAction = 'none';

    el.addEventListener('mouseenter', () => {
      if (closeTimer) clearTimeout(closeTimer);
      openTimer = setTimeout(() => emitHover(id), 60);              // opens after 60 ms
    });
    el.addEventListener('mouseleave', () => {
      if (openTimer) clearTimeout(openTimer);
      closeTimer = setTimeout(() => emitHover(null), 120);          // 120 ms grace
    });
    let fromTouch = false;
    el.addEventListener('touchend', () => { fromTouch = true; }, { passive: true });
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      // Desktop click opens the panel. A mobile single tap opens the hover card and
      // selects the marker; the panel is the double tap, so the card anchors above the
      // dot, clear of the second tap.
      onSelect(id, !fromTouch);
      emitHover(id);
      fromTouch = false;
    });
    // Leaflet's doubleClickZoom is overridden ONLY when the gesture starts on a marker,
    // so double-tapping empty map still zooms normally.
    const suppress = () => { map.doubleClickZoom.disable(); };
    const restore = () => { setTimeout(() => map.doubleClickZoom.enable(), 400); };
    el.addEventListener('mousedown', suppress);
    el.addEventListener('touchstart', suppress, { passive: true });
    el.addEventListener('mouseup', restore);
    el.addEventListener('touchend', restore);
    el.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      onSelect(id, true);
    });
  }

  /* ---- the route line and the station dots (SPEC 3) ---------------------- */

  async function drawRoute() {
    const map = mapRef.current;
    const lines = lineRef.current;
    const dots = dotsRef.current;
    if (!map || !lines || !dots) return;

    const { selectedId, byId, frozen } = useStore.getState();
    const trip = selectedId ? byId.get(selectedId) ?? frozen?.trip ?? null : null;

    if (!trip) {
      lines.clearLayers(); dots.clearLayers();
      drawnFor.current = null;
      useStore.getState().clear('#11');
      return;
    }
    if (drawnFor.current === trip.id) return;
    drawnFor.current = trip.id;
    lines.clearLayers(); dots.clearLayers();
    useStore.getState().clear('#11');

    // A dot at every calling point. stopPosition gaps are stations the trip passes
    // through and correctly get no dot; a stop without coordinates gets none either.
    // Not interactive, matching the rule that timeline stops are not either.
    for (const s of trip.stoptimes) {
      if (s.lat == null || s.lon == null) continue;
      const style = s.progress === 'past'
        ? { radius: 3.5, fillColor: 'var(--past)', color: '#fff', weight: 2, fillOpacity: 1 }
        : s.progress === 'now'
          ? { radius: 4.5, fillColor: '#fff', color: 'var(--now)', weight: 2.5, fillOpacity: 1 }
          : { radius: 3.5, fillColor: '#fff', color: 'var(--future)', weight: 2, fillOpacity: 1 };
      L.circleMarker([s.lat, s.lon], { ...style, interactive: false }).addTo(dots);
    }

    // One fetch per published row, never by canonical id alone on a merged trip.
    const serviceDay = fmtServiceDay(trip.serviceDay);
    const drawn: [number, number][][] = [];
    const failed: string[] = [];

    for (const id of trip.geometryIds) {
      let line: [number, number][] = [];
      try {
        const res = await fetch(
          `/api/geometry/${encodeURIComponent(id)}?serviceDay=${serviceDay}`,
        );
        if (!res.ok) { failed.push(id); continue; }
        line = (await res.json()).line as [number, number][];
      } catch {
        failed.push(id);
        continue;
      }
      if (drawnFor.current !== trip.id) return;   // selection moved on
      if (!line.length) continue;

      // Portions share a trunk that a naive draw overlays N times. The shared points are
      // byte-identical pairs, so the divergence index is an array comparison: draw the
      // primary in full, then each subsequent portion from the MAX over the already-drawn
      // portions of its common-prefix length with each. The shape is a tree, not a trunk
      // with N branches. Legs never overlap, so this is a no-op for them.
      let cut = 0;
      for (const prev of drawn) {
        let i = 0;
        while (i < prev.length && i < line.length
               && prev[i][0] === line[i][0] && prev[i][1] === line[i][1]) i++;
        cut = Math.max(cut, i);
      }
      drawn.push(line);
      const piece = cut > 0 ? line.slice(Math.max(0, cut - 1)) : line;
      if (piece.length > 1) {
        L.polyline(piece, {
          color: trip.typeColor, weight: 4, opacity: .9, interactive: false,
        }).addTo(lines);
      }
    }

    if (failed.length) {
      // No line is drawn for the failed piece and none is substituted: a polyline through
      // the calling points cuts every curve. The dots stay, the amber bar is the answer.
      useStore.getState().raise({
        id: '#11', severity: 'warning', title: 'Route line unavailable',
        hop: null, attempt: 1, nextRetryAt: null, lastGoodAt: null, retry: true,
        detail: `geometry failed for ${failed.length} of ${trip.geometryIds.length}\n`
          + failed[0],
        meta: 'Everything below is still live',
      });
    }
  }

  function followSelected() {
    const map = mapRef.current;
    if (!map || !followingRef.current || !panelOpenRef.current) return;
    if (window.innerWidth <= 900) return;         // mobile never follows
    if (Date.now() < flyingUntil.current) return; // a selection fly owns the map
    const { selectedId, byId } = useStore.getState();
    const trip = selectedId ? byId.get(selectedId) : null;
    // the pan matches the marker glide, so the map and the marker agree
    if (trip) map.panTo([trip.lat, trip.lon], { animate: true, duration: GLIDE_MS / 1000 });
  }

  /* ---- the map itself, mounted after the handlers it wires up ----------- */

  useEffect(() => {
    if (!hostRef.current || mapRef.current) return;

    // Fixed view framing Hungary. No geolocation, no remembered last view, nothing in
    // localStorage (SPEC 9).
    // No zoom control: scroll, pinch and double-tap already zoom, and picking a train
    // zooms for you, so the two buttons were chrome over the map earning nothing.
    const map = L.map(hostRef.current, { zoomControl: false, attributionControl: true })
      .fitBounds(HUNGARY);
    mapRef.current = map;

    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);

    lineRef.current = L.layerGroup().addTo(map);
    dotsRef.current = L.layerGroup().addTo(map);

    // #12: basemap tiles unavailable. Ten or more tileerror events within 0:30, and the
    // toast says train data is unaffected.
    let tileErrors: number[] = [];
    tiles.on('tileerror', () => {
      const t = Date.now();
      tileErrors = tileErrors.filter((x) => t - x < 30_000);
      tileErrors.push(t);
      if (tileErrors.length >= 10) {
        useStore.getState().raise({
          id: '#12', severity: 'warning', title: 'Basemap unavailable',
          hop: null, attempt: 1, nextRetryAt: null, lastGoodAt: null,
          detail: `tile.openstreetmap.org\n${tileErrors.length} tile errors in 0:30`,
          meta: 'Train data is unaffected',
        });
      }
    });

    // A manual pan PAUSES following: a map that fights your drag is worse than one that
    // stops following.
    map.on('dragstart', () => { if (followingRef.current) onPan(); });

    // The search's tie-break and its empty-query list read the viewport centre. Panning
    // does not re-rank anything: the centre is simply whatever it was when the query
    // last changed (SPEC 4).
    const reportCentre = () => {
      const c = map.getCenter();
      setSearchCentre(c.lat, c.lng);
    };
    reportCentre();
    map.on('moveend', reportCentre);

    // A delta computed at the old zoom is meaningless at the new one.
    map.on('zoomstart', () => {
      for (const m of markersRef.current.values()) {
        m.mv.classList.add('nofx');
        m.mv.style.transform = 'translate3d(0,0,0)';
      }
    });

    // #11's Retry: the geometry is a one-shot fetch, so the control re-runs exactly it.
    const onRetryGeometry = () => { drawnFor.current = null; void drawRoute(); };
    window.addEventListener('retry-geometry', onRetryGeometry);

    const unsubscribe = useStore.subscribe((state, prev) => {
      if (state.trains !== prev.trains) syncMarkers(state.trains);
      if (state.selectedId !== prev.selectedId || state.trains !== prev.trains) {
        syncSelection();
      }
    });

    syncMarkers(useStore.getState().trains);

    handleRef.current = {
      // Picking a train zooms in on it. The target is offset by the panel when the panel
      // is about to open, so the fly lands where the train will be visible rather than
      // under the panel, and the panBy below stands down for the duration.
      flyTo: (trip, willOpenPanel = false) => {
        const zoom = Math.max(map.getZoom(), SELECT_ZOOM);
        let target = L.latLng(trip.lat, trip.lon);
        if (willOpenPanel && window.innerWidth > 900) {
          target = map.unproject(map.project(target, zoom).add([PANEL_SHIFT, 0]), zoom);
        }
        flyingUntil.current = Date.now() + FLY_MS;
        map.flyTo(target, zoom);
      },
      recentre: () => {
        const t = useStore.getState().selectedId;
        const trip = t ? useStore.getState().byId.get(t) : null;
        if (trip) map.panTo([trip.lat, trip.lon]);
      },
    };

    const markers = markersRef.current;
    return () => {
      unsubscribe();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('retry-geometry', onRetryGeometry);
      map.remove();
      mapRef.current = null;
      markers.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // The map pans left when the panel opens so the train stays visible, and back when it
  // closes. Desktop only: on mobile the panel is the whole screen.
  const wasOpen = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || wasOpen.current === panelOpen) return;
    wasOpen.current = panelOpen;
    if (window.innerWidth <= 900) return;
    // A selection fly already aimed at the shifted centre, so shifting again here would
    // both double the offset and abort the fly.
    if (Date.now() < flyingUntil.current) return;
    map.panBy([panelOpen ? PANEL_SHIFT : -PANEL_SHIFT, 0], { animate: true });
  }, [panelOpen]);

  return <div className="mapwrap" ref={hostRef} aria-label="Live train map" />;
}

/** Exported only so the panel's "last seen" line can use the same wording. */
export const lastSeen = (seconds: number) => `${mss(seconds)} ago`;
