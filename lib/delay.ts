/** The delay scale, SPEC.md §2. Two tiers: fills for shapes, inks for text.
 *  Bucketed from the trip's RESOLVED delay in seconds (§7.2), never a raw
 *  `arrivalDelay`. `null` means no realtime exists. */

export const delayColor = (s: number | null) =>
  s == null ? 'var(--d-unknown)' :
  s < 0     ? 'var(--d-early)'   :
  s < 300   ? 'var(--d-ontime)'  :
  s < 900   ? 'var(--d-slight)'  :
  s < 1800  ? 'var(--d-late)'    :
              'var(--d-severe)';

/** How the delay NUMBER is coloured. NOT the same ladder: the dot beside it already
 *  carries the exact bucket, and a delay reads as red. Only the states that are not a
 *  delay take an ink of their own, because painting "On time" or "No data" red lies.
 *  Text never reads a --d-* fill. */
export const delayInk = (s: number | null) =>
  s == null ? 'var(--di-unknown)' :   // No data
  s <= -60  ? 'var(--di-early)'   :   // early. `<=`, not `<`: the data is minute-resolution,
                                      // so exactly -60 is a real value and one minute early
                                      // must not read as On time (§7.3)
  s < 60    ? 'var(--di-ontime)'  :   // On time
              'var(--red)';           // late, whichever bucket

/** The words beside the dot. The column is never blank on any surface. */
export const delayText = (s: number | null) =>
  s == null ? 'No data' :
  s <= -60  ? `−${Math.round(Math.abs(s) / 60)} min early` :
  s < 60    ? 'On time' :
              `+${Math.round(s / 60)} min`;

/** Always route.textColor, a bare hex needing a '#'. The fallback is deliberately not
 *  plausible-looking: a white ring reads as broken against every basemap (§2). */
export const typeColor = (hex?: string | null) => (hex ? `#${hex}` : '#ffffff');
