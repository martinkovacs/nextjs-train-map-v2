/** The app's ONLY folding function (SPEC.md §4), used by the search index and the
 *  vagonweb operator filter alike. An explicit map, not NFD: `ő`/`ű` decompose
 *  inconsistently and this is length-preserving, which the <mark> highlighter depends on.
 *  Extend ACCENTS with whatever letters the operator allow list meets. */
const ACCENTS: Record<string, string> = {
  'á':'a','é':'e','í':'i','ó':'o','ö':'o','ő':'o','ú':'u','ü':'u','ű':'u',
  'Á':'a','É':'e','Í':'i','Ó':'o','Ö':'o','Ő':'o','Ú':'u','Ü':'u','Ű':'u',
};
const ACCENT_RE = new RegExp(`[${Object.keys(ACCENTS).join('')}]`, 'g');

export const fold = (s: string) =>
  s.toLowerCase().replace(ACCENT_RE, (m) => ACCENTS[m] ?? m);
