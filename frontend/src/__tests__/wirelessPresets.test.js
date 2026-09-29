// Presets (airFiber-60-LR-class backhaul, LTU-class 5.8 GHz access, plus the
// gigabit alternatives) and the ITU-R P.676 gas-absorption model as it is
// applied to links and coverage.
import { describe, it, expect } from 'vitest';
import { PRESETS, presetFor, presetOptions } from '../wirelessPresets.js';
import { analyseWireless, checkSector } from '../wirelessAnalysis.js';
import { resolveWirelessSettings, atmosLossDbPerKm } from '../wirelessSettings.js';
import { carryDefaults, validateFields, initialValues, LINK_FIELDS, SECTOR_FIELDS } from '../wirelessFields.js';
import { computeSectorCoverage, metresPerPixel } from '../wirelessViewshedCore.js';
import { lngLatToGlobalPixel } from '../wirelessTerrain.js';
import { destinationPoint } from '../wirelessGeo.js';
import { gaseousAttenuationDbPerKm } from '../wirelessGas.js';

const flat = { id: 't', sample: () => 100 };
const site = (id, lng) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, 56.5] }, properties: { site_id: id, mast_height_m: 30 } });
const LNG_10KM = -3.935, LNG_6KM = -4.0;               // ~10.1 km and ~6.1 km east of A at 56.5N
const linkWith = (props, lngB = LNG_10KM) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[-4.1, 56.5], [lngB, 56.5]] },
  properties: { link_id: 'L1', site_a: 'A', site_b: 'B', ...props } });
const state = (l, lngB = LNG_10KM, settings = null) => ({ wirelessSites: [site('A', -4.1), site('B', lngB)], wirelessLinks: [l], wirelessSectors: [], wirelessSettings: settings });
const linkVals = (id) => presetFor('link', id).values;
const codes = (a) => a.issues.map(i => i.code);

describe('preset catalogue', () => {
  it('links and sectors each offer at least two selectable presets; the first is the default', () => {
    expect(presetOptions('link').map(p => p.id)).toEqual(['af60lr', 'ptp11']);
    expect(presetOptions('sector').map(p => p.id)).toEqual(['ptmp5', 'ptmp60']);
    expect(presetFor('link').id).toBe('af60lr');
    expect(presetFor('sector').id).toBe('ptmp5');
    expect(presetFor('link', 'ptp11').name).toMatch(/11 GHz/);
    expect(presetFor('link', 'nonsense').id).toBe('af60lr');         // unknown id falls back to the default
  });
  it('every preset carries a note saying where its numbers come from', () => {
    for (const k of ['site', 'link', 'sector']) for (const p of presetOptions(k)) expect(p.note.length).toBeGreaterThan(30);
    expect(presetFor('link').note).toMatch(/FCC/);
    expect(presetFor('sector').note).toMatch(/36 dBm/);
  });
  it('azimuth is deliberately not preset', () => {
    for (const p of presetOptions('sector')) expect(p.values).not.toHaveProperty('azimuth_deg');
  });
  it('every preset satisfies the form validation and the project limits', () => {
    for (const p of presetOptions('link')) expect(validateFields(LINK_FIELDS, initialValues(LINK_FIELDS, p.values)).ok).toBe(true);
    const S = resolveWirelessSettings(null), sites = new Map([['A', site('A', -4.1)]]);
    for (const p of presetOptions('sector')) {
      expect(validateFields(SECTOR_FIELDS, initialValues(SECTOR_FIELDS, { ...p.values, azimuth_deg: 90 })).ok).toBe(true);
      expect(checkSector({ properties: { sector_id: 'SC1', site_id: 'A', azimuth_deg: 90, ...p.values } }, sites, S)).toEqual([]);
    }
  });
  it('new assets start from the default preset; implausible values on the previous asset are not carried', () => {
    expect(carryDefaults('sector', [])).toMatchObject({ freq_ghz: 5.8, tx_power_dbm: 19, gain_dbi: 17 });
    const d = carryDefaults('link', [{ properties: { freq_ghz: 200, gain_a_dbi: 200, tx_power_a_dbm: 200, rx_sensitivity_a_dbm: 200 } }]);
    expect(d).toMatchObject({ freq_ghz: 69.12, gain_a_dbi: 38, tx_power_a_dbm: 21, rx_sensitivity_a_dbm: -70 });
  });
  it('the 5.8 GHz sector preset is exactly at the UK 36 dBm (4 W) EIRP cap', () => {
    const v = presetFor('sector', 'ptmp5').values;
    expect(v.tx_power_dbm + v.gain_dbi - v.cable_loss_db).toBe(36);
  });
});

