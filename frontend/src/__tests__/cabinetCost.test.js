// cabinetCost.test.js — Regression suite for buildCabinetCost().
//
// WHY THIS EXISTS: flagged in the 1 Jul independent audit as the one engine
// file left with zero test coverage after designHealth.js's gap was closed —
// every other engine in this project now has a suite; this closes the last
// one. buildCabinetCost() is a thin wrapper over buildBom() (see the header
// comment in cabinetCost.js), so this suite is deliberately narrow: it isn't
// re-testing buildBom()'s line-item costing logic (bom.test.js already holds
// that to a hand-verified bar) — it's testing that the wrapper correctly
// derives per-premise cost, extracts the right section, and handles its own
// specific edge cases (no cabinet, zero premises, exchange vs street-cabinet
// site costs) without silently diverging from what buildBom() itself would
// report for the same store.
//
// Every expected total below was calculated independently against
// DEFAULT_COSTS (bom.js lines 44-53) and buildBom()'s actual equipment-row
// logic (bom.js lines 339-380) before running anything — same convention as
// bom.test.js and designHealth.test.js.
//
// Run with: npm test

import { describe, it, expect } from 'vitest';
import { buildCabinetCost } from '../cabinetCost.js';
import { buildBom, DEFAULT_COSTS } from '../bom.js';

// ── Fixture: a fully-equipped street cabinet, 2 premises ────────────────────
// pop_type: 'CABINET' → site build-out (enclosure + electrical) is included.
//
// Hand-calculated expected Network Equip total (DEFAULT_COSTS):
//   Cabinet Enclosure + Groundworks:  1 * 4039.72             = 4039.72
//   Electrical Hookup:                1 * 24.96                = 24.96
//   Eaton DU-X Rectifier Shelf:       1 * 900.00                = 900.00
//   Eaton APR48-ES Inverter:          1 * 202.00                = 202.00
//   Calix E7-2 Shelf:                 1 * 556.63                = 556.63
//   Calix E7-2 GPON-8 Card:           2 * 4200.00               = 8400.00
//   Calix GPON SFP:                   4 * 110.00                = 440.00
//   Yuasa Battery Set:                1 * 145.00                = 145.00
//   19in Battery Shelf:               1 * 40.00 (batts>0 → qty 1) = 40.00
//   19in Patch Panel:                 2 * 60.00                 = 120.00
//   Aggregation Router:               1 * 8000.00 (has_aggreg_router) = 8000.00
//   Management Switch:                1 * 200.00 (always)        = 200.00
//   ───────────────────────────────────────────────────────────────────
//   Network Equip subtotal = 23068.31
//
// No cables/joints/ducts/etc in this fixture, so Network Equip is the only
// non-empty section — grandTotal = 23068.31.
// perPremise = round(23068.31 / 2 * 100) / 100 = 11534.16
function cabinetFixture({ popType = 'CABINET', premises = 2, popName, popId = 'CAB-1' } = {}) {
  return {
    cabinet: {
      properties: {
        pop_id: popId,
        pop_name: popName,
        pop_type: popType,
        dux_shelves: 1,
        calix_shelves: 1,
        gpon_cards: 2,
        gpon_optics: 4,
        battery_sets: 1,
        patch_panels: 2,
        has_aggreg_router: true,
      },
    },
    addressPoints: Array.from({ length: premises }, (_, i) => ({ properties: { uprn: String(1000000 + i) } })),
    cables: [], spans: [], cbtTails: [], bundles: [], dropDucts: [], aerialDrops: [],
    joints: [], ducts: [], chambers: [], poles: [], cbts: [],
  };
}

describe('buildCabinetCost — no cabinet', () => {
  it('returns null when no cabinet has been placed', () => {
    const store = cabinetFixture();
    store.cabinet = null;
    expect(buildCabinetCost(store)).toBeNull();
  });
});

