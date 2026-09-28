// wirelessAim.js — suggest a sector azimuth from the project's premises.
//
// Pure and deterministic. Counts address points within the sector's range and
// inside its beam for every candidate bearing (5-degree steps) and returns the
// bearing that serves the most premises not already inside another sector on
// the same site, centred on them (ties: smallest off-axis total, then smaller bearing). It is a starting point: the
// designer can overwrite it, and the coverage estimate is the real check.

import { bearingDeg, groundDistanceM } from './wirelessGeo.js';
import { angleDiffDeg } from './wirelessViewshedCore.js';

const STEP_DEG = 5;

/**
 * @param site        { lng, lat }
 * @param premises    GeoJSON point features (store.addressPoints)
 * @param opts        { rangeM, beamwidthDeg, existing: [{ azimuthDeg, beamwidthDeg, rangeM }] }
 * @returns {{ azimuthDeg:number|null, count:number, inRange:number }}
 *   azimuthDeg is null when no uncovered premises are within range.
 */
export function suggestAzimuth(site, premises, { rangeM, beamwidthDeg, existing = [] } = {}) {
  if (!(rangeM > 0) || !(beamwidthDeg > 0)) return { azimuthDeg: null, count: 0, inRange: 0 };
  const half = beamwidthDeg / 2;
  const candidates = [];
  for (const f of premises || []) {
    const c = f?.geometry?.coordinates;
    if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    const p = { lng: c[0], lat: c[1] };
    const d = groundDistanceM(site, p);
    if (!(d > 0) || d > rangeM) continue;
    const b = bearingDeg(site, p);
    const covered = existing.some(e => Number.isFinite(e.azimuthDeg) && d <= (e.rangeM ?? rangeM)
      && angleDiffDeg(b, e.azimuthDeg) <= (e.beamwidthDeg ?? beamwidthDeg) / 2);
    if (!covered) candidates.push(b);
  }
  // Most premises first; among equal counts, the bearing that puts them nearest
  // boresight (smallest total off-axis angle), i.e. the beam is centred on
  // them rather than grazing them with its edge. Then the smaller bearing.
  let best = null, bestCount = 0, bestOff = Infinity;
  for (let az = 0; az < 360; az += STEP_DEG) {
    let n = 0, off = 0;
    for (const b of candidates) { const a = angleDiffDeg(b, az); if (a <= half) { n++; off += a; } }
    if (n > bestCount || (n === bestCount && n > 0 && off < bestOff - 1e-9)) { bestCount = n; bestOff = off; best = az; }
  }
  return { azimuthDeg: best, count: bestCount, inRange: candidates.length };
}
