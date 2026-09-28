import { describe, it, expect } from 'vitest';
import { buildProfile, earthBulgeM, fresnelRadiusM } from '../wirelessProfile.js';
import { destinationPoint, groundDistanceM } from '../wirelessGeo.js';

const A = { lng: -4.0, lat: 56.5 };
const B = destinationPoint(A, 90, 10_000);           // 10 km due east
const opts = { freqGHz: 5, kFactor: 4 / 3, stepM: 50 };
const ends = (agl = 30) => [{ ...A, antennaAglM: agl }, { ...B, antennaAglM: agl }];
const flat = (h) => ({ sample: () => h });
const ridge = (peak, at = 5000, widthM = 150) => ({
  sample: (lng, lat) => 100 + peak * Math.exp(-(((groundDistanceM(A, { lng, lat }) - at) / widthM) ** 2)),
});

describe('formulas', () => {
  it('earth bulge at mid-path of 10 km, k=4/3 is ~1.47 m', () => {
    expect(earthBulgeM(5, 5, 4 / 3)).toBeCloseTo(1.4716, 3);
  });
  it('first Fresnel radius at mid-path of 10 km @5 GHz is ~12.25 m', () => {
    expect(fresnelRadiusM(5, 5, 5)).toBeCloseTo(12.247, 2);
  });
});

describe('buildProfile', () => {
  it('flat terrain: golden clearance at mid-path', () => {
    const p = buildProfile(flat(100), ...ends(), opts);
    expect(p.status).toBe('OK');
    expect(p.distanceKm).toBeCloseTo(10, 2);
    // LOS 130 m, terrain 100 m, bulge ~1.47 m => ~28.5 m over a ~12.2 m Fresnel radius
    expect(p.worst.clearanceM).toBeCloseTo(28.5, 0);
    expect(p.worst.clearancePct).toBeGreaterThan(200);
  });

  it('a ridge above the line of sight produces negative clearance', () => {
    const p = buildProfile(ridge(60), ...ends(), opts);   // peak 160 m vs LOS 130 m
    expect(p.status).toBe('OK');
    expect(p.worst.clearanceM).toBeLessThan(0);
    expect(p.worst.atKm).toBeGreaterThan(4.5);
    expect(p.worst.atKm).toBeLessThan(5.5);
  });

  it('a ridge intruding into the Fresnel zone but below LOS gives 0 < clearance% < 60', () => {
    const p = buildProfile(ridge(22), ...ends(), opts);   // peak ~122 vs LOS 130, F1 ~12 m
    expect(p.worst.clearanceM).toBeGreaterThan(0);
    expect(p.worst.clearancePct).toBeLessThan(60);
  });

  it('reversing the endpoints gives the same worst clearance', () => {
    const fwd = buildProfile(ridge(20), ...ends(), opts);
    const [a, b] = ends();
    const rev = buildProfile(ridge(20), b, a, opts);
    expect(rev.worst.clearanceM).toBeCloseTo(fwd.worst.clearanceM, 1);
    expect(rev.worst.clearancePct).toBeCloseTo(fwd.worst.clearancePct, 0);
  });

  it('higher masts increase clearance', () => {
    const lo = buildProfile(ridge(20), ...ends(20), opts);
    const hi = buildProfile(ridge(20), ...ends(40), opts);
    expect(hi.worst.clearanceM).toBeGreaterThan(lo.worst.clearanceM);
  });

  it('any missing interior sample => PARTIAL (never OK)', () => {
    let calls = 0;
    const t = { sample: () => (++calls === 50 ? null : 100) };
    const p = buildProfile(t, ...ends(), opts);
    expect(p.status).toBe('PARTIAL');
    expect(p.missingSamples).toBe(1);
  });

  it('no terrain at all, or unknown endpoint ground => NO_TERRAIN with no clearance', () => {
    const none = buildProfile({ sample: () => null }, ...ends(), opts);
    expect(none.status).toBe('NO_TERRAIN');
    expect(none.worst).toBeNull();
    const [a, b] = ends();
    const endNull = buildProfile({ sample: (lng) => (Math.abs(lng - A.lng) < 1e-9 ? null : 100) }, a, b, opts);
    expect(endNull.status).toBe('NO_TERRAIN');
  });

  it('groundM override replaces terrain at that end', () => {
    const [a, b] = ends();
    const p = buildProfile({ sample: () => null }, { ...a, groundM: 100 }, { ...b, groundM: 100 }, opts);
    expect(p.status).toBe('PARTIAL');   // ends known, interior unknown: still not OK
  });

  it('a very short link still gets an interior sample', () => {
    const near = destinationPoint(A, 90, 20);
    const p = buildProfile(flat(100), { ...A, antennaAglM: 5 }, { ...near, antennaAglM: 5 }, opts);
    expect(p.samples.length).toBeGreaterThanOrEqual(3);
    expect(p.worst).not.toBeNull();
  });

  it('is deterministic and rejects bad input', () => {
    expect(buildProfile(ridge(20), ...ends(), opts)).toEqual(buildProfile(ridge(20), ...ends(), opts));
    expect(() => buildProfile(flat(100), { ...A, antennaAglM: -1 }, { ...B, antennaAglM: 5 }, opts)).toThrow(RangeError);
    expect(() => buildProfile(flat(100), { ...A, antennaAglM: 5 }, { ...A, antennaAglM: 5 }, opts)).toThrow(RangeError);
  });
});
