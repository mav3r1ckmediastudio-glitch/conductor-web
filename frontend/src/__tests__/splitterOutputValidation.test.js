// splitterOutputValidation.test.js — release blocker: an explicit
// feed_mode:SPLITTER_OUTPUT must NOT be trusted blindly. Before this fix a
// fabricated optical leg (e.g. the cabinet feeder marked SPLITTER_OUTPUT with a
// made-up splitter_id and no port) validated with an empty physical plan,
// because the SPLITTER_OUTPUT classification exempts the downstream terminal
// from its raw-input requirement. Every SPLITTER_OUTPUT edge must now prove it
// is a real, uniquely-ported optical output of an actual upstream splitter.

import { describe, it, expect } from 'vitest';
import { planPhysicalFibres } from '../fibrePlanner.js';
import { validatePhysicalPlan } from '../fibrePlanValidation.js';

const cable = (id, from, to, fc, extra = {}) => ({ properties: { cable_id: id, from_node: from, to_node: to, fibre_count: fc, feed_mode: 'PASS_THROUGH', ...extra } });
const joint = (id, ratio) => ({ properties: { joint_id: id, has_splitter: !!ratio, split_ratio: ratio || undefined } });
const base = (over = {}) => ({
  cabinet: { properties: { pop_id: 'CAB-1' } },
  joints: [], cbts: [], spans: [], cbtTails: [], aerialDrops: [], bundles: [], cables: [],
  ...over,
});
const hasCode = (plan, code) => plan.errors.some(e => e.code === code);

// ── 1. Full-pipeline: the reproduced release blocker and topology variants ─────

describe('release blocker: a SPLITTER_OUTPUT leg cannot leave the POP', () => {
  // The exact reproduction: a cable straight from the cabinet/POP to a 1:8
  // splitter, classified SPLITTER_OUTPUT, with a fabricated CAB-SP id and no port.
  const store = base({
    joints: [joint('JNT-1', '1:8')],
    cables: [{ properties: { cable_id: 'CBL-FEED', from_node: 'CAB-1', to_node: 'JNT-1', fibre_count: 96, feed_mode: 'SPLITTER_OUTPUT', splitter_id: 'CAB-SP' } }],
  });
  const plan = planPhysicalFibres(store);
  it('is NOT validated (was the unsafe VALIDATED before the fix)', () => {
    expect(plan.status).not.toBe('VALIDATED');
    expect(plan.status).toBe('INVALID');
  });
  it('flags OUTPUT_WITHOUT_SPLITTER — the POP has no splitter', () => {
    expect(hasCode(plan, 'OUTPUT_WITHOUT_SPLITTER')).toBe(true);
  });
});

describe('a SPLITTER_OUTPUT leg cannot leave an ordinary (non-splitter) joint', () => {
  const store = base({
    joints: [joint('JNT-MID'), joint('JNT-2', '1:8')],
    cables: [
      cable('CBL-IN', 'CAB-1', 'JNT-MID', 96),
      { properties: { cable_id: 'CBL-ON', from_node: 'JNT-MID', to_node: 'JNT-2', fibre_count: 48, feed_mode: 'SPLITTER_OUTPUT', splitter_id: 'JNT-MID-SP', splitter_port: 1 } },
    ],
  });
  const plan = planPhysicalFibres(store);
  it('is rejected with OUTPUT_WITHOUT_SPLITTER', () => {
    expect(plan.status).not.toBe('VALIDATED');
    expect(hasCode(plan, 'OUTPUT_WITHOUT_SPLITTER')).toBe(true);
  });
});

describe('a SPLITTER_OUTPUT splitter_id must identify the upstream splitter', () => {
  const store = base({
    joints: [joint('J1', '1:4'), joint('JT', '1:8')],
    cables: [
      cable('CBL-IN', 'CAB-1', 'J1', 96),
      { properties: { cable_id: 'CBL-ON', from_node: 'J1', to_node: 'JT', fibre_count: 48, feed_mode: 'SPLITTER_OUTPUT', splitter_id: 'WRONG-SP', splitter_port: 1 } },
    ],
  });
  const plan = planPhysicalFibres(store);
  it('flags OUTPUT_SPLITTER_MISMATCH for a wrong id', () => {
    expect(plan.status).not.toBe('VALIDATED');
    expect(hasCode(plan, 'OUTPUT_SPLITTER_MISMATCH')).toBe(true);
  });
});

