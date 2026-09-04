import { NextResponse } from 'next/server';
import { proxyGet } from '@/lib/proxy';
import { keptOperator, parseSearchRows, searchUrl, VW_HEADERS, VW_TIMEOUT_MS } from '@/lib/vagonweb';

/**
 * The second source in the search field. razeni.php needs NO Referer, unlike vlak.php,
 * which is what makes it usable behind a search field at all. The Czech HTML is parsed
 * here and never reaches the browser.
 *
 * The request itself goes through the VPS proxy, like every other call out of this app:
 * vagonweb blocks the datacentre ranges this deploys into. `where` still names
 * razeni.php, because that is the hop that failed as far as anyone reading it cares.
 *
 * Page 1 only, never `&s=2`: `jmeno=1` returns 150 rows on page 1 and offers six pages,
 * which is far more than any result list should draw. The query goes upstream AS TYPED
 * (SPEC 1): vagonweb folds accented vowels but not Czech carons, so folding would be
 * invisible on Hungarian names and would silently empty the list on Czech and Slovak ones.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const jmeno = params.get('jmeno') ?? '';
  const rok = params.get('rok') || String(new Date().getFullYear());
  if (jmeno.trim().length < 2) return NextResponse.json({ rows: [], more: 0 });

  const url = searchUrl(rok, jmeno);
  let res: Response;
  try {
    res = await proxyGet(url, VW_HEADERS, VW_TIMEOUT_MS);
  } catch (e) {
    const err = e as Error;
    const detail = err.name === 'TimeoutError' || err.name === 'AbortError'
      ? 'aborted after 0:10' : `${err.name} ${err.message}`;
    console.error('[vw-search] request failed', { url, detail });
    return NextResponse.json({ failure: '#15', detail, where: 'razeni.php' }, { status: 504 });
  }
  if (!res.ok) {
    console.error('[vw-search] upstream error', { url, status: res.status });
    return NextResponse.json(
      { failure: '#15', detail: `${res.status} ${res.statusText}`, where: 'razeni.php' },
      { status: res.status },
    );
  }

  const all = parseSearchRows(await res.text());
  // Keep MÁV, GySEV, ÖBB and RegioJet (both codes) and drop everything else SILENTLY:
  // a dropped row is not a result and is not counted at the user.
  const rows = all.filter((r) => keptOperator(r.zeme));

  return NextResponse.json({ rows, more: 0 }, {
    headers: { 'Cache-Control': 'public, s-maxage=86400' },
  });
}
