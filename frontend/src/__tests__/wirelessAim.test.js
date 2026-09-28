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
