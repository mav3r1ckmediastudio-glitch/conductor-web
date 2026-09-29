// forestryHeights.js — a TYPICAL (assumed, not measured) canopy height per
// National Forest Inventory stand type, used only where no real DSM/DTM
// height is available (see wirelessTerrainTiles.js — Conductor has no DSM
// ingestion today, so this is the only height source there is for now).
//
// Every value here is a planning estimate for a mature stand of that type,
// not a measurement. Callers must not present it as measured data (Core
// principle #2, CLAUDE.md): the map layer that renders this marks these
// stands as assumed, distinctly from anything derived from real terrain data.
//
// Source: NFI's own IFT_IOA (Interpreted Forest Type / Interpretation of
// Aerial photography) attribute. Values grouped for a simple, honest legend
// rather than one entry per IFT_IOA string.

/** IFT_IOA -> broad group. Anything absent from this table is 'Other'. */
export const IFT_GROUP = Object.freeze({
  'Conifer': 'Conifer', 'Mixed mainly conifer': 'Conifer',
  'Broadleaved': 'Broadleaved', 'Mixed mainly broadleaved': 'Broadleaved',
  'Coppice': 'Broadleaved', 'Coppice with standards': 'Broadleaved',
  'Young trees': 'Young trees',
  'Assumed woodland': 'Assumed woodland',
  'Felled': 'Cleared', 'Windblow': 'Cleared', 'Ground prep': 'Cleared', 'Failed': 'Cleared',
});

/** Typical mature canopy height (m) per group. Zero = no standing canopy to model. */
export const GROUP_HEIGHT_M = Object.freeze({
  Conifer: 20, Broadleaved: 16, 'Young trees': 4, 'Assumed woodland': 12,
  Cleared: 0, Other: 0,
});

/**
 * @param iftIoa   the stand's IFT_IOA attribute value (any case/whitespace)
 * @param category the stand's CATEGORY attribute ('Woodland' / 'Non woodland'), optional
 * @returns {{ group: string, heightM: number }} heightM is always a typical
 *   value, never a measurement — see module note above.
 */
export function typicalCanopy(iftIoa, category) {
  if (category && String(category).trim().toLowerCase() !== 'woodland') return { group: 'Other', heightM: 0 };
  const key = String(iftIoa ?? '').trim();
  const group = IFT_GROUP[key] ?? 'Other';
  return { group, heightM: GROUP_HEIGHT_M[group] ?? 0 };
}
