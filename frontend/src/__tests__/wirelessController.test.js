import { describe, it, expect } from 'vitest';
import { runWirelessAnalysis, runWirelessCoverage } from '../wirelessController.js';
import { TILE_SIZE } from '../wirelessTerrainTiles.js';
import { destinationPoint } from '../wirelessGeo.js';
import { hashWirelessInputs } from '../wirelessInputs.js';

function rgbaFor(heightM) {
  const v = Math.round((heightM + 10000) * 10);
  const a = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
  for (let i = 0; i < TILE_SIZE * TILE_SIZE; i++) { a[i * 4] = Math.floor(v / 65536); a[i * 4 + 1] = Math.floor((v % 65536) / 256); a[i * 4 + 2] = v % 256; a[i * 4 + 3] = 255; }
  return a;
}
const flatTiles = async () => rgbaFor(100);

const A = { lng: -4.0, lat: 56.5 }, B = destinationPoint(A, 90, 6000);
const site = (id, c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [c.lng, c.lat] }, properties: { site_id: id, mast_height_m: 30 } });
const link = (o = {}) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[A.lng, A.lat], [B.lng, B.lat]] }, properties: {
  link_id: 'L1', site_a: 'S1', site_b: 'S2', freq_ghz: 5, tx_power_a_dbm: 25, gain_a_dbi: 30, rx_sensitivity_a_dbm: -80,
  tx_power_b_dbm: 25, gain_b_dbi: 30, rx_sensitivity_b_dbm: -80, ...o } });
const sector = (id, siteId, az, o = {}) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [A.lng, A.lat] }, properties: {
  sector_id: id, site_id: siteId, azimuth_deg: az, beamwidth_deg: 90, freq_ghz: 5, tx_power_dbm: 24, gain_dbi: 17, antenna_height_m: 30,
  range_m: 2500, cpe_height_m: 4, cpe_gain_dbi: 20, cpe_min_rx_dbm: -75, ...o } });
const addr = (c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [c.lng, c.lat] }, properties: {} });
const state = (o = {}) => ({ wirelessSites: [site('S1', A), site('S2', B)], wirelessLinks: [link()], wirelessSectors: [], addressPoints: [], ...o });

describe('runWirelessAnalysis', () => {
  it('loads tiles, analyses, and validates a good link', async () => {
    const r = await runWirelessAnalysis(state(), { fetchTile: flatTiles });
    expect(r.analysis.status).toBe('VALIDATED');
    expect(r.terrainInfo.tilesFailed).toBe(0);
    expect(r.profiles.get('L1').status).toBe('OK');
    expect(r.analysis.inputHash).toBe(hashWirelessInputs(state()));
  });
  it('no key: fails closed with a clear warning, never a silent pass', async () => {
    const r = await runWirelessAnalysis(state(), {});
    expect(r.analysis.status).toBe('INVALID');
    expect(r.analysis.issues.map(i => i.code)).toContain('LINK_NO_TERRAIN');
    expect(r.warning).toMatch(/MapTiler key/);
  });
  it('all tiles failing: fails closed and reports the failure count', async () => {
    const r = await runWirelessAnalysis(state(), { fetchTile: async () => null });
    expect(r.analysis.status).toBe('INVALID');
    expect(r.terrainInfo.tilesFailed).toBeGreaterThan(0);
    expect(r.warning).toMatch(/failed to load/);
  });
  it('a recorded survey lets a link pass with no terrain (budget still enforced)', async () => {
    const s = state({ wirelessLinks: [link({ survey_los_confirmed: true, survey_note: 'walked 12/09' })] });
    const r = await runWirelessAnalysis(s, {});
    expect(r.analysis.status).toBe('VALIDATED');
    expect(r.analysis.issues.some(i => i.code === 'LINK_SURVEYED_LOS')).toBe(true);
  });
});

