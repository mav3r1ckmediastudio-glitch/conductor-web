// wirelessController.js — orchestration for wireless analysis and coverage:
// load terrain tiles, run the pure engines, return results. Holds NO project
// state and touches NO DOM; the caller stores the result via projectStore.
// Network and worker access are injectable, so the whole flow is testable.

import { resolveWirelessSettings } from './wirelessSettings.js';
import { hashWirelessInputs } from './wirelessInputs.js';
import { analyseWirelessDetailed, checkSector, num } from './wirelessAnalysis.js';
import {
  loadTerrainSource, buildDemGrid, pathPointsForState, maptilerTileFetcher, MAPTILER_TERRAIN_ID,
} from './wirelessTerrainTiles.js';
import { computeSectorCoverage, combineBestServer, premisesCoverage, metresPerPixel } from './wirelessViewshedCore.js';
import { lngLatToGlobalPixel, globalPixelToLngLat } from './wirelessTerrain.js';

const NO_TERRAIN = { id: 'none', model: 'UNKNOWN', resolutionM: null, sample: () => null };
const MAX_GRID_CELLS = 9_000_000;

function tileFetcher({ maptilerKey, fetchTile }) {
  return fetchTile || (maptilerKey ? maptilerTileFetcher(maptilerKey) : null);
}

/**
 * Analyse every wireless link. Never throws for missing terrain: with no key or
 * failed tiles the analysis simply fails closed (LINK_NO_TERRAIN / PARTIAL).
 * @returns {{ analysis, profiles: Map, terrainInfo, warning?: string }}
 */
export async function runWirelessAnalysis(state, { maptilerKey, fetchTile } = {}) {
  const settings = resolveWirelessSettings(state.wirelessSettings);
  const fetcher = tileFetcher({ maptilerKey, fetchTile });
  let terrain = NO_TERRAIN, warning;
  if (!fetcher) {
    warning = 'No MapTiler key is configured, so terrain cannot be loaded. Links without a recorded site survey will fail.';
  } else {
    const points = pathPointsForState(state, 400);
    if (points.length) terrain = await loadTerrainSource({ z: settings.terrainZoom, points, fetchTile: fetcher });
    if (terrain.tilesFailed > 0) warning = `${terrain.tilesFailed} of ${terrain.tilesRequested} terrain tiles failed to load; affected links cannot be verified.`;
  }
  const { analysis, profiles } = analyseWirelessDetailed(state, terrain);
  return { analysis, profiles, terrainInfo: { id: terrain.id, tilesRequested: terrain.tilesRequested ?? 0, tilesFailed: terrain.tilesFailed ?? 0 }, warning };
}

// ── Coverage ────────────────────────────────────────────────────────────────
let _worker = null, _seq = 0;
const _pending = new Map();

/** Runs one sector on a Worker when available, else inline (tests / old browsers). */
export function runSectorJob(params) {
  if (typeof Worker === 'undefined') return Promise.resolve(computeSectorCoverage(params));
  if (!_worker) {
    _worker = new Worker(new URL('./wirelessViewshed.worker.js', import.meta.url), { type: 'module' });
    _worker.onmessage = (e) => {
      const p = _pending.get(e.data.jobId); if (!p) return;
      _pending.delete(e.data.jobId);
      e.data.ok ? p.resolve(e.data.result) : p.reject(new Error(e.data.error));
    };
    _worker.onerror = (e) => { for (const p of _pending.values()) p.reject(new Error(e.message || 'worker error')); _pending.clear(); _worker = null; };
  }
  return new Promise((resolve, reject) => { const jobId = ++_seq; _pending.set(jobId, { resolve, reject }); _worker.postMessage({ jobId, params }); });
}

/**
 * Best-server coverage over all COMPLETE sectors.
 *
 * Each sector grid is converted to a MARGIN (received level minus that
 * sector's own CPE minimum Rx) before combining, so sectors with different
 * CPE requirements compare fairly. A premises counts as covered at
 * >= settings.coverageMarginDb. Unknown terrain is "no data", never "covered".
 *
 * @returns {{ ok:true, grid, perSector, skipped, premises, inputHash, terrainInfo, settings, warning? }
 *          | { ok:false, error:string }}
 */
