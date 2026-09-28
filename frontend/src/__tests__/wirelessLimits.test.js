// Regression: a link with impossible radio inputs (e.g. 300 dBi) produced a
// +451.9 dBm received level and a 251.9 dB "margin", and 60 GHz links were
// budgeted as free space with no atmospheric absorption. Limits are editable
// project settings and part of the input fingerprint.
import { describe, it, expect } from 'vitest';
import { analyseWireless, checkSector, wirelessPlanState } from '../wirelessAnalysis.js';
import { hashWirelessInputs } from '../wirelessInputs.js';
import { resolveWirelessSettings, DEFAULT_WIRELESS_SETTINGS } from '../wirelessSettings.js';

const flat = { id: 't', sample: () => 100 };
const site = (id, lng) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, 56.5] }, properties: { site_id: id, mast_height_m: 30 } });
const link = (extra = {}) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[-4.1, 56.5], [-4.0, 56.5]] },
  properties: { link_id: 'L1', site_a: 'A', site_b: 'B', freq_ghz: 5.8, tx_power_a_dbm: 20, gain_a_dbi: 30, rx_sensitivity_a_dbm: -80,
    tx_power_b_dbm: 20, gain_b_dbi: 30, rx_sensitivity_b_dbm: -80, ...extra } });
const state = (l, settings = null) => ({ wirelessSites: [site('A', -4.1), site('B', -4.0)], wirelessLinks: [l], wirelessSectors: [], wirelessSettings: settings });
const codes = (a) => a.issues.map(i => i.code);

describe('radio plausibility limits', () => {
  it('a sensible 5.8 GHz link still validates', () => {
    expect(analyseWireless(state(link()), flat).status).toBe('VALIDATED');
  });

  it('an impossible antenna gain fails the link and computes no budget', () => {
    const a = analyseWireless(state(link({ gain_a_dbi: 300 })), flat);
    expect(a.status).toBe('INVALID');
    expect(codes(a)).toContain('LINK_PARAMS_IMPLAUSIBLE');
    expect(a.issues.find(i => i.code === 'LINK_PARAMS_IMPLAUSIBLE').message).toMatch(/antenna gain at A \(dBi\) is 300 \(allowed 0 to 50\)/);
    expect(a.links[0].rxAtoBDbm).toBeNull();
    expect(a.links[0].fadeMarginDb).toBeNull();
  });

  it('negative losses are rejected (they would act as gain)', () => {
    expect(codes(analyseWireless(state(link({ cable_loss_a_db: -20 })), flat))).toContain('LINK_PARAMS_IMPLAUSIBLE');
    expect(codes(analyseWireless(state(link({ extra_loss_db: -5 })), flat))).toContain('LINK_PARAMS_IMPLAUSIBLE');
  });

  it('limits are editable: raising the gain ceiling accepts the value', () => {
    const a = analyseWireless(state(link({ gain_a_dbi: 55 }), { gainMaxDbi: 60 }), flat);
    expect(codes(a)).not.toContain('LINK_PARAMS_IMPLAUSIBLE');
  });

  it('editing a limit makes a stored analysis stale', () => {
    const s = state(link());
    const edited = { ...s, wirelessAnalysis: analyseWireless(s, flat), wirelessSettings: { gainMaxDbi: 45 } };
    expect(wirelessPlanState(edited)).toBe('STALE');
    expect(hashWirelessInputs(s)).not.toBe(hashWirelessInputs({ ...s, wirelessSettings: { absorptionAboveGhz: 40 } }));
  });

  it('out-of-range limit edits fall back to the default rather than disabling the check', () => {
    expect(resolveWirelessSettings({ gainMaxDbi: 1000 }).gainMaxDbi).toBe(DEFAULT_WIRELESS_SETTINGS.gainMaxDbi);
  });
});

describe('atmospheric absorption above the threshold', () => {
  it('a 60 GHz link without an extra-loss allowance fails', () => {
    const a = analyseWireless(state(link({ freq_ghz: 60 })), flat);
    expect(a.status).toBe('INVALID');
    expect(codes(a)).toContain('LINK_ABSORPTION_UNMODELLED');
  });

  it('a recorded LOS survey does not waive it', () => {
    const a = analyseWireless(state(link({ freq_ghz: 60, survey_los_confirmed: true, survey_note: 'surveyed' })), flat);
    expect(codes(a)).toContain('LINK_ABSORPTION_UNMODELLED');
    expect(a.status).toBe('INVALID');
  });

  it('with an explicit allowance the absorption check is satisfied and the loss is applied', () => {
    const a = analyseWireless(state(link({ freq_ghz: 60, extra_loss_db: 20 })), flat);
    expect(codes(a)).not.toContain('LINK_ABSORPTION_UNMODELLED');
    const b = analyseWireless(state(link({ freq_ghz: 60, extra_loss_db: 40 })), flat);
    expect(a.links[0].rxAtoBDbm - b.links[0].rxAtoBDbm).toBeCloseTo(20, 6);
  });
});

describe('sectors', () => {
  const sites = new Map([['A', site('A', -4.1)]]);
  const sector = (extra = {}) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [-4.1, 56.5] }, properties: {
    sector_id: 'SC1', site_id: 'A', azimuth_deg: 90, beamwidth_deg: 90, freq_ghz: 5.8, tx_power_dbm: 20, gain_dbi: 17,
    antenna_height_m: 20, range_m: 5000, cpe_height_m: 5, cpe_gain_dbi: 23, cpe_min_rx_dbm: -75, ...extra } });
  const S = resolveWirelessSettings(null);

  it('a sensible sector has no issues', () => { expect(checkSector(sector(), sites, S)).toEqual([]); });
  it('an impossible CPE gain is flagged (so coverage skips the sector)', () => {
    expect(checkSector(sector({ cpe_gain_dbi: 230 }), sites, S).map(i => i.code)).toContain('SECTOR_PARAMS_IMPLAUSIBLE');
  });
  it('a 60 GHz sector is flagged as absorption-unmodelled', () => {
    expect(checkSector(sector({ freq_ghz: 60 }), sites, S).map(i => i.code)).toContain('SECTOR_ABSORPTION_UNMODELLED');
  });
});
