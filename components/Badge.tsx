'use client';

import { useEffect, useState } from 'react';
import { hasGlyph } from '@/lib/mnr-coverage';

/** The MNR2007 pictogram, in all three places it appears: hover card header, panel
 *  header, search rows. One component, so they cannot drift.
 *
 *  Two independent fallbacks (SPEC 2, SPEC 10 #14):
 *   - the FONT failed to load, which document.fonts.check() can see: a blank chip in the
 *     type colour with no text. There is deliberately no category-to-abbreviation table,
 *     and a blank badge is itself a visible sign the font did not load.
 *   - the GLYPH is missing, which it cannot see, because the font loads and the codepoint
 *     still renders .notdef. Checked against the font's own build-time coverage instead. */

let fontState: 'unknown' | 'ok' | 'missing' = 'unknown';

export function useMnrLoaded() {
  const [state, setState] = useState(fontState);
  useEffect(() => {
    let live = true;
    // document.fonts is the external system this subscribes to; the answer is cached in
    // a module variable so every badge asks once.
    document.fonts.ready.then(() => {
      if (fontState === 'unknown') {
        fontState = document.fonts.check('16px MNR2007') ? 'ok' : 'missing';
        if (fontState === 'missing') console.error('[MNR2007] font failed to load');
      }
      if (live) setState(fontState);
    });
    return () => { live = false; };
  }, []);
  return state !== 'missing';
}

export function RouteBadge({ fontCode, typeColor, size = 23 }: {
  fontCode: number; typeColor: string; size?: number;
}) {
  const loaded = useMnrLoaded();
  const drawable = loaded && hasGlyph(fontCode);
  const style = { ['--type' as string]: typeColor } as React.CSSProperties;
  if (!drawable) {
    // a blank chip in the type colour, deliberately with no text
    return <span className="badge blank" style={style} aria-hidden="true" />;
  }
  return (
    <span className="badge pict" style={style}>
      <span className="mnr" style={{ fontSize: size }}>{String.fromCharCode(fontCode)}</span>
    </span>
  );
}

/** An info service's pictogram. Here the fallback is to render NO pictogram and keep the
 *  text: a blank chip beside a service name would be meaningless. */
export function InfoPictogram({ fontCode }: { fontCode: number }) {
  const loaded = useMnrLoaded();
  if (!loaded || !hasGlyph(fontCode)) return null;
  return <span className="mnr">{String.fromCharCode(fontCode)}</span>;
}
