// wirelessProfile.js
// Pure path-profile analysis: terrain along a link + earth curvature + first
// Fresnel zone clearance. Terrain access is injected (TerrainSource.sample).
//
// FAIL-CLOSED: any unknown terrain height (null) downgrades status to PARTIAL
// or NO_TERRAIN. A profile with missing data never reports a clearance verdict
// that could be read as a pass.

import { interpolatePath, groundDistanceM } from './wirelessGeo.js';

const R_EARTH_M = 6371000;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Earth bulge (m) at d1 km from one end and d2 km from the other, for k-factor k. */
export function earthBulgeM(d1Km, d2Km, k) {
  return (d1Km * 1000 * d2Km * 1000) / (2 * k * R_EARTH_M);
}

/** First Fresnel zone radius (m). Distances in km, frequency in GHz. */
export function fresnelRadiusM(d1Km, d2Km, freqGHz) {
  const D = d1Km + d2Km;
  if (!(D > 0) || !(freqGHz > 0)) return 0;
  return 17.32 * Math.sqrt((d1Km * d2Km) / (freqGHz * D));
}

/**
 * @param terrain  TerrainSource ({ sample(lng,lat) -> metres|null })
 * @param a,b      { lng, lat, antennaAglM, groundM? }  groundM overrides terrain at that end
 * @param opts     { freqGHz, kFactor, stepM }
 * @returns {{
 *   status: 'OK'|'PARTIAL'|'NO_TERRAIN', distanceKm:number,
 *   samples: Array<{dKm,groundM,bulgeM,losM,f1M,clearanceM,clearancePct}>,
 *   worst: {clearancePct:number, clearanceM:number, atKm:number}|null,
 *   missingSamples:number, endpointGroundM:{a:number|null,b:number|null},
 *   params:{stepM:number,kFactor:number,freqGHz:number}
 * }}
 */
export function buildProfile(terrain, a, b, opts) {
  const { freqGHz, kFactor, stepM } = opts;
  if (!(freqGHz > 0) || !(kFactor > 0) || !(stepM > 0)) throw new RangeError('freqGHz, kFactor and stepM must be > 0');
  for (const e of [a, b]) if (!isNum(e.antennaAglM) || e.antennaAglM < 0) throw new RangeError('antennaAglM must be a finite number >= 0');

  const distM = groundDistanceM(a, b);
  if (!(distM > 0)) throw new RangeError('link endpoints coincide');
  // Guarantee at least one interior sample so a very short link still gets a
  // clearance figure rather than an empty (and therefore unverifiable) profile.
  const effStepM = Math.min(stepM, distM / 2);
  const path = interpolatePath(a, b, effStepM);
  const distanceKm = distM / 1000;
  const heights = path.map(p => terrain.sample(p.lng, p.lat));
  const n = path.length;

  const gA = isNum(a.groundM) ? a.groundM : heights[0];
  const gB = isNum(b.groundM) ? b.groundM : heights[n - 1];
  heights[0] = gA;
  heights[n - 1] = gB;
  const missing = heights.reduce((c, h) => c + (h == null ? 1 : 0), 0);
  const params = { stepM: effStepM, kFactor, freqGHz };
  const base = { distanceKm, missingSamples: missing, endpointGroundM: { a: gA ?? null, b: gB ?? null }, params };

  if (missing === n || gA == null || gB == null) {
    return { ...base, status: 'NO_TERRAIN', samples: [], worst: null };
  }

  const hA = gA + a.antennaAglM, hB = gB + b.antennaAglM;
  const samples = [];
  let worst = null;
  for (let i = 0; i < n; i++) {
    const dKm = path[i].dM / 1000;
    const g = heights[i];
    if (g == null) { samples.push({ dKm, groundM: null, bulgeM: null, losM: null, f1M: null, clearanceM: null, clearancePct: null }); continue; }
    const d2Km = distanceKm - dKm;
    const bulgeM = earthBulgeM(dKm, d2Km, kFactor);
    const losM = distanceKm > 0 ? hA + (hB - hA) * (dKm / distanceKm) : hA;
    const f1M = fresnelRadiusM(dKm, d2Km, freqGHz);
    const interior = i > 0 && i < n - 1;
    const clearanceM = interior ? losM - (g + bulgeM) : null;
    const clearancePct = interior && f1M > 0 ? (clearanceM / f1M) * 100 : null;
    samples.push({ dKm, groundM: g, bulgeM, losM, f1M, clearanceM, clearancePct });
    if (clearancePct != null && (worst == null || clearancePct < worst.clearancePct)) {
      worst = { clearancePct, clearanceM, atKm: dKm };
    }
  }
  return { ...base, status: missing > 0 ? 'PARTIAL' : 'OK', samples, worst };
}
