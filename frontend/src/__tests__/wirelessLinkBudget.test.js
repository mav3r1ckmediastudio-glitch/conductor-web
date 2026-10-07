import { describe, it, expect } from 'vitest';
import { fsplDb, computeLinkBudget } from '../wirelessLinkBudget.js';

describe('wirelessLinkBudget', () => {
  it('FSPL golden value: 5 GHz over 10 km = 126.43 dB', () => {
    expect(fsplDb(5, 10)).toBeCloseTo(126.43, 2);
  });
  it('FSPL rises 6 dB per doubling of distance or frequency', () => {
    expect(fsplDb(5, 20) - fsplDb(5, 10)).toBeCloseTo(6.02, 2);
    expect(fsplDb(10, 10) - fsplDb(5, 10)).toBeCloseTo(6.02, 2);
  });
  it('computes rx power and fade margin', () => {
    const b = computeLinkBudget({ txPowerDbm: 20, txGainDbi: 25, rxGainDbi: 25, freqGHz: 5, distanceKm: 10, rxSensitivityDbm: -80 });
    expect(b.rxPowerDbm).toBeCloseTo(-56.43, 2);
    expect(b.fadeMarginDb).toBeCloseTo(23.57, 2);
    expect(b.eirpDbm).toBe(45);
  });
  it('cable and extra losses reduce the margin dB-for-dB', () => {
    const base = { txPowerDbm: 20, txGainDbi: 25, rxGainDbi: 25, freqGHz: 5, distanceKm: 10, rxSensitivityDbm: -80 };
    const a = computeLinkBudget(base);
    const b = computeLinkBudget({ ...base, txCableLossDb: 1, rxCableLossDb: 2, extraLossDb: 3 });
    expect(a.fadeMarginDb - b.fadeMarginDb).toBeCloseTo(6, 9);
  });
  it('throws (never defaults to 0) on missing or non-finite required input', () => {
    expect(() => computeLinkBudget({ txGainDbi: 1, rxGainDbi: 1, freqGHz: 5, distanceKm: 1, rxSensitivityDbm: -80 })).toThrow(TypeError);
    expect(() => computeLinkBudget({ txPowerDbm: NaN, txGainDbi: 1, rxGainDbi: 1, freqGHz: 5, distanceKm: 1, rxSensitivityDbm: -80 })).toThrow(TypeError);
    expect(() => fsplDb(0, 1)).toThrow(RangeError);
  });
  it('is deterministic', () => {
    const p = { txPowerDbm: 20, txGainDbi: 25, rxGainDbi: 25, freqGHz: 5.8, distanceKm: 7.3, rxSensitivityDbm: -78 };
    expect(computeLinkBudget(p)).toEqual(computeLinkBudget(p));
  });
});