describe('60 GHz-band backhaul preset (airFiber 60 LR class) on a clear path', () => {
  it('~6 km: passes with a healthy margin', () => {
    const a = analyseWireless(state(linkWith(linkVals('af60lr'), LNG_6KM), LNG_6KM), flat);
    expect(a.status).toBe('VALIDATED');
    expect(a.links[0].fadeMarginDb).toBeGreaterThan(15);
  });
  it('~10 km: ~12 dB spare gives only ~99.6% rain availability (about 33 h/year) against the 99.9% target, so it fails and says by how much', () => {
    const a = analyseWireless(state(linkWith(linkVals('af60lr'))), flat);
    const r = a.links[0];
    expect(r.distanceKm).toBeGreaterThan(10);
    expect(r.fadeMarginDb).toBeGreaterThan(11);
    expect(r.fadeMarginDb).toBeLessThan(12.5);
    expect(codes(a)).toEqual(['LINK_RAIN_AVAILABILITY_LOW']);
    expect(r.rain.availabilityPct).toBeGreaterThan(99.5);
    expect(r.rain.availabilityPct).toBeLessThan(99.7);
    expect(r.rain.shortfallDb).toBeGreaterThan(12);
    expect(r.rain.shortfallDb).toBeLessThan(14);
    expect(a.issues[0].message).toMatch(/rain would limit availability/);
    expect(a.issues[0].message).toMatch(/13\.\d dB more/);
    expect(r.atmosLossDb).toBeCloseTo(0.587 * r.distanceKm, 1);
  });
  it('~6 km passes the 99.9% rain target', () => {
    const a = analyseWireless(state(linkWith(linkVals('af60lr'), LNG_6KM), LNG_6KM), flat);
    expect(a.links[0].rain.availabilityPct).toBeGreaterThan(99.9);
  });
  it('even at the lowest data rate (-78 dBm) 10 km on 69 GHz cannot reach 99.9% in Loch Tay rain', () => {
    const a = analyseWireless(state(linkWith({ ...linkVals('af60lr'), rx_sensitivity_a_dbm: -78, rx_sensitivity_b_dbm: -78 })), flat);
    expect(codes(a)).toEqual(['LINK_RAIN_AVAILABILITY_LOW']);
    expect(a.links[0].rain.availabilityPct).toBeGreaterThan(99.8);
  });
  it('the availability target and the design rain rate are editable thresholds', () => {
    const at = (settings) => analyseWireless(state(linkWith(linkVals('af60lr')), LNG_10KM, settings), flat);
    expect(at({ minAvailabilityPct: 99.5 }).status).toBe('VALIDATED');
    expect(at({ rainRate001Mmh: 12 }).status).toBe('INVALID');            // even a moderately wet climate (99.86%) is not enough
    expect(at({ rainRate001Mmh: 8 }).status).toBe('VALIDATED');           // a far drier climate is
    expect(at({ rainRate001Mmh: 45 }).links[0].rain.availabilityPct).toBeLessThan(at(null).links[0].rain.availabilityPct);
  });
  it('a clear-sky floor still applies: below 6 dB of margin the link fails LINK_MARGIN_LOW even before rain', () => {
    const a = analyseWireless(state(linkWith({ ...linkVals('af60lr'), freq_ghz: 66.96 })), flat);      // ~5.5 dB at 10 km
    expect(codes(a)).toEqual(['LINK_MARGIN_LOW']);
    expect(a.issues[0].message).toMatch(/clear-sky/);
  });
  it('below the rain threshold (10 GHz) the flat fade margin is used and no rain assessment is made', () => {
    const l = { ...linkVals('ptp11'), freq_ghz: 5.8, channel_width_mhz: 40, tx_power_a_dbm: 25, tx_power_b_dbm: 25, gain_a_dbi: 30, gain_b_dbi: 30, rx_sensitivity_a_dbm: -80, rx_sensitivity_b_dbm: -80 };
    const a = analyseWireless(state(linkWith(l)), flat);
    expect(a.links[0].rain).toBeNull();
    expect(codes(a)).not.toContain('LINK_RAIN_AVAILABILITY_LOW');
    const b = analyseWireless(state(linkWith({ ...l, gain_a_dbi: 15, gain_b_dbi: 15 })), flat);      // ~7 dB: under the flat 15 dB
    expect(codes(b)).toEqual(['LINK_MARGIN_LOW']);
    expect(b.issues[0].message).toMatch(/dB more/);
  });
  it('channel choice matters enormously: on 66.96 GHz the same path has ~5 dB and on 64.8 GHz it is hopeless', () => {
    const at = (f) => analyseWireless(state(linkWith({ ...linkVals('af60lr'), freq_ghz: f })), flat).links[0];
    expect(at(66.96).fadeMarginDb).toBeLessThan(at(69.12).fadeMarginDb - 5);
    expect(at(64.8).fadeMarginDb).toBeLessThan(-20);
  });
});

