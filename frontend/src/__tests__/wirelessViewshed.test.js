import { describe, it, expect } from 'vitest';
import {
  computeSectorCoverage, combineBestServer, sampleCoverage, premisesCoverage,
  knifeEdgeLossDb, sectorPatternLossDb, angleDiffDeg, metresPerPixel,
} from '../wirelessViewshedCore.js';
import { lngLatToGlobalPixel } from '../wirelessTerrain.js';

const Z = 12, SITE = { lng: -4.05, lat: 56.5 };
const W = 400;
const { x: sgx, y: sgy } = lngLatToGlobalPixel(SITE.lng, SITE.lat, Z);
const gxMin = Math.floor(sgx) - W / 2, gyMin = Math.floor(sgy) - W / 2;
const sx = sgx - gxMin, sy = sgy - gyMin;
const mpp = metresPerPixel(SITE.lat, Z);

const demOf = (fn) => {
  const data = new Float32Array(W * W);
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) data[j * W + i] = fn(i, j);
  return { z: Z, gxMin, gyMin, w: W, h: W, data };
};
const sector = (o = {}) => ({ azimuthDeg: 0, beamwidthDeg: 90, txPowerDbm: 24, gainDbi: 17, freqGHz: 5, cpeHeightM: 4, cpeGainDbi: 20, ...o });
const run = (dem, sec = sector(), extra = {}) => computeSectorCoverage({
  site: { ...SITE, groundM: 0, antennaAglM: 30 }, sector: sec, radiusM: 3000, dem, kFactor: 4 / 3, ...extra });
const at = (g, dxPx, dyPx) => g.rxDbm[Math.round(sy + dyPx) * W + Math.round(sx + dxPx)];
const fsplDb = (fGHz, dM) => 92.45 + 20 * Math.log10(fGHz) + 20 * Math.log10(dM / 1000);

describe('primitives', () => {
  it('knife-edge loss: ~6 dB at grazing (v=0), 0 well clear, large when deeply shadowed', () => {
    expect(knifeEdgeLossDb(0)).toBeCloseTo(6.03, 1);
    expect(knifeEdgeLossDb(-2)).toBe(0);
    expect(knifeEdgeLossDb(10)).toBeGreaterThan(20);
  });
  it('sector pattern: 3 dB at half-beamwidth, capped at front-to-back', () => {
    expect(sectorPatternLossDb(0, 90)).toBe(0);
    expect(sectorPatternLossDb(45, 90)).toBeCloseTo(3, 9);
    expect(sectorPatternLossDb(180, 90)).toBe(25);
  });
  it('angle difference wraps', () => {
    expect(angleDiffDeg(350, 10)).toBe(20);
    expect(angleDiffDeg(0, 180)).toBe(180);
  });
});

describe('computeSectorCoverage', () => {
  it('flat terrain on boresight equals free-space (closed form)', () => {
    const g = run(demOf(() => 0));
    const eirp = 24 + 17;
    for (const px of [40, 80, 120]) {
      const i = Math.round(sx), j = Math.round(sy - px);
      const d = Math.hypot(i - sx, j - sy) * mpp;
      const expected = eirp - fsplDb(5, d) + 20;
      expect(at(g, 0, -px)).toBeCloseTo(expected, 0);
      expect(Math.abs(at(g, 0, -px) - expected)).toBeLessThan(0.6);
    }
  });

  it('power falls with distance and with angle off boresight', () => {
    const g = run(demOf(() => 0));
    expect(at(g, 0, -40)).toBeGreaterThan(at(g, 0, -120));
    expect(at(g, 0, -80)).toBeGreaterThan(at(g, 80, 0));          // 90 degrees off a 90-degree beam
    expect(at(g, 0, -80)).toBeGreaterThan(at(g, 0, 80));          // behind the sector (front-to-back)
  });

  it('a ridge shadows the cells behind it but not those in front', () => {
    const wallRow = Math.round(sy - 60);
    const flatG = run(demOf(() => 0));
    const g = run(demOf((i, j) => (Math.abs(j - wallRow) <= 1 ? 250 : 0)));
    expect(at(g, 0, -30)).toBeCloseTo(at(flatG, 0, -30), 1);       // in front: unchanged
    expect(at(g, 0, -100)).toBeLessThan(at(flatG, 0, -100) - 15);   // behind: heavily attenuated
  });

  it('unknown terrain truncates the ray: nothing beyond a NaN is reported as covered', () => {
    const nanRow = Math.round(sy - 50);
    const g = run(demOf((i, j) => (j === nanRow ? NaN : 0)));
    expect(Number.isNaN(at(g, 0, -90))).toBe(true);
    expect(Number.isNaN(at(g, 0, -50))).toBe(true);
    expect(Number.isFinite(at(g, 0, -30))).toBe(true);
  });

  it('cells beyond the analysis radius are not painted', () => {
    const g = run(demOf(() => 0), sector(), { radiusM: 1000 });
    expect(Number.isNaN(at(g, 0, -150))).toBe(true);
  });

  it('is deterministic (byte-identical)', () => {
    const dem = demOf((i, j) => 20 * Math.sin(i / 17) + 15 * Math.cos(j / 23));
    const a = run(dem), b = run(dem);
    expect(Buffer.from(a.rxDbm.buffer).equals(Buffer.from(b.rxDbm.buffer))).toBe(true);
  });
});

describe('best server + premises', () => {
  const dem = demOf(() => 0);
  it('per-cell maximum across sectors', () => {
    const n = run(dem, sector({ azimuthDeg: 0 })), s = run(dem, sector({ azimuthDeg: 180 }));
    const best = combineBestServer([n, s]);
    expect(at(best, 0, -80)).toBe(Math.max(at(n, 0, -80), at(s, 0, -80)));
    expect(at(best, 0, 80)).toBe(Math.max(at(n, 0, 80), at(s, 0, 80)));
    expect(() => combineBestServer([n, { ...s, w: 10 }])).toThrow();
  });
  it('premises: counts served / unserved / no-data separately (no data is never "served")', () => {
    const g = run(dem, sector({ azimuthDeg: 0 }));
    const lngLatOf = (dx, dy) => {
      const gx = gxMin + sx + dx, gy = gyMin + sy + dy, scale = 256 * 2 ** Z;
      const lng = (gx / scale) * 360 - 180;
      const n = Math.PI - (2 * Math.PI * gy) / scale;
      return [lng, (180 / Math.PI) * Math.atan(Math.sinh(n))];
    };
    const pt = (dx, dy) => ({ geometry: { type: 'Point', coordinates: lngLatOf(dx, dy) } });
    const strong = pt(0, -30), weak = pt(0, 120), outside = { geometry: { type: 'Point', coordinates: [-4.05, 57.5] } };
    const minRx = at(g, 0, -30) - 1;
    const r = premisesCoverage([strong, weak, outside], g, minRx);
    expect(r.total).toBe(3);
    expect(r.served).toBe(1);
    expect(r.noData).toBe(1);
    expect(r.unserved).toBe(1);
    expect(Number.isNaN(sampleCoverage(g, -4.05, 57.5))).toBe(true);
  });
});
