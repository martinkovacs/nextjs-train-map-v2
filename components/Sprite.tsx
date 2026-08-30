/**
 * The icon sprite, rendered once. Every icon in the app is an inline SVG on a 20×20
 * viewBox referenced from here, `display:block` inside an `align-items:center` flex row.
 * No text glyph ever substitutes for one, in any string, including monospace ones
 * (CLAUDE.md). The only font glyphs anywhere are MÁV's own MNR2007 pictograms.
 *
 * Three groups: UI, carriage amenities, vehicle silhouettes. `locate` and `pin` are
 * different glyphs and stay that way — one glyph never means two things.
 */
export function Sprite() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true"><defs>
      {/* ---- UI ---- */}
      <g id="i-arrow"><path d="M3 10h13M11.5 5.5 16 10l-4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></g>
      <g id="i-pin"><path d="M10 17.5s5.5-5.1 5.5-9.1a5.5 5.5 0 1 0-11 0c0 4 5.5 9.1 5.5 9.1Z" fill="none" stroke="currentColor" strokeWidth="1.7"/><circle cx="10" cy="8.3" r="1.9" fill="currentColor"/></g>
      <g id="i-speed"><path d="M3.6 15.2a7.6 7.6 0 1 1 12.8 0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><path d="M10 10.9 13.4 7.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><circle cx="10" cy="11.4" r="1.5" fill="currentColor"/></g>
      <g id="i-clock"><circle cx="10" cy="10" r="7.1" fill="none" stroke="currentColor" strokeWidth="1.7"/><path d="M10 5.9V10l2.8 1.9" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></g>
      <g id="i-warn"><path d="M10 2.6 18.3 17H1.7Z" fill="currentColor"/><path d="M10 7.8v3.9" stroke="#fff" strokeWidth="1.7" strokeLinecap="round"/><circle cx="10" cy="14.3" r="1" fill="#fff"/></g>
      <g id="i-search"><circle cx="9" cy="9" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.9"/><path d="M13.6 13.6 17.5 17.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/></g>
      <g id="i-close"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/></g>
      <g id="i-refresh"><path d="M16.5 10a6.5 6.5 0 1 1-1.9-4.6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/><path d="M16.8 2.6v4.2h-4.2" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/></g>
      <g id="i-offline"><path d="M2 3.2 18 17.4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/><path d="M4.2 8.1a8.6 8.6 0 0 1 3-1.9M10 4.3a8.6 8.6 0 0 1 5.9 2.3M6.9 11a4.9 4.9 0 0 1 1.8-1.1M13.2 9.9a4.9 4.9 0 0 1 .9.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><circle cx="10" cy="15.2" r="1.3" fill="currentColor"/></g>
      <g id="i-down"><path d="M10 3.8v11.6M14.6 10.8 10 15.4l-4.6-4.6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></g>
      <g id="i-up"><path d="M10 16.2V4.6M5.4 9.2 10 4.6l4.6 4.6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></g>
      <g id="i-back"><path d="M17 10H4M8.5 5.5 4 10l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></g>
      <g id="i-locate"><circle cx="10" cy="10" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.7"/><circle cx="10" cy="10" r="1.5" fill="currentColor"/><path d="M10 1.6v2.8M10 15.6v2.8M1.6 10h2.8M15.6 10h2.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></g>
      <g id="i-flag"><path d="M5.2 3v14.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><path d="M6.4 4h8.4l-2.1 3.1 2.1 3.1H6.4Z" fill="currentColor"/></g>

      {/* ---- carriage amenities (§6.5): ours, standing in for vagonweb's pictograms,
              matched from its filenames by the table in plan/vagonweb.md ---- */}
      <g id="i-wifi" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M2.9 7.4a11.3 11.3 0 0 1 14.2 0"/><path d="M5.7 10.9a7.1 7.1 0 0 1 8.6 0"/><path d="M8.3 14.2a3 3 0 0 1 3.4 0"/><circle cx="10" cy="16.7" r="1.2" fill="currentColor" stroke="none"/></g>
      <g id="i-power" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="4.6" y="8" width="10.8" height="7.4" rx="2.2"/><path d="M7.4 8V4.5M12.6 8V4.5M10 15.4v2.6"/></g>
      <g id="i-ac" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M10 2.8v14.4M3.8 6.4l12.4 7.2M16.2 6.4 3.8 13.6"/><path d="M8.1 4.5 10 2.8l1.9 1.7M8.1 15.5 10 17.2l1.9-1.7M4.1 9.2l-.6-2.4 2.4-.6M15.9 10.8l.6 2.4-2.4.6M5.9 13.8l-2.4.6.6 2.4M14.1 6.2l2.4-.6-.6-2.4"/></g>
      <g id="i-wc"><path d="M5.5 2.9h2.6v5h7.1v1.5a6.6 6.6 0 0 1-3.7 5.9l.9 2.5H7.6l.9-2.5a6.6 6.6 0 0 1-3.7-5.9V7.9h.7Z" fill="currentColor"/></g>
      <g id="i-bike" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="5.3" cy="13.2" r="3.7"/><circle cx="14.7" cy="13.2" r="3.7"/><path d="m5.3 13.2 4-6.5h3.5l1.9 6.5M8.4 6.7h3.2M12.8 6.7l1.4-2.5"/></g>
      <g id="i-wheelchair" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="11.5" cy="3.7" r="1.8" fill="currentColor" stroke="none"/><path d="M10.6 6.9v4.4h4.1l2 4.9"/><circle cx="9.2" cy="12.6" r="4.9"/></g>
      <g id="i-pram" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M16.4 10.6H4.5a6 6 0 0 1 11.9 0Z" fill="currentColor" stroke="none"/><path d="M16.4 10.6v-8M4.5 10.6h11.9M6.5 10.6 4.8 14.6M14.4 10.6l1.7 4"/><circle cx="4.4" cy="16.2" r="1.6"/><circle cx="15.6" cy="16.2" r="1.6"/></g>
      <g id="i-camera" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><rect x="2.7" y="6.4" width="10.6" height="7.6" rx="2.2"/><path d="m13.3 9.1 4-2.3v6.7l-4-2.3Z" fill="currentColor" stroke="none"/></g>
      <g id="i-dining" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5.2 2.8v5.4a2 2 0 0 0 4 0V2.8M7.2 2.8v5.6M7.2 10.2v7"/><path d="M14.6 2.8c-1.5 1.2-2.2 3-2.2 5.1 0 1.4.6 2.3 2.2 2.3Z" fill="currentColor" stroke="none"/><path d="M14.6 2.8v14.4"/></g>
      <g id="i-plug" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6.6 2.6v4.2M13.4 2.6v4.2"/><path d="M4.4 6.8h11.2v3.1a5.6 5.6 0 0 1-11.2 0Z"/><path d="M10 15.5v2.1"/></g>
      <g id="i-screen" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2.6" y="3.4" width="14.8" height="10.4" rx="2"/><path d="M7 17.2h6"/><path d="m8.6 6.9 3.9 2.1-3.9 2.1Z" fill="currentColor" stroke="none"/></g>
      <g id="i-service" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2.6 14.6h14.8"/><path d="M4.4 14.6a5.6 5.6 0 0 1 11.2 0" fill="currentColor" stroke="none"/><path d="M10 6.5V4.2"/><circle cx="10" cy="3.1" r="1.2" fill="currentColor" stroke="none"/></g>
      <g id="i-seat"><rect x="3.6" y="2.6" width="3.6" height="9.8" rx="1.8" fill="currentColor"/><rect x="3.6" y="10.4" width="12.4" height="3.6" rx="1.8" fill="currentColor"/><path d="M14.6 13.6v3.6M5.4 13.6v3.6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/></g>

      {/* ---- vehicle silhouettes (§6.5), the fallback for a vehicle vagonweb has no
              drawing for. Not 20×20: vagonweb's own canvas sizes, 264×40 for a coach and
              190×58 for a locomotive, so a fallback occupies exactly the box the drawing
              would have and a missing drawing does not change the length of the train. */}
      <g id="c-coach">
        <rect x="2.5" y="1.2" width="259" height="32" rx="5" fill="var(--body,#e8ecf3)" stroke="currentColor" strokeWidth="1.6"/>
        <path d="M22 32.8V2M242 32.8V2" stroke="currentColor" strokeWidth="1.2" opacity=".5"/>
        <g fill="#fff" stroke="currentColor" strokeWidth="1.1" opacity=".85">
          <rect x="33" y="7.5" width="17" height="13" rx="2"/><rect x="56" y="7.5" width="17" height="13" rx="2"/>
          <rect x="79" y="7.5" width="17" height="13" rx="2"/><rect x="102" y="7.5" width="17" height="13" rx="2"/>
          <rect x="125" y="7.5" width="17" height="13" rx="2"/><rect x="148" y="7.5" width="17" height="13" rx="2"/>
          <rect x="171" y="7.5" width="17" height="13" rx="2"/><rect x="194" y="7.5" width="17" height="13" rx="2"/>
          <rect x="217" y="7.5" width="17" height="13" rx="2"/>
        </g>
        <path d="M8 33.4h248" stroke="currentColor" strokeWidth="1.6"/>
        <g fill="currentColor" opacity=".8"><circle cx="42" cy="36.7" r="3.1"/><circle cx="60" cy="36.7" r="3.1"/><circle cx="204" cy="36.7" r="3.1"/><circle cx="222" cy="36.7" r="3.1"/></g>
      </g>
      <g id="c-loco">
        <path d="M8 46V14l16-9h157a6 6 0 0 1 6 6v35Z" fill="var(--body,#dfe6f0)" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
        <path d="M30 10h21v11H21Z" fill="#fff" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
        <rect x="62" y="12" width="112" height="9" rx="3" fill="#fff" stroke="currentColor" strokeWidth="1.3"/>
        <path d="M8 46.4h179" stroke="currentColor" strokeWidth="1.7"/>
        <g fill="currentColor" opacity=".8"><circle cx="40" cy="51" r="5"/><circle cx="59" cy="51" r="5"/><circle cx="136" cy="51" r="5"/><circle cx="155" cy="51" r="5"/></g>
      </g>
    </defs></svg>
  );
}

/** One icon, always from the sprite, always block-level. */
export function Icon({ id, size = 17, className, style }: {
  id: string; size?: number; className?: string; style?: React.CSSProperties;
}) {
  return (
    <svg className={`ic${className ? ' ' + className : ''}`} width={size} height={size}
         viewBox="0 0 20 20" style={style} aria-hidden="true">
      <use href={`#${id}`} />
    </svg>
  );
}

/** The hop arrow inside a monospace technical string: 12 px, vertical-align -2px,
 *  opacity .75. ASCII "->" inherits the mono font's metrics and sits visibly off
 *  centre, so it gets an SVG too (SPEC.md §10, CLAUDE.md). */
export function HopArrow() {
  return (
    <span className="hop">
      <svg className="ic" width="12" height="12" viewBox="0 0 20 20" aria-hidden="true"
           style={{ display: 'inline-block' }}>
        <use href="#i-arrow" />
      </svg>
    </span>
  );
}
