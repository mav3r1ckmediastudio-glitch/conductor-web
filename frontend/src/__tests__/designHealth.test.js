// designHealth.test.js — Regression suite for designHealth.js.
//
// WHY THIS EXISTS: the re-audit (30 Jun 2026) flagged designHealth.js as the
// one engine file with zero test coverage — notably Check 1b, which computes
// exactly the kind of customer-facing "would this route actually work"
// verdict the rest of the suite holds to a hand-verified bar. This suite
// closes that gap for Check 1b specifically (the splitter-cascade-count
// rule), which was tightened this session from "≥1 splitter" to "exactly 2",
// and was extended same-session to cover Check 1c (the strict Gigaloch
// cascade-order rule layered on top of 1b — see that describe block below).
//
// THE RULE UNDER TEST (Check 1b): a viable premises connection needs EXACTLY
// TWO passive splitter stages between the premise and the cabinet. This is a
// structural PON invariant — it does NOT check ratios (1:4→1:8, 1:2→1:16,
// whatever an operator configures) and must stay that way. Ratio/capacity
// checks live separately in Check 2b, keyed off each splitter's own
// split_ratio field. If these tests ever need a hardcoded ratio to pass,
// that's a sign Check 1b has regressed into an operator-specific rule.
//
// THE RULE UNDER TEST (Check 1c): once 1b confirms exactly two stages exist,
// 1c additionally requires Gigaloch's SPECIFIC convention — 1:8 nearest the
// premises, 1:4 nearest the cabinet, in that order. This one IS deliberately
// operator-specific (hardcoded, not derived from Check 2b's split_ratio
// logic) — it's testing a Gigaloch build-standard rule, not a PON invariant.
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

function orderIssues(result) {
  return result.issues.filter(i => i.category === 'Wrong splitter cascade order');
}

