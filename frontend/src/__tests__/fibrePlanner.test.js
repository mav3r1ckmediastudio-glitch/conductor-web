// fibrePlanner.test.js — Golden fixtures for the demand-driven physical planner.
// Encodes the remediation spec §11 golden test fixtures. These are the
// correctness authority for the rewrite (spec §12/§13) and must be reviewed by
// a fibre-network engineer before build-facing splice plans are re-enabled.

import { describe, it, expect } from 'vitest';
import { planPhysicalFibres } from '../fibrePlanner.js';
import { PROFILE_COMPACT_OUTBOUND } from '../fibrePhysicalPlan.js';
import { validatePhysicalPlan } from '../fibrePlanValidation.js';

// ── fixture helpers ────────────────────────────────────────────────────────────
const cable = (id, from, to, fc, extra = {}) => ({ properties: { cable_id: id, from_node: from, to_node: to, fibre_count: fc, feed_mode: 'PASS_THROUGH', ...extra } });
const joint = (id, ratio) => ({ properties: { joint_id: id, has_splitter: !!ratio, split_ratio: ratio || undefined } });
const base = (over = {}) => ({
  cabinet: { properties: { pop_id: 'CAB-1' } },
  joints: [], cbts: [], spans: [], cbtTails: [], aerialDrops: [], bundles: [], cables: [],
  ...over,
});

function seg(records, segId) {
  const r = records.filter(x => x.cable_id === segId);
  const tap = r.filter(x => x.fibre_role === 'SPLITTER_INPUT').length;
  const thr = r.filter(x => x.fibre_role === 'THROUGH_SPLICE').length;
  const dark = r.filter(x => x.fibre_role === 'DARK_STORAGE').reduce((s, x) => s + (x.dark_count || 1), 0);
  return { tap, thr, dark, total: tap + thr + dark };
}

// ── 1. 96F + local 1:4, no onward demand → 1 tap, 0 through, 95 dark ───────────
describe('golden: 96F + local 1:4, no onward demand', () => {
  const store = base({
    joints: [joint('JNT-001', '1:4')],
    cables: [cable('CBL-IN', 'CAB-1', 'JNT-001', 96), cable('CBL-ON', 'JNT-001', 'END', 48)],
  });
  const plan = planPhysicalFibres(store);
  it('is a VALIDATED plan', () => { expect(plan.status).toBe('VALIDATED'); expect(plan.errors).toEqual([]); });
  it('emits 1 tap, 0 through, 95 dark on the incoming 96F', () => {
    expect(seg(plan.records, 'CBL-IN')).toEqual({ tap: 1, thr: 0, dark: 95, total: 96 });
  });
});

// ── 2. 96F + local 1:4 + one terminal → 1 tap, 1 through, 94 dark ──────────────
describe('golden: 96F + local 1:4 + one downstream terminal', () => {
  const store = base({
    joints: [joint('JNT-001', '1:4'), joint('JNT-002', '1:8')],
    cables: [cable('CBL-IN', 'CAB-1', 'JNT-001', 96), cable('CBL-ON', 'JNT-001', 'JNT-002', 48)],
  });
  const plan = planPhysicalFibres(store);
  it('is VALIDATED', () => expect(plan.status).toBe('VALIDATED'));
  it('emits 1 tap, 1 through, 94 dark on the incoming 96F', () => {
    expect(seg(plan.records, 'CBL-IN')).toEqual({ tap: 1, thr: 1, dark: 94, total: 96 });
  });
  it('is colour-preserving: incoming F2 → onward F2', () => {
    const t = plan.records.find(r => r.fibre_role === 'THROUGH_SPLICE');
    expect(t.fibre_number).toBe(2);
    expect(t.splice_to_fibre).toBe(2);
  });
});

