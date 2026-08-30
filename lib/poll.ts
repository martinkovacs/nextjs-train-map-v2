'use client';

import { useStore } from './store';
import type { FeedError, VehiclesResponse } from './types';
import { fmtClock, mss } from './time';

/** The 30 s poll (SPEC 1 and SPEC 10).
 *
 *  `cache: 'no-store'`, or the browser serves its own copy and the poll stops polling.
 *  Paused on visibilitychange with one immediate fetch when the tab comes back. The
 *  backoff ladder below is this poll's alone: neither vagonweb call ever auto-retries. */

const POLL_MS = 30_000;
const LADDER = [2, 4, 8, 16, 30];          // seconds, then hold
const FREEZE_AFTER = 180;                  // 3:00 of wall clock, never a count of polls

/** The failure ids the /api/vehicles poll owns, so a success can clear exactly those. */
const FEED_IDS = ['#1', '#2', '#3', '#4', '#5', '#6', '#7'];

type ApiFailureBody = {
  failure?: string; title?: string; hop?: [string, string];
  upstreamStatus?: number; detail?: string; retry?: boolean;
};

let timer: ReturnType<typeof setTimeout> | null = null;
let attempt = 0;
let running = false;
let lastMax = 0;
let lastAdvanceAt = 0;
let inFlight: AbortController | null = null;

const now = () => Math.floor(Date.now() / 1000);

const schedule = (seconds: number) => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { void tick(); }, seconds * 1000);
};

const backoffSeconds = () => LADDER[Math.min(attempt, LADDER.length - 1)];

function raiseFeedError(part: Omit<FeedError, 'attempt' | 'nextRetryAt' | 'lastGoodAt'>,
                        retryIn: number | null) {
  const { raise } = useStore.getState();
  raise({
    ...part,
    attempt: attempt || 1,
    nextRetryAt: retryIn == null ? null : now() + retryIn,
    lastGoodAt: useStore.getState().lastGoodAt,
  });
}

async function tick() {
  const store = useStore.getState();
  inFlight?.abort();
  inFlight = new AbortController();

  let res: Response;
  try {
    res = await fetch('/api/vehicles', { cache: 'no-store', signal: inFlight.signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
    attempt++;
    const wait = backoffSeconds();
    console.error('[poll] fetch rejected', e);
    raiseFeedError({
      id: '#1', severity: 'error', title: 'Data is not updating',
      hop: null, icon: 'i-offline',
      detail: `TypeError: Failed to fetch · /api/vehicles\nnavigator.onLine = ${navigator.onLine}`,
      retry: true,
    }, wait);
    schedule(wait);
    return;
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as ApiFailureBody;
    console.error('[poll] /api/vehicles failed', res.status, body);
    const id = body.failure ?? '#2';
    const retryable = body.retry !== false && res.status !== 403;
    const retryAfter = Number(res.headers.get('Retry-After'));
    attempt++;
    const wait = retryable
      ? (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : backoffSeconds())
      : null;

    const statusLine = body.upstreamStatus === 200
      ? (id === '#6' ? '200 OK with errors[]' : '200 OK')
      : `${res.status} ${res.statusText}`;
    const hopText = body.hop ? body.hop : null;

    raiseFeedError({
      id,
      severity: 'error',
      title: body.title ?? 'Data is not updating',
      hop: hopText,
      status: res.status,
      icon: id === '#4' ? 'i-clock' : 'i-warn',
      detail: `${statusLine}\n${body.detail ?? ''}`.trim(),
      retry: true,
      meta: retryable ? undefined
        : (Number.isFinite(retryAfter) && retryAfter > 0
            ? `Backing off to ${mss(retryAfter)}`
            : 'Not retried, the query needs changing'),
    }, wait);
    if (wait != null) schedule(wait);
    return;
  }

  const data = await res.json() as VehiclesResponse;
  attempt = 0;
  // On the first successful poll the toast disappears silently. The data moving again is
  // the confirmation, so there is no "back online" message.
  FEED_IDS.forEach((id) => store.clear(id));
  useStore.getState().setFeed(data);

  // #7a: some rows failed validation while others survived. The only thing meta.dropped
  // is for.
  if (data.meta.dropped > 0) {
    useStore.getState().raise({
      id: '#7a', severity: 'warning', title: 'Some trains could not be read',
      hop: null, attempt: 1, nextRetryAt: null, lastGoodAt: data.meta.fetchedAt,
      detail: `200 OK · ${data.meta.dropped} of ${data.meta.total} rows failed validation\n`
        + `${data.trains.length} trains rendered`,
      meta: 'Still polling every 30 s',
    });
  } else {
    useStore.getState().clear('#7a');
  }

  // #9: zero vehicles, including the local time so the answer can be judged plausible.
  if (data.trains.length === 0) {
    useStore.getState().raise({
      id: '#9', severity: 'warning', title: 'No trains in the response',
      hop: null, attempt: 1, nextRetryAt: null, lastGoodAt: data.meta.fetchedAt,
      detail: `200 OK · vehiclePositions: [] · ${fmtClock(data.meta.fetchedAt)} local\n`
        + 'plausible at night, otherwise suspect',
      meta: 'Still polling every 30 s',
    });
  } else {
    useStore.getState().clear('#9');
  }

  // #8: the whole feed frozen. Computed over RETAINED trips only, because dropped rows
  // keep publishing fresh timestamps and would mask it, and measured in elapsed time
  // rather than in polls: three consecutive polls can legitimately return one cached
  // payload, but no cache window spans 3:00.
  const max = data.trains.reduce((m, t) => Math.max(m, t.lastUpdated), 0);
  if (max > lastMax) { lastMax = max; lastAdvanceAt = now(); }
  if (!lastAdvanceAt) lastAdvanceAt = now();
  const frozenFor = now() - lastAdvanceAt;
  if (frozenFor >= FREEZE_AFTER && data.trains.length) {
    useStore.getState().raise({
      id: '#8', severity: 'warning', title: 'Positions may be stale',
      hop: null, attempt: 1, nextRetryAt: null, lastGoodAt: data.meta.fetchedAt,
      icon: 'i-clock',
      detail: `200 OK · ${data.trains.length} trains · feed clock frozen\n`
        + `max(lastUpdated) unchanged for ${mss(frozenFor)}\n`
        + `newest report ${mss(Math.max(0, data.meta.fetchedAt - max))} old`,
      meta: 'Still polling every 30 s',
    });
  } else {
    useStore.getState().clear('#8');
  }

  schedule(POLL_MS / 1000);
}

/** Fired by the map shell on mount. Polling pauses while the tab is hidden and fires one
 *  immediate fetch when it regains focus. */
export function startPolling() {
  if (running) return () => {};
  running = true;
  void tick();

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      if (timer) clearTimeout(timer);
      timer = null;
    } else {
      void tick();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    running = false;
    document.removeEventListener('visibilitychange', onVisibility);
    if (timer) clearTimeout(timer);
    timer = null;
    inFlight?.abort();
  };
}

/** The Retry control on the toast and on #10's card. */
export function retryNow() {
  attempt = 0;
  void tick();
}
