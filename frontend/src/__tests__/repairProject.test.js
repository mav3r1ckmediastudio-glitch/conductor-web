// repairProject.test.js — Regression suite for repairProject.js.
//
// WHY THIS EXISTS: cascadeDelete.js prevents NEW dangling references;
// repairProject.js cleans up the ones already saved in older projects. Found
// live on 02/07/26: SCOT-PH1 carried 402 dangling fibreAssignment records
// from a pole deleted long before cascadeDelete existed. This suite verifies
// the sweep (a) removes genuinely-dangling records, (b) leaves valid data and
// legitimate synthetic/optional references alone, (c) iterates to a fixpoint
// so multi-level orphaning is fully cleaned in one call, and (d) the dry-run
// (analyseProject) and the apply (repairProject) agree.
//
// Every expected count below was hand-derived from repairProject.js's rules
// before running anything — same convention as cascadeDelete.test.js and the
// rest of the suite.
//
// Run with: npm test

import { describe, it, expect } from 'vitest';
import { analyseProject, repairProject } from '../repairProject.js';

function apply(state, patch) {
  return { ...state, ...patch };
}

describe('repairProject — clean project is left untouched', () => {
  it('reports clean and produces an empty patch when nothing dangles', () => {
    const state = {
      cabinet: { properties: { pop_id: 'CAB-1' } },
      joints: [{ properties: { joint_id: 'JNT-1' } }],
      cables: [{ properties: { cable_id: 'CBL-1', from_node: 'JNT-1', to_node: 'CAB-1' } }],
      bundles: [{ properties: { bundle_id: 'BUN-1', from_joint: 'JNT-1' } }],
      fibreAssignments: [{ assign_id: 'ASN-1', joint_id: 'JNT-1', bundle_id: 'BUN-1' }],
    };
    const dry = analyseProject(state);
    expect(dry.clean).toBe(true);
    expect(dry.total).toBe(0);

    const { patch, summary } = repairProject(state);
    expect(summary.clean).toBe(true);
    expect(Object.keys(patch)).toEqual([]);
  });
});

describe('repairProject — the live bug: 402-style dangling assignments', () => {
  it('removes assignments naming a long-gone pole and its already-orphaned span', () => {
    // Pole POL-001 is ALREADY gone (not in the state — this is the
    // post-deletion corruption state, not a live delete). Its span is still
    // present but now dangling, and assignments reference both.
    const state = {
      cabinet: { properties: { pop_id: 'CAB-1' } },
      poles: [{ properties: { pole_id: 'SCOT-PH1-POL-002' } }],  // 001 is gone
      spans: [
        { properties: { span_id: 'SCOT-PH1-SPAN-001', from_node: 'SCOT-PH1-POL-001', to_node: 'SCOT-PH1-POL-002' } },
      ],
      fibreAssignments: [
        { assign_id: 'ASN-0030', joint_id: 'SCOT-PH1-POL-001' },   // dangling joint ref
        { assign_id: 'ASN-0031', cable_id: 'SCOT-PH1-SPAN-001' },  // names the span (valid THIS pass)
      ],
    };

    const { patch, summary } = repairProject(state);
    // Pass 1: SPAN-001 dangles (from_node POL-001 gone) → removed.
    //         ASN-0030 dangles (joint_id POL-001 gone) → removed.
    // Pass 2: ASN-0031 now dangles (SPAN-001 removed last pass) → removed.
    expect(summary.removed.spans).toBe(1);
    expect(summary.removed.fibreAssignments).toBe(2);
    expect(summary.passes).toBeGreaterThanOrEqual(2);   // needed the fixpoint loop
    expect(patch.spans).toEqual([]);
    expect(patch.fibreAssignments).toEqual([]);
  });
});

describe('repairProject — role-aware fibre assignment checks (no false positives)', () => {
  it('keeps synthetic -SP pigtail cable_ids (not dangling)', () => {
    const state = {
      joints: [{ properties: { joint_id: 'JNT-1' } }],
      fibreAssignments: [{ assign_id: 'ASN-1', joint_id: 'JNT-1', cable_id: 'JNT-1-SP' }],
    };
    expect(analyseProject(state).clean).toBe(true);
  });

  it('keeps bundle_id that is a downstream joint/CBT (feeder splitter convention)', () => {
    const state = {
      joints: [{ properties: { joint_id: 'JNT-1' } }],
      cbts: [{ properties: { cbt_id: 'CBT-1' } }],
      // feeder splitter's bundle_id points at a downstream CBT, not a bundle
      fibreAssignments: [{ assign_id: 'ASN-1', joint_id: 'JNT-1', bundle_id: 'CBT-1' }],
    };
    expect(analyseProject(state).clean).toBe(true);
  });

  it('keeps a cable_id that names an aerial span (fibre runs through spans)', () => {
    const state = {
      spans: [{ properties: { span_id: 'SPAN-1', from_node: 'JNT-1', to_node: 'JNT-2' } }],
      joints: [
        { properties: { joint_id: 'JNT-1' } },
        { properties: { joint_id: 'JNT-2' } },
      ],
      fibreAssignments: [{ assign_id: 'ASN-1', cable_id: 'SPAN-1' }],
    };
    expect(analyseProject(state).clean).toBe(true);
  });
});

