'use client';

import { delayColor, delayInk, delayText } from '@/lib/delay';

/** How a delay is written, on every surface: hover card row 2, the search result row and
 *  the timeline sub-line all use THIS component, so the three can never drift.
 *
 *  A dot, then the number. The 7 px dot carries the five-bucket FILL scale and is drawn
 *  as an element, never a glyph; the number is 700 in --red, because red is what a delay
 *  means and the dot already says how late. It leaves red only for the states that are
 *  not a delay: On time, early and No data. No background and no chip.
 *
 *  The column is never blank on any surface. */
export function Delay({ seconds, className, style }: {
  seconds: number | null; className?: string; style?: React.CSSProperties;
}) {
  return (
    <span
      className={`dly${className ? ' ' + className : ''}`}
      style={{
        ['--dot' as string]: delayColor(seconds),
        color: delayInk(seconds),
        ...style,
      } as React.CSSProperties}
    >
      {delayText(seconds)}
    </span>
  );
}
