// Gigabit presets (11 GHz backhaul, 60 GHz access) and modelled oxygen-band
// absorption. Presets must pass the project's own limits and produce a working
// design on open terrain, and absorption must actually be applied.
import { describe, it, expect } from 'vitest';
import { PRESETS } from '../wirelessPresets.js';
import { analyseWireless, checkSector } from '../wirelessAnalysis.js';
import { resolveWirelessSettings, atmosLossDbPerKm } from '../wirelessSettings.js';
import { carryDefaults, validateFields, initialValues, LINK_FIELDS, SECTOR_FIELDS } from '../wirelessFields.js';
import { computeSectorCoverage, metresPerPixel } from '../wirelessViewshedCore.js';
import { lngLatToGlobalPixel } from '../wirelessTerrain.js';
import { destinationPoint } from '../wirelessGeo.js';

const flat = { id: 't', sample: () => 100 };
const site = (id, lng) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, 56.5] }, properties: { site_id: id, mast_height_m: 30 } });
const linkWith = (props) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[-4.1, 56.5], [-3.935, 56.5]] },
  properties: { link_id: 'L1', site_a: 'A', site_b: 'B', ...props } });
const state = (l) => ({ wirelessSites: [site('A', -4.1), site('B', -3.935)], wirelessLinks: [l], wirelessSectors: [], wirelessSettings: null });

describe('gigabit presets', () => {
  it('the backhaul preset passes every check on a clear ~10 km path', () => {
    const a = analyseWireless(state(linkWith(PRESETS.link.values)), flat);
    expect(a.status).toBe('VALIDATED');
    expect(a.links[0].distanceKm).toBeGreaterThan(9.5);
    expect(a.links[0].fadeMarginDb).toBeGreaterThan(15);
    expect(a.links[0].atmosLossDb).toBe(0);                 // 11 GHz is outside the oxygen band
  });

  it('the access preset passes the sector checks (only azimuth is left to the designer)', () => {
    const S = resolveWirelessSettings(null);
    const sites = new Map([['A', site('A', -4.1)]]);
    const sec = { properties: { sector_id: 'SC1', site_id: 'A', azimuth_deg: 90, ...PRESETS.sector.values } };
    expect(checkSector(sec, sites, S)).toEqual([]);
    expect(PRESETS.sector.values).not.toHaveProperty('azimuth_deg');
  });

  it('preset values satisfy the form validation', () => {
    expect(validateFields(LINK_FIELDS, initialValues(LINK_FIELDS, PRESETS.link.values)).ok).toBe(true);
    const sv = initialValues(SECTOR_FIELDS, { ...PRESETS.sector.values, azimuth_deg: 90 });
    expect(validateFields(SECTOR_FIELDS, sv).ok).toBe(true);
  });

  it('new assets start from the preset; implausible values on the previous asset are not carried', () => {
    expect(carryDefaults('sector', [])).toMatchObject({ freq_ghz: 60, cpe_gain_dbi: 36 });
    const d = carryDefaults('link', [{ properties: { freq_ghz: 200, gain_a_dbi: 200, tx_power_a_dbm: 200, rx_sensitivity_a_dbm: 200 } }]);
    expect(d).toMatchObject({ freq_ghz: 11, gain_a_dbi: 38, tx_power_a_dbm: 23, rx_sensitivity_a_dbm: -58 });
  });
});

describe('modelled oxygen-band absorption', () => {
  it('applies the configured dB/km inside the band only', () => {
    const S = resolveWirelessSettings(null);
    expect(atmosLossDbPerKm(60, S)).toBe(15);
    expect(atmosLossDbPerKm(11, S)).toBe(0);
    expect(atmosLossDbPerKm(80, S)).toBe(0);
  });

  it('a 60 GHz link needs no manual allowance and carries distance x 15 dB of loss', () => {
    const a = analyseWireless(state(linkWith({ ...PRESETS.link.values, freq_ghz: 60 })), flat);
    expect(a.issues.map(i => i.code)).not.toContain('LINK_ABSORPTION_UNMODELLED');
    expect(a.links[0].atmosLossDb).toBeCloseTo(15 * a.links[0].distanceKm, 6);
    expect(a.links[0].verdict).toBe('FAIL');                // ~150 dB of absorption over 10 km: not viable
  });

  it('the rate is editable and part of the result', () => {
    const s = { ...state(linkWith({ ...PRESETS.link.values, freq_ghz: 60 })), wirelessSettings: { oxygenLossDbPerKm: 10 } };
    const a = analyseWireless(s, flat);
    expect(a.links[0].atmosLossDb).toBeCloseTo(10 * a.links[0].distanceKm, 6);
  });

  it('coverage subtracts the absorption along each ray', () => {
    const z = 12, siteP = { lng: -4.1, lat: 56.5, groundM: 0, antennaAglM: 15 };
    const R = 1500, mpp = metresPerPixel(siteP.lat, z), rPx = Math.ceil(R / mpp) + 3;
    const { x, y } = lngLatToGlobalPixel(siteP.lng, siteP.lat, z);
    const w = 2 * rPx;
    const dem = { z, gxMin: Math.floor(x - rPx), gyMin: Math.floor(y - rPx), w, h: w, data: new Float32Array(w * w).fill(0) };
    const sec = { azimuthDeg: 90, beamwidthDeg: 90, txPowerDbm: 20, gainDbi: 25, freqGHz: 60, cpeHeightM: 6, cpeGainDbi: 36 };
    const at = (g, km) => { const p = destinationPoint(siteP, 90, km * 1000), q = lngLatToGlobalPixel(p.lng, p.lat, z);
      return g.rxDbm[Math.round(q.y - dem.gyMin) * w + Math.round(q.x - dem.gxMin)]; };
    const without = computeSectorCoverage({ site: siteP, sector: sec, radiusM: R, dem, kFactor: 4 / 3 });
    const withAbs = computeSectorCoverage({ site: siteP, sector: { ...sec, atmosDbPerKm: 15 }, radiusM: R, dem, kFactor: 4 / 3 });
    expect(at(without, 1) - at(withAbs, 1)).toBeCloseTo(15, 0);
  });
});