describe('buildCabinetCost — street cabinet, fully equipped', () => {
  it('computes the correct grand total and per-premise figure', () => {
    const result = buildCabinetCost(cabinetFixture({ premises: 2 }));
    expect(result.grandTotal).toBe(23068.31);
    expect(result.premises).toBe(2);
    expect(result.perPremise).toBe(11534.16);
  });

  it('extracts the Network Equip section specifically, matching its subtotal to grandTotal', () => {
    const result = buildCabinetCost(cabinetFixture());
    expect(result.equipSection.name).toBe('Network Equip');
    expect(result.equipSection.subtotal).toBe(result.grandTotal);
    // Fixture has no other section contributing anything, so this is a
    // meaningful equivalence check, not a tautology.
  });

  it('includes site build-out (enclosure + electrical) for pop_type CABINET', () => {
    const result = buildCabinetCost(cabinetFixture({ popType: 'CABINET' }));
    const descs = result.equipSection.rows.map(r => r.description);
    expect(descs).toContain('Cabinet Enclosure + Groundworks');
    expect(descs).toContain('Electrical Hookup');
  });
});

describe('buildCabinetCost — non-cabinet site (exchange/DC/rooftop)', () => {
  it('excludes site build-out costs when pop_type is not CABINET, dropping the total accordingly', () => {
    const result = buildCabinetCost(cabinetFixture({ popType: 'EXCHANGE' }));
    const descs = result.equipSection.rows.map(r => r.description);
    expect(descs).not.toContain('Cabinet Enclosure + Groundworks');
    expect(descs).not.toContain('Electrical Hookup');
    // Same active-electronics fixture, minus the two site build-out rows
    // (4039.72 + 24.96 = 4064.68) from the CABINET case above.
    expect(result.grandTotal).toBe(19003.63);
  });

  it('pop_type is case-insensitive ("cabinet" lowercase still counts as a street cabinet)', () => {
    const result = buildCabinetCost(cabinetFixture({ popType: 'cabinet' }));
    const descs = result.equipSection.rows.map(r => r.description);
    expect(descs).toContain('Cabinet Enclosure + Groundworks');
  });
});

describe('buildCabinetCost — per-premise edge cases', () => {
  it('does not divide by zero when no premises are imported yet', () => {
    const result = buildCabinetCost(cabinetFixture({ premises: 0 }));
    expect(result.premises).toBe(0);
    expect(result.perPremise).toBe(0);
    // grandTotal is unaffected — equipment cost exists independent of
    // premises count, only the per-premise apportionment guards to 0.
    expect(result.grandTotal).toBe(23068.31);
  });
});

describe('buildCabinetCost — popName / popType passthrough', () => {
  it('uses pop_name when set', () => {
    const result = buildCabinetCost(cabinetFixture({ popName: 'Tarvin Cabinet 1' }));
    expect(result.popName).toBe('Tarvin Cabinet 1');
  });

  it('falls back to pop_id when pop_name is unset', () => {
    const result = buildCabinetCost(cabinetFixture({ popName: undefined, popId: 'CAB-42' }));
    expect(result.popName).toBe('CAB-42');
  });

  it('passes through pop_type verbatim (not normalised) for display', () => {
    const result = buildCabinetCost(cabinetFixture({ popType: 'EXCHANGE' }));
    expect(result.popType).toBe('EXCHANGE');
  });
});

describe('buildCabinetCost — consistency with buildBom (no silent divergence)', () => {
  it('sections and grandTotal match what buildBom() itself reports for the same store, verbatim', () => {
    // buildCabinetCost is documented as a thin wrapper, not a separate
    // calculation — this test guards that claim directly with a real
    // side-by-side comparison, rather than trusting the header comment or
    // re-asserting the same hand-calculated number twice.
    const store = cabinetFixture();
    const bomResult = buildBom(store, DEFAULT_COSTS);
    const cabResult = buildCabinetCost(store, DEFAULT_COSTS);

    expect(cabResult.grandTotal).toBe(bomResult.grandTotal);
    expect(cabResult.sections).toEqual(bomResult.sections);
    expect(cabResult.equipSection).toEqual(
      bomResult.sections.find(s => s.name === 'Network Equip')
    );
  });

  it('a cost override passed to buildCabinetCost reaches buildBom identically (no cost table gets silently dropped)', () => {
    const store = cabinetFixture();
    const customCosts = { ...DEFAULT_COSTS, mgmt_switch_each: 999.99 };
    const result = buildCabinetCost(store, customCosts);
    const switchRow = result.equipSection.rows.find(r => r.description === 'Management Switch');
    expect(switchRow.unit_cost).toBe(999.99);
  });
});