// ── 3. Two downstream branches → one unique incoming fibre per branch ──────────
describe('golden: two downstream branches, no duplicate fibre use', () => {
  const store = base({
    joints: [joint('JNT-001', '1:4'), joint('JNT-A', '1:8'), joint('JNT-B', '1:8')],
    cables: [
      cable('CBL-IN', 'CAB-1', 'JNT-001', 96),
      cable('CBL-A', 'JNT-001', 'JNT-A', 48),
      cable('CBL-B', 'JNT-001', 'JNT-B', 48),
    ],
  });
  const plan = planPhysicalFibres(store);
  it('is VALIDATED', () => expect(plan.status).toBe('VALIDATED'));
  it('assigns one unique incoming fibre per demanded branch (no duplicates)', () => {
    const thr = plan.records.filter(r => r.fibre_role === 'THROUGH_SPLICE' && r.cable_id === 'CBL-IN');
    const inFibres = thr.map(r => r.abs);
    expect(inFibres.length).toBe(2);
    expect(new Set(inFibres).size).toBe(2); // no duplicate incoming fibre
  });
  it('incoming = 1 tap + 2 through (F1 tap, F2→A, F3→B)', () => {
    expect(seg(plan.records, 'CBL-IN')).toMatchObject({ tap: 1, thr: 2 });
  });
});

// ── 4. Demand exceeds capacity → hard failure, no authoritative plan ───────────
describe('golden: demand exceeds capacity', () => {
  const store = base({
    joints: [joint('JNT-001', '1:4'), joint('JNT-002', '1:8')],
    // incoming only 1F but demand is 2 (tap + through)
    cables: [cable('CBL-IN', 'CAB-1', 'JNT-001', 1), cable('CBL-ON', 'JNT-001', 'JNT-002', 48)],
  });
  const plan = planPhysicalFibres(store);
  it('is NOT validated and saves no records', () => {
    expect(plan.status).toBe('INVALID');
    expect(plan.records).toEqual([]);
    expect(plan.capacityError).toBeTruthy();
  });
});

// ── 5. CBT tail on a 1:4 OUTPUT does not propagate raw feeder demand upstream ──
describe('golden: CBT tail on a 1:4 optical output', () => {
  const store = base({
    joints: [joint('JNT-001', '1:4')],
    cbts: [{ properties: { cbt_id: 'CBT-1', split_ratio: '1:8' } }],
    cables: [cable('CBL-IN', 'CAB-1', 'JNT-001', 96)],
    // tail is an optical SPLITTER_OUTPUT leg of JNT-001's 1:4
    cbtTails: [{ properties: { tail_id: 'TAIL-1', from_cbt: 'CBT-1', to_joint: 'JNT-001', fibre_count: 1, feed_mode: 'SPLITTER_OUTPUT', splitter_id: 'JNT-001-SP', splitter_port: 2 } }],
  });
  const plan = planPhysicalFibres(store);
  it('is VALIDATED', () => { expect(plan.status).toBe('VALIDATED'); expect(plan.errors).toEqual([]); });
  it('incoming 96F needs only the 1:4 input fibre (CBT does not add raw demand)', () => {
    expect(plan.demand.edgeRequired.get('CBL-IN')).toBe(1);
    expect(seg(plan.records, 'CBL-IN')).toEqual({ tap: 1, thr: 0, dark: 95, total: 96 });
  });
});

// ── 6. 1:4 plus a raw pass-through → one tap + recursive onward demand ─────────
describe('golden: 1:4 with an optical CBT plus a raw pass-through branch', () => {
  const store = base({
    joints: [joint('JNT-001', '1:4'), joint('JNT-002', '1:8')],
    cbts: [{ properties: { cbt_id: 'CBT-1', split_ratio: '1:8' } }],
    cables: [cable('CBL-IN', 'CAB-1', 'JNT-001', 96), cable('CBL-ON', 'JNT-001', 'JNT-002', 48)],
    cbtTails: [{ properties: { tail_id: 'TAIL-1', from_cbt: 'CBT-1', to_joint: 'JNT-001', fibre_count: 1, feed_mode: 'SPLITTER_OUTPUT', splitter_id: 'JNT-001-SP', splitter_port: 2 } }],
  });
  const plan = planPhysicalFibres(store);
  it('is VALIDATED', () => expect(plan.status).toBe('VALIDATED'));
  it('incoming demand = 1 tap + 1 recursive onward = 2', () => {
    expect(plan.demand.edgeRequired.get('CBL-IN')).toBe(2);
    expect(seg(plan.records, 'CBL-IN')).toEqual({ tap: 1, thr: 1, dark: 94, total: 96 });
  });
});

