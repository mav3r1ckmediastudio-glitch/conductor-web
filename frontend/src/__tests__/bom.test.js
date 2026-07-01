// bom.test.js — Regression suite for buildBom(), the BoM costing engine.
//
// WHY THIS MATTERS MOST: per the audit, "a wrong... mis-costed BoM isn't a
// cosmetic bug — it's a number someone makes a build decision on." This is the
// one engine of the four (trace/assign/optical/bom) that turns directly into a
// price someone pays or charges. Getting the aggregation and rounding right
// here has the most real-world consequence of any test in this suite.
//
// As with the other suites: every expected total below was calculated by hand
// against DEFAULT_COSTS and buildBom()'s actual grouping/rounding logic
// (bom.js lines 64-392) before running anything.
//
// Run with: npm test

import { describe, it, expect } from 'vitest';
import { buildBom, generateBomHtml, DEFAULT_COSTS } from '../bom.js';

// ── Fixture: a small, fully-accounted project ───────────────────────────────
// Deliberately has NO cabinet — buildBom only adds a "Network Equip" section
// when store.cabinet exists (see bom.js line 346), so omitting it keeps this
// fixture isolated to exactly two sections: Fibre Cable and Joints. Every
// other section (Drop & Bundle, Duct, PIA, Home Install, Network Equip)
// should come back completely empty.
//
// Hand-calculated expected values:
//
//   FIBRE CABLE — two 48F G.652D FEEDER cables, 100m + 50m, grouped together
//     qty = 150m
//     unit_cost = DEFAULT_COSTS.cable_48f_m = 0.62
//     total = 150 * 0.62 = 93.00
//
//   JOINTS — one SPLICE joint, closure 'Prysmian CMJ', with a 1:8 splitter
//     Joint Closure — Prysmian CMJ:  1 * joint_cmj_each (66.81)   = 66.81
//     Prysmian Port Entry Gland:     1 * joint_gland_each (10.28) = 10.28
//     Splitter Module 1:8:           1 * splitter_1x8_each (8.62) = 8.62
//     Joints subtotal = 66.81 + 10.28 + 8.62 = 85.71
//
//   GRAND TOTAL = 93.00 + 85.71 = 178.71
function smallFixture() {
  return {
    cabinet: null,
    cables: [
      { properties: { cable_type: 'FEEDER', fibre_count: 48, fibre_type: 'G.652D', length_m: 100 } },
      { properties: { cable_type: 'FEEDER', fibre_count: 48, fibre_type: 'G.652D', length_m: 50 } },
    ],
    spans: [],
    cbtTails: [],
    bundles: [],
    dropDucts: [],
    aerialDrops: [],
    joints: [{
      properties: {
        joint_type: 'SPLICE', closure_type: 'Prysmian CMJ',
        has_splitter: true, split_ratio: '1:8',
      },
    }],
    ducts: [],
    chambers: [],
    poles: [],
    cbts: [],
  };
}

describe('buildBom — fibre cable grouping and costing', () => {
  const result = buildBom(smallFixture());
  const fibreCable = result.sections.find(s => s.name === 'Fibre Cable');

  it('groups same-spec cables into a single line and sums their length', () => {
    expect(fibreCable.rows).toHaveLength(1);
    expect(fibreCable.rows[0].qty).toBe(150);
    expect(fibreCable.rows[0].notes).toBe('2 cable(s)');
  });

  it('costs the cable line correctly at the default 48F rate (150m × £0.62)', () => {
    expect(fibreCable.rows[0].unit_cost).toBe(0.62);
    expect(fibreCable.rows[0].total).toBe(93.00);
  });

  it('subtotals the section correctly', () => {
    expect(fibreCable.subtotal).toBe(93.00);
  });
});

describe('buildBom — joint closure, gland, and splitter costing', () => {
  const result = buildBom(smallFixture());
  const joints = result.sections.find(s => s.name === 'Joints');

  it('produces exactly three lines: closure, gland, splitter', () => {
    expect(joints.rows).toHaveLength(3);
  });

  it('costs the CMJ closure correctly', () => {
    const row = joints.rows.find(r => r.description.includes('Prysmian CMJ'));
    expect(row.total).toBe(66.81);
  });

  it('adds one port entry gland per joint closure', () => {
    const row = joints.rows.find(r => r.description.includes('Gland'));
    expect(row.qty).toBe(1);
    expect(row.total).toBe(10.28);
  });

  it('costs the declared 1:8 splitter module, not a default/fallback ratio', () => {
    const row = joints.rows.find(r => r.description.includes('Splitter Module'));
    expect(row.description).toBe('Splitter Module 1:8');
    expect(row.total).toBe(8.62);
  });

  it('subtotals the section correctly (66.81 + 10.28 + 8.62)', () => {
    expect(joints.subtotal).toBe(85.71);
  });
});

