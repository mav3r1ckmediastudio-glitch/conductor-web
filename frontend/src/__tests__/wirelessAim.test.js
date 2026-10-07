// Sector azimuth suggestion: new sectors are aimed at the most premises within
// range, skipping premises already covered by the site's other sectors.
import { describe, it, expect } from 'vitest';
import { suggestAzimuth } from '../wirelessAim.js';
import { destinationPoint } from '../wirelessGeo.js';

const SITE = { lng: -4.1, lat: 56.5 };
const pt = (brg, m) => { const p = destinationPoint(SITE, brg, m); return { type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] } }; };
const cluster = (brg, n, m = 800) => Array.from({ length: n }, (_, i) => pt(brg + (i % 5) - 2, m + i));
const OPTS = { rangeM: 1500, beamwidthDeg: 90 };

describe('suggestAzimuth', () => {
  it('points at the biggest cluster within range', () => {
    const r = suggestAzimuth(SITE, [...cluster(330, 12), ...cluster(60, 5)], OPTS);
    expect(Math.abs(((r.azimuthDeg - 330 + 540) % 360) - 180)).toBeLessThanOrEqual(10);
    expect(r.count).toBe(12);
  });

  it('ignores premises beyond the sector range', () => {
    const r = suggestAzimuth(SITE, [...cluster(330, 30, 5000), ...cluster(60, 4)], OPTS);
    expect(Math.abs(r.azimuthDeg - 60)).toBeLessThanOrEqual(10);
    expect(r.count).toBe(4);
  });

  it('a second sector on the same site aims at the next uncovered cluster', () => {
    const premises = [...cluster(330, 12), ...cluster(150, 7)];
    const r = suggestAzimuth(SITE, premises, { ...OPTS, existing: [{ azimuthDeg: 330, beamwidthDeg: 90, rangeM: 1500 }] });
    expect(Math.abs(r.azimuthDeg - 150)).toBeLessThanOrEqual(10);
    expect(r.count).toBe(7);
  });

  it('returns null when nothing is in range (the designer chooses)', () => {
    expect(suggestAzimuth(SITE, cluster(90, 10, 9000), OPTS).azimuthDeg).toBeNull();
    expect(suggestAzimuth(SITE, [], OPTS).azimuthDeg).toBeNull();
  });

  it('is deterministic and wraps correctly around north', () => {
    const premises = cluster(358, 9);
    const a = suggestAzimuth(SITE, premises, OPTS), b = suggestAzimuth(SITE, premises, OPTS);
    expect(a).toEqual(b);
    expect(a.count).toBe(9);
    expect(a.azimuthDeg >= 0 && a.azimuthDeg < 360).toBe(true);
  });
});

import { azimuthFromPoint, countPremisesInBeam } from '../wirelessAim.js';
import { sectorAimFeatures, buildDisplayCollections, FAN_MAX_M, HANDLE_MAX_M } from '../wirelessLayers.js';
import { groundDistanceM, bearingDeg } from '../wirelessGeo.js';

describe('azimuthFromPoint (drag -> compass bearing)', () => {
  const at = (brg, m) => destinationPoint(SITE, brg, m);
  it('returns whole-degree compass bearings for the four cardinal directions', () => {
    expect(azimuthFromPoint(SITE, at(0, 500))).toBe(0);
    expect(azimuthFromPoint(SITE, at(90, 500))).toBe(90);
    expect(azimuthFromPoint(SITE, at(180, 500))).toBe(180);
    expect(azimuthFromPoint(SITE, at(270, 500))).toBe(270);
  });
  it('wraps to [0,360): just west of north is 359, never 360 or negative', () => {
    expect(azimuthFromPoint(SITE, at(359.7, 500))).toBe(0);     // rounds to 360 -> 0
    expect(azimuthFromPoint(SITE, at(-30, 500))).toBe(330);
  });
  it('Shift snaps to the requested step', () => {
    expect(azimuthFromPoint(SITE, at(47, 500), { snapDeg: 5 })).toBe(45);
    expect(azimuthFromPoint(SITE, at(48, 500), { snapDeg: 5 })).toBe(50);
  });
  it('has no bearing when dropped on the site itself', () => {
    expect(azimuthFromPoint(SITE, SITE)).toBeNull();
  });
});

