// wirelessStore.test.js — schema v3 migration + projectStore wireless lifecycle.
// Same fresh-module / localStorage-mock pattern as projectStoreSession.test.js.
import { describe, it, expect, beforeEach, vi } from 'vitest';

function makeLocalStorageMock() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
}
beforeEach(() => { vi.resetModules(); vi.stubGlobal('localStorage', makeLocalStorageMock()); });

const A = { lng: -4.0, lat: 56.5 };
const B = { lng: -3.9, lat: 56.5 };
const site = (id, c, mast = 30) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [c.lng, c.lat] }, properties: { site_id: id, mast_height_m: mast } });
const sector = (id, siteId, c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [c.lng, c.lat] }, properties: { sector_id: id, site_id: siteId } });
const link = (id, a, b, o = {}) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[A.lng, A.lat], [B.lng, B.lat]] }, properties: {
  link_id: id, site_a: a, site_b: b, freq_ghz: 5, tx_power_a_dbm: 25, gain_a_dbi: 30, rx_sensitivity_a_dbm: -80,
  tx_power_b_dbm: 25, gain_b_dbi: 30, rx_sensitivity_b_dbm: -80, ...o } });
const flat = { id: 't', model: 'UNKNOWN', resolutionM: 30, sample: () => 100 };

async function fresh() {
  const { projectStore } = await import('../projectStore.js');
  projectStore.resetProject();
  const analysis = await import('../wirelessAnalysis.js');
  const inputs = await import('../wirelessInputs.js');
  return { projectStore, ...analysis, ...inputs };
}

describe('schema v3', () => {
  it('migrates a v2 project: empty wireless layer, fibre data untouched', async () => {
    const { validateProjectState, SCHEMA_VERSION } = await import('../projectSchema.js');
    const r = validateProjectState({ schemaVersion: 2, cables: [{ type: 'Feature' }], physicalPlanStatus: 'VALIDATED' });
    expect(SCHEMA_VERSION).toBe(3);
    expect(r.ok).toBe(true);
    expect(r.state.wirelessSites).toEqual([]);
    expect(r.state.wirelessLinks).toEqual([]);
    expect(r.state.wirelessSectors).toEqual([]);
    expect(r.state.wirelessAnalysis).toBeNull();
    expect(r.state.cables).toHaveLength(1);
    expect(r.state.physicalPlanStatus).toBe('VALIDATED');
    expect(r.migrations.join(' ')).toMatch(/v3/);
  });
  it('keeps wireless data that is already present, and repairs wrong-typed fields', async () => {
    const { validateProjectState } = await import('../projectSchema.js');
    const keep = validateProjectState({ schemaVersion: 3, wirelessSites: [site('S1', A)] });
    expect(keep.state.wirelessSites).toHaveLength(1);
    expect(keep.migrations).toHaveLength(0);
    const bad = validateProjectState({ schemaVersion: 3, wirelessSites: 'nope', wirelessAnalysis: [] });
    expect(bad.state.wirelessSites).toEqual([]);
    expect(bad.state.wirelessAnalysis).toBeNull();
    expect(bad.warnings.length).toBe(2);
  });
  it('an older build (max v2) would refuse a v3 file — the version really is > 2', async () => {
    const { validateProjectState, SCHEMA_VERSION } = await import('../projectSchema.js');
    expect(validateProjectState({ schemaVersion: SCHEMA_VERSION + 1 }).ok).toBe(false);
  });
});