describe('a SPLITTER_OUTPUT leg with a real splitter but no port fails', () => {
  const store = base({
    joints: [joint('J1', '1:4'), joint('JT', '1:8')],
    cables: [
      cable('CBL-IN', 'CAB-1', 'J1', 96),
      { properties: { cable_id: 'CBL-ON', from_node: 'J1', to_node: 'JT', fibre_count: 48, feed_mode: 'SPLITTER_OUTPUT', splitter_id: 'J1-SP' } },
    ],
  });
  const plan = planPhysicalFibres(store);
  it('flags OUTPUT_PORT_MISSING', () => {
    expect(plan.status).not.toBe('VALIDATED');
    expect(hasCode(plan, 'OUTPUT_PORT_MISSING')).toBe(true);
  });
});

describe('two SPLITTER_OUTPUT legs cannot claim the same splitter port', () => {
  const store = base({
    joints: [joint('J1', '1:4'), joint('JA', '1:8'), joint('JB', '1:8')],
    cables: [
      cable('CBL-IN', 'CAB-1', 'J1', 96),
      { properties: { cable_id: 'CBL-A', from_node: 'J1', to_node: 'JA', fibre_count: 48, feed_mode: 'SPLITTER_OUTPUT', splitter_id: 'J1-SP', splitter_port: 1 } },
      { properties: { cable_id: 'CBL-B', from_node: 'J1', to_node: 'JB', fibre_count: 48, feed_mode: 'SPLITTER_OUTPUT', splitter_id: 'J1-SP', splitter_port: 1 } },
    ],
  });
  const plan = planPhysicalFibres(store);
  it('flags OUTPUT_PORT_REUSE for the duplicated port', () => {
    expect(plan.status).not.toBe('VALIDATED');
    expect(hasCode(plan, 'OUTPUT_PORT_REUSE')).toBe(true);
  });
  it('distinct ports on the same splitter do NOT reuse-flag', () => {
    const ok = base({
      joints: [joint('J1', '1:4'), joint('JA', '1:8'), joint('JB', '1:8')],
      cables: [
        cable('CBL-IN', 'CAB-1', 'J1', 96),
        { properties: { cable_id: 'CBL-A', from_node: 'J1', to_node: 'JA', fibre_count: 48, feed_mode: 'SPLITTER_OUTPUT', splitter_id: 'J1-SP', splitter_port: 1 } },
        { properties: { cable_id: 'CBL-B', from_node: 'J1', to_node: 'JB', fibre_count: 48, feed_mode: 'SPLITTER_OUTPUT', splitter_id: 'J1-SP', splitter_port: 2 } },
      ],
    });
    expect(hasCode(planPhysicalFibres(ok), 'OUTPUT_PORT_REUSE')).toBe(false);
  });
});

// A known-good optical output leg still validates end-to-end (golden §11 #5/#6
// exercise this via a CBT tail); assert here it carries no OUTPUT_* error.
describe('a valid SPLITTER_OUTPUT leg raises no OUTPUT_* error', () => {
  const store = base({
    joints: [joint('JNT-001', '1:4')],
    cbts: [{ properties: { cbt_id: 'CBT-1', split_ratio: '1:8' } }],
    cables: [cable('CBL-IN', 'CAB-1', 'JNT-001', 96)],
    cbtTails: [{ properties: { tail_id: 'TAIL-1', from_cbt: 'CBT-1', to_joint: 'JNT-001', fibre_count: 1, feed_mode: 'SPLITTER_OUTPUT', splitter_id: 'JNT-001-SP', splitter_port: 2 } }],
  });
  const plan = planPhysicalFibres(store);
  it('validates with no OUTPUT_* errors', () => {
    expect(plan.status).toBe('VALIDATED');
    expect(plan.errors.filter(e => e.code.startsWith('OUTPUT_'))).toEqual([]);
  });
});