describe('runWirelessCoverage', () => {
  it('needs a key/fetcher, and at least one complete sector', async () => {
    expect((await runWirelessCoverage(state({ wirelessSectors: [sector('X', 'S1', 90)] }), {})).ok).toBe(false);
    const none = await runWirelessCoverage(state(), { fetchTile: flatTiles });
    expect(none.ok).toBe(false); expect(none.error).toMatch(/no complete sectors/i);
    const bad = await runWirelessCoverage(state({ wirelessSectors: [sector('X', 'S1', '')] }), { fetchTile: flatTiles });
    expect(bad.ok).toBe(false); expect(bad.skipped[0].sector_id).toBe('X');
  });

  it('computes best-server margin and counts premises: near covered, behind/far uncovered', async () => {
    const near = destinationPoint(A, 90, 1200), behind = destinationPoint(A, 270, 1200), far = destinationPoint(A, 90, 20000);
    const s = state({ wirelessSectors: [sector('X', 'S1', 90)], addressPoints: [addr(near), addr(behind), addr(far)] });
    const r = await runWirelessCoverage(s, { fetchTile: flatTiles });
    expect(r.ok).toBe(true);
    expect(r.inputHash).toBe(hashWirelessInputs(s));
    expect(r.premises.total).toBe(3);
    expect(r.premises.served).toBe(1);
    expect(r.premises.noData).toBe(1);          // 20 km is outside the analysed area: no data, not "unserved"
    expect(r.premises.unserved).toBe(1);        // behind the sector: computed, but below the margin
    expect(r.terrainInfo.model).toBe('UNKNOWN');
  });

  it('a second sector pointing the other way covers the previously uncovered premises', async () => {
    const behind = destinationPoint(A, 270, 1200);
    const one = state({ wirelessSectors: [sector('X', 'S1', 90)], addressPoints: [addr(behind)] });
    const two = state({ wirelessSectors: [sector('X', 'S1', 90), sector('Y', 'S1', 270)], addressPoints: [addr(behind)] });
    expect((await runWirelessCoverage(one, { fetchTile: flatTiles })).premises.served).toBe(0);
    expect((await runWirelessCoverage(two, { fetchTile: flatTiles })).premises.served).toBe(1);
  });

  it('missing terrain is never reported as coverage', async () => {
    const near = destinationPoint(A, 90, 1200);
    const s = state({ wirelessSectors: [sector('X', 'S1', 90)], addressPoints: [addr(near)] });
    const r = await runWirelessCoverage(s, { fetchTile: async () => null });
    expect(r.ok).toBe(false);                  // no ground at the site and no override
    const withGround = { ...s, wirelessSites: [{ ...s.wirelessSites[0], properties: { ...s.wirelessSites[0].properties, ground_override_m: 100 } }, s.wirelessSites[1]] };
    const r2 = await runWirelessCoverage(withGround, { fetchTile: async () => null });
    expect(r2.ok).toBe(true);
    expect(r2.premises.served).toBe(0);
    expect(r2.premises.noData).toBe(1);
    expect(r2.warning).toMatch(/failed to load/);
  });

  it('refuses an analysis area that is too large', async () => {
    const s = state({ wirelessSectors: [sector('X', 'S1', 90, { range_m: 30000 })] });
    s.wirelessSites = [site('S1', A), site('S2', { lng: A.lng + 1.5, lat: A.lat })];
    s.wirelessSectors.push(sector('Y', 'S2', 90, { range_m: 30000 }));
    const r = await runWirelessCoverage(s, { fetchTile: flatTiles });
    expect(r.ok).toBe(false); expect(r.error).toMatch(/too large/);
  });

  it('is deterministic', async () => {
    const s = state({ wirelessSectors: [sector('X', 'S1', 90)] });
    const a = await runWirelessCoverage(s, { fetchTile: flatTiles }), b = await runWirelessCoverage(s, { fetchTile: flatTiles });
    expect(Buffer.from(a.grid.rxDbm.buffer).equals(Buffer.from(b.grid.rxDbm.buffer))).toBe(true);
  });
});
