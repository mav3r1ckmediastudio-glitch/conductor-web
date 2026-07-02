// cascadeDelete.test.js — Regression suite for computeCascadeDelete().
//
// WHY THIS EXISTS: found live on Conductor Web on 02/07/26 — deleting a pole
// (SCOT-PH1-POL-001) had left its four aerial spans and every fibre
// assignment naming them dangling forever, reported by Design Health as 402
// blocking errors on an otherwise-healthy project. deleteAsset() previously
// just spliced the target out of its own array and stopped; nothing ever
// cleaned up the records that referenced it. This suite is built directly
// off the FK relationships documented in designHealth.js's Check 2c/2d
// comments (also now centralised in assetSchema.js) — each test below
// exercises exactly one of those relationships in isolation, then a combined
// test reproduces the actual multi-level cascade shape of the live bug
// (pole → span → fibre assignment, two levels deep).
//
// Every expected result below was worked out by hand from cascadeDelete.js's
// own logic before running anything, same convention as the rest of this
// suite (designHealth.test.js, fibreAssign.test.js, etc.).
//
// Run with: npm test

import { describe, it, expect } from 'vitest';
import { computeCascadeDelete } from '../cascadeDelete.js';

function apply(state, patch) {
  return { ...state, ...patch };
}

describe('computeCascadeDelete — direct delete only, no dependents', () => {
  it('removes just the target when nothing references it', () => {
    const state = { poles: [{ properties: { pole_id: 'POL-1' } }] };
    const { patch, summary } = computeCascadeDelete(state, 'poles', 0);
    expect(patch.poles).toEqual([]);
    expect(summary.removed).toEqual({});
    expect(summary.nulled).toEqual({});
  });

  it('returns null for an out-of-range index', () => {
    const state = { poles: [] };
    expect(computeCascadeDelete(state, 'poles', 0)).toBeNull();
  });
});

describe('computeCascadeDelete — node deletion cascades to cables/spans', () => {
  it('deleting a joint cascade-deletes cables with it as from_node or to_node', () => {
    const state = {
      joints: [{ properties: { joint_id: 'JNT-1' } }],
      cables: [
        { properties: { cable_id: 'CBL-1', from_node: 'JNT-1', to_node: 'CAB-1' } },
        { properties: { cable_id: 'CBL-2', from_node: 'CAB-1', to_node: 'JNT-1' } },
        { properties: { cable_id: 'CBL-3', from_node: 'OTHER', to_node: 'CAB-1' } },
      ],
    };
    const { patch, summary } = computeCascadeDelete(state, 'joints', 0);
    expect(patch.cables.map(c => c.properties.cable_id)).toEqual(['CBL-3']);
    expect(summary.removed.cables).toBe(2);
  });

  it('deleting a pole cascade-deletes aerial spans referencing it', () => {
    const state = {
      poles: [{ properties: { pole_id: 'POL-1' } }],
      spans: [
        { properties: { span_id: 'SPAN-1', from_node: 'POL-1', to_node: 'POL-2' } },
        { properties: { span_id: 'SPAN-2', from_node: 'POL-3', to_node: 'POL-4' } },
      ],
    };
    const { patch, summary } = computeCascadeDelete(state, 'poles', 0);
    expect(patch.spans.map(s => s.properties.span_id)).toEqual(['SPAN-2']);
    expect(summary.removed.spans).toBe(1);
  });
});

describe('computeCascadeDelete — the live bug: pole → span → fibre assignment', () => {
  it('deleting a pole cleans up fibre assignments naming its spans, two levels deep', () => {
    // Reproduces the exact shape found live: POL-001 has one span (SPAN-001),
    // and a fibre assignment references that span's id via cable_id (spans
    // share fibreAssignments.cable_id's namespace — see designHealth.js).
    const state = {
      poles: [{ properties: { pole_id: 'SCOT-PH1-POL-001' } }],
      spans: [{ properties: { span_id: 'SCOT-PH1-SPAN-001', from_node: 'SCOT-PH1-POL-001', to_node: 'SCOT-PH1-POL-002' } }],
      fibreAssignments: [
        { assign_id: 'ASN-0030', joint_id: 'SCOT-PH1-POL-001' },
        { assign_id: 'ASN-0031', cable_id: 'SCOT-PH1-SPAN-001' },
        { assign_id: 'ASN-0032', cable_id: 'SCOT-PH1-SPAN-999' }, // unrelated, must survive
      ],
    };
    const { patch, summary } = computeCascadeDelete(state, 'poles', 0);
    expect(patch.poles).toEqual([]);
    expect(patch.spans).toEqual([]);
    expect(patch.fibreAssignments.map(a => a.assign_id)).toEqual(['ASN-0032']);
    expect(summary.removed).toEqual({ spans: 1, fibreAssignments: 2 });
  });
});

