// segmentIdIntegrity.test.js — Review 17 Jul 2026, item 6.
//
// SEG_NO_ID was the only buildFibreNetwork error code with no test, AND the only
// one that the (now removed) network.ok exempted from failing the graph. The
// untested code and the anomalous code were the same code.
//
// A segment with no id is SKIPPED by pushSeg — it vanishes from the graph, gets
// no fibre records and appears in no splice plan. These tests pin the fact that
// a skipped segment can never yield an authoritative plan, so a future refactor
// cannot quietly restore the fail-open.

import { describe, it, expect } from 'vitest';
import { planPhysicalFibres } from '../fibrePlanner.js';
import { buildFibreNetwork } from '../fibreNetwork.js';

const cable = (id, from, to, fc, extra = {}) => ({ properties: { cable_id: id, from_node: from, to_node: to, fibre_count: fc, feed_mode: 'PASS_THROUGH', ...extra } });
const joint = (id, ratio) => ({ properties: { joint_id: id, has_splitter: !!ratio, split_ratio: ratio || undefined } });
const base = (over = {}) => ({
  cabinet: { properties: { pop_id: 'CAB-1' } },
  joints: [], cbts: [], spans: [], cbtTails: [], aerialDrops: [], bundles: [], cables: [],
  ...over,
});

describe('SEG_NO_ID: an id-less segment is skipped and never yields a valid plan', () => {
  it('raises SEG_NO_ID and skips the segment', () => {
    const store = base({
      joints: [joint('JNT-001', '1:4')],
      cables: [cable('CBL-IN', 'CAB-1', 'JNT-001', 96), cable(undefined, 'JNT-001', 'JNT-SPARE', 48)],
    });
    const net = buildFibreNetwork(store);
    expect(net.errors.some(e => e.code === 'SEG_NO_ID')).toBe(true);
    // Skipped: no edge exists for the id-less cable.
    expect(net.edges).toHaveLength(1);
    expect(net.edges[0].id).toBe('CBL-IN');
  });

  it('is INVALID even when nothing downstream demands a fibre', () => {
    // The dangerous case: dropping this segment changes no demand, so only
    // SEG_NO_ID fires. The old network.ok would have reported true here.
    const store = base({
      joints: [joint('JNT-001', '1:4')],
      cables: [cable('CBL-IN', 'CAB-1', 'JNT-001', 96), cable(undefined, 'JNT-001', 'JNT-SPARE', 48)],
    });
    const plan = planPhysicalFibres(store);
    expect(plan.status).toBe('INVALID');
    expect(plan.ok).toBe(false);
    expect(plan.errors.some(e => e.code === 'SEG_NO_ID')).toBe(true);
    // The skipped segment contributes no records at all.
    expect([...new Set(plan.records.map(r => r.cable_id))]).toEqual(['CBL-IN']);
  });

  it('is INVALID when a demanding terminal sits behind the id-less segment', () => {
    const store = base({
      joints: [joint('JNT-001', '1:4'), joint('JNT-003', '1:8')],
      cables: [cable('CBL-IN', 'CAB-1', 'JNT-001', 96), cable(undefined, 'JNT-001', 'JNT-003', 48)],
    });
    const plan = planPhysicalFibres(store);
    expect(plan.status).toBe('INVALID');
    // Defence in depth: the demand/validation passes independently catch the
    // orphaned terminal, not just the SEG_NO_ID report.
    expect(plan.errors.some(e => e.code === 'UNFED_TERMINAL')).toBe(true);
    expect(plan.records.some(r => r.joint_id === 'JNT-003')).toBe(false);
  });

  it('a clean graph is VALIDATED (control)', () => {
    const store = base({
      joints: [joint('JNT-001', '1:4')],
      cables: [cable('CBL-IN', 'CAB-1', 'JNT-001', 96), cable('CBL-ON', 'JNT-001', 'JNT-SPARE', 48)],
    });
    const plan = planPhysicalFibres(store);
    expect(plan.status).toBe('VALIDATED');
    expect(plan.errors).toEqual([]);
  });
});

describe('buildFibreNetwork exposes no `ok` (review item 1)', () => {
  // It previously returned one, computed as:
  //   errors.filter(x => x.code !== 'SEG_NO_ID').length === 0 || errors.length === 0
  // Nothing read it, the second clause was dead, and the first exempted
  // SEG_NO_ID — so a graph that had dropped a real segment reported ok:true.
  // fibrePlanner is the sole owner of that judgement. Guard against its return.
  it('does not return an ok field', () => {
    const store = base({ joints: [joint('JNT-001', '1:4')], cables: [cable('CBL-IN', 'CAB-1', 'JNT-001', 96)] });
    expect('ok' in buildFibreNetwork(store)).toBe(false);
  });

  it('does not return an ok field on the empty/no-POP path either', () => {
    expect('ok' in buildFibreNetwork({ ...base(), cabinet: null })).toBe(false);
  });
});