describe('countPremisesInBeam (live count while dragging)', () => {
  const premises = [...cluster(330, 10), ...cluster(150, 4)];
  it('counts only the premises inside this beam and range', () => {
    expect(countPremisesInBeam(SITE, premises, { azimuthDeg: 330, rangeM: 1500, beamwidthDeg: 90 }).inBeam).toBe(10);
    expect(countPremisesInBeam(SITE, premises, { azimuthDeg: 150, rangeM: 1500, beamwidthDeg: 90 }).inBeam).toBe(4);
    expect(countPremisesInBeam(SITE, premises, { azimuthDeg: 240, rangeM: 1500, beamwidthDeg: 90 }).inBeam).toBe(0);
    expect(countPremisesInBeam(SITE, premises, { azimuthDeg: 330, rangeM: 500, beamwidthDeg: 90 }).inBeam).toBe(0);
  });
  it('separates out premises another sector on the site already covers', () => {
    const r = countPremisesInBeam(SITE, premises, { azimuthDeg: 330, rangeM: 1500, beamwidthDeg: 90,
      existing: [{ azimuthDeg: 330, beamwidthDeg: 90, rangeM: 1500 }] });
    expect(r).toEqual({ inBeam: 10, uncovered: 0 });
  });
  it('an unset or invalid aim counts nothing', () => {
    expect(countPremisesInBeam(SITE, premises, { azimuthDeg: NaN, rangeM: 1500, beamwidthDeg: 90 })).toEqual({ inBeam: 0, uncovered: 0 });
  });
});

describe('aiming handle geometry', () => {
  it('the handle sits on the boresight at the fan radius, and the line runs from the site to it', () => {
    const [line, handle] = sectorAimFeatures(SITE, 120, 90, 800, { sector_id: 'S1' });
    const [hl, ht] = handle.geometry.coordinates, tip = { lng: hl, lat: ht };
    expect(groundDistanceM(SITE, tip)).toBeCloseTo(800, -1);
    expect(bearingDeg(SITE, tip)).toBeCloseTo(120, 0);
    expect(line.geometry.coordinates[0]).toEqual([SITE.lng, SITE.lat]);
    expect(line.geometry.coordinates[1]).toEqual(handle.geometry.coordinates);
    expect(handle.properties).toMatchObject({ sector_id: 'S1', bw: 90, r: 800, lng: SITE.lng, lat: SITE.lat });
  });
  it('a long-range sector keeps its handle within reach (1.2 km) but remembers its true range', () => {
    const [, handle] = sectorAimFeatures(SITE, 0, 90, 5000);
    expect(groundDistanceM(SITE, { lng: handle.geometry.coordinates[0], lat: handle.geometry.coordinates[1] })).toBeCloseTo(HANDLE_MAX_M, -1);
    expect(handle.properties.r).toBe(5000);
    expect(sectorAimFeatures(SITE, 0, 90, 90000)[1].properties.r).toBe(FAN_MAX_M);
  });
  it('the fan drawn for a sector reaches its real range, not a fixed 1.2 km', () => {
    const site = { type: 'Feature', geometry: { type: 'Point', coordinates: [SITE.lng, SITE.lat] }, properties: { site_id: 'A' } };
    const mk = (range_m) => buildDisplayCollections({ wirelessSites: [site], wirelessLinks: [],
      wirelessSectors: [{ type: 'Feature', geometry: site.geometry, properties: { sector_id: 'X', site_id: 'A', azimuth_deg: 90, beamwidth_deg: 90, range_m } }] });
    const farthest = (c) => Math.max(...c.fans[0].geometry.coordinates[0].map(([lng, lat]) => groundDistanceM(SITE, { lng, lat })));
    expect(farthest(mk(5000))).toBeGreaterThan(4900);
    expect(farthest(mk(5000))).toBeLessThan(5100);
    expect(farthest(mk(800))).toBeLessThan(900);
    expect(farthest(mk(100000))).toBeLessThan(30100);                    // capped at the analysis limit
  });
  it('stored sectors get a handle; incomplete ones (no azimuth) do not', () => {
    const site = { type: 'Feature', geometry: { type: 'Point', coordinates: [SITE.lng, SITE.lat] }, properties: { site_id: 'A' } };
    const sec = (props) => ({ type: 'Feature', geometry: site.geometry, properties: { sector_id: 'X', site_id: 'A', beamwidth_deg: 90, range_m: 1500, ...props } });
    const c = buildDisplayCollections({ wirelessSites: [site], wirelessLinks: [], wirelessSectors: [sec({ azimuth_deg: 45 }), sec({ sector_id: 'Y', azimuth_deg: '' })] });
    expect(c.aim).toHaveLength(2);                         // one line + one handle, for the complete sector only
    expect(c.aim.every(f => f.properties.sector_id === 'X')).toBe(true);
  });
});
