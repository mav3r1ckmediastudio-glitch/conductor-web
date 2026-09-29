import { describe, it, expect } from 'vitest';
import { analyseWireless, wirelessPlanReady, wirelessPlanState, checkSector } from '../wirelessAnalysis.js';
import { hashWirelessInputs, canonicalWirelessInputs } from '../wirelessInputs.js';
import { destinationPoint, groundDistanceM } from '../wirelessGeo.js';

const A = { lng: -4.0, lat: 56.5 };
const B = destinationPoint(A, 90, 10_000);
const site = (id, c, mast = 30) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [c.lng, c.lat] }, properties: { site_id: id, mast_height_m: mast } });
const linkProps = (o = {}) => ({
  link_id: 'L1', site_a: 'S1', site_b: 'S2', freq_ghz: 5,
  tx_power_a_dbm: 25, gain_a_dbi: 30, rx_sensitivity_a_dbm: -80,
  tx_power_b_dbm: 25, gain_b_dbi: 30, rx_sensitivity_b_dbm: -80, ...o,
});
const link = (o) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[A.lng, A.lat], [B.lng, B.lat]] }, properties: linkProps(o) });
const base = (o = {}) => ({ wirelessSites: [site('S1', A), site('S2', B)], wirelessLinks: [link()], wirelessSectors: [], wirelessSettings: null, ...o });
const flat = (h = 100) => ({ id: 't', model: 'UNKNOWN', resolutionM: 30, sample: () => h });
const ridge = (peak) => ({ ...flat(), sample: (lng, lat) => 100 + peak * Math.exp(-(((groundDistanceM(A, { lng, lat }) - 5000) / 150) ** 2)) });
const codes = (r) => r.issues.map(i => i.code);

describe('analyseWireless — happy path', () => {
  it('a clear, well-margined link validates', () => {
    const r = analyseWireless(base(), flat());
    expect(r.status).toBe('VALIDATED');
    expect(r.links[0].verdict).toBe('PASS');
    expect(r.links[0].fadeMarginDb).toBeGreaterThan(15);
    expect(r.links[0].terrainStatus).toBe('OK');
    expect(r.terrainId).toBe('t');
    expect(r.inputHash).toBe(hashWirelessInputs(base()));
  });
  it('reports both directions of the budget', () => {
    const r = analyseWireless(base({ wirelessLinks: [link({ tx_power_b_dbm: 15 })] }), flat()).links[0];
    expect(r.fadeAtoBDb).toBeGreaterThan(r.fadeBtoADb);
    expect(r.fadeMarginDb).toBeCloseTo(r.fadeBtoADb, 9);
  });
  it('is deterministic', () => {
    expect(analyseWireless(base(), ridge(5))).toEqual(analyseWireless(base(), ridge(5)));
  });
});

describe('analyseWireless — fails closed', () => {
  it('empty project is INVALID, not VALIDATED', () => {
    expect(analyseWireless({ wirelessSites: [], wirelessLinks: [], wirelessSectors: [] }, flat()).status).toBe('INVALID');
  });
  it('missing endpoint site', () => {
    const r = analyseWireless(base({ wirelessLinks: [link({ site_b: 'NOPE' })] }), flat());
    expect(codes(r)).toContain('LINK_ENDPOINT_MISSING');
    expect(r.status).toBe('INVALID');
  });
  it('same site on both ends', () => {
    expect(codes(analyseWireless(base({ wirelessLinks: [link({ site_b: 'S1' })] }), flat()))).toContain('LINK_SAME_SITE');
  });
  it.each(['freq_ghz', 'tx_power_a_dbm', 'gain_b_dbi', 'rx_sensitivity_a_dbm'])('missing %s is LINK_PARAMS_INCOMPLETE, never a silent 0', (k) => {
    const r = analyseWireless(base({ wirelessLinks: [link({ [k]: '' })] }), flat());
    expect(codes(r)).toContain('LINK_PARAMS_INCOMPLETE');
    expect(r.status).toBe('INVALID');
  });
  it('obstructed path', () => {
    const r = analyseWireless(base(), ridge(80));
    expect(codes(r)).toContain('LINK_OBSTRUCTED');
    expect(r.status).toBe('INVALID');
  });
  it('Fresnel intrusion without obstruction', () => {
    const r = analyseWireless(base(), ridge(22));
    expect(codes(r)).toContain('LINK_FRESNEL_FAIL');
    expect(codes(r)).not.toContain('LINK_OBSTRUCTED');
  });
  it('low fade margin', () => {
    const r = analyseWireless(base({ wirelessLinks: [link({ rx_sensitivity_b_dbm: -45 })] }), flat());
    expect(codes(r)).toContain('LINK_MARGIN_LOW');
    expect(r.status).toBe('INVALID');
  });
  it('no terrain / partial terrain', () => {
    expect(codes(analyseWireless(base(), { ...flat(), sample: () => null }))).toContain('LINK_NO_TERRAIN');
    let n = 0;
    expect(codes(analyseWireless(base(), { ...flat(), sample: () => (++n === 40 ? null : 100) }))).toContain('LINK_TERRAIN_PARTIAL');
  });
  it('thresholds come from project settings', () => {
    const strict = base({ wirelessSettings: { minFadeMarginDb: 60 } });
    expect(codes(analyseWireless(strict, flat()))).toContain('LINK_MARGIN_LOW');
  });
  it('duplicate site ids and missing mast height are flagged', () => {
    const dup = base({ wirelessSites: [site('S1', A), site('S1', B)] });
    expect(codes(analyseWireless(dup, flat()))).toContain('SITE_DUPLICATE_ID');
    const nomast = base({ wirelessSites: [site('S1', A, ''), site('S2', B)] });
    expect(codes(analyseWireless(nomast, flat()))).toContain('SITE_PARAMS_INCOMPLETE');
  });
});

