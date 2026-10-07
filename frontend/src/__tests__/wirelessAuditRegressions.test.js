// Regression tests for two defects found in the pre-merge audit of the
// wireless patch series (see commit message). Each failed before its fix.
import { describe, it, expect } from 'vitest';
import { analyseWireless, wirelessPlanState } from '../wirelessAnalysis.js';
import { hashWirelessInputs } from '../wirelessInputs.js';
import { computeSectorCoverage, metresPerPixel } from '../wirelessViewshedCore.js';
import { lngLatToGlobalPixel } from '../wirelessTerrain.js';
import { destinationPoint } from '../wirelessGeo.js';

describe('audit: survey_note is a fingerprinted input of the surveyed-LOS override', () => {
  // A ridge that obstructs the path, so the link can only pass via the survey override.
  const ridge = { id: 't', sample: (lng) => (lng > -4.06 && lng < -4.04 ? 900 : 100) };
  const site = (id, lng) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, 56.5] }, properties: { site_id: id, mast_height_m: 10 } });
  const link = (extra) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[-4.1, 56.5], [-4.0, 56.5]] },
    properties: { link_id: 'L1', site_a: 'A', site_b: 'B', freq_ghz: 5.8,
      tx_power_a_dbm: 20, gain_a_dbi: 23, rx_sensitivity_a_dbm: -80,
      tx_power_b_dbm: 20, gain_b_dbi: 23, rx_sensitivity_b_dbm: -80, ...extra } });
  const base = { wirelessSites: [site('A', -4.1), site('B', -4.0)], wirelessSectors: [] };

  it('the override validates only with a note', () => {
    const withNote = { ...base, wirelessLinks: [link({ survey_los_confirmed: true, survey_note: 'Visual LOS from mast, 12 Sep' })] };
    expect(analyseWireless(withNote, ridge).status).toBe('VALIDATED');
  });

  it('blanking the survey note after validation makes the plan STALE, not still VALIDATED', () => {
    const s = { ...base, wirelessLinks: [link({ survey_los_confirmed: true, survey_note: 'Visual LOS from mast, 12 Sep' })] };
    const analysis = analyseWireless(s, ridge);
    const edited = { ...s, wirelessAnalysis: analysis, wirelessLinks: [link({ survey_los_confirmed: true, survey_note: '' })] };
    expect(wirelessPlanState(edited)).toBe('STALE');
    expect(analyseWireless(edited, ridge).status).toBe('INVALID');
  });

  it('changing the note text changes the fingerprint', () => {
    const a = { ...base, wirelessLinks: [link({ survey_los_confirmed: true, survey_note: 'one' })] };
    const b = { ...base, wirelessLinks: [link({ survey_los_confirmed: true, survey_note: 'two' })] };
    expect(hashWirelessInputs(a)).not.toBe(hashWirelessInputs(b));
  });
});

describe('audit: coverage respects the smooth-earth radio horizon', () => {
  // Flat sea-level DEM (a loch surface is the realistic case). 10 m mast, 2 m
  // CPE, k=4/3: horizon = sqrt(2kR*10) + sqrt(2kR*2) ~= 13.0 + 5.8 = 18.8 km.
  const z = 12, site = { lng: -4.1, lat: 56.5, groundM: 0, antennaAglM: 10 };
  const R = 26000, mpp = metresPerPixel(site.lat, z), rPx = Math.ceil(R / mpp) + 3;
  const { x, y } = lngLatToGlobalPixel(site.lng, site.lat, z);
  const w = 2 * rPx;
  const dem = { z, gxMin: Math.floor(x - rPx), gyMin: Math.floor(y - rPx), w, h: w, data: new Float32Array(w * w).fill(0) };
  const sec = { azimuthDeg: 90, beamwidthDeg: 90, txPowerDbm: 20, gainDbi: 17, freqGHz: 5.8, cpeHeightM: 2, cpeGainDbi: 23 };
  const g = computeSectorCoverage({ site, sector: sec, radiusM: R, dem, kFactor: 4 / 3 });
  const extraLossAt = (km) => {
    const p = destinationPoint(site, 90, km * 1000), q = lngLatToGlobalPixel(p.lng, p.lat, z);
    const rx = g.rxDbm[Math.round(q.y - dem.gyMin) * w + Math.round(q.x - dem.gxMin)];
    const fs = sec.txPowerDbm + sec.gainDbi + sec.cpeGainDbi - (92.45 + 20 * Math.log10(sec.freqGHz) + 20 * Math.log10(km));
    return fs - rx;
  };

  it('well inside the horizon: essentially free-space', () => {
    expect(extraLossAt(8)).toBeLessThan(1);
  });
  it('beyond the horizon: diffraction loss applies (never free-space all the way out)', () => {
    expect(extraLossAt(22)).toBeGreaterThan(6);
    expect(extraLossAt(25)).toBeGreaterThan(extraLossAt(22));
  });
});
