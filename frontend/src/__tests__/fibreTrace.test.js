// fibreTrace.test.js — Regression suite for the fibre-trace engine.
//
// WHY THIS EXISTS: the v2-readiness audit (June 2026) flagged zero automated
// tests on the engines that compute customer-facing numbers (optical pass/fail,
// fibre assignment, costed BoM) as a HIGH-severity gap — a wrong number here
// isn't cosmetic, it's a number someone makes a build decision on. fibreTrace.js
// is a pure function of `store`, which makes it cheap to test properly: every
// fixture below is a small, hand-built synthetic network (not real project data),
// and every expected value in these tests was calculated by hand against the
// actual engine logic, with the working shown in comments. If a refactor changes
// the maths, these break — that's the point.
//
// Run with: npm test

import { describe, it, expect } from 'vitest';
import { traceFibre, STATUS_OK, STATUS_PARTIAL, STATUS_UNSERVED } from '../fibreTrace.js';

// ── Fixture 1: a clean ROUTED path ──────────────────────────────────────────
// Premise → Bundle → JOINT (with a 1:8 splitter) → Cable → Cabinet (POP).
//
// Hand-calculated expected values:
//   lengthM = bundle length_m (15) + cable length_m (200) = 215
//   optical (calculateRouteBudget(215, spliceCount=1, splitters=['1:8'])):
//     fibre_db     = (215/1000) * 0.25            = 0.05375 → rounds to 0.05
//     splice_db    = 1 * 0.10                      = 0.10   → rounds to 0.10
//     splitter_db  = DEFAULT_SPLITTER_LOSS_DB['1:8'] = 10.5
//     connector_db = 1.50 (fixed default)
//     loss_db      = 0.05375 + 0.10 + 10.5 + 1.50  = 12.15375 → rounds to 12.15
//     budget_db    = LINK_CLASS_BUDGET_DB['B+'] (28.0) - safety_margin_db (3.0) = 25.0
//     margin_db    = 25.0 - 12.15375               = 12.84625 → rounds to 12.85
//     link_pass    = margin_db >= 0                = true
function routedFixture() {
  return {
    cabinet: {
      properties: { pop_id: 'CAB-1' },
      geometry: { coordinates: [0, 0] },
    },
    joints: [{
      properties: {
        joint_id: 'JNT-1', chamber_id: 'JNT-1',
        has_splitter: true, split_ratio: '1:8',
      },
      geometry: { coordinates: [0.001, 0.001] },
    }],
    cbts: [],
    poles: [],
    cables: [{
      properties: { cable_id: 'CBL-1', from_node: 'CAB-1', to_node: 'JNT-1', length_m: 200 },
    }],
    spans: [],
    cbtTails: [],
    bundles: [{
      properties: { uprn: '1000001', bundle_id: 'BUN-1', from_joint: 'JNT-1', length_m: 15 },
    }],
    aerialDrops: [],
  };
}

// ── Fixture 2: a PARTIAL path ───────────────────────────────────────────────
// The cabinet IS wired into the graph (via CAB-1 → JNT-1), but the premise's
// entry joint (JNT-2) is completely isolated — no cable references it at all.
// This should hit the "reached a JOINT but no path continues to the cabinet"
// branch specifically (reachedJoint=true, popInGraph=true).
function partialFixture() {
  return {
    cabinet: {
      properties: { pop_id: 'CAB-1' },
      geometry: { coordinates: [0, 0] },
    },
    joints: [
      {
        properties: { joint_id: 'JNT-1', chamber_id: 'JNT-1', has_splitter: false },
        geometry: { coordinates: [0.001, 0.001] },
      },
      {
        properties: { joint_id: 'JNT-2', chamber_id: 'JNT-2', has_splitter: false },
        geometry: { coordinates: [0.002, 0.002] },
      },
    ],
    cbts: [],
    poles: [],
    cables: [{
      properties: { cable_id: 'CBL-1', from_node: 'CAB-1', to_node: 'JNT-1', length_m: 200 },
    }],
    spans: [],
    cbtTails: [],
    bundles: [{
      properties: { uprn: '2000002', bundle_id: 'BUN-2', from_joint: 'JNT-2', length_m: 10 },
    }],
    aerialDrops: [],
  };
}

describe('traceFibre — ROUTED path', () => {
  const store = routedFixture();
  const result = traceFibre(store, '1000001');

  it('reaches the cabinet with status ROUTED', () => {
    expect(result.status).toBe(STATUS_OK);
    expect(result.reason).toBe('Routed to cabinet.');
  });

  it('walks the correct node path: entry joint then cabinet', () => {
    expect(result.nodes).toEqual(['JNT-1', 'CAB-1']);
  });

  it('sums bundle + cable length correctly (15 + 200 = 215m)', () => {
    expect(result.lengthM).toBe(215);
  });

  it('produces the hand-calculated optical budget', () => {
    expect(result.optical).not.toBeNull();
    expect(result.optical.loss_db).toBeCloseTo(12.15, 2);
    expect(result.optical.budget_db).toBeCloseTo(25.0, 2);
    expect(result.optical.margin_db).toBeCloseTo(12.85, 2);
    expect(result.optical.link_pass).toBe(true);
  });

  it('counts exactly one splice (the JOINT) and one 1:8 splitter', () => {
    expect(result.optical.breakdown.splice_count).toBe(1);
    expect(result.optical.breakdown.splitters).toEqual(['1:8']);
  });

  it('builds the correct hop sequence for display', () => {
    expect(result.hops).toEqual([
      { kind: 'bundle', label: 'Bundle', id: 'BUN-1' },
      { kind: 'JOINT', label: 'Joint', id: 'JNT-1' },
      { kind: 'edge', label: 'Cable', id: 'CBL-1' },
      { kind: 'POP', label: 'Cabinet', id: 'CAB-1' },
    ]);
  });
});

describe('traceFibre — PARTIAL path (isolated entry joint)', () => {
  const store = partialFixture();
  const result = traceFibre(store, '2000002');

  it('returns PARTIAL, not a crash or false ROUTED', () => {
    expect(result.status).toBe(STATUS_PARTIAL);
  });

  it('correctly diagnoses: reached a joint, but no path continues to the POP', () => {
    expect(result.reason).toContain('no cable path continues');
  });

  it('identifies the break point as the isolated joint', () => {
    expect(result.breakNode).not.toBeNull();
    expect(result.breakNode.id).toBe('JNT-2');
    expect(result.breakNode.type).toBe('JOINT');
  });

  it('reports no optical budget for an incomplete path', () => {
    expect(result.optical).toBeNull();
  });

  it('still reports the entry-segment length (10m), not the full route', () => {
    expect(result.lengthM).toBe(10);
  });
});

describe('traceFibre — UNSERVED (no connecting asset)', () => {
  it('returns UNSERVED when the premise has no bundle or aerial drop at all', () => {
    const store = partialFixture(); // reuse — premise 9999999 isn't in it
    const result = traceFibre(store, '9999999');
    expect(result.status).toBe(STATUS_UNSERVED);
    expect(result.reason).toBe('No bundle or aerial drop connects this premise to the network.');
    expect(result.entry).toBeNull();
    expect(result.optical).toBeNull();
  });

  it('returns UNSERVED with a specific reason when no cabinet has been placed', () => {
    const store = { ...partialFixture(), cabinet: null };
    const result = traceFibre(store, '2000002');
    expect(result.status).toBe(STATUS_UNSERVED);
    expect(result.reason).toBe('No cabinet placed.');
  });
});
