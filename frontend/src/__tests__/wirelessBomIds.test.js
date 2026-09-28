import { describe, it, expect } from 'vitest';
import { buildWirelessBom, generateWirelessBomCsv, generateWirelessBomHtml } from '../wirelessBom.js';
import { nextWirelessId } from '../wirelessIds.js';

const f = (props) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: props });
const state = {
  wirelessSites: [f({ site_id: 'S1', mast_height_m: 30 }), f({ site_id: 'S2', mast_height_m: 30 }), f({ site_id: 'S3', mast_height_m: 15 })],
  wirelessLinks: [f({ link_id: 'L1', freq_ghz: 5 }), f({ link_id: 'L2', freq_ghz: 24 })],
  wirelessSectors: [f({ sector_id: 'X1' }), f({ sector_id: 'X2' }), f({ sector_id: 'X3' })],
};

describe('wireless BoM', () => {
  it('counts quantities and never invents prices', () => {
    const b = buildWirelessBom(state);
    const q = (k) => b.lines.find(l => l.key === k)?.qty;
    expect(q('site')).toBe(3);
    expect(q('ptp_radio')).toBe(4);
    expect(q('sector_radio')).toBe(3);
    expect(q('ptp_radio_5ghz')).toBe(2);
    expect(q('mast_30m')).toBe(2);
    expect(b.total).toBeNull();
    expect(b.lines.every(l => l.unitCost === null && l.total === null)).toBe(true);
  });
  it('prices only lines the caller supplies a cost for; informational subsets are not double-counted', () => {
    const b = buildWirelessBom(state, { site: 1000, ptp_radio: 200, ptp_radio_5ghz: 999 });
    expect(b.total).toBe(3 * 1000 + 4 * 200);
  });
  it('stamps the plan state on every output so a draft cannot pass as validated', () => {
    expect(buildWirelessBom(state).planState).toBe('UNVERIFIED');
    expect(generateWirelessBomCsv(state)).toContain('NOT VALIDATED');
    expect(generateWirelessBomHtml(state)).toContain('UNVERIFIED');
  });
  it('escapes project text in HTML and quotes in CSV', () => {
    const s = { wirelessSites: [], wirelessLinks: [f({ link_id: 'L', freq_ghz: '<img src=x>' })], wirelessSectors: [] };
    expect(generateWirelessBomHtml(s)).not.toContain('<img src=x>');
    expect(generateWirelessBomCsv(s)).toContain('"');
  });
  it('an empty project produces no lines', () => {
    expect(buildWirelessBom({}).lines).toEqual([]);
  });
});

describe('nextWirelessId', () => {
  it('starts at 001, increments past the max, ignores other prefixes and junk', () => {
    expect(nextWirelessId('site', 'SCOT-PH1', [])).toBe('SCOT-PH1-WS-001');
    expect(nextWirelessId('site', 'SCOT-PH1', ['SCOT-PH1-WS-001', 'SCOT-PH1-WS-007', 'OTHER-WS-099', 'SCOT-PH1-WS-x'])).toBe('SCOT-PH1-WS-008');
    expect(nextWirelessId('link', 'A', ['A-WL-002'])).toBe('A-WL-003');
    expect(nextWirelessId('sector', undefined, [])).toBe('XX-XX-WSEC-001');
    expect(() => nextWirelessId('nope', 'A', [])).toThrow();
  });
  it('never reuses an id after a lower one is deleted', () => {
    expect(nextWirelessId('site', 'A', ['A-WS-001', 'A-WS-003'])).toBe('A-WS-004');
  });
});
