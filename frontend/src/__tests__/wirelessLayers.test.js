import { describe, it, expect, vi } from 'vitest';
import {
  buildDisplayCollections, sectorFanPolygon, coverageRgba, gridCorners, colourForDbm, COVERAGE_STOPS,
  ensureWirelessLayers, syncWireless, WL,
} from '../wirelessLayers.js';
import { analyseWireless } from '../wirelessAnalysis.js';
import { globalPixelToLngLat, lngLatToGlobalPixel } from '../wirelessTerrain.js';
import { destinationPoint, groundDistanceM } from '../wirelessGeo.js';

const A = { lng: -4.0, lat: 56.5 }, B = destinationPoint(A, 90, 10_000);
const site = (id, c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [c.lng, c.lat] }, properties: { site_id: id, mast_height_m: 30 } });
const link = (o = {}) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[A.lng, A.lat], [B.lng, B.lat]] }, properties: {
  link_id: 'L1', site_a: 'S1', site_b: 'S2', freq_ghz: 5, tx_power_a_dbm: 25, gain_a_dbi: 30, rx_sensitivity_a_dbm: -80,
  tx_power_b_dbm: 25, gain_b_dbi: 30, rx_sensitivity_b_dbm: -80, ...o } });
const base = () => ({ wirelessSites: [site('S1', A), site('S2', B)], wirelessLinks: [link()], wirelessSectors: [] });
const flat = { id: 't', model: 'UNKNOWN', resolutionM: 30, sample: () => 100 };

describe('link display state', () => {
  it('unverified before analysis; pass/fail after; back to unverified when stale', () => {
    expect(buildDisplayCollections(base()).links[0].properties._state).toBe('unverified');
    const s = base();
    const pass = { ...s, wirelessAnalysis: analyseWireless(s, flat) };
    expect(buildDisplayCollections(pass).links[0].properties._state).toBe('pass');
    const failS = { ...s, wirelessLinks: [link({ rx_sensitivity_b_dbm: -40 })] };
    const fail = { ...failS, wirelessAnalysis: analyseWireless(failS, flat) };
    expect(buildDisplayCollections(fail).links[0].properties._state).toBe('fail');
    const stale = { ...pass, wirelessLinks: [link({ freq_ghz: 5.8 })] };
    expect(buildDisplayCollections(stale).links[0].properties._state).toBe('unverified');
  });
  it('does not mutate the stored link features', () => {
    const s = base(); buildDisplayCollections(s);
    expect(s.wirelessLinks[0].properties._state).toBeUndefined();
  });
});

describe('sector fans', () => {
  it('polygon spans the beamwidth at the given radius and closes', () => {
    const poly = sectorFanPolygon(A, 90, 60, 1000);
    const ring = poly.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    for (const [lng, lat] of ring.slice(1, -1)) expect(groundDistanceM(A, { lng, lat })).toBeCloseTo(1000, -1);
  });
  it('skips sectors with unusable geometry parameters; the fan is drawn at the true range (9 km here)', () => {
    const s = { ...base(), wirelessSectors: [
      { geometry: { type: 'Point', coordinates: [A.lng, A.lat] }, properties: { sector_id: 'OK', site_id: 'S1', azimuth_deg: 0, beamwidth_deg: 90, range_m: 9000 } },
      { geometry: { type: 'Point', coordinates: [A.lng, A.lat] }, properties: { sector_id: 'BAD', site_id: 'S1', azimuth_deg: '', beamwidth_deg: 90 } }] };
    const fans = buildDisplayCollections(s).fans;
    expect(fans).toHaveLength(1);
    const d = groundDistanceM(A, { lng: fans[0].geometry.coordinates[0][1][0], lat: fans[0].geometry.coordinates[0][1][1] });
    expect(d).toBeGreaterThan(8900);
    expect(d).toBeLessThan(9100);
  });
});

describe('coverage overlay helpers', () => {
  it('colour ramp is clamped and monotone-anchored at its stops', () => {
    expect(colourForDbm(-200)).toEqual(COVERAGE_STOPS[0][1]);
    expect(colourForDbm(0)).toEqual(COVERAGE_STOPS.at(-1)[1]);
    expect(colourForDbm(-75)).toEqual(COVERAGE_STOPS[2][1]);
  });
  it('RGBA: no data and below-minimum cells are transparent, served cells opaque', () => {
    const grid = { w: 3, h: 1, rxDbm: new Float32Array([NaN, -90, -60]) };
    const px = coverageRgba(grid, -80);
    expect([px[3], px[7], px[11]]).toEqual([0, 0, 255]);
  });
  it('global pixel <-> lng/lat round trips, and image corners bound the grid', () => {
    const { x, y } = lngLatToGlobalPixel(A.lng, A.lat, 12);
    const back = globalPixelToLngLat(x, y, 12);
    expect(back.lng).toBeCloseTo(A.lng, 9); expect(back.lat).toBeCloseTo(A.lat, 9);
    const [tl, tr, br, bl] = gridCorners({ z: 12, gxMin: 1000, gyMin: 700, w: 100, h: 80 });
    expect(tl[0]).toBeLessThan(tr[0]); expect(tl[1]).toBeGreaterThan(bl[1]);
    expect(tl[0]).toBe(bl[0]); expect(tr[0]).toBe(br[0]);
  });
});

describe('map sync', () => {
  function fakeMap() {
    const sources = new Map(), layers = new Set();
    return {
      sources, layers,
      getSource: (id) => sources.get(id), getLayer: (id) => (layers.has(id) ? {} : undefined),
      addSource: (id) => sources.set(id, { setData: vi.fn(), updateImage: vi.fn() }),
      addLayer: (spec) => layers.add(spec.id), removeLayer: (id) => layers.delete(id), removeSource: (id) => sources.delete(id),
    };
  }
  it('creates sources/layers idempotently', () => {
    const m = fakeMap(); ensureWirelessLayers(m); const n = m.layers.size; ensureWirelessLayers(m);
    expect(m.layers.size).toBe(n);
    for (const id of [WL.sitesLayer, WL.linksLayer, WL.fansFill]) expect(m.layers.has(id)).toBe(true);
  });
  it('only re-uploads when an input reference changed', () => {
    const m = fakeMap(); ensureWirelessLayers(m);
    const s = base();
    syncWireless(m, s);
    const set = m.sources.get(WL.sitesSrc).setData;
    expect(set).toHaveBeenCalledTimes(1);
    syncWireless(m, s);
    expect(set).toHaveBeenCalledTimes(1);
    syncWireless(m, { ...s, wirelessLinks: [...s.wirelessLinks] });
    expect(set).toHaveBeenCalledTimes(2);
  });
  it('a rebuilt map (basemap switch) is repopulated', () => {
    const m1 = fakeMap(); ensureWirelessLayers(m1); syncWireless(m1, base());
    const m2 = fakeMap(); ensureWirelessLayers(m2); syncWireless(m2, base());
    expect(m2.sources.get(WL.sitesSrc).setData).toHaveBeenCalledTimes(1);
  });
});
