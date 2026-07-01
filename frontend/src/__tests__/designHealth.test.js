// designHealth.test.js — Regression suite for designHealth.js.
//
// WHY THIS EXISTS: the re-audit (30 Jun 2026) flagged designHealth.js as the
// one engine file with zero test coverage — notably Check 1b, which computes
// exactly the kind of customer-facing "would this route actually work"
// verdict the rest of the suite holds to a hand-verified bar. This suite
// closes that gap for Check 1b specifically (the splitter-cascade-count
// rule), which was tightened this session from "≥1 splitter" to "exactly 2".
//
// THE RULE UNDER TEST (Check 1b): a viable premises connection needs EXACTLY
// TWO passive splitter stages between the premise and the cabinet. This is a
// structural PON invariant — it does NOT check ratios (1:4→1:8, 1:2→1:16,
// whatever an operator configures) and must stay that way. Ratio/capacity
// checks live separately in Check 2b, keyed off each splitter's own
// split_ratio field. If these tests ever need a hardcoded ratio to pass,
// that's a sign Check 1b has regressed into an operator-specific rule.
//
// Every fixture is a small hand-built synthetic network: premise → bundle →
// a chain of N joints (each independently splitter or not) → cable(s) → the
// cabinet. This exercises real traceFibre()/computeOptical() logic, not a
// mocked trace — same convention as fibreTrace.test.js.
//
// Run with: npm test

import { describe, it, expect } from 'vitest';
import { runDesignHealth, VERDICT } from '../designHealth.js';

// Builds a premise → JNT-1 → JNT-2 → … → JNT-n → CAB-1 chain, where the first
// `splitterCount` joints (of `jointCount` total) declare has_splitter:true.
// jointCount defaults to max(splitterCount, 1) since a bundle needs at least
// one joint to attach to, even in the zero-splitter case.
function chainedStore(splitterCount, jointCount = Math.max(splitterCount, 1)) {
  const joints = [];
  const cables = [];
  for (let i = 1; i <= jointCount; i++) {
    const id = `JNT-${i}`;
    joints.push({
      properties: {
        joint_id: id,
        has_splitter: i <= splitterCount,
        split_ratio: i <= splitterCount ? '1:8' : undefined,
      },
      geometry: { coordinates: [0.001 * i, 0.001 * i] },
    });
    const toNode = i < jointCount ? `JNT-${i + 1}` : 'CAB-1';
    cables.push({
      properties: { cable_id: `CBL-${i}`, from_node: id, to_node: toNode, length_m: 50 },
    });
  }
  return {
    addressPoints: [{ properties: { uprn: '1000001', address: 'Test Cottage' } }],
    cabinet: { properties: { pop_id: 'CAB-1' }, geometry: { coordinates: [0, 0] } },
    joints,
    cbts: [], poles: [], spans: [], cbtTails: [], aerialDrops: [],
    cables,
    bundles: [{ properties: { uprn: '1000001', bundle_id: 'BUN-1', from_joint: 'JNT-1', length_m: 10 } }],
  };
}

function cascadeIssues(result) {
  return result.issues.filter(i => i.category === 'Wrong splitter cascade');
}

