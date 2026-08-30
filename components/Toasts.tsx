'use client';

import { useEffect, useState } from 'react';
import { HopArrow, Icon } from './Sprite';
import { orderedConditions, useStore } from '@/lib/store';
import { retryNow } from '@/lib/poll';
import { fmtClock, mss } from '@/lib/time';
import type { FeedError } from '@/lib/types';

/** The error surface, design B: one toast, horizontally centred against the bottom edge
 *  of the map. One component renders every FeedError, so adding a failure mode means
 *  adding a mapping and not a UI.
 *
 *  There is no dismissal. A toast is a readout of a live condition, not a notification:
 *  it is up exactly as long as the condition holds and clears itself the moment the data
 *  moves again. The one exception is #17, which reports something that already happened.
 *
 *  On mobile it sits ABOVE the detail sheet and is never hidden by it: a sheet covering a
 *  failure the map is currently having is what this section exists to prevent. */
export function Toasts({ shifted }: { shifted: boolean }) {
  const conditions = useStore((s) => s.conditions);
  const everLoaded = useStore((s) => s.everLoaded);
  const [expanded, setExpanded] = useState(false);
  const [, tick] = useState(0);

  // the countdown line is the only thing that needs a clock of its own
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const live = orderedConditions(conditions);
  if (!live.length) {
    // First load, before any answer: a single unobtrusive line where the toast goes.
    // Nothing blocks on the fetch; the map, tiles and search box are already usable.
    return everLoaded ? null : <div className="loading-line">Loading trains</div>;
  }

  // #10: nothing has ever loaded. It OVERLAYS the map, it does not replace it: the
  // basemap and the search box rendered on the first frame and are not torn down.
  const worst = live[0];
  if (!everLoaded && worst.severity === 'error') {
    return (
      <div className="err-full">
        <div className="card">
          <Icon id="i-offline" size={30} style={{ color: 'var(--red)', margin: '0 auto 12px' }} />
          <div style={{ fontWeight: 700, fontSize: 17 }}>Could not load train data</div>
          <div className="err-tech" style={{ display: 'inline-block', textAlign: 'left' }}>
            <Detail e={worst} />
          </div>
          <div style={{ marginTop: 16 }}>
            <button className="err-btn" style={{ padding: '9px 16px' }} onClick={retryNow}>
              <Icon id="i-refresh" size={15} />Try again
            </button>
          </div>
          <div className="err-meta">{metaLine(worst)}</div>
        </div>
      </div>
    );
  }

  // The resting position stays at the bottom edge and the stack grows upward behind it,
  // most severe at the bottom, so expanding never moves the toast you just pressed.
  const stack = expanded ? [...live].reverse() : [worst];

  return (
    <div className={`err-stack${shifted ? ' shifted' : ''}`}>
      {stack.map((e) => (
        <Toast key={e.id} e={e}
               more={e === worst && live.length > 1 ? live.length - 1 : 0}
               onMore={() => setExpanded((v) => !v)} />
      ))}
    </div>
  );
}

const cardClass = (e: FeedError) =>
  e.severity === 'error' ? 'card err' : e.severity === 'warning' ? 'card warn' : 'card info-c';

const iconColour = (e: FeedError) =>
  e.severity === 'error' ? 'var(--red)' : e.severity === 'warning' ? 'var(--amber)' : 'var(--info)';

function Toast({ e, more, onMore }: { e: FeedError; more: number; onMore: () => void }) {
  return (
    <div className={cardClass(e)}>
      <div className="err-body">
        <div className="icrow" style={{ gap: 8 }}>
          <Icon id={e.icon ?? 'i-warn'} style={{ color: iconColour(e) }} />
          <b className="err-title">{e.title}</b>
          {more > 0 && (
            <button className="err-more" onClick={onMore}
                    title={`${more} more condition${more === 1 ? ' is' : 's are'} live. `
                      + 'Press to expand the stack.'}>
              +{more}
            </button>
          )}
          {e.retry && (
            <button className="err-btn" onClick={retryNow}>
              <Icon id="i-refresh" size={14} />Retry
            </button>
          )}
        </div>
        <div className="err-tech"><Detail e={e} /></div>
        <div className="err-meta">{metaLine(e)}</div>
      </div>
    </div>
  );
}

/** The technical lines: the hop, the status and the raw error, never "Something went
 *  wrong". The hop arrow is an SVG even here, inside a monospace string. */
function Detail({ e }: { e: FeedError }) {
  const lines = e.detail.split('\n');
  return (
    <>
      {lines.map((line, i) => (
        <span key={i}>
          {i === 0 && e.hop ? (
            <>
              {line} · {e.hop[0]}<HopArrow />{e.hop[1]}
            </>
          ) : line}
          {i < lines.length - 1 && <br />}
        </span>
      ))}
    </>
  );
}

const metaLine = (e: FeedError) => {
  if (e.meta) return e.meta;
  const bits = [`Attempt ${e.attempt}`];
  if (e.nextRetryAt) {
    bits.push(`retry in ${mss(Math.max(0, e.nextRetryAt - Math.floor(Date.now() / 1000)))}`);
  }
  if (e.lastGoodAt) bits.push(`last good ${fmtClock(e.lastGoodAt)}`);
  return bits.join(' · ');
};