// ── 2. Direct validator: numeric port sweep (missing/zero/negative/range) ──────

describe('a SPLITTER_OUTPUT leg must reach a downstream splitter/CBT', () => {
  const store = base({
    joints: [joint('J1', '1:4'), joint('J-MID')],
    cables: [
      cable('CBL-IN', 'CAB-1', 'J1', 96),
      { properties: { cable_id: 'CBL-DEAD', from_node: 'J1', to_node: 'J-MID', fibre_count: 48, feed_mode: 'SPLITTER_OUTPUT', splitter_id: 'J1-SP', splitter_port: 1 } },
    ],
  });
  it('flags OUTPUT_CHILD_MISSING instead of validating a dead optical leg', () => {
    const plan = planPhysicalFibres(store);
    expect(plan.status).toBe('INVALID');
    expect(hasCode(plan, 'OUTPUT_CHILD_MISSING')).toBe(true);
  });
});

describe('validator port sweep: an integer port within 1..ratio is required', () => {
  function splitNet(port) {
    const onEdge = { id: 'CBL-ON', capacity: 48, feedMode: 'SPLITTER_OUTPUT', feedModeInferred: false, from: 'J1', to: 'JT', splitterId: 'J1-SP', splitterPort: port };
    return {
      edges: [
        { id: 'CBL-IN', capacity: 96, feedMode: 'PASS_THROUGH', feedModeInferred: false, from: 'CAB-1', to: 'J1' },
        onEdge,
      ],
      nodes: new Map([
        ['CAB-1', { id: 'CAB-1', hasSplitter: false }],
        ['J1', { id: 'J1', hasSplitter: true, cap: 4, ratio: '1:4' }],
        ['JT', { id: 'JT', hasSplitter: true, cap: 8, ratio: '1:8' }],
      ]),
      outEdges: new Map(),
      inEdges: new Map([['J1', [{ id: 'CBL-IN', feedMode: 'PASS_THROUGH' }]], ['JT', [onEdge]]]),
      dist: new Map([['CAB-1', 0], ['J1', 1], ['JT', 2]]),
      errors: [],
    };
  }
  const demand = { errors: [] };
  const records = () => [
    { cable_id: 'CBL-IN', joint_id: 'J1', fibre_role: 'SPLITTER_INPUT', tube_number: 1, fibre_number: 1, abs: 1 },
    { cable_id: 'CBL-IN', fibre_role: 'DARK_STORAGE', dark_abs: Array.from({ length: 95 }, (_, i) => i + 2) },
  ];

  it('missing port -> OUTPUT_PORT_MISSING', () => {
    const { errors } = validatePhysicalPlan(splitNet(null), demand, records());
    expect(errors.some(e => e.code === 'OUTPUT_PORT_MISSING')).toBe(true);
  });
  it('zero port -> OUTPUT_PORT_RANGE', () => {
    const { errors } = validatePhysicalPlan(splitNet(0), demand, records());
    expect(errors.some(e => e.code === 'OUTPUT_PORT_RANGE')).toBe(true);
  });
  it('negative port -> OUTPUT_PORT_RANGE', () => {
    const { errors } = validatePhysicalPlan(splitNet(-1), demand, records());
    expect(errors.some(e => e.code === 'OUTPUT_PORT_RANGE')).toBe(true);
  });
  it('port above the 1:4 ratio -> OUTPUT_PORT_RANGE', () => {
    const { errors } = validatePhysicalPlan(splitNet(5), demand, records());
    expect(errors.some(e => e.code === 'OUTPUT_PORT_RANGE')).toBe(true);
  });
  it('a valid port (2) raises no OUTPUT_* error', () => {
    const { errors } = validatePhysicalPlan(splitNet(2), demand, records());
    expect(errors.filter(e => e.code.startsWith('OUTPUT_'))).toEqual([]);
  });
});