export async function runWirelessCoverage(state, { maptilerKey, fetchTile, runJob = runSectorJob, onProgress } = {}) {
  const settings = resolveWirelessSettings(state.wirelessSettings);
  const fetcher = tileFetcher({ maptilerKey, fetchTile });
  if (!fetcher) return { ok: false, error: 'No MapTiler key is configured, so terrain cannot be loaded for a coverage estimate.' };

  const sitesById = new Map((state.wirelessSites || []).map(s => [String(s.properties?.site_id ?? ''), s]));
  const skipped = [];
  const usable = [];
  for (const sec of state.wirelessSectors || []) {
    const issues = checkSector(sec, sitesById);
    if (issues.length) { skipped.push({ sector_id: sec.properties?.sector_id, reason: issues.map(i => i.message).join(' ') }); continue; }
    usable.push(sec);
  }
  if (!usable.length) return { ok: false, error: 'There are no complete sectors to analyse. Add a sector to a site and fill in every required field.', skipped };

  const z = settings.terrainZoom;
  let gxMin = Infinity, gyMin = Infinity, gxMax = -Infinity, gyMax = -Infinity;
  const geo = usable.map(sec => {
    const p = sec.properties, [lng, lat] = sitesById.get(String(p.site_id)).geometry.coordinates;
    const rPx = Math.ceil(Number(p.range_m) / metresPerPixel(lat, z)) + 2;
    const { x, y } = lngLatToGlobalPixel(lng, lat, z);
    gxMin = Math.min(gxMin, Math.floor(x - rPx)); gxMax = Math.max(gxMax, Math.ceil(x + rPx));
    gyMin = Math.min(gyMin, Math.floor(y - rPx)); gyMax = Math.max(gyMax, Math.ceil(y + rPx));
    return { lng, lat };
  });
  const w = gxMax - gxMin, h = gyMax - gyMin;
  if (w * h > MAX_GRID_CELLS) return { ok: false, error: `The analysis area is too large (${w} x ${h} cells). Reduce the sector ranges or analyse sites that are closer together.` };

  const pts = [];
  for (let gy = gyMin; gy <= gyMax + 180; gy += 180) for (let gx = gxMin; gx <= gxMax + 180; gx += 180) pts.push(globalPixelToLngLat(Math.min(gx, gxMax), Math.min(gy, gyMax), z));
  for (const g of geo) pts.push(g);
  const terrain = await loadTerrainSource({ z, points: pts, fetchTile: fetcher });
  const dem = buildDemGrid(terrain, gxMin, gyMin, w, h);

  const grids = [], perSector = [];
  for (let i = 0; i < usable.length; i++) {
    const sec = usable[i], p = sec.properties, site = sitesById.get(String(p.site_id));
    const siteProps = site.properties || {};
    const ground = num(siteProps.ground_override_m) ?? terrain.sample(geo[i].lng, geo[i].lat);
    if (ground == null) { skipped.push({ sector_id: p.sector_id, reason: 'No terrain data at the site and no ground elevation override.' }); continue; }
    onProgress?.({ done: i, total: usable.length, sector_id: p.sector_id });
    const g = await runJob({
      site: { ...geo[i], groundM: ground, antennaAglM: Number(p.antenna_height_m) },
      sector: { azimuthDeg: Number(p.azimuth_deg), beamwidthDeg: Number(p.beamwidth_deg), txPowerDbm: Number(p.tx_power_dbm), gainDbi: Number(p.gain_dbi),
                cableLossDb: num(p.cable_loss_db) ?? 0, freqGHz: Number(p.freq_ghz), cpeHeightM: Number(p.cpe_height_m), cpeGainDbi: Number(p.cpe_gain_dbi) },
      radiusM: Number(p.range_m), dem, kFactor: settings.kFactor,
    });
    const min = Number(p.cpe_min_rx_dbm);
    const margin = new Float32Array(g.rxDbm.length);
    for (let k = 0; k < margin.length; k++) margin[k] = g.rxDbm[k] - min;   // NaN stays NaN
    grids.push({ ...g, rxDbm: margin });
    perSector.push({ sector_id: p.sector_id, site_id: p.site_id, coveredCells: g.visibleCells });
  }
  if (!grids.length) return { ok: false, error: 'No sector could be analysed (missing terrain at every site).', skipped };

  const grid = combineBestServer(grids);          // .rxDbm now holds best-server MARGIN in dB
  const premises = premisesCoverage(state.addressPoints, grid, settings.coverageMarginDb);
  const warning = terrain.tilesFailed > 0 ? `${terrain.tilesFailed} of ${terrain.tilesRequested} terrain tiles failed to load; those areas show no data.` : undefined;
  return {
    ok: true, grid, perSector, skipped, premises, settings, warning,
    inputHash: hashWirelessInputs(state),
    terrainInfo: { id: terrain.id ?? MAPTILER_TERRAIN_ID, resolutionM: terrain.resolutionM, model: terrain.model, tilesRequested: terrain.tilesRequested, tilesFailed: terrain.tilesFailed, cellM: grid.metresPerPixel },
  };
}