describe('surveyed-LOS override is explicit and documented', () => {
  const noTerrain = { ...flat(), sample: () => null };
  it('requires a note', () => {
    const r = analyseWireless(base({ wirelessLinks: [link({ survey_los_confirmed: true })] }), noTerrain);
    expect(codes(r)).toContain('LINK_PARAMS_INCOMPLETE');
    expect(r.status).toBe('INVALID');
  });
  it('with a note it waives missing terrain but leaves a visible warning', () => {
    const r = analyseWireless(base({ wirelessLinks: [link({ survey_los_confirmed: true, survey_note: 'Walked path 12/09, clear' })] }), noTerrain);
    expect(r.status).toBe('VALIDATED');
    expect(r.links[0].surveyed).toBe(true);
    expect(codes(r)).toContain('LINK_SURVEYED_LOS');
  });
  it('never waives a failing link budget', () => {
    const r = analyseWireless(base({ wirelessLinks: [link({ survey_los_confirmed: true, survey_note: 'x', rx_sensitivity_b_dbm: -45 })] }), noTerrain);
    expect(r.status).toBe('INVALID');
    expect(codes(r)).toContain('LINK_MARGIN_LOW');
  });
});

describe('sectors', () => {
  const sector = (o = {}) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [A.lng, A.lat] }, properties: {
    sector_id: 'SEC1', site_id: 'S1', azimuth_deg: 90, beamwidth_deg: 90, freq_ghz: 5, tx_power_dbm: 24, gain_dbi: 17,
    antenna_height_m: 30, range_m: 5000, cpe_height_m: 4, cpe_gain_dbi: 20, cpe_min_rx_dbm: -75, ...o } });
  it('complete sector passes checks', () => {
    expect(checkSector(sector(), new Map([['S1', site('S1', A)]]))).toEqual([]);
  });
  it('incomplete sector or unknown site makes the plan INVALID', () => {
    const r1 = analyseWireless(base({ wirelessSectors: [sector({ azimuth_deg: '' })] }), flat());
    expect(codes(r1)).toContain('SECTOR_PARAMS_INCOMPLETE');
    expect(r1.status).toBe('INVALID');
    expect(codes(analyseWireless(base({ wirelessSectors: [sector({ site_id: 'X' })] }), flat()))).toContain('SECTOR_SITE_MISSING');
  });
  it('rejects out-of-range values', () => {
    expect(checkSector(sector({ azimuth_deg: 400 }), new Map([['S1', {}]])).map(i => i.code)).toContain('SECTOR_PARAMS_INCOMPLETE');
  });
});

describe('freshness gate (same shape as the splice-plan gate)', () => {
  const valid = () => { const s = base(); return { ...s, wirelessAnalysis: analyseWireless(s, flat()) }; };
  it('ready only while inputs are unchanged', () => {
    const s = valid();
    expect(wirelessPlanReady(s)).toBe(true);
    expect(wirelessPlanState(s)).toBe('VALIDATED');
  });
  it.each([
    ['frequency edit',   (s) => ({ ...s, wirelessLinks: [link({ freq_ghz: 5.8 })] })],
    ['tx power edit',    (s) => ({ ...s, wirelessLinks: [link({ tx_power_a_dbm: 10 })] })],
    ['mast height edit', (s) => ({ ...s, wirelessSites: [site('S1', A, 45), site('S2', B)] })],
    ['site moved',       (s) => ({ ...s, wirelessSites: [site('S1', destinationPoint(A, 0, 5)), site('S2', B)] })],
    ['setting edit',     (s) => ({ ...s, wirelessSettings: { minFresnelClearancePct: 80 } })],
    ['link removed',     (s) => ({ ...s, wirelessLinks: [] })],
  ])('%s closes the gate immediately', (_n, edit) => {
    const s = edit(valid());
    expect(wirelessPlanReady(s)).toBe(false);
    expect(wirelessPlanState(s)).toBe('STALE');
  });
  it('an INVALID analysis is never ready', () => {
    const s = base(); const bad = { ...s, wirelessAnalysis: analyseWireless(s, ridge(80)) };
    expect(wirelessPlanReady(bad)).toBe(false);
    expect(wirelessPlanState(bad)).toBe('INVALID');
  });
  it('no analysis => UNVERIFIED; no assets => NONE', () => {
    expect(wirelessPlanState(base())).toBe('UNVERIFIED');
    expect(wirelessPlanState({})).toBe('NONE');
  });
});

describe('fingerprint', () => {
  it('ignores ordering and derived data', () => {
    const s = base({ wirelessLinks: [link({ link_id: 'L1' }), link({ link_id: 'L2' })] });
    const rev = { ...s, wirelessLinks: [...s.wirelessLinks].reverse(), wirelessAnalysis: { status: 'VALIDATED' } };
    expect(hashWirelessInputs(rev)).toBe(hashWirelessInputs(s));
  });
  it('is sensitive to ~1 cm of site movement', () => {
    const moved = base({ wirelessSites: [site('S1', { lng: A.lng + 1e-7, lat: A.lat }), site('S2', B)] });
    expect(hashWirelessInputs(moved)).not.toBe(hashWirelessInputs(base()));
  });
  it('canonical string covers settings, sites, sectors and links', () => {
    const c = canonicalWirelessInputs(base());
    for (const k of ['SETTINGS', 'SITES', 'SECTORS', 'LINKS']) expect(c).toContain(k);
  });
});
