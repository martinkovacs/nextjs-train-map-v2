'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from './Sprite';
import { InfoPictogram, RouteBadge } from './Badge';
import { Delay } from './Delay';
import { Composition } from './Composition';
import { delayColor } from '@/lib/delay';
import { fmtTime, kmh, mss } from '@/lib/time';
import type { NormalisedStop, NormalisedTrip, TimelineRow } from '@/lib/types';
import { useStore, type GoneReason } from '@/lib/store';

/** Detail panel, design C: table rows. 420 px desktop, right-docked, full height.
 *  No tabs over the trip's own data: nothing the feed says about this train is a click
 *  away. Timeline stops are not interactive. */

const STALE_AFTER = 180;   // #8b, 3:00. Not 60 s: worst-case data age is ~60 s already.

export function DetailPanel({ trip, onClose, onRecentre, followPaused }: {
  trip: NormalisedTrip;
  onClose: () => void;
  onRecentre: () => void;
  followPaused: boolean;
}) {
  const frozen = useStore((s) => s.frozen);
  const conditions = useStore((s) => s.conditions);
  const fetchedAt = useStore((s) => s.meta?.fetchedAt ?? 0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [page, setPage] = useState<'route' | 'composition'>('route');
  const touchX = useRef(0);

  // On open, scroll to the current stop and keep it pinned until the user scrolls. An
  // arrived train has no current stop, so it opens scrolled to the terminus.
  useEffect(() => {
    pinned.current = true;
    const body = bodyRef.current;
    if (!body) return;
    const target = body.querySelector('[data-now]') ?? body.querySelector('li:last-child');
    if (target && pinned.current) {
      (target as HTMLElement).scrollIntoView({ block: 'center' });
    }
  }, [trip.id]);

  const isStale = !trip.isEstimated && trip.lastUpdated > 0
    && fetchedAt - trip.lastUpdated > STALE_AFTER;

  return (
    <aside className="panel card" aria-label="Train detail">
      <div className="p-hd" style={{ ['--type' as string]: trip.typeColor } as React.CSSProperties}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          {page === 'composition' ? (
            <button className="cxBack" onClick={() => setPage('route')} aria-label="Back to the route">
              <Icon id="i-back" size={19} />
            </button>
          ) : (
            <RouteBadge fontCode={trip.fontCode} typeColor={trip.typeColor} />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="p-title">
              {[trip.number, trip.name, trip.category].filter(Boolean).join(' ')}
            </div>
            <div className="icrow p-sub">
              {trip.origin}
              <Icon id="i-arrow" size={15} />
              {trip.destination}
            </div>
            {/* a portioned train names every destination and lists the other numbers,
                since any of them identifies the same physical train */}
            {trip.otherNumbers.length > 0 && (
              <div className="p-sub">
                Runs as {[trip.number, ...trip.otherNumbers].join(', ')}
              </div>
            )}
            {trip.delayMeasuredAt && trip.delay != null && (
              <div className="p-sub">
                {trip.delay >= 0 ? '+' : '−'}{Math.abs(Math.round(trip.delay / 60))} min at{' '}
                {trip.delayMeasuredAt}
              </div>
            )}
          </div>
          {followPaused && (
            <button className="x" onClick={onRecentre} aria-label="Re-centre on the train">
              <Icon id="i-locate" />
            </button>
          )}
          <button className="x x-lg" onClick={onClose} aria-label="Close">
            <Icon id="i-close" />
          </button>
        </div>
        {/* two pages on mobile: the route, and the composition one swipe across */}
        <div className="cxPager only-narrow" style={{ marginTop: 8 }} aria-hidden="true">
          <i className={page === 'route' ? 'on' : ''} />
          <i className={page === 'composition' ? 'on' : ''} />
        </div>
      </div>

      <div className="p-body" ref={bodyRef} onScroll={() => { pinned.current = false; }}
           onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
           onTouchEnd={(e) => {
             // the composition is one swipe across from the route, and back again
             const dx = e.changedTouches[0].clientX - touchX.current;
             if (dx < -60) setPage('composition');
             else if (dx > 60) setPage('route');
           }}>
        {page === 'composition' ? (
          <Composition trip={trip} active variant="page" />
        ) : (
          <>
            <InlineBars trip={trip} frozenReason={frozen?.trip.id === trip.id ? frozen.reason : null}
                        frozenAt={frozen?.at ?? null} stale={isStale} fetchedAt={fetchedAt}
                        geometryFailed={!!conditions['#11']} />

            {trip.alerts.map((a, i) => (
              <div className="alert" key={i}>
                <Icon id="i-warn" size={16} style={{ marginTop: 1 }} />
                <div>{a.description}</div>
              </div>
            ))}

            <InfoServices trip={trip} />

            <div className="sec-h">Route</div>
            {trip.stoptimes.length === 0 ? (
              <div style={{ color: 'var(--w-ink-2)', fontSize: 13.5 }}>
                No stop information for this train.
              </div>
            ) : (
              <>
                <div className="tl3-hdr"><span>STOP</span><span>ARR</span><span>DEP</span></div>
                <Timeline trip={trip} />
              </>
            )}

            {/* the composition is a swipe on a phone; on desktop it is already on
                screen as its own card beside the panel */}
            <button className="err-btn only-narrow" style={{ marginTop: 14 }}
                    onClick={() => setPage('composition')}>
              <Icon id="i-arrow" size={14} />Carriage composition
            </button>
          </>
        )}
      </div>
    </aside>
  );
}

/* ---- info services (7.3) ------------------------------------------------- */

/** Some trains file twenty-one of these, each a full sentence, which pushed the route
 *  itself off the bottom of the panel. normalise() has already sorted the four filings
 *  that answer "can I get on this train" to the top, so the panel shows the first
 *  INFO_SHOWN and puts the rest behind one control. Collapsed again whenever the panel
 *  changes train, since the count is a property of the train. */
const INFO_SHOWN = 4;

function InfoServices({ trip }: { trip: NormalisedTrip }) {
  // Keyed by the train it was expanded for, so switching train collapses it again
  // without an effect resetting the flag a render later.
  const [expandedFor, setExpandedFor] = useState('');
  const all = expandedFor === trip.id;

  const hidden = trip.infoServices.length - INFO_SHOWN;
  const shown = all ? trip.infoServices : trip.infoServices.slice(0, INFO_SHOWN);

  return (
    <>
      {shown.map((s, i) => (
        <div className="info" key={`${s.name}-${s.fontCode}-${i}`}>
          <InfoPictogram fontCode={s.fontCode} />
          <div>
            {s.name}
            {/* the sub-line is hidden when a single range spans the whole trip */}
            {!(s.ranges.length === 1
               && s.ranges[0].from === trip.origin
               && s.ranges[0].till === trip.destination)
              && s.ranges.map((r, j) => (
                <span className="rng" key={j}>{r.from} – {r.till}</span>
              ))}
          </div>
        </div>
      ))}
      {hidden > 0 && (
        <button className="err-btn info-more"
                onClick={() => setExpandedFor(all ? '' : trip.id)}>
          <Icon id={all ? 'i-up' : 'i-down'} size={13} />
          {all ? 'Fewer services' : `Show ${hidden} more service${hidden > 1 ? 's' : ''}`}
        </button>
      )}
    </>
  );
}

/* ---- the inline bars: #8b, #11, #13, #13a, #13b, #13c -------------------- */

function InlineBars({ trip, frozenReason, frozenAt, stale, fetchedAt, geometryFailed }: {
  trip: NormalisedTrip; frozenReason: GoneReason | null; frozenAt: number | null;
  stale: boolean; fetchedAt: number; geometryFailed: boolean;
}) {
  const terminus = trip.stoptimes[trip.stoptimes.length - 1];
  const bars: React.ReactNode[] = [];

  if (frozenReason) {
    // All three of #13a, #13b and #13c are normal states of a train doing what it is
    // supposed to be doing, so they are blue and carry no button. Only #13 is a train
    // that vanished mid-journey.
    const seen = frozenAt ? fmtTime(frozenAt) : '';
    if (frozenReason === 'arrived') {
      bars.push(<Bar key="13a" blue icon="i-flag"
        text={`Arrived at ${terminus?.name ?? ''} ${fmtTime(terminus?.arrival)}.`}
        tech="final stoptime realtime-backed, held 10 min after arrival" />);
    } else if (frozenReason === 'gap' && trip.inLegGap) {
      bars.push(<Bar key="13b" blue icon="i-clock"
        text={`Not running between ${trip.inLegGap.from} and ${trip.inLegGap.to}. `
          + `Rail service resumes at ${fmtTime(trip.inLegGap.resumesAt)}.`}
        tech="no leg has a stopRelationship" />);
    } else if (frozenReason === 'due') {
      bars.push(<Bar key="13c" blue icon="i-clock"
        text={`Scheduled to have arrived at ${terminus?.name ?? ''} `
          + `${fmtTime(terminus?.scheduledArrival)}. No realtime confirmation.`}
        tech="final stoptime SCHEDULED, retained by clause (c)" />);
    } else {
      bars.push(<Bar key="13" blue icon="i-clock"
        text="This train is no longer reporting."
        tech={`${trip.id} not in last poll`}
        meta={`Last seen ${seen} near ${trip.nextStop ?? trip.destination}`} />);
    }
  }

  if (stale) {
    // Per-train staleness is surfaced ONLY here, in the panel where you asked about this
    // train. The marker is never faded, dimmed or annotated for it.
    bars.push(<Bar key="8b" icon="i-clock"
      text={`Position may be out of date. This train last reported `
        + `${mss(fetchedAt - trip.lastUpdated)} ago.`}
      tech={`lastUpdated ${fmtTime(trip.lastUpdated)}, the feed itself is healthy`}
      meta="Times and delays below are unaffected" />);
  }

  if (geometryFailed) {
    bars.push(<Bar key="11" icon="i-warn"
      text="Route line unavailable. Everything below is still live."
      tech="the calling-point dots still render" retry />);
  }

  return <>{bars}</>;
}

function Bar({ text, tech, meta, icon, blue, retry }: {
  text: string; tech?: string; meta?: string; icon: string; blue?: boolean; retry?: boolean;
}) {
  return (
    <div className={`warnbar${blue ? ' blue' : ''}`}>
      <Icon id={icon} size={15} style={{ marginTop: 1 }} />
      <div style={{ flex: 1 }}>
        {text}
        {tech && <span className="err-tech" style={{ marginTop: 4 }}>{tech}</span>}
        {meta && <span className="err-meta">{meta}</span>}
      </div>
      {retry && (
        <button className="err-btn" style={{ alignSelf: 'flex-start' }}
                onClick={() => window.dispatchEvent(new Event('retry-geometry'))}>
          <Icon id="i-refresh" size={13} />Retry
        </button>
      )}
    </div>
  );
}

/* ---- the timeline -------------------------------------------------------- */

function Timeline({ trip }: { trip: NormalisedTrip }) {
  const rows = trip.rows.length
    ? trip.rows
    : trip.stoptimes.map((_, index) => ({ kind: 'stop', index } as TimelineRow));

  // The delay-change marker compares against the PREVIOUS RENDERED stop, not
  // stopPosition - 1, which is usually a skipped stop, and only between two
  // realtime-backed stops. Computed over the rendered order once, so the row renderer
  // stays a pure function of its stop.
  const grewFor = new Map<number, number>();
  let previous: NormalisedStop | null = null;
  for (const row of rows) {
    if (row.kind !== 'stop') continue;
    const stop = trip.stoptimes[row.index];
    if (!stop) continue;
    grewFor.set(row.index, growth(previous, stop));
    previous = stop;
  }

  return (
    <ul className="tl tl3">
      {rows.map((row, i) => {
        if (row.kind === 'stop') {
          const s = trip.stoptimes[row.index];
          if (!s) return null;
          return <StopRow key={`s${row.index}`} stop={s} grew={grewFor.get(row.index) ?? 0} />;
        }
        if (row.kind === 'transit') {
          return <TransitRow key={`t${i}`} trip={trip} />;
        }
        if (row.kind === 'gap') {
          // The feed never says "bus", so neither does the wording.
          return (
            <li className="brk" key={`g${i}`}>
              No rail service between <b>{row.from}</b> and <b>{row.to}</b>.{' '}
              {mss(row.seconds)} gap.
            </li>
          );
        }
        return (
          <li className="brk" key={`f${i}`}>
            <b>Portions divide here</b>
            <div className="fork-tails">
              {row.tails.map((tail) => (
                <div className="fork-tail" key={tail.number + tail.destination}>
                  <div className="to">
                    {tail.stoptimes.length
                      ? `${tail.number} to ${tail.destination}`
                      : `${tail.number} ends here`}
                  </div>
                  {tail.stoptimes.length > 0 && (
                    <ul>
                      {tail.stoptimes.map((s, j) => (
                        <li key={j}>
                          <span>{s.name}</span>
                          <span className="t">{fmtTime(s.arrival ?? s.departure)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const growth = (prev: NormalisedStop | null, s: NormalisedStop) => {
  if (!prev || !prev.isRealtime || !s.isRealtime) return 0;
  if (prev.arrivalDelay == null || s.arrivalDelay == null) return 0;
  const d = s.arrivalDelay - prev.arrivalDelay;
  return Math.abs(d) < 60 ? 0 : d;
};

function StopRow({ stop, grew }: { stop: NormalisedStop; grew: number }) {
  const cls = stop.progress === 'past' ? 'done' : stop.progress === 'now' ? 'now' : 'todo';
  const minutes = Math.abs(Math.round(grew / 60));
  return (
    <li className={cls} data-now={stop.progress === 'now' ? '' : undefined}>
      {stop.progress === 'now' && <span className="hl" />}
      <span className="dot" />
      <div>
        <div className="stopname">{stop.name}</div>
        <div className="sub">
          {stop.platformCode && (
            <span className={`plat ${stop.platformColor}`}>Pl. {stop.platformCode}</span>
          )}
          {/* Row delay is arrivalDelay on every row, always: it answers what the row's own
              position asks, how late the train got HERE. A SCHEDULED row has none. */}
          {stop.arrivalDelay != null && stop.arrivalDelay >= 60 && (
            <Delay className="dmin" seconds={stop.arrivalDelay} />
          )}
          {grew !== 0 && (
            <span className={`grew${grew < 0 ? ' down' : ''}`}
                  title={`delay ${grew > 0 ? 'grew' : 'fell'} by ${minutes} min here`}>
              <Icon id={grew > 0 ? 'i-up' : 'i-down'} size={13} />
              {grew > 0 ? '+' : '−'}{minutes}
            </span>
          )}
        </div>
      </div>
      {/* Each cell is coloured by ITS OWN delay. A train that arrives late and stands in
          the platform until its booked departure leaves on time, so the arrival is red
          and the departure green. Reading arrivalDelay for both is what painted that
          departure red. */}
      <TimeCell scheduled={stop.scheduledArrival} realtime={stop.arrival}
                realtimeBacked={stop.isRealtime} late={(stop.arrivalDelay ?? 0) >= 60} />
      <TimeCell scheduled={stop.scheduledDeparture} realtime={stop.departure}
                realtimeBacked={stop.isRealtime} late={(stop.departureDelay ?? 0) >= 60} />
    </li>
  );
}

/** MODIFIED / UPDATED: show realtime, scheduled struck through above it when they differ.
 *  SCHEDULED: one grey time, no strike-through, and no delay. */
function TimeCell({ scheduled, realtime, realtimeBacked, late }: {
  scheduled: number | null; realtime: number | null; realtimeBacked: boolean; late: boolean;
}) {
  if (realtime == null && scheduled == null) {
    return <div className="cell" style={{ color: 'var(--muted)' }} />;
  }
  if (!realtimeBacked) {
    return <div className="cell"><span className="new sched">{fmtTime(scheduled)}</span></div>;
  }
  const changed = scheduled != null && realtime != null && scheduled !== realtime;
  return (
    <div className="cell">
      {changed && <><span className="old">{fmtTime(scheduled)}</span><br /></>}
      <span className={`new ${late ? 'late' : 'ok'}`}>{fmtTime(realtime)}</span>
    </div>
  );
}

/** IN_TRANSIT_TO renders the train as a pulsing marker ON the rail between two stops, at
 *  the boundary where solid becomes dashed. The label is a bonus; the marker is the row's
 *  real job, and it renders with no label when speed is null. */
function TransitRow({ trip }: { trip: NormalisedTrip }) {
  const speed = kmh(trip.speed);
  return (
    <li className="transit" style={{ ['--seg' as string]: delayColor(trip.delay) } as React.CSSProperties}>
      <span className="dot" />
      <div className="lab">
        <Icon id="i-speed" size={15} />
        <span>In transit to {trip.nextStop}</span>
        {speed != null && <span className="num">{speed} km/h</span>}
      </div>
      {trip.isEstimated && <div className="lab-sub">Position estimated</div>}
    </li>
  );
}