describe('buildBom — sections that should stay empty', () => {
  const result = buildBom(smallFixture());

  it('leaves every other section empty for this fixture', () => {
    const untouchedSections = ['Drop & Bundle', 'Duct', 'PIA', 'Home Install', 'Network Equip'];
    for (const name of untouchedSections) {
      const section = result.sections.find(s => s.name === name);
      expect(section.rows).toEqual([]);
      expect(section.subtotal).toBe(0);
    }
  });

  it('does NOT add a Network Equip section when no cabinet is placed', () => {
    const networkEquip = result.sections.find(s => s.name === 'Network Equip');
    expect(networkEquip.rows).toHaveLength(0);
  });
});

describe('buildBom — grand total', () => {
  it('sums every section subtotal correctly (93.00 + 85.71 = 178.71)', () => {
    const result = buildBom(smallFixture());
    expect(result.grandTotal).toBe(178.71);
  });
});

describe('buildBom — custom cost overrides', () => {
  it('uses an overridden unit cost where supplied, and falls back to DEFAULT_COSTS for everything else', () => {
    // Override only the 48F cable rate; everything else (joint costs etc.)
    // should still come from DEFAULT_COSTS unchanged. This pins down the `C()`
    // merge behaviour in buildBom (costs[k] ?? DEFAULT_COSTS[k]) — important
    // because a future settings UI will pass partial overrides, not a full
    // replacement cost sheet.
    const customCosts = { ...DEFAULT_COSTS, cable_48f_m: 1.00 };
    const result = buildBom(smallFixture(), customCosts);

    const fibreCable = result.sections.find(s => s.name === 'Fibre Cable');
    expect(fibreCable.rows[0].unit_cost).toBe(1.00);
    expect(fibreCable.rows[0].total).toBe(150.00); // 150m × £1.00

    // Joints section is untouched by the override — still default pricing.
    const joints = result.sections.find(s => s.name === 'Joints');
    expect(joints.subtotal).toBe(85.71);

    // Grand total reflects the higher cable cost: 150.00 + 85.71
    expect(result.grandTotal).toBe(235.71);
  });
});

describe('buildBom — empty project baseline', () => {
  it('returns all-empty sections and a zero grand total for a blank project', () => {
    const emptyStore = {
      cabinet: null, cables: [], spans: [], cbtTails: [], bundles: [],
      dropDucts: [], aerialDrops: [], joints: [], ducts: [], chambers: [],
      poles: [], cbts: [],
    };
    const result = buildBom(emptyStore);
    expect(result.grandTotal).toBe(0);
    for (const section of result.sections) {
      expect(section.rows).toEqual([]);
      expect(section.subtotal).toBe(0);
    }
  });
});

describe('generateBomHtml — HTML escaping (1 Jul audit §3.4)', () => {
  // projName is the highest-risk field here — free text, directly
  // user-entered (project setup), not constrained by any dropdown.
  it('escapes a malicious project name — no raw tag reaches the output document', () => {
    const store = {
      project: { name: '<img src=x onerror=alert(1)>' },
      cabinet: null, cables: [], spans: [], cbtTails: [], bundles: [],
      dropDucts: [], aerialDrops: [], joints: [], ducts: [], chambers: [],
      poles: [], cbts: [],
    };
    const html = generateBomHtml(store);
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('escapes a closure_type value that flows through into a BoM row description', () => {
    // closure_type is the same free-text-capable field flagged in
    // splicePlan.js's escaping fix — confirms the fix covers it here too,
    // since it reaches the HTML via a completely different code path
    // (buildBom's joint-grouping logic, not splicePlan's per-joint render).
    const store = {
      cabinet: null, cables: [], spans: [], cbtTails: [], bundles: [],
      dropDucts: [], aerialDrops: [], ducts: [], chambers: [], poles: [], cbts: [],
      joints: [{ properties: { joint_type: 'SPLICE', closure_type: '"><script>x</script>' } }],
    };
    const html = generateBomHtml(store);
    expect(html).not.toContain('"><script>x</script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;x&lt;/script&gt;');
  });

  it('an ampersand in a project name renders as a literal & when viewed, not double-escaped', () => {
    const store = {
      project: { name: 'Smith & Sons Farm' },
      cabinet: null, cables: [], spans: [], cbtTails: [], bundles: [],
      dropDucts: [], aerialDrops: [], joints: [], ducts: [], chambers: [],
      poles: [], cbts: [],
    };
    const html = generateBomHtml(store);
    expect(html).toContain('Smith &amp; Sons Farm');
    expect(html).not.toContain('Smith & Sons Farm');
  });
});