describe('Design Health — Check 1b: splitter cascade must be exactly two stages', () => {
  it('flags ZERO splitters as an error, with a "no passive splitter" message', () => {
    const result = runDesignHealth(chainedStore(0));
    const flags = cascadeIssues(result);
    expect(flags).toHaveLength(1);
    expect(flags[0].tier).toBe('error');
    expect(flags[0].message).toContain('no passive splitter found');
  });

  it('flags ONE splitter as an error, distinctly worded from zero', () => {
    const result = runDesignHealth(chainedStore(1));
    const flags = cascadeIssues(result);
    expect(flags).toHaveLength(1);
    expect(flags[0].tier).toBe('error');
    expect(flags[0].message).toContain('only one splitter stage found');
  });

  it('does NOT flag exactly TWO splitters — the valid cascade shape', () => {
    const result = runDesignHealth(chainedStore(2));
    expect(cascadeIssues(result)).toHaveLength(0);
    // With no other errors/warnings in this clean fixture, verdict should be GO.
    expect(result.verdict).toBe(VERDICT.GO);
  });

  it('flags THREE splitters as an error, worded as "too many" not "too few"', () => {
    const result = runDesignHealth(chainedStore(3));
    const flags = cascadeIssues(result);
    expect(flags).toHaveLength(1);
    expect(flags[0].tier).toBe('error');
    expect(flags[0].message).toContain('3 splitter stages found');
    expect(flags[0].message).toContain('needs exactly two');
  });

  it('is ratio-agnostic: two splitters at a NON-Gigaloch ratio (1:2 + 1:16) still passes', () => {
    // Deliberately not 1:4/1:8 — proves this check counts stages, not ratios,
    // and isn't secretly re-encoding one operator's cascade as "the" rule.
    const store = chainedStore(2);
    store.joints[0].properties.split_ratio = '1:2';
    store.joints[1].properties.split_ratio = '1:16';
    const result = runDesignHealth(store);
    expect(cascadeIssues(result)).toHaveLength(0);
  });

  it('a zero-splitter or wrong-count cascade drives verdict to NO-GO (error tier)', () => {
    expect(runDesignHealth(chainedStore(0)).verdict).toBe(VERDICT.NOGO);
    expect(runDesignHealth(chainedStore(1)).verdict).toBe(VERDICT.NOGO);
    expect(runDesignHealth(chainedStore(3)).verdict).toBe(VERDICT.NOGO);
  });

  it('caps displayed cascade issues and summarises the overflow (>10 bad routes)', () => {
    // 15 premises, each fed by their own zero-splitter joint chain sharing one cabinet.
    const store = chainedStore(0);
    const extraJoints = [];
    const extraCables = [];
    const extraBundles = [];
    const addressPoints = [{ properties: { uprn: '1000001', address: 'Premise 1' } }];
    for (let i = 2; i <= 15; i++) {
      const jid = `JNT-EXTRA-${i}`;
      extraJoints.push({ properties: { joint_id: jid, has_splitter: false }, geometry: { coordinates: [0, 0] } });
      extraCables.push({ properties: { cable_id: `CBL-EXTRA-${i}`, from_node: jid, to_node: 'CAB-1', length_m: 50 } });
      extraBundles.push({ properties: { uprn: String(1000000 + i), bundle_id: `BUN-${i}`, from_joint: jid, length_m: 10 } });
      addressPoints.push({ properties: { uprn: String(1000000 + i), address: `Premise ${i}` } });
    }
    store.joints.push(...extraJoints);
    store.cables.push(...extraCables);
    store.bundles.push(...extraBundles);
    store.addressPoints = addressPoints;

    const result = runDesignHealth(store);
    const flags = cascadeIssues(result);
    // 10 individual + 1 summary "…and 5 more" line.
    expect(flags).toHaveLength(11);
    expect(flags[flags.length - 1].message).toContain('…and 5 more');
  });
});

describe('Design Health — Check 2b stays ratio-agnostic (sanity check, not a regression target)', () => {
  it('does not flag a correctly-declared non-Gigaloch splitter ratio as overcapacity', () => {
    // A joint declaring 1:16 with 10 bundles is well within cap — must not
    // trip capacity check just because it isn't Gigaloch's usual 1:8.
    const store = chainedStore(2);
    store.joints[0].properties.split_ratio = '1:16';
    for (let i = 2; i <= 10; i++) {
      store.bundles.push({ properties: { uprn: `900000${i}`, bundle_id: `BUN-X${i}`, from_joint: 'JNT-1', length_m: 5 } });
    }
    const result = runDesignHealth(store);
    const capFlags = result.issues.filter(i => i.category === 'Splitter overcapacity');
    expect(capFlags).toHaveLength(0);
  });
});
