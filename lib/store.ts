'use client';

import { create } from 'zustand';
import type { FeedError, NormalisedTrip, VehiclesResponse } from './types';

/** One Zustand store: normalised trains, selected trip id, current FeedError set.
 *  The marker layer reads it IMPERATIVELY through getState()/subscribe and is never a
 *  subscriber component, so a poll re-renders the hover card, panel, search and toast
 *  only, never 400 markers (SPEC 1). */

export type Source = 'current' | 'vagonweb' | 'both';

/** What happened to the open train when it left the feed: #13, #13a, #13b, #13c. */
export type GoneReason = 'left' | 'arrived' | 'gap' | 'due';

type State = {
  trains: NormalisedTrip[];
  byId: Map<string, NormalisedTrip>;
  meta: VehiclesResponse['meta'] | null;
  everLoaded: boolean;
  lastGoodAt: number | null;

  selectedId: string | null;
  /** The open train's last known state after it dropped out of the feed. The panel
   *  freezes on this and the marker greys; nothing closes silently. */
  frozen: { trip: NormalisedTrip; reason: GoneReason; at: number } | null;

  /** Live conditions, keyed by the SPEC 10 failure number. One toast at a time, highest
   *  severity at rest, the rest behind the +N control. */
  conditions: Record<string, FeedError>;

  source: Source;

  setFeed: (res: VehiclesResponse) => void;
  select: (id: string | null) => void;
  raise: (e: FeedError) => void;
  clear: (id: string) => void;
  setSource: (s: Source) => void;
};

const SEVERITY = { error: 0, warning: 1, info: 2 } as const;

export const useStore = create<State>((set, get) => ({
  trains: [],
  byId: new Map(),
  meta: null,
  everLoaded: false,
  lastGoodAt: null,
  selectedId: null,
  frozen: null,
  conditions: {},
  source: 'both',

  setFeed: (res) => {
    const byId = new Map(res.trains.map((t) => [t.id, t]));
    const { selectedId, frozen } = get();
    let nextFrozen = frozen;

    if (selectedId) {
      const still = byId.get(selectedId);
      if (still) {
        nextFrozen = null;                       // it is back, or never left
      } else if (!frozen) {
        // The open train left the feed. Which message depends on WHY, and all four are
        // states of a train doing what it is supposed to be doing except #13.
        const last = get().byId.get(selectedId);
        if (last) {
          const reason: GoneReason =
            last.status === 'ARRIVED' ? 'arrived'
            : last.inLegGap ? 'gap'
            : last.status === 'NOT_RUNNING' ? 'due'
            : 'left';
          nextFrozen = { trip: last, reason, at: res.meta.fetchedAt };
        }
      }
    }

    set({
      trains: res.trains,
      byId,
      meta: res.meta,
      everLoaded: true,
      lastGoodAt: res.meta.fetchedAt,
      frozen: nextFrozen,
    });
  },

  select: (id) => set({ selectedId: id, frozen: null }),

  raise: (e) => set((s) => ({ conditions: { ...s.conditions, [e.id]: e } })),

  clear: (id) => set((s) => {
    if (!(id in s.conditions)) return s;
    const next = { ...s.conditions };
    delete next[id];
    return { conditions: next };
  }),

  setSource: (source) => set({ source }),
}));

/** Highest severity wins and is the only one rendered at rest; the stack grows upward
 *  behind it, most severe at the bottom. */
export const orderedConditions = (conditions: Record<string, FeedError>) =>
  Object.values(conditions).sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity]);

export const selectedTrip = (s: State): NormalisedTrip | null =>
  (s.selectedId ? s.byId.get(s.selectedId) ?? s.frozen?.trip ?? null : null);
