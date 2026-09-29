// Rain attenuation: ITU-R P.838-3 (specific attenuation) and P.530-17 (path
// attenuation and time-percentage scaling).
//
// Golden values: Table 5 is copied from the P.838-3 PDF; the path values were
// produced by an independent open-source implementation of the same
// recommendations (ITU-Rpy 0.4.0), taking the worse of horizontal and vertical
// polarisation at R0.01 = 30 mm/h. The full 115-row Table 5 and 80 path cases
// were also checked when this module was written (worst error 0.11% = the
// table's own rounding, and 7e-15).
import { describe, it, expect } from 'vitest';
import { rainCoefficients, rainSpecificDbPerKm, rainAttenuationDb, rainAvailability, marginNeededDb } from '../wirelessRain.js';

const TABLE5 = [ // f, kH, aH, kV, aV
    [1.0, 2.59e-05, 0.9691, 3.08e-05, 0.8592],
    [5.0, 0.0002162, 1.6969, 0.0002428, 1.5317],
    [10.0, 0.01217, 1.2571, 0.01129, 1.2156],
    [24.0, 0.1425, 1.0101, 0.1404, 0.9561],
    [30.0, 0.2403, 0.9485, 0.2291, 0.9129],
    [60.0, 0.8606, 0.7656, 0.8515, 0.7486],
    [66.0, 0.967, 0.7458, 0.9598, 0.7313],
    [68.0, 0.9999, 0.74, 0.9932, 0.7262],
    [69.0, 1.0159, 0.7372, 1.0094, 0.7238],
    [70.0, 1.0315, 0.7345, 1.0253, 0.7215],
    [100.0, 1.3671, 0.6815, 1.368, 0.6765],
];
const PATH = [ // f, d km, % of time, dB at R0.01 = 30 mm/h (worse of H/V)
    [11, 10.2, 0.01, 7.625145],
    [24, 6.1, 0.1, 7.228037],
    [60.48, 10.2, 0.001, 115.062457],
    [66.96, 1.0, 1.0, 1.617015],
    [69.12, 10.2, 0.1, 25.048721],
    [69.12, 20.0, 0.01, 104.145105],
    [69.12, 6.1, 0.01, 47.805308],
    [11, 1.0, 0.001, 3.605835],
];

describe('P.838-3 coefficients', () => {
  it('match the standard\'s numeric Table 5 (to its 4-digit rounding)', () => {
    for (const [f, kH, aH, kV, aV] of TABLE5) {
      const c = rainCoefficients(f);
      expect(Math.abs(c.kH - kH) / kH).toBeLessThan(0.002);
      expect(Math.abs(c.aH - aH) / aH).toBeLessThan(0.002);
      expect(Math.abs(c.kV - kV) / kV).toBeLessThan(0.002);
      expect(Math.abs(c.aV - aV) / aV).toBeLessThan(0.002);
    }
  });
  it('specific attenuation is k R^alpha and rises with rain rate and frequency', () => {
    const c = rainCoefficients(69.12);
    expect(rainSpecificDbPerKm(69.12, 30)).toBeCloseTo(Math.max(c.kH * 30 ** c.aH, c.kV * 30 ** c.aV), 9);
    expect(rainSpecificDbPerKm(69.12, 60)).toBeGreaterThan(rainSpecificDbPerKm(69.12, 30));
    expect(rainSpecificDbPerKm(69.12, 30)).toBeGreaterThan(rainSpecificDbPerKm(24, 30));
    expect(rainSpecificDbPerKm(24, 30)).toBeGreaterThan(rainSpecificDbPerKm(11, 30));
    expect(rainSpecificDbPerKm(69.12, 0)).toBe(0);
  });
});

describe('P.530-17 path attenuation', () => {
  it('matches the independent implementation', () => {
    for (const [f, d, p, ref] of PATH) {
      expect(Math.abs(rainAttenuationDb({ fGHz: f, dKm: d, r001Mmh: 30, pctTime: p }) - ref) / ref).toBeLessThan(1e-4);
    }
  });
  it('is larger for rarer (heavier) rain, longer paths and heavier 0.01% rain rates', () => {
    const a = (over) => rainAttenuationDb({ fGHz: 69.12, dKm: 6, r001Mmh: 30, pctTime: 0.1, ...over });
    expect(a({ pctTime: 0.01 })).toBeGreaterThan(a({ pctTime: 0.1 }));
    expect(a({ pctTime: 0.1 })).toBeGreaterThan(a({ pctTime: 1 }));
    expect(a({ dKm: 10 })).toBeGreaterThan(a({ dKm: 6 }));
    expect(a({ r001Mmh: 45 })).toBeGreaterThan(a({ r001Mmh: 30 }));
  });
  it('clamps the time percentage to the method\'s 0.001-1% range and is 0 for bad input', () => {
    const at = (p) => rainAttenuationDb({ fGHz: 69.12, dKm: 6, r001Mmh: 30, pctTime: p });
    expect(at(5)).toBe(at(1));
    expect(at(0.0001)).toBe(at(0.001));
    expect(rainAttenuationDb({ fGHz: 69.12, dKm: 0, r001Mmh: 30, pctTime: 0.01 })).toBe(0);
    expect(rainAttenuationDb({ fGHz: 69.12, dKm: 6, r001Mmh: 0, pctTime: 0.01 })).toBe(0);
  });
});

describe('availability against rain', () => {
  const base = { fGHz: 69.12, dKm: 10.13, r001Mmh: 30 };
  it('the rain fade at the availability found equals the margin (self-consistent)', () => {
    for (const marginDb of [8, 11.7, 16, 24, 40]) {
      const r = rainAvailability({ ...base, marginDb });
      if (r.bound !== 'exact') continue;
      expect(rainAttenuationDb({ ...base, pctTime: r.exceededPct })).toBeCloseTo(marginDb, 6);
      expect(r.availabilityPct).toBeCloseTo(100 - r.exceededPct, 9);
    }
  });
  it('more margin means better availability; the 10 km 69 GHz link at 11.7 dB is ~99.6% (~33 h/year)', () => {
    const lo = rainAvailability({ ...base, marginDb: 11.7 }), hi = rainAvailability({ ...base, marginDb: 20 });
    expect(hi.availabilityPct).toBeGreaterThan(lo.availabilityPct);
    expect(lo.availabilityPct).toBeGreaterThan(99.5);
    expect(lo.availabilityPct).toBeLessThan(99.7);
    expect(lo.outageHoursPerYear).toBeGreaterThan(25);
    expect(lo.outageHoursPerYear).toBeLessThan(40);
  });
  it('outside the method\'s range it says so instead of extrapolating', () => {
    expect(rainAvailability({ ...base, marginDb: 2 }).bound).toBe('below');
    expect(rainAvailability({ ...base, marginDb: 2 }).availabilityPct).toBe(99);
    expect(rainAvailability({ ...base, marginDb: 500 }).bound).toBe('above');
    expect(rainAvailability({ ...base, marginDb: 0 }).availabilityPct).toBe(0);
    expect(rainAvailability({ ...base, marginDb: -5 }).availabilityPct).toBe(0);
  });
  it('marginNeededDb inverts it: the margin needed for 99.9% gives exactly 99.9%', () => {
    const need = marginNeededDb({ ...base, targetAvailabilityPct: 99.9 });
    expect(rainAvailability({ ...base, marginDb: need }).availabilityPct).toBeCloseTo(99.9, 6);
    expect(marginNeededDb({ ...base, targetAvailabilityPct: 99.99 })).toBeGreaterThan(need);
  });
});
