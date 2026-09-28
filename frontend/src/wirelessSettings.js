// wirelessSettings.js
// Project-level wireless engineering thresholds. These are DEFAULTS, not
// authoritative engineering rules — they are stored in the project (so they are
// visible, editable and fingerprinted) and must be confirmed by a qualified
// wireless engineer before a design is relied on.

export const DEFAULT_WIRELESS_SETTINGS = Object.freeze({
  kFactor: 4 / 3,                 // effective earth radius factor (standard atmosphere)
  minFresnelClearancePct: 60,     // required clearance of the 1st Fresnel zone, % of radius
  minFadeMarginDb: 15,            // required fade margin per direction
  coverageMarginDb: 10,           // a premises counts as covered at >= this many dB above the CPE minimum Rx
  profileStepM: 25,               // ground spacing of terrain samples along a link
  terrainZoom: 12,                // Terrain-RGB tile zoom used for sampling
  terrainSourceId: 'maptiler-terrain-rgb-v2',
});

const RANGES = {
  kFactor:                [0.5, 3],
  minFresnelClearancePct: [0, 200],
  minFadeMarginDb:        [0, 60],
  coverageMarginDb:       [0, 40],
  profileStepM:           [5, 200],
  terrainZoom:            [8, 14],
};

/** Merge user settings over defaults, dropping anything invalid back to default. */
export function resolveWirelessSettings(raw) {
  const out = { ...DEFAULT_WIRELESS_SETTINGS };
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, [lo, hi]] of Object.entries(RANGES)) {
    const v = Number(raw[k]);
    if (raw[k] !== '' && raw[k] != null && Number.isFinite(v) && v >= lo && v <= hi) out[k] = v;
  }
  if (typeof raw.terrainSourceId === 'string' && raw.terrainSourceId) out.terrainSourceId = raw.terrainSourceId;
  return out;
}
