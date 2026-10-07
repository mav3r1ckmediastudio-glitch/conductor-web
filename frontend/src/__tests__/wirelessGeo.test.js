import { describe, it, expect } from 'vitest';
import {
  groundDistanceM, bearingDeg, destinationPoint, mercatorScale, interpolatePath,
} from '../wirelessGeo.js';

describe('wirelessGeo', () => {
  it('bearing: cardinal directions', () => {
    const o = { lng: 0, lat: 0 };
    expect(bearingDeg(o, { lng: 0, lat: 1 })).toBeCloseTo(0, 6);
    expect(bearingDeg(o, { lng: 1, lat: 0 })).toBeCloseTo(90, 6);
    expect(bearingDeg(o, { lng: 0, lat: -1 })).toBeCloseTo(180, 6);
    expect(bearingDeg(o, { lng: -1, lat: 0 })).toBeCloseTo(270, 6);
  });

  it('bearing a->b and b->a differ by ~180 on a short link', () => {
    const a = { lng: -4.05, lat: 56.5 }, b = { lng: -4.0, lat: 56.53 };
    // Deviation of (a->b) from the exact reciprocal (b->a + 180), wrapped to [0,180].
    const dev = Math.abs(((bearingDeg(a, b) - bearingDeg(b, a) - 180 + 540) % 360) - 180);
    expect(dev).toBeLessThan(0.1);
  });

  it('destinationPoint round-trips distance and bearing', () => {
    const a = { lng: -4.05, lat: 56.5 };
    const b = destinationPoint(a, 37, 12_345);
    expect(groundDistanceM(a, b)).toBeCloseTo(12_345, 0);
    expect(bearingDeg(a, b)).toBeCloseTo(37, 2);
  });

  it('mercatorScale is ~1.8 at Perthshire latitude and 1 at the equator', () => {
    expect(mercatorScale(0)).toBeCloseTo(1, 10);
    expect(mercatorScale(56.5)).toBeGreaterThan(1.8);
    expect(mercatorScale(56.5)).toBeLessThan(1.83);
  });

  it('interpolatePath: endpoints exact, spacing <= step, monotonic, deterministic', () => {
    const a = { lng: -4.10, lat: 56.48 }, b = { lng: -3.95, lat: 56.55 };
    const p = interpolatePath(a, b, 50);
    expect(p[0]).toEqual({ lng: a.lng, lat: a.lat, dM: 0 });
    const last = p[p.length - 1];
    expect(last.lng).toBe(b.lng); expect(last.lat).toBe(b.lat);
    expect(last.dM).toBeCloseTo(groundDistanceM(a, b), 6);
    for (let i = 1; i < p.length; i++) {
      expect(p[i].dM).toBeGreaterThan(p[i - 1].dM);
      expect(p[i].dM - p[i - 1].dM).toBeLessThanOrEqual(50 + 1e-6);
    }
    expect(interpolatePath(a, b, 50)).toEqual(p);
  });

  it('interpolatePath: coincident points give one sample; bad step throws', () => {
    const a = { lng: -4, lat: 56 };
    expect(interpolatePath(a, a, 50)).toHaveLength(1);
    expect(() => interpolatePath(a, { lng: -3, lat: 56 }, 0)).toThrow();
  });
});