describe('repairProject — legitimate-optional FKs are nulled, not the record removed', () => {
  it('nulls a dangling duct_id but keeps the cable', () => {
    const state = {
      cabinet: { properties: { pop_id: 'CAB-1' } },
      joints: [{ properties: { joint_id: 'JNT-1' } }],
      cables: [{ properties: { cable_id: 'CBL-1', from_node: 'JNT-1', to_node: 'CAB-1', duct_id: 'DCT-GONE' } }],
    };
    const { patch, summary } = repairProject(state);
    expect(summary.removed.cables).toBeUndefined();
    expect(summary.nulled.cables).toBe(1);
    expect(patch.cables[0].properties.duct_id).toBeNull();
    expect(patch.cables[0].properties.from_node).toBe('JNT-1');
  });

  it('nulls a dangling chamber_id but keeps the joint', () => {
    const state = {
      joints: [{ properties: { joint_id: 'JNT-1', chamber_id: 'CHM-GONE' } }],
    };
    const { patch, summary } = repairProject(state);
    expect(summary.nulled.joints).toBe(1);
    expect(patch.joints[0].properties.joint_id).toBe('JNT-1');
    expect(patch.joints[0].properties.chamber_id).toBeNull();
  });

  it('leaves already-null optional FKs completely alone', () => {
    const state = {
      cabinet: { properties: { pop_id: 'CAB-1' } },
      joints: [{ properties: { joint_id: 'JNT-1', chamber_id: null } }],
      cables: [{ properties: { cable_id: 'CBL-1', from_node: 'JNT-1', to_node: 'CAB-1', duct_id: null } }],
    };
    expect(analyseProject(state).clean).toBe(true);
  });
});

describe('repairProject — cascade removals', () => {
  it('removes a cable with a missing endpoint but keeps a fully-connected one', () => {
    const state = {
      cabinet: { properties: { pop_id: 'CAB-1' } },
      joints: [{ properties: { joint_id: 'JNT-1' } }],
      cables: [
        { properties: { cable_id: 'GOOD', from_node: 'JNT-1', to_node: 'CAB-1' } },
        { properties: { cable_id: 'BAD',  from_node: 'JNT-1', to_node: 'GONE' } },
      ],
    };
    const { patch, summary } = repairProject(state);
    expect(summary.removed.cables).toBe(1);
    expect(patch.cables.map(c => c.properties.cable_id)).toEqual(['GOOD']);
  });

  it('removes a bundle off a missing joint and a drop off a missing CBT', () => {
    const state = {
      joints: [],  // JNT-GONE is gone
      cbts: [],    // CBT-GONE is gone
      bundles: [{ properties: { bundle_id: 'BUN-1', from_joint: 'JNT-GONE' } }],
      aerialDrops: [{ properties: { adrop_id: 'ADR-1', from_cbt: 'CBT-GONE' } }],
    };
    const { summary } = repairProject(state);
    expect(summary.removed.bundles).toBe(1);
    expect(summary.removed.aerialDrops).toBe(1);
  });
});

describe('repairProject — dry run and apply agree', () => {
  it('analyseProject totals match repairProject summary totals', () => {
    const state = {
      cabinet: { properties: { pop_id: 'CAB-1' } },
      poles: [],
      spans: [{ properties: { span_id: 'SPAN-1', from_node: 'POL-GONE', to_node: 'CAB-1' } }],
      cables: [{ properties: { cable_id: 'CBL-1', from_node: 'JNT-GONE', to_node: 'CAB-1', duct_id: 'DCT-GONE' } }],
      joints: [],
      fibreAssignments: [
        { assign_id: 'ASN-1', joint_id: 'JNT-GONE' },
        { assign_id: 'ASN-2', cable_id: 'SPAN-1' },
      ],
    };
    const dry = analyseProject(state);
    const { summary } = repairProject(state);
    expect(dry.total).toBe(summary.total);
    expect(dry.removed).toEqual(summary.removed);
    expect(dry.nulled).toEqual(summary.nulled);
  });

  it('analyseProject does not mutate the input state', () => {
    const state = {
      spans: [{ properties: { span_id: 'SPAN-1', from_node: 'GONE', to_node: 'ALSO-GONE' } }],
    };
    analyseProject(state);
    expect(state.spans).toHaveLength(1); // untouched
  });
});
