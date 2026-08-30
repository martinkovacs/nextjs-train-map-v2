'use client';

import { Icon } from './Sprite';
import { RouteBadge } from './Badge';
import { Delay } from './Delay';
import { fmtTime, kmh } from '@/lib/time';
import type { NormalisedTrip } from '@/lib/types';

/** Hover card, design D: icon rows plus an alert list. 330 px, base font 13 px.
 *
 *  Both middle rows are .ttD-row, which forces one font family, one size (14.5 px) and
 *  one 22 px line box on EVERY child. Mixing a monospace time with sans text and a
 *  smaller platform label is what threw the row off axis; do not reintroduce either. */
export function HoverCard({ trip, point }: {
  trip: NormalisedTrip; point: { x: number; y: number };
}) {
  const stop = trip.nextStop ? trip.stoptimes.find((s) => s.name === trip.nextStop) : null;
  const terminus = trip.stoptimes[trip.stoptimes.length - 1];
  const speed = kmh(trip.speed);

  // "Next stop" wording comes from stopRelationship.status. An arrived train has neither
  // status and reads Arrived; a train retained under clause (c) reads Due with the
  // SCHEDULED time, because nothing has reported it arriving.
  const row2 = trip.status === 'ARRIVED'
    ? { label: 'Arrived', name: terminus?.name ?? '', time: terminus?.arrival ?? null, sched: false, stop: terminus }
    : trip.status === 'NOT_RUNNING'
      ? { label: 'Due', name: terminus?.name ?? '', time: terminus?.scheduledArrival ?? null, sched: true, stop: terminus }
      : { label: trip.status === 'STOPPED_AT' ? 'At' : 'Next',
          name: stop?.name ?? '', time: stop?.arrival ?? null,
          sched: !(stop?.isRealtime ?? false), stop };

  return (
    <div
      className="card tt"
      style={{ left: point.x, top: point.y, transform: 'translate(-50%, calc(-100% - 22px))' }}
    >
      <div className="tt-hd" style={{ ['--type' as string]: trip.typeColor } as React.CSSProperties}>
        <RouteBadge fontCode={trip.fontCode} typeColor={trip.typeColor} />
        <span className="title">
          {[trip.number, trip.name, trip.category].filter(Boolean).join(' ')}
        </span>
      </div>

      {/* row 1: destination left, speed right */}
      <div className="ttD-row" style={{ padding: '10px 11px 0' }}>
        <Icon id="i-flag" style={{ color: 'var(--w-ink-2)' }} />
        <b className="ell">{trip.destination}</b>
        {trip.isEstimated ? (
          // MÁV computed that position rather than measuring it, and those rows carry no
          // speed anyway, so the empty slot carries the reason instead. The marker is
          // untouched: nothing on the map changes appearance for a data-quality reason.
          <span style={{ color: 'var(--w-ink-2)', flex: 'none', fontSize: 13 }}>
            Position estimated
          </span>
        ) : speed != null ? (
          <span className="icrow" style={{ color: 'var(--w-ink-2)', flex: 'none' }}>
            <Icon id="i-speed" />
            <span className="num">{speed} km/h</span>
          </span>
        ) : null}
      </div>

      {/* row 2: pin, station, arrival, platform, delay */}
      <div className="ttD-row" style={{ padding: '6px 11px 11px' }}>
        <Icon id="i-pin" style={{ color: 'var(--w-ink-2)' }} />
        <span className="ell" style={{ flex: '0 1 auto' }}>
          {row2.label === 'Next' || row2.label === 'At' ? row2.name : `${row2.label} ${row2.name}`}
        </span>
        {row2.time != null && (
          <span className="num" style={{
            fontWeight: 700, flex: 'none',
            // a SCHEDULED time is grey: nothing may imply MÁV knows when it arrives
            color: row2.sched ? 'var(--muted)' : undefined,
          }}>
            {fmtTime(row2.time)}
          </span>
        )}
        {/* a null platformCode renders nothing at all, whatever the colour says */}
        {row2.stop?.platformCode && (
          <span className={`plat ${row2.stop.platformColor}`}>Pl. {row2.stop.platformCode}</span>
        )}
        <Delay seconds={trip.delay} style={{ marginLeft: 'auto' }} />
      </div>

      {trip.alerts.length > 0 && (
        <div style={{
          borderTop: '1px solid var(--w-line)', padding: '7px 11px',
          display: 'grid', gap: 5,
        }}>
          {trip.alerts.map((a, i) => (
            <div key={i} className="icrow" style={{ color: 'var(--red)', fontSize: 12.5 }}>
              <Icon id="i-warn" size={14} />
              <span className="ell" title={a.description}>{a.description}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
