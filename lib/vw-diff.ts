import type { Vehicle } from './vw-parse';

/** The diff against the plan (SPEC 6.5). Every mark on a vehicle and every word of the
 *  sentence comes out of this, and getting it wrong is invisible: a mis-paired coach
 *  still renders, it just lies. */

export type Mark = '' | 'chg' | 'add' | 'miss';
export type DiffEntry = { v: Vehicle; from?: Vehicle; mark: Mark; slot: number };

/** 1. Pair on the CAR NUMBER, never on position. vagonweb prints the number written on
 *  the coach itself, so it survives re-ordering, substitution and a train running short.
 *  Position pairing does not: one substituted coach shifts everything behind it and the
 *  whole tail reports as changed.
 *
 *      slot(v, i) =
 *          v.isLoco  ?  (i === 0 ? -1 : 1000 + i)   // a leading loco sorts first,
 *                                                   // a rear or banking loco last
 *        : v.number  ?  parseInt(v.number, 10)      // 409, 410, 411 ...
 *        :              500 + i                     // no number: out of the numbered
 *                                                   // range, still stable
 *
 *  parseInt, not Number(): a car number is not always a number. 937 ran twice as a single
 *  815 unit numbered "11-16", which Number() turns into NaN and the sort into nonsense. */
export function slotOf(v: Vehicle, i: number): number {
  if (v.isLoco) return i === 0 ? -1 : 1000 + i;
  const n = parseInt(v.no ?? '', 10);
  return Number.isFinite(n) ? n : 500 + i;
}

/** Vehicle kind: the coach type, or `loco <class>` for a locomotive. NOTHING else is
 *  compared, so a coach that kept its number and type but gained Wi-Fi is not a
 *  difference. */
const kind = (v: Vehicle) => (v.isLoco ? `loco ${v.type}` : v.type);

/** A slot vagonweb fills with EITHER of two machines matches either, so 849 turning up
 *  behind its 490 is the plan and not a substitution. */
const kinds = (v: Vehicle) => (v.alt ? v.alt.map((a) => (a.isLoco ? `loco ${a.type}` : a.type)) : [kind(v)]);
const same = (p: Vehicle, a: Vehicle) => kinds(p).some((k) => kinds(a).includes(k));

/** 2. Each slot yields exactly one outcome, which is what makes it impossible for one
 *  coach to be reported twice.
 *  3. Drawn in the REPORTED train's own order, never in slot order. A planned vehicle
 *     that did not run is put back in the gap it left, directly after whichever vehicle
 *     it followed in the plan, or at the head if it was first. */
export function diffComposition(planned: Vehicle[], reported: Vehicle[]): DiffEntry[] {
  const planSlots = planned.map(slotOf);
  const carSlots = reported.map(slotOf);

  const inPlan = new Map<number, Vehicle>();
  planSlots.forEach((s, i) => { if (!inPlan.has(s)) inPlan.set(s, planned[i]); });
  const firstReported = new Map<number, number>();
  carSlots.forEach((s, i) => { if (!firstReported.has(s)) firstReported.set(s, i); });

  // where each missing vehicle goes back: after the reported vehicle it followed
  const gaps = new Map<number, Vehicle[]>();
  let after = -1;
  planned.forEach((v, i) => {
    const s = planSlots[i];
    const at = firstReported.get(s);
    if (at != null) { after = at; return; }
    const list = gaps.get(after);
    if (list) list.push(v); else gaps.set(after, [v]);
  });

  const out: DiffEntry[] = (gaps.get(-1) ?? []).map((v, i) => ({ v, mark: 'miss', slot: slotOf(v, i) }));
  const used = new Set<number>();
  reported.forEach((a, i) => {
    const s = carSlots[i];
    const p = used.has(s) ? undefined : inPlan.get(s);
    if (p) used.add(s);
    out.push(p
      ? { slot: s, v: a, from: p, mark: same(p, a) ? '' : 'chg' }
      : { slot: s, v: a, mark: 'add' });
    (gaps.get(i) ?? []).forEach((v) => out.push({ v, mark: 'miss', slot: slotOf(v, 0) }));
  });
  return out;
}

/* ---- 4. the sentence, walking that same array ----------------------------- */

type Clause = { key: string; mark: Mark; v: Vehicle; from?: Vehicle; nums: (string | null)[] };

function clauses(seq: DiffEntry[]): Clause[] {
  const out: Clause[] = [];
  for (const x of seq) {
    if (!x.mark) continue;
    const key = [x.mark, kind(x.v), x.from ? kind(x.from) : ''].join('|');
    const last = out[out.length - 1];
    // neighbouring vehicles with an identical outcome merge into one clause
    if (last && last.key === key) last.nums.push(x.v.no);
    else out.push({ key, mark: x.mark, v: x.v, from: x.from, nums: [x.v.no] });
  }
  return out;
}

const list = (ns: (string | null)[]) => {
  const f = ns.filter((n): n is string => !!n);
  if (!f.length) return '';
  return (f.length === 1 ? f[0] : `${f.slice(0, -1).join(', ')} and ${f[f.length - 1]}`) + ' ';
};

const count = (n: number) => `${n} vehicle${n === 1 ? '' : 's'}`;

/** Returns HTML: the marks inside the sentence carry the same colours as the vehicles,
 *  because both come out of the same array in the same order. */
export function compositionSentence(planned: Vehicle[], reported: Vehicle[]): string {
  const seq = diffComposition(planned, reported);

  // 5. Two escape hatches, both required by real trains.
  if (seq.length && !seq.some((x) => !x.mark)) {
    return '<b class="m-chg">A different train entirely.</b> '
      + `${count(planned.length)} planned, ${count(reported.length)} ran, `
      + 'and not one of them lines up.';
  }

  const parts = clauses(seq).map((c) => {
    const loco = c.v.isLoco;
    if (c.mark === 'chg') {
      return `<b class="m-chg">${loco ? 'loco ' : ''}${c.v.type}</b> in place of `
        + `${loco ? '' : list(c.nums)}${c.from?.type ?? ''}`;
    }
    const who = `<b class="m-${c.mark}">${loco ? `loco ${c.v.type}` : list(c.nums) + c.v.type}</b>`;
    if (c.mark === 'add') return loco ? `an extra ${who}` : `${who} extra`;
    return `${who} missing`;
  });
  if (!parts.length) return '<span class="same">Runs exactly as planned.</span>';

  const rest = parts.length > 4 ? parts.length - 4 : 0;
  const shown = rest
    ? parts.slice(0, 4).concat(`${rest} more difference${rest === 1 ? '' : 's'}`)
    : parts;
  const text = shown.length === 1
    ? shown[0]
    : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
  // skip past any opening tags before capitalising, or the "l" of "loco" stays lowercase
  return text.replace(/^((?:<[^>]*>)*)([a-z])/, (_, tags, ch) => tags + ch.toUpperCase()) + '.';
}
