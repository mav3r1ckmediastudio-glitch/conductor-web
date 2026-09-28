// ITU-R P.676-12 gaseous attenuation. Expected values were computed by an
// independent Python implementation of the same Annex 1 equations, and the
// headline figures match the standard's published curves (Fig. 1 and 2):
// water-vapour peak 22.235 GHz ~0.19, oxygen peak ~15 dB/km at 60 GHz,
// 183.31 GHz peak ~28, E-band ~0.35-0.5 dB/km.
import { describe, it, expect } from 'vitest';
import { gaseousAttenuationDbPerKm as g } from '../wirelessGas.js';
import { OXYGEN_LINES, WATER_VAPOUR_LINES } from '../wirelessGasData.js';

const close = (v, ref, rel = 0.005) => expect(Math.abs(v - ref) / ref).toBeLessThan(rel);

describe('ITU-R P.676-12 gaseous attenuation (standard atmosphere)', () => {
  it('data tables were parsed complete (44 oxygen + 35 water vapour lines)', () => {
    expect(OXYGEN_LINES).toHaveLength(44);
    expect(WATER_VAPOUR_LINES).toHaveLength(35);
    expect(OXYGEN_LINES.every(r => r.length === 7 && r.every(Number.isFinite))).toBe(true);
  });
  it('matches independently computed reference values', () => {
    close(g(5.8), 0.0091, 0.02);
    close(g(11), 0.0158, 0.02);
    close(g(22.235), 0.1933);
    close(g(60), 14.6557);
    close(g(64.8), 4.4412);
    close(g(66.96), 1.2315);
    close(g(69.12), 0.5870);
    close(g(76), 0.3497);
    close(g(183.31), 28.2599);
  });
  it('oxygen peak is ~15 dB/km at ~60 GHz and collapses either side (the 57-71 GHz band is not flat)', () => {
    expect(g(60.48)).toBeGreaterThan(14);
    expect(g(60.48)).toBeLessThan(16);
    expect(g(58.32)).toBeLessThan(g(60.48));
    expect(g(62.64)).toBeLessThan(g(60.48));
    expect(g(69.12)).toBeLessThan(g(60.48) / 20);          // a top-channel 60 GHz-band link loses >20x less per km
  });
  it('decreases monotonically up the upper side of the band', () => {
    let last = Infinity;
    for (const f of [63, 64, 65, 66, 67, 68, 69, 70, 71]) { const v = g(f); expect(v).toBeLessThan(last); last = v; }
  });
  it('drier and colder air changes the water-vapour part; humidity 0 removes it', () => {
    expect(g(22.235, { waterVapourGm3: 0 })).toBeLessThan(g(22.235) / 10);
    expect(g(22.235, { waterVapourGm3: 12 })).toBeGreaterThan(g(22.235));
  });
  it('is deterministic and safe on bad input', () => {
    expect(g(60)).toBe(g(60));
    expect(g(0)).toBe(0);
    expect(g(-5)).toBe(0);
    expect(Number.isFinite(g(1000))).toBe(true);
  });
});