// ── 7. Reversed endpoint order → same result after POP orientation ────────────
describe('golden: reversed endpoint order', () => {
  const forward = base({
    joints: [joint('JNT-001', '1:4'), joint('JNT-002', '1:8')],
    cables: [cable('CBL-IN', 'CAB-1', 'JNT-001', 96), cable('CBL-ON', 'JNT-001', 'JNT-002', 48)],
  });
  const reversed = base({
    joints: [joint('JNT-001', '1:4'), joint('JNT-002', '1:8')],
    cables: [cable('CBL-IN', 'JNT-001', 'CAB-1', 96), cable('CBL-ON', 'JNT-002', 'JNT-001', 48)],
  });
  it('produces the same per-segment result regardless of endpoint order', () => {
    const a = planPhysicalFibres(forward), b = planPhysicalFibres(reversed);
    expect(b.status).toBe('VALIDATED');
    expect(seg(b.records, 'CBL-IN')).toEqual(seg(a.records, 'CBL-IN'));
  });
});

// ── 8. Cycle / multiple feeder paths → plan rejected as ambiguous ─────────────
describe('golden: ambiguous multiple feeder paths', () => {
  const store = base({
    joints: [joint('JNT-001', '1:8')],
    cables: [cable('CBL-1', 'CAB-1', 'JNT-001', 48), cable('CBL-2', 'CAB-1', 'JNT-001', 48)],
  });
  const plan = planPhysicalFibres(store);
  it('is rejected (not VALIDATED) with an ambiguity error', () => {
    expect(plan.status).not.toBe('VALIDATED');
    expect(plan.errors.some(e => e.code === 'MULTI_FEEDER' || e.code === 'AMBIGUOUS_ORIENT')).toBe(true);
  });
});

