import { describe, it, expect } from 'vitest';
import { decodeTile, tilesForPoints, loadTerrainSource, buildDemGrid, pathPointsForState, TILE_SIZE } from '../wirelessTerrainTiles.js';
import { lngLatToGlobalPixel } from '../wirelessTerrain.js';

function rgbaFor(heightM) {
  const v = Math.round((heightM + 10000) * 10);
  const r = Math.floor(v / 65536), g = Math.floor((v % 65536) / 256), b = v % 256;
  const a = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
  for (let i = 0; i < TILE_SIZE * TILE_SIZE; i++) { a[i * 4] = r; a[i * 4 + 1] = g; a[i * 4 + 2] = b; a[i * 4 + 3] = 255; }
  return a;
}
const P = { lng: -4.05, lat: 56.5 };

describe('wirelessTerrainTiles', () => {
  it('decodes a tile to heights, no-data to NaN', () => {
    expect(decodeTile(rgbaFor(250))[0]).toBeCloseTo(250, 1);
    expect(Number.isNaN(decodeTile(new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4))[0])).toBe(true);
  });

  it('a point near a tile edge requests the neighbouring tile too', () => {
    const z = 12;
    const { x, y } = lngLatToGlobalPixel(P.lng, P.lat, z);
    const tx = Math.floor(x / TILE_SIZE);
    // move the point to sit ~0.5 px from the tile's east edge
    const edgeGx = (tx + 1) * TILE_SIZE - 0.5;
    const lng = (edgeGx / (TILE_SIZE * 2 ** z)) * 360 - 180;
    const keys = tilesForPoints([{ lng, lat: P.lat }], z);
    expect(keys.length).toBeGreaterThanOrEqual(2);
    expect(keys).toContain(`${tx}/${Math.floor(y / TILE_SIZE)}`);
    expect(keys).toContain(`${tx + 1}/${Math.floor(y / TILE_SIZE)}`);
  });

  it('samples loaded tiles, reports provenance', async () => {
    const src = await loadTerrainSource({ z: 12, points: [P], fetchTile: async () => rgbaFor(250) });
    expect(src.sample(P.lng, P.lat)).toBeCloseTo(250, 1);
    expect(src.id).toBe('maptiler-terrain-rgb-v2');
    expect(src.model).toBe('UNKNOWN');
    expect(src.resolutionM).toBeGreaterThanOrEqual(30);
    expect(src.tilesFailed).toBe(0);
  });

  it('failed, throwing, or malformed tiles yield null samples (fail closed)', async () => {
    for (const f of [async () => null, async () => { throw new Error('net'); }, async () => new Uint8ClampedArray(10)]) {
      const src = await loadTerrainSource({ z: 12, points: [P], fetchTile: f });
      expect(src.sample(P.lng, P.lat)).toBeNull();
      expect(src.tilesFailed).toBeGreaterThan(0);
    }
  });

  it('a tile that was never requested is null, not 0', async () => {
    const src = await loadTerrainSource({ z: 12, points: [P], fetchTile: async () => rgbaFor(100) });
    expect(src.sample(P.lng + 2, P.lat)).toBeNull();
  });

  it('buildDemGrid mirrors heightAt and marks gaps NaN', async () => {
    const src = await loadTerrainSource({ z: 12, points: [P], fetchTile: async () => rgbaFor(120) });
    const { x, y } = lngLatToGlobalPixel(P.lng, P.lat, 12);
    const g = buildDemGrid(src, Math.floor(x) - 4, Math.floor(y) - 4, 8, 8);
    expect(g.data[0]).toBeCloseTo(120, 1);
    const far = buildDemGrid(src, Math.floor(x) + 100000, Math.floor(y), 2, 2);
    expect(Number.isNaN(far.data[0])).toBe(true);
  });

  it('collects points along every link plus all sites', () => {
    const st = { wirelessSites: [
      { geometry: { coordinates: [-4, 56.5] }, properties: { site_id: 'A' } },
      { geometry: { coordinates: [-3.9, 56.5] }, properties: { site_id: 'B' } }],
      wirelessLinks: [{ properties: { site_a: 'A', site_b: 'B' } }] };
    expect(pathPointsForState(st, 500).length).toBeGreaterThan(10);
    expect(pathPointsForState({ wirelessSites: [], wirelessLinks: [] })).toEqual([]);
  });
});