describe('store: ids, updates, move, delete', () => {
  it('generates unique sequential ids and refuses duplicates', async () => {
    const { projectStore: s } = await fresh();
    s.setupProject({ name: 'T', areaId: 'SCOT-PH1' });
    expect(s.nextWirelessId('site')).toBe('SCOT-PH1-WS-001');
    expect(s.addWirelessSite(site('SCOT-PH1-WS-001', A))).toBe(true);
    expect(s.addWirelessSite(site('SCOT-PH1-WS-001', B))).toBe(false);
    expect(s.wirelessSites).toHaveLength(1);
    expect(s.nextWirelessId('site')).toBe('SCOT-PH1-WS-002');
  });

  it('updates properties immutably and never lets the id change', async () => {
    const { projectStore: s } = await fresh();
    s.addWirelessSite(site('S1', A));
    const before = s.wirelessSites;
    expect(s.updateWirelessProps('site', 'S1', { mast_height_m: 45, site_id: 'HACK' })).toBe(true);
    expect(s.wirelessSites).not.toBe(before);
    expect(s.wirelessSites[0].properties).toMatchObject({ site_id: 'S1', mast_height_m: 45 });
    expect(before[0].properties.mast_height_m).toBe(30);
    expect(s.updateWirelessProps('site', 'NOPE', {})).toBe(false);
  });

  it('moving a site drags its sectors and the matching link endpoints, in one update', async () => {
    const { projectStore: s } = await fresh();
    s.addWirelessSite(site('S1', A)); s.addWirelessSite(site('S2', B));
    s.addWirelessSector(sector('SEC1', 'S1', A));
    s.addWirelessLink(link('L1', 'S1', 'S2'));
    let emits = 0; s.on(() => emits++);
    expect(s.moveWirelessSite('S2', [-3.8, 56.6])).toBe(true);
    expect(emits).toBe(1);
    expect(s.wirelessLinks[0].geometry.coordinates).toEqual([[A.lng, A.lat], [-3.8, 56.6]]);
    expect(s.moveWirelessSite('S1', [-4.1, 56.4])).toBe(true);
    expect(s.wirelessSectors[0].geometry.coordinates).toEqual([-4.1, 56.4]);
    expect(s.wirelessLinks[0].geometry.coordinates[0]).toEqual([-4.1, 56.4]);
    expect(s.moveWirelessSite('NOPE', [0, 0])).toBe(false);
  });

  it('deleting a site cascades to its sectors and every link touching it, and reports it', async () => {
    const { projectStore: s } = await fresh();
    s.addWirelessSite(site('S1', A)); s.addWirelessSite(site('S2', B)); s.addWirelessSite(site('S3', { lng: -3.8, lat: 56.5 }));
    s.addWirelessSector(sector('SEC1', 'S1', A)); s.addWirelessSector(sector('SEC2', 'S2', B));
    s.addWirelessLink(link('L1', 'S1', 'S2')); s.addWirelessLink(link('L2', 'S2', 'S3')); s.addWirelessLink(link('L3', 'S1', 'S3'));
    const sum = s.deleteWirelessSite('S1');
    expect(sum.removed).toEqual({ wirelessSites: 1, wirelessSectors: 1, wirelessLinks: 2 });
    expect(s.wirelessLinks.map(l => l.properties.link_id)).toEqual(['L2']);
    expect(s.wirelessSectors.map(x => x.properties.sector_id)).toEqual(['SEC2']);
    expect(s.deleteWirelessSite('S1')).toBeNull();
    expect(s.deleteWirelessLink('L2')).toBe(true);
    expect(s.deleteWirelessLink('L2')).toBe(false);
    expect(s.deleteWirelessSector('SEC2')).toBe(true);
  });

  it('survives an autosave round-trip through validation', async () => {
    const { projectStore: s } = await fresh();
    s.addWirelessSite(site('S1', A)); s.addWirelessLink(link('L1', 'S1', 'S1'));
    s.flush();
    const { validateProjectState } = await import('../projectSchema.js');
    const r = validateProjectState(JSON.parse(JSON.stringify(s.stampForSave())));
    expect(r.ok).toBe(true);
    expect(r.state.wirelessSites).toHaveLength(1);
    expect(r.warnings).toEqual([]);
  });
});

describe('lifecycle: valid -> edit -> stale (the wireless equivalent of valid plan -> edit -> export blocked)', () => {
  async function validated() {
    const ctx = await fresh();
    const { projectStore: s } = ctx;
    s.addWirelessSite(site('S1', A)); s.addWirelessSite(site('S2', B));
    s.addWirelessLink(link('L1', 'S1', 'S2'));
    s.applyWirelessAnalysis(ctx.analyseWireless(s.state, flat));
    return ctx;
  }

  it('a fresh valid analysis opens the gate; the stored result carries a timestamp', async () => {
    const { projectStore: s, wirelessPlanReady, wirelessPlanState } = await validated();
    expect(wirelessPlanReady(s.state)).toBe(true);
    expect(wirelessPlanState(s.state)).toBe('VALIDATED');
    expect(typeof s.wirelessAnalysis.computedAt).toBe('string');
  });

  it.each([
    ['link parameter edit', (s) => s.updateWirelessProps('link', 'L1', { tx_power_a_dbm: 10 })],
    ['mast height edit',    (s) => s.updateWirelessProps('site', 'S1', { mast_height_m: 12 })],
    ['site move',           (s) => s.moveWirelessSite('S2', [-3.85, 56.5])],
    ['setting edit',        (s) => s.updateWirelessSettings({ minFadeMarginDb: 30 })],
    ['link delete',         (s) => s.deleteWirelessLink('L1')],
    ['site delete',         (s) => s.deleteWirelessSite('S2')],
    ['new link added',      (s) => s.addWirelessLink(link('L2', 'S2', 'S1'))],
  ])('%s closes the gate immediately', async (_n, edit) => {
    const { projectStore: s, wirelessPlanReady, wirelessPlanState } = await validated();
    edit(s);
    expect(wirelessPlanReady(s.state)).toBe(false);
    expect(wirelessPlanState(s.state)).toBe('STALE');
  });

  it('re-running after the edit reaches a fresh, correct state', async () => {
    const { projectStore: s, wirelessPlanReady, analyseWireless } = await validated();
    s.updateWirelessProps('link', 'L1', { rx_sensitivity_b_dbm: -40 });        // now fails the fade-margin rule
    s.applyWirelessAnalysis(analyseWireless(s.state, flat));
    expect(s.wirelessAnalysis.status).toBe('INVALID');
    expect(wirelessPlanReady(s.state)).toBe(false);
    s.updateWirelessProps('link', 'L1', { rx_sensitivity_b_dbm: -80 });
    s.applyWirelessAnalysis(analyseWireless(s.state, flat));
    expect(wirelessPlanReady(s.state)).toBe(true);
  });

  it('a stored VALIDATED result cannot be trusted after a save/load round trip if inputs differ', async () => {
    const { projectStore: s, wirelessPlanReady } = await validated();
    const snap = JSON.parse(JSON.stringify(s.stampForSave()));
    snap.wirelessLinks[0].properties.freq_ghz = 5.8;                             // hand-edit the saved file
    expect(wirelessPlanReady(snap)).toBe(false);
  });
});
