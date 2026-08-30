/** Time and unit helpers. SPEC.md §7.3 and §9.
 *
 *  `serviceDay` is the day the trip departs its FIRST station and the seconds fields are
 *  plain offsets that simply run past 86400 after midnight, so the conversion is
 *  `serviceDay + seconds` with no clamping and no modulo. Kept in one helper anyway, so
 *  no component ever sees an offset. */

export const TZ = 'Europe/Budapest';

/** serviceDay + offset -> absolute unix seconds. Null offset stays null. */
export const absolute = (serviceDay: number, seconds: number | null | undefined) =>
  seconds == null ? null : serviceDay + seconds;

const hhmm = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
});

/** HH:mm in Europe/Budapest. The data is minute-resolution, so no seconds. */
export const fmtTime = (unixSeconds: number | null | undefined) =>
  unixSeconds == null ? '' : hhmm.format(new Date(unixSeconds * 1000));

const hhmmss = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});

/** HH:mm:ss, for the toast's "last good" line. */
export const fmtClock = (unixSeconds: number | null | undefined) =>
  unixSeconds == null ? '' : hhmmss.format(new Date(unixSeconds * 1000));

const isoDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});

/** YYYY-MM-DD in Europe/Budapest, the geometry query's serviceDay argument. */
export const fmtServiceDay = (unixSeconds: number) =>
  isoDay.format(new Date(unixSeconds * 1000));

const yearOnly = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric' });

/** Calendar year of an instant in Europe/Budapest. Not new Date().getFullYear():
 *  a trip that departed on 31 December belongs to the old timetable year. */
export const yearInBudapest = (unixSeconds: number) =>
  yearOnly.format(new Date(unixSeconds * 1000));

/** Relative and elapsed values are m:ss everywhere (CLAUDE.md, SPEC.md §10). */
export const mss = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** The API returns metres per second (§9, confirmed in findings.md). One helper. */
export const kmh = (metresPerSecond: number | null | undefined) =>
  metresPerSecond == null ? null : Math.round(metresPerSecond * 3.6);

/** heading is compass degrees clockwise from north, but negative and fractional
 *  values are routine (§3, §9). */
export const normaliseHeading = (h: number) => ((h % 360) + 360) % 360;
