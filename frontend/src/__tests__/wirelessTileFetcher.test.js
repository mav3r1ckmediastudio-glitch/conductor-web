// Regression: the terrain fetcher must use MapTiler's TileJSON tile address
// (Terrain-RGB v2 is served as WebP). A guessed ".png" URL failed every tile
// in production, so every link reported LINK_NO_TERRAIN.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { maptilerTileFetcher, downsampleTileRgba, tileUrlFromTemplate } from '../wirelessTerrainTiles.js';

const TEMPLATE = 'https://api.maptiler.com/tiles/terrain-rgb-v2/{z}/{x}/{y}.webp?key=K';
let requested;

function installBrowserFakes({ tileSize = 256, maxzoom = 12 } = {}) {
  requested = [];
  globalThis.fetch = vi.fn(async (url) => {
    requested.push(url);
    if (url.includes('tiles.json')) return { ok: true, json: async () => ({ tiles: [TEMPLATE], maxzoom }) };
    if (url.endsWith('.png') || url.includes('.png?')) return { ok: false, status: 404 };
    return { ok: true, blob: async () => ({ size: tileSize }) };
  });
  globalThis.createImageBitmap = vi.fn(async (blob) => ({ width: blob.size, height: blob.size }));
  globalThis.OffscreenCanvas = class {
    constructor(w, h) { this.w = w; this.h = h; }
    getContext() {
      const { w, h } = this;
      return { drawImage() {}, getImageData: () => {
        const data = new Uint8ClampedArray(w * h * 4);
        for (let p = 0; p < w * h; p++) { data[p * 4] = p % 251; data[p * 4 + 3] = 255; }
        return { data };
      } };
    }
  };
}

describe('maptilerTileFetcher', () => {
  const saved = {};
  beforeEach(() => { for (const k of ['fetch', 'createImageBitmap', 'OffscreenCanvas']) saved[k] = globalThis[k]; });
  afterEach(() => { for (const k of Object.keys(saved)) globalThis[k] = saved[k]; });

  it('reads the tile address from the TileJSON and requests the WebP tile', async () => {
    installBrowserFakes();
    const rgba = await maptilerTileFetcher('K')(12, 2003, 1270);
    expect(requested[0]).toContain('/terrain-rgb-v2/tiles.json?key=K');
    expect(requested[1]).toBe('https://api.maptiler.com/tiles/terrain-rgb-v2/12/2003/1270.webp?key=K');
    expect(rgba).not.toBeNull();
    expect(rgba.length).toBe(256 * 256 * 4);
  });

  it('fetches the TileJSON once for many tiles', async () => {
    installBrowserFakes();
    const f = maptilerTileFetcher('K');
    await Promise.all([f(12, 1, 1), f(12, 1, 2), f(12, 2, 1)]);
    expect(requested.filter((u) => u.includes('tiles.json'))).toHaveLength(1);
  });

  it('accepts 512-px tiles by nearest-neighbour downsampling to 256', async () => {
    installBrowserFakes({ tileSize: 512 });
    const rgba = await maptilerTileFetcher('K')(12, 1, 1);
    expect(rgba.length).toBe(256 * 256 * 4);
  });

  it('refuses zooms above the TileJSON maxzoom (fails closed, no request)', async () => {
    installBrowserFakes({ maxzoom: 12 });
    expect(await maptilerTileFetcher('K')(13, 1, 1)).toBeNull();
    expect(requested.some((u) => u.includes('/13/'))).toBe(false);
  });
});

describe('downsampleTileRgba', () => {
  it('keeps exact encoded pixels (never blends channels)', () => {
    const n = 512, src = new Uint8ClampedArray(n * n * 4);
    for (let p = 0; p < n * n; p++) { src[p * 4] = 1; src[p * 4 + 1] = 134; src[p * 4 + 2] = (p * 7) % 256; src[p * 4 + 3] = 255; }
    const out = downsampleTileRgba(src, n);
    for (let j = 0; j < 256; j += 37) for (let i = 0; i < 256; i += 41) {
      const o = (j * 256 + i) * 4, s = ((2 * j) * n + 2 * i) * 4;
      expect([...out.slice(o, o + 4)]).toEqual([...src.slice(s, s + 4)]);
    }
  });
  it('rejects sizes that are not a multiple of 256', () => {
    expect(downsampleTileRgba(new Uint8ClampedArray(300 * 300 * 4), 300)).toBeNull();
  });
  it('fills an XYZ template', () => {
    expect(tileUrlFromTemplate('a/{z}/{x}/{y}.webp', 1, 2, 3)).toBe('a/1/2/3.webp');
  });
});
