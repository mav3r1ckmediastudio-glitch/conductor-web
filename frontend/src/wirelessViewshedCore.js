// wirelessViewshedCore.js
// Pure coverage estimate for one sector: radial-sweep viewshed over a DEM grid
// with earth curvature, single dominant knife-edge diffraction and a sector
// antenna pattern. Deterministic, no DOM, no network — safe to run in a Worker
// and to unit-test directly.
//
// THIS IS AN ESTIMATE. Simplifications a wireless engineer must know about:
//   * Bare DEM only: no trees, buildings or other clutter.
//   * Horizontal antenna pattern only (3GPP-style parabolic); no vertical
//     pattern or downtilt.
//   * One dominant knife-edge (highest elevation angle along the ray), not
//     Deygout/Epstein-Peterson multiple-edge diffraction.
//   * Free-space loss + diffraction only: no rain, foliage or atmospheric loss.
//   * Local isotropic scale: metres-per-pixel taken at the site latitude.
// Unknown terrain (NaN) truncates a ray: everything beyond it is "no data",
// never "covered".

import { lngLatToGlobalPixel } from './wirelessTerrain.js';

const R_EARTH_M = 6371000;
const EQUATOR_M = 40075016.686;

/** Ground metres per Terrain-RGB pixel at a latitude and zoom (256 px tiles). */
export function metresPerPixel(latDeg, z) {
  return (EQUATOR_M * Math.cos((latDeg * Math.PI) / 180)) / (256 * 2 ** z);
}

/** Single knife-edge diffraction loss J(v), dB (ITU-R P.526 approximation). */
export function knifeEdgeLossDb(v) {
  if (!(v > -0.78)) return 0;
  const t = v - 0.1;
  return 6.9 + 20 * Math.log10(Math.sqrt(t * t + 1) + t);
}

/** Smallest absolute angular difference between two compass bearings, degrees [0,180]. */
export function angleDiffDeg(a, b) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

/**
 * Sector pattern loss (dB, >= 0) at `offDeg` from boresight for a 3 dB
 * beamwidth `bwDeg`: 12*(off/bw)^2, capped at the front-to-back ratio.
 */
export function sectorPatternLossDb(offDeg, bwDeg, frontToBackDb = 25) {
  return Math.min(12 * (offDeg / bwDeg) ** 2, frontToBackDb);
}

function bilinear(dem, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= dem.w || y0 + 1 >= dem.h) return NaN;
  const tx = x - x0, ty = y - y0, w = dem.w, d = dem.data;
  const h00 = d[y0 * w + x0], h10 = d[y0 * w + x0 + 1], h01 = d[(y0 + 1) * w + x0], h11 = d[(y0 + 1) * w + x0 + 1];
  return (h00 * (1 - tx) + h10 * tx) * (1 - ty) + (h01 * (1 - tx) + h11 * tx) * ty;   // NaN propagates
}

/**
 * @param p.site    { lng, lat, groundM, antennaAglM }
 * @param p.sector  { azimuthDeg, beamwidthDeg, txPowerDbm, gainDbi, cableLossDb?, freqGHz, cpeHeightM, cpeGainDbi, frontToBackDb? }
 * @param p.radiusM analysis radius
 * @param p.dem     { z, gxMin, gyMin, w, h, data:Float32Array } heights in metres, NaN = no data
 * @param p.kFactor effective earth radius factor
 * @returns {{ z, gxMin, gyMin, w, h, rxDbm:Float32Array, visibleCells:number, metresPerPixel:number }}
 *   rxDbm is NaN where there is no data / not reached; cell (i,j) is global pixel (gxMin+i, gyMin+j)
 */
