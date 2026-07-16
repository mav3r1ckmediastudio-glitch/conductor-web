// mapGeom.test.js — Unit tests for the pure geometry / GeoJSON helpers that
// were extracted out of the 3,292-line mapTools.js during its decomposition
// (16 Jul 2026). These functions carried zero coverage while buried in the map
// module; pulled into mapGeom.js they are trivially testable, so this pins
// their behaviour before anything downstream relies on it.
//
// Every expected value below was worked out by hand from the maths, not by
// running the code and copying the output.

import { describe, it, expect } from 'vitest';
import {
  emptyFC,
  pointFC,
  pointInPolygon,
  haversine,
  haversineChain,
  compassLeg,
  _distToSegment,
} from '../mapGeom.js';

describe('emptyFC / pointFC', () => {
  it('emptyFC is an empty FeatureCollection', () => {
    expect(emptyFC()).toEqual({ type: 'FeatureCollection', features: [] });
  });

  it('each emptyFC() is a fresh object (no shared mutable reference)', () => {
    const a = emptyFC();
    a.features.push(1);
    expect(emptyFC().features).toEqual([]);
  });

  it('pointFC wraps a single Point feature at [lng, lat]', () => {
    const fc = pointFC(-1.5, 53.8);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry).toEqual({ type: 'Point', coordinates: [-1.5, 53.8] });
  });
});

describe('pointInPolygon', () => {
  // ring entries are [x, y] === [lng, lat]. A 2×2 axis-aligned square.
  const square = [[0, 0], [2, 0], [2, 2], [0, 2]];

  it('returns true for an interior point', () => {
    expect(pointInPolygon(1, 1, square)).toBe(true);
  });

  it('returns false for a point outside on the x axis', () => {
    expect(pointInPolygon(3, 1, square)).toBe(false);
  });

  it('returns false for a point outside on the y axis', () => {
    expect(pointInPolygon(1, 3, square)).toBe(false);
  });

  it('handles a concave polygon (point in the notch is outside)', () => {
    // An "L"/arrow shape with a notch around x∈(1,2), y∈(1,2).
    const concave = [[0, 0], [3, 0], [3, 3], [2, 3], [2, 1], [0, 1]];
    expect(pointInPolygon(0.5, 0.5, concave)).toBe(true);  // in the base bar
    expect(pointInPolygon(1.5, 2.5, concave)).toBe(false); // in the notch
  });
});

describe('haversine', () => {
  it('is zero for identical points', () => {
    expect(haversine(1.23, 4.56, 1.23, 4.56)).toBe(0);
  });

  it('≈111.19 km for one degree of latitude', () => {
    // 1° of latitude on a 6,371,000 m sphere ≈ 111,195 m.
    expect(haversine(0, 0, 0, 1)).toBeCloseTo(111194.9, 0);
  });

  it('is symmetric', () => {
    const a = haversine(-1.6, 53.8, -1.5, 53.9);
    const b = haversine(-1.5, 53.9, -1.6, 53.8);
    expect(a).toBeCloseTo(b, 6);
  });
});

describe('haversineChain', () => {
  it('sums the legs of a polyline', () => {
    const chain = haversineChain([[0, 0], [0, 1], [0, 2]]);
    expect(chain).toBeCloseTo(2 * haversine(0, 0, 0, 1), 6);
  });

  it('is zero for a single-point (or empty) chain', () => {
    expect(haversineChain([[0, 0]])).toBe(0);
    expect(haversineChain([])).toBe(0);
  });
});

describe('compassLeg', () => {
  it('maps the four cardinal directions', () => {
    expect(compassLeg(0, 0, 0, 1)).toBe('N');
    expect(compassLeg(0, 0, 1, 0)).toBe('E');
    expect(compassLeg(0, 0, 0, -1)).toBe('S');
    expect(compassLeg(0, 0, -1, 0)).toBe('W');
  });

  it('rounds to the nearest cardinal at the sector boundaries', () => {
    expect(compassLeg(0, 0, 1, 1)).toBe('E');   // 45° → E sector [45,135)
    expect(compassLeg(0, 0, 1, -1)).toBe('S');  // 135° → S sector [135,225)
    expect(compassLeg(0, 0, -1, -1)).toBe('W'); // 225° → W sector [225,315)
    expect(compassLeg(0, 0, -1, 1)).toBe('N');  // 315° → N sector [315,45)
  });
});

describe('_distToSegment (screen-space, {x,y} points)', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 0 };

  it('is the perpendicular distance when the foot falls on the segment', () => {
    expect(_distToSegment({ x: 5, y: 3 }, a, b)).toBeCloseTo(3, 10);
  });

  it('clamps to the nearest endpoint when the projection is past the end', () => {
    expect(_distToSegment({ x: 15, y: 0 }, a, b)).toBeCloseTo(5, 10); // dist from (10,0)
    expect(_distToSegment({ x: -3, y: 4 }, a, b)).toBeCloseTo(5, 10); // dist from (0,0)
  });

  it('handles a degenerate zero-length segment as point distance', () => {
    expect(_distToSegment({ x: 3, y: 4 }, a, a)).toBeCloseTo(5, 10);
  });
});
