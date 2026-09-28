// wirelessTerrain.js
// Pure terrain-elevation decoding + sampling for wireless planning.
//
// Deliberately contains NO network or DOM code. Tile fetching is injected as a
// global-pixel accessor so this module is deterministic and unit-testable.
//
// NO-DATA RULE: an unknown height is `null`, never 0. Callers must propagate
// null into a NO_TERRAIN / PARTIAL status and must never fabricate a pass.
//
// Encoding: Mapbox/MapTiler Terrain-RGB
//   height_m = -10000 + (R*65536 + G*256 + B) * 0.1

/** Anything below this is treated as "no data" (deepest land is ~-430 m). */
export const MIN_VALID_HEIGHT_M = -500;

/** @returns {number|null} metres above sea level, or null when no data. */
export function decodeTerrainRgb(r, g, b) {
  const h = -10000 + (r * 65536 + g * 256 + b) * 0.1;
  return h < MIN_VALID_HEIGHT_M ? null : h;
}

/**
 * lng/lat -> fractional global pixel coordinates at zoom z (Web-Mercator).
 * Global pixel space spans [0, tileSize * 2^z). Using global pixels lets the
 * sampler ignore tile edges: the accessor resolves which tile owns a pixel.
 */
export function lngLatToGlobalPixel(lng, lat, z, tileSize = 256) {
  const scale = tileSize * 2 ** z;
  const clampedLat = Math.max(-85.0511287798, Math.min(85.0511287798, lat));
  const x = ((lng + 180) / 360) * scale;
  const s = Math.sin((clampedLat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale;
  return { x, y };
}

/**
 * Bilinear-sample decoded terrain height at lng/lat.
 * @param {(gx:number, gy:number) => number|null} getHeight  height at an
 *        integer global pixel, or null if that tile/pixel has no data.
 * @returns {number|null} null if ANY of the 4 neighbouring pixels is null.
 */
export function sampleHeight(getHeight, lng, lat, z, tileSize = 256) {
  const { x, y } = lngLatToGlobalPixel(lng, lat, z, tileSize);
  // Pixel centres sit at +0.5.
  const fx = x - 0.5, fy = y - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const h00 = getHeight(x0, y0), h10 = getHeight(x0 + 1, y0);
  const h01 = getHeight(x0, y0 + 1), h11 = getHeight(x0 + 1, y0 + 1);
  if (h00 == null || h10 == null || h01 == null || h11 == null) return null;
  const top = h00 * (1 - tx) + h10 * tx;
  const bot = h01 * (1 - tx) + h11 * tx;
  return top * (1 - ty) + bot * ty;
}

/**
 * @typedef {Object} TerrainSource
 * @property {string} id              e.g. 'maptiler-terrain-rgb-v2' | 'user-dem:<hash>'
 * @property {number} resolutionM     nominal, surfaced to the user
 * @property {'BARE_EARTH'|'SURFACE'} model
 * @property {(lng:number, lat:number) => number|null} sample
 */