// ── 9. Repeat execution → identical deterministic allocation ──────────────────
describe('golden: deterministic repeat execution', () => {
  const store = base({
    joints: [joint('JNT-001', '1:4'), joint('JNT-A', '1:8'), joint('JNT-B', '1:8')],
    cables: [cable('CBL-IN', 'CAB-1', 'JNT-001', 96), cable('CBL-A', 'JNT-001', 'JNT-A', 48), cable('CBL-B', 'JNT-001', 'JNT-B', 48)],
  });
  it('produces byte-identical records on repeat runs', () => {
    const a = planPhysicalFibres(store).records;
    const b = planPhysicalFibres(store).records;
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

// ── 10. Frozen installed assignment is not renumbered by added proposed work ──
describe('golden: frozen installed assignment preserved', () => {
  // JNT-001's splitter input is INSTALLED on fibre 3 (not the default lowest F1).
  const installed = [
    { assign_id: 'INS-1', cable_id: 'CBL-IN', joint_id: 'JNT-001', fibre_role: 'SPLITTER_INPUT', tube_number: 1, fibre_number: 3, status: 'INSTALLED' },
  ];
  const store = base({
    joints: [joint('JNT-001', '1:4'), joint('JNT-002', '1:8')],
    cables: [cable('CBL-IN', 'CAB-1', 'JNT-001', 96), cable('CBL-ON', 'JNT-001', 'JNT-002', 48)],
    fibreAssignments: installed,
  });
  const plan = planPhysicalFibres(store, { existingAssignments: installed });
  it('keeps the installed input on fibre 3 (not renumbered to F1)', () => {
    const tap = plan.records.find(r => r.fibre_role === 'SPLITTER_INPUT' && r.joint_id === 'JNT-001');
    expect(tap.abs).toBe(3);
  });
  it('still validates', () => expect(plan.status).toBe('VALIDATED'));
});

// ── bonus: compact-outbound profile renumbers onward from F1 ───────────────────
describe('profile: compact outbound', () => {
  const store = base({
    joints: [joint('JNT-001', '1:4'), joint('JNT-002', '1:8')],
    cables: [cable('CBL-IN', 'CAB-1', 'JNT-001', 96), cable('CBL-ON', 'JNT-001', 'JNT-002', 48)],
  });
  it('maps incoming F2 → onward F1 under COMPACT_OUTBOUND', () => {
    const plan = planPhysicalFibres(store, { profile: PROFILE_COMPACT_OUTBOUND });
    const t = plan.records.find(r => r.fibre_role === 'THROUGH_SPLICE');
    expect(t.fibre_number).toBe(2);
    expect(t.splice_to_fibre).toBe(1);
  });
});


// ── P1 hardening (release-audit §5) ────────────────────────────────────────────
describe('P1: inferred feed_mode at a splitter blocks VALIDATED (fail closed)', () => {
  it('an onward cable leaving a 1:4 with NO feed_mode cannot validate', () => {
    const store = base({
      joints: [joint('JNT-001', '1:4'), joint('JNT-002', '1:8')],
      cables: [
        cable('CBL-IN', 'CAB-1', 'JNT-001', 96),
        { properties: { cable_id: 'CBL-ON', from_node: 'JNT-001', to_node: 'JNT-002', fibre_count: 48 } }, // no feed_mode
      ],
    });
    const plan = planPhysicalFibres(store);
    expect(plan.status).toBe('INVALID');
    expect(plan.errors.some(e => e.code === 'INFERRED_CLASSIFICATION')).toBe(true);
  });
});

describe('P1: duplicate segment ids are rejected before graph construction', () => {
  it('a cable and a span sharing an id is rejected', () => {
    const store = base({
      joints: [joint('JNT-001', '1:8')],
      poles: [{ properties: { pole_id: 'POLE-1' } }],
      cables: [cable('DUP', 'CAB-1', 'JNT-001', 48)],
      spans: [{ properties: { span_id: 'DUP', from_node: 'JNT-001', to_node: 'POLE-1', fibre_count: 12, feed_mode: 'PASS_THROUGH' } }],
    });
    const plan = planPhysicalFibres(store);
    expect(plan.status).not.toBe('VALIDATED');
    expect(plan.errors.some(e => e.code === 'DUP_SEGMENT_ID')).toBe(true);
  });
});

describe('P1: small onward branch — colour-preserving vs compact rule', () => {
  const mk = () => base({
    joints: [joint('J1'), joint('JA', '1:8'), joint('JB', '1:8')],
    cables: [cable('CBL-IN', 'CAB-1', 'J1', 12), cable('CBL-A', 'J1', 'JA', 1), cable('CBL-B', 'J1', 'JB', 1)],
  });
  it('colour-preserving hard-fails when a fibre number exceeds the onward capacity', () => {
    const plan = planPhysicalFibres(mk());
    expect(plan.status).toBe('INVALID');
    expect(plan.errors.some(e => e.code === 'OUT_OF_RANGE')).toBe(true);
  });
  it('compact remapping succeeds for the same topology', () => {
    const plan = planPhysicalFibres(mk(), { profile: PROFILE_COMPACT_OUTBOUND });
    expect(plan.status).toBe('VALIDATED');
  });
});

describe('P1: frozen through-splice preserves BOTH incoming and outgoing numbers', () => {
  it('does not renumber a compact frozen mapping (in F5 → out F2)', () => {
    const installed = [{ cable_id: 'CBL-IN', joint_id: 'J1', fibre_role: 'THROUGH_SPLICE', tube_number: 1, fibre_number: 5, splice_to_cable: 'CBL-ON', splice_to_tube: 1, splice_to_fibre: 2, status: 'INSTALLED' }];
    const store = base({
      joints: [joint('J1'), joint('JT', '1:8')],
      cables: [cable('CBL-IN', 'CAB-1', 'J1', 12), cable('CBL-ON', 'J1', 'JT', 12)],
      physicalAssignments: installed,
    });
    const plan = planPhysicalFibres(store, { existingAssignments: installed });
    const thr = plan.records.find(r => r.fibre_role === 'THROUGH_SPLICE' && r.cable_id === 'CBL-IN');
    expect(thr.abs).toBe(5);              // incoming preserved
    expect(thr.splice_to_fibre).toBe(2);  // outgoing preserved
    expect(plan.status).toBe('VALIDATED');
  });
});

describe('P1: validation completeness', () => {
  it('a validated plan leaves no reachable pass-through segment unaccounted', () => {
    const store = base({
      joints: [joint('JNT-001', '1:4'), joint('JNT-002', '1:8')],
      cables: [cable('CBL-IN', 'CAB-1', 'JNT-001', 96), cable('CBL-ON', 'JNT-001', 'JNT-002', 48)],
    });
    const plan = planPhysicalFibres(store);
    expect(plan.status).toBe('VALIDATED');
    expect(plan.errors.some(e => e.code === 'INCOMPLETE_SEGMENT')).toBe(false);
  });
});


// ── §3a hardening: outgoing frozen-fibre reuse (release-audit §5 / handoff §3a) ─
// The validator adds a through-splice's onward fibre to a Set, which silently
// collapses a second through-splice claiming the same onward fibre. Latent today
// (the allocator never emits it) but real once installed/live fibres feed back
// in. These test the validator directly for the exact gap.
describe('§3a: two through-splices claiming the same onward fibre fail validation', () => {
  const mkNetwork = () => ({
    edges: [
      { id: 'CBL-IN', capacity: 12, feedMode: 'PASS_THROUGH', from: 'CAB-1', to: 'J1', feedModeInferred: false },
      { id: 'CBL-ON', capacity: 12, feedMode: 'PASS_THROUGH', from: 'J1', to: 'JT', feedModeInferred: false },
    ],
    nodes: new Map([
      ['CAB-1', { id: 'CAB-1', hasSplitter: false }],
      ['J1', { id: 'J1', hasSplitter: false }],
      ['JT', { id: 'JT', hasSplitter: true }],
    ]),
    inEdges: new Map([['J1', []], ['JT', []]]),
    dist: new Map([['CAB-1', 0], ['J1', 1], ['JT', 2]]),
    errors: [],
  });
  const thr = (inF, outF) => ({ cable_id: 'CBL-IN', joint_id: 'J1', fibre_role: 'THROUGH_SPLICE', tube_number: 1, fibre_number: inF, splice_to_cable: 'CBL-ON', splice_to_tube: 1, splice_to_fibre: outF, abs: inF });
  const demand = { errors: [] };

  it('flags OUT_REUSE when two through-splices target the same onward fibre', () => {
    const records = [thr(5, 2), thr(6, 2)]; // distinct incoming, same onward F2
    const { errors } = validatePhysicalPlan(mkNetwork(), demand, records);
    expect(errors.some(e => e.code === 'OUT_REUSE')).toBe(true);
    // incoming fibres differ, so this is NOT a per-end REUSE
    expect(errors.some(e => e.code === 'REUSE')).toBe(false);
  });

  it('does not flag two through-splices with distinct onward fibres', () => {
    const { errors } = validatePhysicalPlan(mkNetwork(), demand, [thr(5, 5), thr(6, 6)]);
    expect(errors.some(e => e.code === 'OUT_REUSE')).toBe(false);
  });

  it('does not conflate a through-splice out-fibre with a SPLITTER_INPUT of the same number', () => {
    // a through-splice delivers F3 to CBL-ON, and a splitter at CBL-ON's far end
    // consumes F3 — same fibre, different roles. Legitimate: must not be OUT_REUSE.
    const records = [
      thr(3, 3),
      { cable_id: 'CBL-ON', joint_id: 'JT', fibre_role: 'SPLITTER_INPUT', tube_number: 1, fibre_number: 3, abs: 3 },
    ];
    const { errors } = validatePhysicalPlan(mkNetwork(), demand, records);
    expect(errors.some(e => e.code === 'OUT_REUSE')).toBe(false);
  });
});