export function computeSectorCoverage(p) {
  const { site, sector, radiusM, dem, kFactor } = p;
  const mpp = metresPerPixel(site.lat, dem.z);
  const radiusPx = Math.min(Math.floor(radiusM / mpp), 2000);
  const { x: sgx, y: sgy } = lngLatToGlobalPixel(site.lng, site.lat, dem.z);
  const sx = sgx - dem.gxMin, sy = sgy - dem.gyMin;   // site position inside the grid

  const out = new Float32Array(dem.w * dem.h).fill(NaN);
  const txH = site.groundM + site.antennaAglM;
  const lambda = 0.299792458 / sector.freqGHz;
  const eirp = sector.txPowerDbm + sector.gainDbi - (sector.cableLossDb ?? 0);
  const fb = sector.frontToBackDb ?? 25;
  const curv = 1 / (2 * kFactor * R_EARTH_M);
  const nRays = Math.max(360, Math.ceil(2 * Math.PI * radiusPx * 1.5));
  let painted = 0;

  for (let r = 0; r < nRays; r++) {
    const az = (r / nRays) * 360;
    const rad = (az * Math.PI) / 180;
    const dx = Math.sin(rad), dy = -Math.cos(rad);        // north is -y in pixel space
    const patternLoss = sectorPatternLossDb(angleDiffDeg(az, sector.azimuthDeg), sector.beamwidthDeg, fb);

    let maxAng = -Infinity, obsD = 0, obsH = 0;            // dominant obstacle so far (ground-level)
    for (let s = 1; s <= radiusPx; s++) {
      const px = sx + s * dx, py = sy + s * dy;
      const g = bilinear(dem, px, py);
      if (Number.isNaN(g)) break;                           // unknown terrain: stop, never assume
      const d = s * mpp;
      // Earth curvature in the transmitter's tangent-plane frame: the ground
      // FALLS AWAY from the transmitter by d^2 / (2kR). (Adding it instead
      // raises distant terrain and removes the radio horizon entirely.)
      const drop = d * d * curv;

      // Received power at a CPE standing here.
      const rxTop = g + sector.cpeHeightM - drop;
      let diffLoss = 0;
      if (obsD > 0) {
        const los = txH + (rxTop - txH) * (obsD / d);
        const hObs = obsH - los;
        const d1 = obsD, d2 = d - obsD;
        if (d2 > 0) diffLoss = knifeEdgeLossDb(hObs * Math.sqrt((2 * (d1 + d2)) / (lambda * d1 * d2)));
      }
      const fspl = 92.45 + 20 * Math.log10(sector.freqGHz) + 20 * Math.log10(d / 1000);
      const rx = eirp - fspl - diffLoss - patternLoss + sector.cpeGainDbi;
      const ix = Math.round(px), iy = Math.round(py);
      if (ix >= 0 && iy >= 0 && ix < dem.w && iy < dem.h) {
        const idx = iy * dem.w + ix;
        if (!(out[idx] >= rx)) { if (Number.isNaN(out[idx])) painted++; out[idx] = rx; }
      }

      // The ground here may block cells further out (ground level, not CPE height).
      const hEff = g - drop;
      const ang = (hEff - txH) / d;
      if (ang > maxAng) { maxAng = ang; obsD = d; obsH = hEff; }
    }
  }
  return { z: dem.z, gxMin: dem.gxMin, gyMin: dem.gyMin, w: dem.w, h: dem.h, rxDbm: out, visibleCells: painted, metresPerPixel: mpp };
}

/** Per-cell maximum across sector results (best server). Grids must share geometry. */
export function combineBestServer(grids) {
  if (!grids.length) return null;
  const first = grids[0];
  const out = new Float32Array(first.rxDbm.length).fill(NaN);
  for (const g of grids) {
    if (g.w !== first.w || g.h !== first.h || g.gxMin !== first.gxMin || g.gyMin !== first.gyMin || g.z !== first.z) {
      throw new Error('combineBestServer: grids do not share geometry');
    }
    for (let i = 0; i < out.length; i++) {
      const v = g.rxDbm[i];
      if (!Number.isNaN(v) && !(out[i] >= v)) out[i] = v;
    }
  }
  return { ...first, rxDbm: out };
}

/** Rx level at a lng/lat, or NaN outside the grid / no data. */
export function sampleCoverage(grid, lng, lat) {
  const { x, y } = lngLatToGlobalPixel(lng, lat, grid.z);
  const i = Math.round(x - grid.gxMin), j = Math.round(y - grid.gyMin);
  if (i < 0 || j < 0 || i >= grid.w || j >= grid.h) return NaN;
  return grid.rxDbm[j * grid.w + i];
}

/**
 * Count premises whose best-server level meets `minRxDbm`.
 * @param points GeoJSON point features
 * @returns {{ total:number, served:number, unserved:number, noData:number }}
 */
export function premisesCoverage(points, grid, minRxDbm) {
  let served = 0, noData = 0;
  for (const f of points || []) {
    const c = f?.geometry?.coordinates;
    if (!Array.isArray(c)) continue;
    const v = sampleCoverage(grid, c[0], c[1]);
    if (Number.isNaN(v)) noData++; else if (v >= minRxDbm) served++;
  }
  const total = (points || []).length;
  return { total, served, unserved: total - served - noData, noData };
}