describe('computeCascadeDelete — bundles and aerial drops', () => {
  it('deleting a joint cascade-deletes bundles hung off it, and their fibre assignments', () => {
    const state = {
      joints: [{ properties: { joint_id: 'JNT-1' } }],
      bundles: [{ properties: { bundle_id: 'BUN-1', from_joint: 'JNT-1', uprn: '1001' } }],
      fibreAssignments: [{ assign_id: 'ASN-1', bundle_id: 'BUN-1' }],
    };
    const { patch, summary } = computeCascadeDelete(state, 'joints', 0);
    expect(patch.bundles).toEqual([]);
    expect(patch.fibreAssignments).toEqual([]);
    expect(summary.removed).toEqual({ bundles: 1, fibreAssignments: 1 });
  });

  it('deleting a CBT cascade-deletes aerial drops off it (from_cbt) and their fibre assignments', () => {
    const state = {
      cbts: [{ properties: { cbt_id: 'CBT-1' } }],
      aerialDrops: [{ properties: { adrop_id: 'ADR-1', from_cbt: 'CBT-1' } }],
      fibreAssignments: [{ assign_id: 'ASN-1', bundle_id: 'ADR-1' }],
    };
    const { patch, summary } = computeCascadeDelete(state, 'cbts', 0);
    expect(patch.aerialDrops).toEqual([]);
    expect(patch.fibreAssignments).toEqual([]);
    expect(summary.removed).toEqual({ aerialDrops: 1, fibreAssignments: 1 });
  });

  it('deleting a pole cascade-deletes aerial drops off it via legacy from_node field', () => {
    const state = {
      poles: [{ properties: { pole_id: 'POL-1' } }],
      aerialDrops: [{ properties: { drop_id: 'DRP-1', from_node: 'POL-1' } }],
    };
    const { patch, summary } = computeCascadeDelete(state, 'poles', 0);
    expect(patch.aerialDrops).toEqual([]);
    expect(summary.removed.aerialDrops).toBe(1);
  });
});

describe('computeCascadeDelete — CBT tails', () => {
  it('deleting a CBT cascade-deletes its tails', () => {
    const state = {
      cbts: [{ properties: { cbt_id: 'CBT-1' } }],
      cbtTails: [
        { properties: { tail_id: 'TAIL-1', cbt_id: 'CBT-1' } },
        { properties: { tail_id: 'TAIL-2', cbt_id: 'CBT-2' } },
      ],
    };
    const { patch, summary } = computeCascadeDelete(state, 'cbts', 0);
    expect(patch.cbtTails.map(t => t.properties.tail_id)).toEqual(['TAIL-2']);
    expect(summary.removed.cbtTails).toBe(1);
  });
});

describe('computeCascadeDelete — legitimate-null fields are unlinked, not cascade-deleted', () => {
  it('deleting a chamber nulls chamber_id on joints snapped to it, keeping the joint', () => {
    const state = {
      chambers: [{ properties: { chamber_id: 'CHM-1' } }],
      joints: [
        { properties: { joint_id: 'JNT-1', chamber_id: 'CHM-1' } },
        { properties: { joint_id: 'JNT-2', chamber_id: 'CHM-2' } },
      ],
    };
    const { patch, summary } = computeCascadeDelete(state, 'chambers', 0);
    expect(patch.joints.map(j => j.properties.joint_id)).toEqual(['JNT-1', 'JNT-2']);
    expect(patch.joints[0].properties.chamber_id).toBeNull();
    expect(patch.joints[1].properties.chamber_id).toBe('CHM-2'); // untouched
    expect(summary.nulled).toEqual({ joints: 1 });
    expect(summary.removed).toEqual({});
  });

  it('deleting a duct nulls duct_id on cables referencing it, keeping the cable', () => {
    const state = {
      ducts: [{ properties: { duct_id: 'DCT-1' } }],
      cables: [{ properties: { cable_id: 'CBL-1', duct_id: 'DCT-1', from_node: 'A', to_node: 'B' } }],
    };
    const { patch, summary } = computeCascadeDelete(state, 'ducts', 0);
    expect(patch.cables).toHaveLength(1);
    expect(patch.cables[0].properties.duct_id).toBeNull();
    expect(patch.cables[0].properties.from_node).toBe('A'); // rest of the cable untouched
    expect(summary.nulled).toEqual({ cables: 1 });
  });

  it('deleting an address point nulls uprn on bundles matched to it, keeping the bundle', () => {
    const state = {
      addressPoints: [{ properties: { uprn: '1001' } }],
      bundles: [{ properties: { bundle_id: 'BUN-1', uprn: '1001', from_joint: 'JNT-1' } }],
    };
    const { patch, summary } = computeCascadeDelete(state, 'addressPoints', 0);
    expect(patch.bundles).toHaveLength(1);
    expect(patch.bundles[0].properties.uprn).toBeNull();
    expect(summary.nulled).toEqual({ bundles: 1 });
  });
});

describe('computeCascadeDelete — patch only includes touched collections', () => {
  it('does not include untouched collections in the patch', () => {
    const state = {
      poles: [{ properties: { pole_id: 'POL-1' } }],
      cables: [],
      spans: [],
      bundles: [{ properties: { bundle_id: 'BUN-1', from_joint: 'SOMETHING-ELSE' } }],
    };
    const { patch } = computeCascadeDelete(state, 'poles', 0);
    expect(Object.keys(patch)).toEqual(['poles']);
  });
});