describe('11 GHz backhaul preset', () => {
  it('passes a clear ~10 km path with almost no atmospheric loss', () => {
    const a = analyseWireless(state(linkWith(linkVals('ptp11'))), flat);
    expect(a.status).toBe('VALIDATED');
    expect(a.links[0].fadeMarginDb).toBeGreaterThan(20);
    expect(a.links[0].atmosLossDb).toBeLessThan(0.5);
    expect(a.links[0].rain.availabilityPct).toBeGreaterThan(99.99);    // 11 GHz rain fade is mild
    expect(a.links[0].rain.a001Db).toBeLessThan(10);
  });
});

describe('gas absorption applied to links and coverage', () => {
  it('atmosLossDbPerKm follows the ITU model at each frequency', () => {
    const S = resolveWirelessSettings(null);
    expect(atmosLossDbPerKm(60.48, S)).toBeGreaterThan(14);
    expect(atmosLossDbPerKm(11, S)).toBeCloseTo(0.0158, 3);
    expect(atmosLossDbPerKm(80, S)).toBeGreaterThan(0.2);                     // E-band is modelled, not zero
    expect(atmosLossDbPerKm(69.12, S)).toBeCloseTo(gaseousAttenuationDbPerKm(69.12), 6);
  });
  it('the model can be switched off, and temperature and humidity are editable', () => {
    expect(atmosLossDbPerKm(60.48, resolveWirelessSettings({ gasModel: 0 }))).toBe(0);
    const dry = atmosLossDbPerKm(22.235, resolveWirelessSettings({ gasWaterVapourGm3: 0.5 }));
    expect(dry).toBeLessThan(atmosLossDbPerKm(22.235, resolveWirelessSettings(null)) / 5);
  });
  it('a 60.48 GHz link needs no manual allowance and carries distance x ~15 dB of gas loss (so it fails at 10 km)', () => {
    const a = analyseWireless(state(linkWith({ ...linkVals('af60lr'), freq_ghz: 60.48 })), flat);
    expect(codes(a)).not.toContain('LINK_ABSORPTION_UNMODELLED');
    expect(a.links[0].atmosLossDb).toBeCloseTo(gaseousAttenuationDbPerKm(60.48) * a.links[0].distanceKm, 6);
    expect(a.links[0].verdict).toBe('FAIL');
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
