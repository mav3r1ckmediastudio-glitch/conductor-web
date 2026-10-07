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

/** MapTiler's TileJSON for Terrain-RGB v2 — the same entry point the map itself uses. */
export const MAPTILER_TERRAIN_TILEJSON = 'https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json';

/** Fill an XYZ template ("…/{z}/{x}/{y}.webp?key=…"). */
export function tileUrlFromTemplate(template, z, x, y) {
  return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

/**
 * Reduce a square RGBA tile of size n*256 to 256x256 by taking every n-th
 * pixel. Terrain-RGB packs a height across three channels, so blending
 * neighbouring pixels (canvas scaling, averaging) would produce heights that
 * never existed; nearest-neighbour keeps every value genuine.
 * @returns Uint8ClampedArray(256*256*4) or null if the size is not a multiple of 256.
 */
export function downsampleTileRgba(rgba, size) {
  if (size === TILE_SIZE) return rgba;
  if (!(size > TILE_SIZE) || size % TILE_SIZE !== 0 || rgba.length !== size * size * 4) return null;
  const step = size / TILE_SIZE;
  const out = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
  for (let j = 0; j < TILE_SIZE; j++) for (let i = 0; i < TILE_SIZE; i++) {
    const src = ((j * step) * size + i * step) * 4, dst = (j * TILE_SIZE + i) * 4;
    out[dst] = rgba[src]; out[dst + 1] = rgba[src + 1]; out[dst + 2] = rgba[src + 2]; out[dst + 3] = rgba[src + 3];
  }
  return out;
}

/**
 * Browser tile fetcher for MapTiler Terrain-RGB v2. Returns null on any failure.
 *
 * The tile URL (format, host, key handling) and the maximum zoom are read from
 * MapTiler's TileJSON rather than assumed: the dataset is served as WebP, and a
 * hard-coded ".png" address fails every request. Zoom levels above the
 * TileJSON's maxzoom are refused (null -> the analysis fails closed) rather
 * than silently substituted.
 */
export function maptilerTileFetcher(apiKey, { tileJsonUrl = MAPTILER_TERRAIN_TILEJSON } = {}) {
  let tileJson = null;
  const loadTileJson = () => (tileJson ??= (async () => {
    const res = await fetch(`${tileJsonUrl}?key=${encodeURIComponent(apiKey)}`);
    if (!res.ok) throw new Error(`TileJSON request failed (${res.status})`);
    const tj = await res.json();
    if (!Array.isArray(tj?.tiles) || typeof tj.tiles[0] !== 'string') throw new Error('TileJSON has no tile URL');
    return { template: tj.tiles[0], maxzoom: Number.isFinite(tj.maxzoom) ? tj.maxzoom : Infinity };
  })().catch((err) => { tileJson = null; throw err; }));

  return async (z, x, y) => {
    const { template, maxzoom } = await loadTileJson();
    if (z > maxzoom) return null;
    const res = await fetch(tileUrlFromTemplate(template, z, x, y));
    if (!res.ok) return null;
    const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    if (bmp.width !== bmp.height) return null;
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    return downsampleTileRgba(ctx.getImageData(0, 0, bmp.width, bmp.height).data, bmp.width);
  };
}
