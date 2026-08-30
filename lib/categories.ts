/** trainCategoryName -> vagonweb's category code (plan/vagonweb.md), each row confirmed
 *  against the info_vlak vagonweb returns for a real train of that category. Shared, so
 *  the card and the route handler cannot disagree about which record they are asking for.
 *  An unmapped value must not throw: `kategorie` is dropped and vagonweb picks its own
 *  default, which lands on the search fallback. */
export const VW_CATEGORY: Record<string, string> = {
  'InterCity': 'IC', 'InterRégió': 'IR', 'Expresszvonat': 'Ex',
  'EuroCity': 'EC', 'EuroRegio': 'ER', 'railjet': 'RJ',
  'railjet xpress': 'RJX', 'sebesvonat': 'S', 'személyvonat': 'Sz',
  'EuroNight': 'EN',
};

export const categoryCode = (trainCategoryName: string): string | null =>
  VW_CATEGORY[trainCategoryName] ?? null;