// Two-joint chain with independently-set ratios per position, for Check 1c
// (order-sensitive) testing. JNT-1 is nearest the premise (bundle attaches
// there); JNT-2 is nearest the cabinet — same convention chainedStore() uses.
function orderedTwoStageStore(nearPremiseRatio, nearCabinetRatio) {
  const store = chainedStore(2);
  store.joints[0].properties.split_ratio = nearPremiseRatio;
  store.joints[1].properties.split_ratio = nearCabinetRatio;
  return store;
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
    // Explicit correct Gigaloch ratios (1:8 near premise, 1:4 near cabinet) so
    // this fixture is clean under Check 1c too — this test is isolating 1b's
    // shape/count logic specifically, not asserting anything about ratios.
    // See the "Check 1c" describe block below for order/ratio-specific cases.
    const result = runDesignHealth(orderedTwoStageStore('1:8', '1:4'));
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

  it('is ratio-agnostic: two splitters at a NON-Gigaloch ratio (1:2 + 1:16) still passes 1b', () => {
    // Deliberately not 1:4/1:8 — proves this check counts stages, not ratios,
    // and isn't secretly re-encoding one operator's cascade as "the" rule.
    // NOTE: this fixture WILL trip Check 1c below (it's not the Gigaloch pair)
    // — that's correct and expected, not a contradiction. 1b's job is "is
    // this a valid PON shape for any operator"; 1c's job is "is this
    // specifically Gigaloch's cascade". They're deliberately answering
    // different questions, so only cascadeIssues (1b's category) is checked
    // here — see orderedTwoStageStore('1:2', '1:16') in the 1c block for the
    // same fixture asserted the other way.
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

describe('Design Health — Check 1c: strict Gigaloch cascade order (1:8 near premise, 1:4 near cabinet)', () => {
  // Unlike 1b, this check is deliberately operator-specific — it hardcodes
  // Gigaloch's build standard rather than deriving from declared ratios. It
  // only runs when 1b has already confirmed exactly two stages exist (see
  // designHealth.js: the two checks are mutually exclusive per-premise, not
  // layered — a route either fails 1b's count check or is eligible for 1c's
  // order check, never both, so counts below don't double up).

  it('does NOT flag the correct order — 1:8 nearest premise, 1:4 nearest cabinet', () => {
    const result = runDesignHealth(orderedTwoStageStore('1:8', '1:4'));
    expect(orderIssues(result)).toHaveLength(0);
    expect(result.verdict).toBe(VERDICT.GO);
  });

  it('flags a REVERSED cascade (1:4 nearest premise, 1:8 nearest cabinet), worded as "reversed"', () => {
    const result = runDesignHealth(orderedTwoStageStore('1:4', '1:8'));
    const flags = orderIssues(result);
    expect(flags).toHaveLength(1);
    expect(flags[0].tier).toBe('error');
    expect(flags[0].message).toContain('cascade order is reversed');
  });

  it('flags a matched-but-wrong pair (1:8 + 1:8), worded as "wrong split ratios" not "reversed"', () => {
    const result = runDesignHealth(orderedTwoStageStore('1:8', '1:8'));
    const flags = orderIssues(result);
    expect(flags).toHaveLength(1);
    expect(flags[0].tier).toBe('error');
    expect(flags[0].message).toContain('wrong split ratios');
    expect(flags[0].message).not.toContain('reversed');
  });

  it('flags a non-Gigaloch but internally-valid pair (1:2 near premise, 1:16 near cabinet)', () => {
    // Same fixture as the 1b ratio-agnostic test above, asserted the other
    // way: 1b doesn't care, 1c does — both are correct simultaneously.
    const result = runDesignHealth(orderedTwoStageStore('1:2', '1:16'));
    const flags = orderIssues(result);
    expect(flags).toHaveLength(1);
    expect(flags[0].message).toContain('wrong split ratios');
  });

  it('a wrong-order cascade drives verdict to NO-GO (error tier), same as a wrong-count cascade', () => {
    expect(runDesignHealth(orderedTwoStageStore('1:4', '1:8')).verdict).toBe(VERDICT.NOGO);
  });

  it('does NOT double-flag when the stage count itself is wrong (0, 1, or 3 splitters)', () => {
    // 1c only evaluates when splitters.length === 2 — a wrong-count route is
    // 1b's problem exclusively, and shouldn't also produce a spurious 1c
    // "wrong order" issue on top of the count error.
    expect(orderIssues(runDesignHealth(chainedStore(0)))).toHaveLength(0);
    expect(orderIssues(runDesignHealth(chainedStore(1)))).toHaveLength(0);
    expect(orderIssues(runDesignHealth(chainedStore(3)))).toHaveLength(0);
  });

  it('caps displayed order issues and summarises the overflow (>10 bad routes)', () => {
    // 15 premises, each fed by their own reversed-order two-joint chain
    // sharing one cabinet — mirrors the 1b overflow test above.
    const store = orderedTwoStageStore('1:4', '1:8'); // reversed: JNT-1, JNT-2
    const extraJoints = [];
    const extraCables = [];
    const extraBundles = [];
    const addressPoints = [{ properties: { uprn: '1000001', address: 'Premise 1' } }];
    for (let i = 2; i <= 15; i++) {
      const near = `JNT-EXTRA-${i}-A`;
      const far  = `JNT-EXTRA-${i}-B`;
      extraJoints.push(
        { properties: { joint_id: near, has_splitter: true, split_ratio: '1:4' }, geometry: { coordinates: [0, 0] } },
        { properties: { joint_id: far,  has_splitter: true, split_ratio: '1:8' }, geometry: { coordinates: [0, 0] } },
      );
      extraCables.push(
        { properties: { cable_id: `CBL-EXTRA-${i}-A`, from_node: near, to_node: far,     length_m: 50 } },
        { properties: { cable_id: `CBL-EXTRA-${i}-B`, from_node: far,  to_node: 'CAB-1',  length_m: 50 } },
      );
      extraBundles.push({ properties: { uprn: String(1000000 + i), bundle_id: `BUN-${i}`, from_joint: near, length_m: 10 } });
      addressPoints.push({ properties: { uprn: String(1000000 + i), address: `Premise ${i}` } });
    }
    store.joints.push(...extraJoints);
    store.cables.push(...extraCables);
    store.bundles.push(...extraBundles);
    store.addressPoints = addressPoints;

    const result = runDesignHealth(store);
    const flags = orderIssues(result);
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

describe('Design Health — Check 2b stale-declaration drift class', () => {
  it('flags a genuinely isolated splitter (bundleCount=0, feeds nothing downstream)', () => {
    // A joint declared as a splitter but not connected onward to anything —
    // no bundles, and its only cable neighbour is a non-splitter joint.
    const store = chainedStore(1);
    // chainedStore(1) already has JNT-1 as a splitter WITH one bundle
    // attached (that's the entry joint) — add a second, genuinely orphaned
    // splitter joint that isn't fed by anything and feeds nothing.
    store.joints.push({
      properties: { joint_id: 'JNT-ORPHAN', has_splitter: true, split_ratio: '1:8' },
      geometry: { coordinates: [0.5, 0.5] },
    });
    const result = runDesignHealth(store);
    const staleFlags = result.issues.filter(i => i.category === 'Stale splitter declaration' && i.assetId === 'JNT-ORPHAN');
    expect(staleFlags).toHaveLength(1);
    expect(staleFlags[0].tier).toBe('warning');
  });

  it('does NOT flag a feeder splitter whose only consumers are downstream splitter joints (not bundles)', () => {
    // This is the exact case that would false-positive on a naive
    // bundleCount===0 check: a 1:4 feeder's real consumers are other
    // splitter joints in the cascade, not bundles directly. Explicit
    // assertion (chainedStore(2)'s second joint IS this case already,
    // covered implicitly by the "exactly two splitters" test — this makes
    // the guarantee explicit and names it).
    const result = runDesignHealth(chainedStore(2));
    const staleFlags = result.issues.filter(i => i.category === 'Stale splitter declaration');
    expect(staleFlags).toHaveLength(0);
  });

  it('does NOT flag a joint feeding a CBT (CBTs are always splitters, no has_splitter toggle to check)', () => {
    const store = chainedStore(1);
    store.cbts.push({ properties: { cbt_id: 'CBT-1', split_ratio: '1:8' }, geometry: { coordinates: [0.5, 0.5] } });
    store.cables.push({ properties: { cable_id: 'CBL-TO-CBT', from_node: 'JNT-1', to_node: 'CBT-1', length_m: 20 } });
    const result = runDesignHealth(store);
    // JNT-1 has a bundle attached anyway in this fixture, so this mainly
    // proves the CBT-feed path doesn't throw or misclassify — the dedicated
    // "feeds nothing" case is covered by the isolated-joint test above.
    const staleFlags = result.issues.filter(i => i.category === 'Stale splitter declaration' && i.assetId === 'JNT-1');
    expect(staleFlags).toHaveLength(0);
  });

  it('does NOT flag a splitter joint fed purely via CBT tails (docs/TODO.md item 2 — JNT-001 shape: a 1:4 feeding two 1:8 CBTs via tails, no bundles or cables)', () => {
    // Tails are stored from_cbt -> to_joint (the physical lay direction),
    // but the feed relationship runs the other way: the joint feeds the CBT.
    // Before this fix, feedsAnotherSplitter never inspected cbtTails at all,
    // so a splitter fed purely this way (SCOT-PH1 JNT-001) false-positived.
    const store = chainedStore(1);
    store.joints.push({
      properties: { joint_id: 'JNT-TAILFED', has_splitter: true, split_ratio: '1:4' },
      geometry: { coordinates: [0.6, 0.6] },
    });
    store.cbts.push(
      { properties: { cbt_id: 'CBT-A', split_ratio: '1:8' }, geometry: { coordinates: [0.7, 0.7] } },
      { properties: { cbt_id: 'CBT-B', split_ratio: '1:8' }, geometry: { coordinates: [0.8, 0.8] } },
    );
    store.cbtTails.push(
      { properties: { tail_id: 'TAIL-A', from_cbt: 'CBT-A', to_joint: 'JNT-TAILFED', length_m: 40 } },
      { properties: { tail_id: 'TAIL-B', from_cbt: 'CBT-B', to_joint: 'JNT-TAILFED', length_m: 60 } },
    );
    const result = runDesignHealth(store);
    const staleFlags = result.issues.filter(i => i.category === 'Stale splitter declaration' && i.assetId === 'JNT-TAILFED');
    expect(staleFlags).toHaveLength(0);
  });

  it('does NOT flag a splitter joint feeding a downstream splitter joint via an aerial span (spans are a separate collection from cables)', () => {
    const store = chainedStore(1);
    store.joints.push(
      { properties: { joint_id: 'JNT-SPANFED', has_splitter: true, split_ratio: '1:4' },
        geometry: { coordinates: [0.6, 0.6] } },
      { properties: { joint_id: 'JNT-SPAN-DOWNSTREAM', has_splitter: true, split_ratio: '1:8' },
        geometry: { coordinates: [0.7, 0.7] } },
    );
    store.spans.push({
      properties: { span_id: 'SPAN-1', from_node: 'JNT-SPANFED', to_node: 'JNT-SPAN-DOWNSTREAM', length_m: 30 },
    });
    const result = runDesignHealth(store);
    const staleFlags = result.issues.filter(i => i.category === 'Stale splitter declaration' && i.assetId === 'JNT-SPANFED');
    expect(staleFlags).toHaveLength(0);
  });
});

describe('Design Health — Check 2d: cable duct_id FK', () => {
  it('does not flag a null duct_id (normal unmatched state)', () => {
    const store = chainedStore(2);
    store.cables[0].properties.duct_id = null;
    const result = runDesignHealth(store);
    expect(result.issues.filter(i => i.message.includes('duct_id'))).toHaveLength(0);
  });

  it('does not flag a duct_id that resolves to a real duct', () => {
    const store = chainedStore(2);
    store.ducts = [{ properties: { duct_id: 'DCT-1' } }];
    store.cables[0].properties.duct_id = 'DCT-1';
    const result = runDesignHealth(store);
    expect(result.issues.filter(i => i.message.includes('duct_id'))).toHaveLength(0);
  });

  it('flags a set-but-dangling duct_id', () => {
    const store = chainedStore(2);
    store.cables[0].properties.duct_id = 'DCT-DELETED';
    const result = runDesignHealth(store);
    const flags = result.issues.filter(i => i.message.includes('duct_id'));
    expect(flags).toHaveLength(1);
    expect(flags[0].tier).toBe('error');
    expect(flags[0].assetId).toBe('CBL-1');
  });
});

describe('Design Health — Check 2d: joint chamber_id FK', () => {
  it('does not flag a chamber_id that resolves to a real chamber', () => {
    const store = chainedStore(2);
    store.chambers = [{ properties: { chamber_id: 'CH-1' } }];
    store.joints[0].properties.chamber_id = 'CH-1';
    const result = runDesignHealth(store);
    expect(result.issues.filter(i => i.message.includes('chamber_id'))).toHaveLength(0);
  });

  it('flags a set-but-dangling chamber_id', () => {
    const store = chainedStore(2);
    store.joints[0].properties.chamber_id = 'CH-DELETED';
    const result = runDesignHealth(store);
    const flags = result.issues.filter(i => i.message.includes('chamber_id'));
    expect(flags).toHaveLength(1);
    expect(flags[0].tier).toBe('error');
    expect(flags[0].assetId).toBe('JNT-1');
  });
});

describe('Design Health — Check 2d: bundle uprn FK', () => {
  it('does not flag a null uprn (normal unmatched state)', () => {
    const store = chainedStore(2);
    store.bundles[0].properties.uprn = null;
    const result = runDesignHealth(store);
    expect(result.issues.filter(i => i.message.includes('uprn'))).toHaveLength(0);
  });

  it('flags a set-but-dangling uprn', () => {
    const store = chainedStore(2);
    store.bundles[0].properties.uprn = '9999999';
    const result = runDesignHealth(store);
    const flags = result.issues.filter(i => i.message.includes('uprn'));
    expect(flags).toHaveLength(1);
    expect(flags[0].tier).toBe('error');
    expect(flags[0].assetId).toBe('BUN-1');
  });
});

describe('Design Health — Check 2d: fibreAssignments FKs (role-aware)', () => {
  // IMPORTANT: fibreAssignments records are FLAT objects (see fibreAssign.js's
  // rec() helper — `{ assign_id, ...o }`, no GeoJSON .properties wrapper like
  // every other collection). designHealth.js's `p = assignment.properties ||
  // assignment` fallback handles this, but the fixtures below deliberately
  // match the real shape rather than lean on that fallback.
  it('does not flag a real cable_id, a synthetic "-SP" splitter pigtail id, or a real joint_id/bundle_id', () => {
    const store = chainedStore(2);
    store.fibreAssignments = [
      { assign_id: 'ASN-0001', cable_id: 'CBL-1', joint_id: 'JNT-1', fibre_role: 'SPLITTER_INPUT' },
      { assign_id: 'ASN-0002', cable_id: 'JNT-1-SP', joint_id: 'JNT-1', bundle_id: 'BUN-1', fibre_role: 'SPLITTER_OUTPUT' },
      // Stage-1 convention: bundle_id holds a downstream CHILD JOINT id, not a bundle.
      { assign_id: 'ASN-0003', cable_id: 'JNT-1-SP', joint_id: 'JNT-1', bundle_id: 'JNT-2', fibre_role: 'SPLITTER_OUTPUT' },
    ];
    const result = runDesignHealth(store);
    expect(result.issues.filter(i => i.layer === 'fibreAssignments')).toHaveLength(0);
  });

  it('flags a dangling joint_id, a dangling non-synthetic cable_id, and a dangling bundle_id', () => {
    const store = chainedStore(2);
    store.fibreAssignments = [
      { assign_id: 'ASN-0001', joint_id: 'JNT-DOES-NOT-EXIST', fibre_role: 'SPLITTER_INPUT' },
      { assign_id: 'ASN-0002', cable_id: 'CBL-DOES-NOT-EXIST', joint_id: 'JNT-1', fibre_role: 'DARK_STORAGE' },
      { assign_id: 'ASN-0003', joint_id: 'JNT-1', bundle_id: 'NEITHER-BUNDLE-NOR-JOINT', fibre_role: 'SPLITTER_OUTPUT' },
    ];
    const result = runDesignHealth(store);
    const flags = result.issues.filter(i => i.layer === 'fibreAssignments');
    expect(flags).toHaveLength(3);
    expect(flags.every(f => f.tier === 'error')).toBe(true);
  });
});
