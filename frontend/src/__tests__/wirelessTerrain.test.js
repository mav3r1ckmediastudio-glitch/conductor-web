import { describe, it, expect } from 'vitest';
import {
  decodeTerrainRgb, lngLatToGlobalPixel, sampleHeight, MIN_VALID_HEIGHT_M,
} from '../wirelessTerrain.js';

describe('decodeTerrainRgb', () => {
  it('decodes known values', () => {
    // 1*65536 + 134*256 + 160 = 100000 -> -10000 + 10000 = 0 m
    expect(decodeTerrainRgb(1, 134, 160)).toBeCloseTo(0, 6);
    // +0.1 m per step
    expect(decodeTerrainRgb(1, 134, 170)).toBeCloseTo(1, 6);
  });
  it('treats out-of-coverage (0,0,0 => -10000 m) as null, never 0', () => {
    expect(decodeTerrainRgb(0, 0, 0)).toBeNull();
    expect(MIN_VALID_HEIGHT_M).toBeLessThan(-430);
  });
});

describe('lngLatToGlobalPixel', () => {
  it('maps (0,0) to the centre of the world at any zoom', () => {
    expect(lngLatToGlobalPixel(0, 0, 0)).toEqual({ x: 128, y: 128 });
    const p = lngLatToGlobalPixel(0, 0, 3);
    expect(p.x).toBeCloseTo(1024, 6); expect(p.y).toBeCloseTo(1024, 6);
  });
});

describe('sampleHeight', () => {
  it('returns exact value on a flat field', () => {
    expect(sampleHeight(() => 250, -4.05, 56.5, 12)).toBeCloseTo(250, 9);
  });

  it('bilinear-interpolates a linear west-east ramp', () => {
    const z = 12;
    const ramp = (gx) => gx * 0.5; // metres per pixel
    const { x } = lngLatToGlobalPixel(-4.05, 56.5, z);
    const got = sampleHeight(ramp, -4.05, 56.5, z);
    // Bilinear on a linear field is exact: sample position is (x - 0.5) in pixel-centre space.
    expect(got).toBeCloseTo((x - 0.5) * 0.5, 6);
  });

  it('propagates null if ANY neighbour is no-data', () => {
    const z = 12;
    const { x, y } = lngLatToGlobalPixel(-4.05, 56.5, z);
    const bad = Math.floor(x - 0.5) + 1, badY = Math.floor(y - 0.5) + 1;
    const get = (gx, gy) => (gx === bad && gy === badY ? null : 100);
    expect(sampleHeight(get, -4.05, 56.5, z)).toBeNull();
  });

  it('is deterministic', () => {
    const g = (gx, gy) => gx * 0.3 + gy * 0.7;
    expect(sampleHeight(g, -4.05, 56.5, 13)).toBe(sampleHeight(g, -4.05, 56.5, 13));
  });
});
