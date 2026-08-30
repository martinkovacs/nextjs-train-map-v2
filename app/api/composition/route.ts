import { NextResponse } from 'next/server';
import { fetchComposition, nameMatches, type TrainKey } from '@/lib/vagonweb';
import { isOurs, parseCompositionPage } from '@/lib/vw-parse';

/**
 * The carriage composition, one record per train per day.
 *
 * The four parameters are exactly the inputs vlak.php takes, passed through unchanged,
 * which is also the cache key: four parameters rather than one composite key, so the
 * handler cannot assemble the wrong record. `kategorie` is optional and omitted when
 * unmapped, which is vagonweb.md's degrade path and not an error.
 *
 * A FIFTH parameter, `nazev`, is a CHECKSUM and never a request input: it is never put on
 * the vlak.php URL (a wrong nazev returns the shell) and is not part of the cache key, so
 * it cannot split one record into two entries. It exists for the verify-do-not-trust
 * check below and for pickFromSearch's name tiers.
 */
export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const key: TrainKey = {
    zeme: p.get('zeme') ?? '',
    kategorie: p.get('kategorie'),
    cislo: p.get('cislo') ?? '',
    nazev: p.get('nazev') ?? '',
    rok: p.get('rok') || String(new Date().getFullYear()),
  };
  if (!key.zeme || !key.cislo) {
    return NextResponse.json(
      { failure: '#16', detail: 'zeme and cislo are required', where: 'vlak.php' },
      { status: 400 },
    );
  }

  const got = await fetchComposition(key);

  if (!got.ok) {
    console.error('[composition] vagonweb failed', got);
    return NextResponse.json(
      { failure: '#16', detail: got.reason, where: got.where, url: got.url },
      { status: got.status ?? 504 },
    );
  }
  if (!got.found) {
    // A normal answer, not a failure, and it must never render as one.
    return NextResponse.json({ found: false, url: got.url }, {
      headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=86400' },
    });
  }

  const parsed = parseCompositionPage(got.html, key.zeme);
  // Verify, do not trust: drop any block whose number or name is not ours, insurance
  // against a dropped kategorie or a loose name match.
  const ours = (record: string) => isOurs(record, key.cislo, (n) => nameMatches(n, key.nazev));
  const windows = parsed.windows.filter((w) => ours(w.record));
  const days = parsed.days.filter((d) => ours(d.record)).slice(0, 3);

  return NextResponse.json({
    found: true,
    url: got.url,
    via: got.via,
    windows,
    days,
    plannedCount: parsed.plannedCount,
    reportedCount: parsed.reportedCount,
  }, {
    headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=86400' },
  });
}
