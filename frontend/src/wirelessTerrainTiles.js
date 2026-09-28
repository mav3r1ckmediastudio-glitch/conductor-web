// wirelessTerrainTiles.js
// Loads Terrain-RGB tiles covering the given points and exposes them as a
// synchronous TerrainSource plus DEM grids for the viewshed worker.
//
// Tile fetching is injected (`fetchTile`) so everything except the browser
// default fetcher is unit-testable. The default fetcher only issues normal
// per-tile requests directly from the user's browser (no proxying, no bulk
// export) and keeps tiles in memory for the session only.
//
// FAIL-CLOSED: a tile that fails to load, or is not 256x256, contributes NaN
// heights, which surface as null samples -> PARTIAL / NO_TERRAIN downstream.

import { decodeTerrainRgb, lngLatToGlobalPixel, sampleHeight } from './wirelessTerrain.js';
import { interpolatePath } from './wirelessGeo.js';
import { metresPerPixel } from './wirelessViewshedCore.js';

export const TILE_SIZE = 256;
export const MAPTILER_TERRAIN_ID = 'maptiler-terrain-rgb-v2';
// MapTiler describes Terrain RGB as a ~30 m composite of many DEMs whose
// terrain-vs-surface nature is not documented, so the model is reported UNKNOWN.
export const MAPTILER_NOMINAL_RESOLUTION_M = 30;

/** Decode one RGBA tile (Uint8ClampedArray, 256*256*4) into heights (NaN = no data). */
export function decodeTile(rgba) {
  const n = TILE_SIZE * TILE_SIZE;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const h = decodeTerrainRgb(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    out[i] = h == null ? NaN : h;
  }
  return out;
}

/** Tile keys ("x/y") needed to sample every point (+1 px bilinear margin). */
export function tilesForPoints(points, z) {
  const set = new Set();
  const max = 2 ** z - 1;
  for (const { lng, lat } of points) {
    const { x, y } = lngLatToGlobalPixel(lng, lat, z, TILE_SIZE);
    for (const gx of [x - 1.5, x + 1.5]) for (const gy of [y - 1.5, y + 1.5]) {
      const tx = Math.floor(gx / TILE_SIZE), ty = Math.floor(gy / TILE_SIZE);
      if (tx >= 0 && ty >= 0 && tx <= max && ty <= max) set.add(`${tx}/${ty}`);
    }
  }
  return [...set].sort();
}

/** Points along every link (plus all site positions) to work out which tiles are needed. */
export function pathPointsForState(state, stepM = 500) {
  const pts = [];
  const byId = new Map((state.wirelessSites || []).map(s => [String(s.properties?.site_id ?? ''), s]));
  for (const s of state.wirelessSites || []) {
    const c = s.geometry?.coordinates; if (c) pts.push({ lng: c[0], lat: c[1] });
  }
  for (const l of state.wirelessLinks || []) {
    const a = byId.get(String(l.properties?.site_a ?? '')), b = byId.get(String(l.properties?.site_b ?? ''));
    const ca = a?.geometry?.coordinates, cb = b?.geometry?.coordinates;
    if (!ca || !cb) continue;
    pts.push(...interpolatePath({ lng: ca[0], lat: ca[1] }, { lng: cb[0], lat: cb[1] }, stepM));
  }
  return pts;
}

/**
 * @param o.z            tile zoom
 * @param o.points       [{lng,lat}] that will be sampled (used to decide which tiles to load)
 * @param o.fetchTile    async (z,x,y) => Uint8ClampedArray(256*256*4) | null
 * @param o.concurrency  parallel tile requests
 */
export async function loadTerrainSource({ z, points, fetchTile, id = MAPTILER_TERRAIN_ID, concurrency = 6 }) {
  const keys = tilesForPoints(points, z);
  const tiles = new Map();
  const failed = [];
  let next = 0;
  async function worker() {
    while (next < keys.length) {
      const key = keys[next++];
      const [x, y] = key.split('/').map(Number);
      try {
        const rgba = await fetchTile(z, x, y);
        if (rgba && rgba.length === TILE_SIZE * TILE_SIZE * 4) tiles.set(key, decodeTile(rgba));
        else failed.push(key);
      } catch { failed.push(key); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, keys.length) }, worker));

  const heightAt = (gx, gy) => {
    const tx = Math.floor(gx / TILE_SIZE), ty = Math.floor(gy / TILE_SIZE);
    const t = tiles.get(`${tx}/${ty}`);
    if (!t) return null;
    const v = t[(gy - ty * TILE_SIZE) * TILE_SIZE + (gx - tx * TILE_SIZE)];
    return Number.isNaN(v) ? null : v;
  };
  const lat0 = points.length ? points[0].lat : 56;
  return {
    id, z,
    model: 'UNKNOWN',
    resolutionM: Math.max(MAPTILER_NOMINAL_RESOLUTION_M, metresPerPixel(lat0, z)),
    tilesRequested: keys.length,
    tilesFailed: failed.length,
    heightAt,
    sample: (lng, lat) => sampleHeight(heightAt, lng, lat, z, TILE_SIZE),
  };
}

/** Assemble a Float32 DEM grid (NaN = no data) covering [gxMin, gxMin+w) x [gyMin, gyMin+h). */
export function buildDemGrid(source, gxMin, gyMin, w, h) {
  const data = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const v = source.heightAt(gxMin + i, gyMin + j);
    data[j * w + i] = v == null ? NaN : v;
  }
  return { z: source.z, gxMin, gyMin, w, h, data };
}

/** Browser tile fetcher for MapTiler Terrain-RGB v2. Returns null on any failure. */
export function maptilerTileFetcher(apiKey) {
  return async (z, x, y) => {
    const url = `https://api.maptiler.com/tiles/terrain-rgb-v2/${z}/${x}/${y}.png?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    if (bmp.width !== TILE_SIZE || bmp.height !== TILE_SIZE) return null;
    const cv = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    return ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;
  };
}
