// wirelessSettings.js
// Project-level wireless engineering thresholds. These are DEFAULTS, not
// authoritative engineering rules — they are stored in the project (so they are
// visible, editable and fingerprinted) and must be confirmed by a qualified
// wireless engineer before a design is relied on.

export const DEFAULT_WIRELESS_SETTINGS = Object.freeze({
  kFactor: 4 / 3,                 // effective earth radius factor (standard atmosphere)
  minFresnelClearancePct: 60,     // required clearance of the 1st Fresnel zone, % of radius
  minFadeMarginDb: 15,            // required fade margin per direction, for links below rainAssessAboveGhz
  coverageMarginDb: 10,           // a premises counts as covered at >= this many dB above the CPE minimum Rx
  profileStepM: 25,               // ground spacing of terrain samples along a link
  terrainZoom: 12,                // Terrain-RGB tile zoom used for sampling
  terrainSourceId: 'maptiler-terrain-rgb-v2',

  // ── Radio input plausibility limits ──────────────────────────────────────
  // Typical UK fixed-wireless figures, used to catch typos and unit mistakes
  // (e.g. 300 dBi entered for 30). A value outside these makes the link or
  // sector fail rather than produce an impossible link budget. They are NOT
  // regulatory limits (Ofcom EIRP / licence conditions are not checked).
  freqMinGhz: 0.4,                // below UHF PtP use
  freqMaxGhz: 90,                 // covers E-band (71-86 GHz)
  txPowerMinDbm: -10,
  txPowerMaxDbm: 40,
  gainMinDbi: 0,
  gainMaxDbi: 50,                 // large PtP dishes are ~40-45 dBi
  rxSensMinDbm: -110,             // better sensitivity than this is not real-world
  rxSensMaxDbm: -20,
  maxLossDb: 100,                 // ceiling for cable/connector and extra path loss
  // Above this frequency, atmospheric (oxygen/water) absorption is significant
  // (~15 dB/km around 60 GHz) and the free-space model does not include it:
  // links must carry an explicit extra-loss allowance or they fail.
  absorptionAboveGhz: 50,
  // Gaseous (oxygen + water vapour) absorption per ITU-R P.676-12, applied to
  // every link and coverage ray at that frequency's own dB/km (see
  // wirelessGas.js). gasModel 0 switches it off, after which frequencies above
  // absorptionAboveGhz need an explicit extra-loss allowance again. The
  // defaults are the ITU standard atmosphere; wet Scottish air is close to it.
  gasModel: 1,
  gasTemperatureC: 15,
  gasWaterVapourGm3: 7.5,
  // Rain (ITU-R P.838 / P.530, see wirelessRain.js). At and above
  // rainAssessAboveGhz a link is judged on how often rain would take it below
  // its receiver sensitivity, not on a flat fade margin: it must reach
  // minAvailabilityPct at the site's 0.01%-of-time rain rate, and still have
  // minClearSkyMarginDb in clear weather (alignment, ageing, mount sway).
  // rainRate001Mmh is the ITU-R P.837-7 value for Loch Tay (27-30 mm/h at the
  // three project sites); change it for anywhere else.
  rainAssessAboveGhz: 10,
  rainRate001Mmh: 30,
  minAvailabilityPct: 99.9,
  minClearSkyMarginDb: 6,
});

import { gaseousAttenuationDbPerKm } from './wirelessGas.js';

const RANGES = {
  kFactor:                [0.5, 3],
  minFresnelClearancePct: [0, 200],
  minFadeMarginDb:        [0, 60],
  coverageMarginDb:       [0, 40],
  profileStepM:           [5, 200],
  terrainZoom:            [8, 14],
  freqMinGhz:             [0.1, 100],
  freqMaxGhz:             [1, 300],
  txPowerMinDbm:          [-40, 20],
  txPowerMaxDbm:          [0, 60],
  gainMinDbi:             [-20, 20],
  gainMaxDbi:             [10, 70],
  rxSensMinDbm:           [-150, -60],
  rxSensMaxDbm:           [-80, 0],
  maxLossDb:              [1, 300],
  absorptionAboveGhz:     [1, 300],
  rainAssessAboveGhz:     [1, 100],
  rainRate001Mmh:         [1, 200],
  minAvailabilityPct:     [99, 99.999],
  minClearSkyMarginDb:    [0, 40],
  gasModel:               [0, 1],
  gasTemperatureC:        [-40, 50],
  gasWaterVapourGm3:      [0, 30],
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

/** True when this frequency's gaseous absorption is modelled (so no manual allowance is needed). */
export function absorptionModelled(freqGHz, settings) {
  const s = settings || DEFAULT_WIRELESS_SETTINGS;
  return s.gasModel >= 0.5 && freqGHz > 0 && freqGHz <= 1000;
}

/** Gaseous absorption at this frequency in dB per km of path (0 when the model is switched off). */
export function atmosLossDbPerKm(freqGHz, settings) {
  const s = settings || DEFAULT_WIRELESS_SETTINGS;
  if (!absorptionModelled(freqGHz, s)) return 0;
  return gaseousAttenuationDbPerKm(freqGHz, { temperatureC: s.gasTemperatureC, waterVapourGm3: s.gasWaterVapourGm3 });
}
