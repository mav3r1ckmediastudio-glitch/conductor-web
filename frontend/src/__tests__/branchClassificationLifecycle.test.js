// branchClassificationLifecycle.test.js — release-audit §3 / handoff §4.
//
// Proves the branch-classification paid-beta gate end-to-end at the data-path
// level: the exact writes BranchClassificationPanel / AssetEditPanel / the
// creation forms make (projectStore.updateAsset writing feed_mode) drive the
// design from "inferred at a splitter → export blocked" to VALIDATED with
// splice export available, and any later planning-input edit closes the gate
// again. This is the deterministic backstop for the Playwright acceptance E2E.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { assignFibres } from '../fibreAssign.js';
import { physicalPlanReady } from '../splicePlan.js';
import { buildFibreNetwork } from '../fibreNetwork.js';

function makeLocalStorageMock() {
  const store = new Map();
  return { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };
}
beforeEach(() => { vi.resetModules(); vi.stubGlobal('localStorage', makeLocalStorageMock()); });

// A splitter (JNT-001, 1:4) with an onward raw branch (CBL-ON) that is left
// UNCLASSIFIED — it leaves a splitter, so the planner must not guess it.
function designState() {
  return {
    stage: 'design', project: { area_id: 'TST' }, buildArea: null,
    cabinet: { properties: { pop_id: 'CAB-1' } },
    chambers: [], ducts: [], dropDucts: [], poles: [], spans: [], cbtTails: [], addressPoints: [],
    joints: [
      { properties: { joint_id: 'JNT-001', has_splitter: true, split_ratio: '1:4' } },
      { properties: { joint_id: 'JNT-002', has_splitter: true, split_ratio: '1:8' } },
    ],
    cbts: [], aerialDrops: [],
    bundles: [{ properties: { uprn: '1000001', bundle_id: 'BUN-1', from_joint: 'JNT-002' } }],
    cables: [
      { properties: { cable_id: 'CBL-IN', from_node: 'CAB-1', to_node: 'JNT-001', fibre_count: 96, feed_mode: 'PASS_THROUGH' } },
      // Deliberately NO feed_mode — leaves splitter JNT-001 → inferred.
      { properties: { cable_id: 'CBL-ON', from_node: 'JNT-001', to_node: 'JNT-002', fibre_count: 48 } },
    ],
    fibreAssignments: [], physicalAssignments: [], physicalPlanStatus: 'UNVERIFIED', physicalPlanInputHash: null,
  };
}

async function freshStore(state) {
  const mod = await import('../projectStore.js');
  const ps = mod.projectStore;
  ps.restoreState(structuredClone(state));
  return ps;
}
const cableIdx = (ps, id) => (ps.state.cables || []).findIndex(c => c.properties.cable_id === id);

describe('§4 branch classification: the panel list surfaces the inferred branch', () => {
  it('buildFibreNetwork flags CBL-ON as feedModeInferred leaving a splitter', async () => {
    const ps = await freshStore(designState());
    const net = buildFibreNetwork(ps.state);
    const onward = net.edges.find(e => e.id === 'CBL-ON');
    expect(onward.feedModeInferred).toBe(true);           // shows up in the resolution list
    expect(net.nodes.get(onward.from).hasSplitter).toBe(true); // and it blocks validation
  });
});

describe('§4 lifecycle: classify → VALIDATED → export opens → edit closes it', () => {
  it('an unclassified splitter branch blocks VALIDATED and export', async () => {
    const ps = await freshStore(designState());
    const res = assignFibres(ps.state);
    expect(res.physicalPlanStatus).toBe('INVALID');
    expect(res.physicalPlan.errors.some(e => e.code === 'INFERRED_CLASSIFICATION')).toBe(true);
    ps.applyFibreAssignment(res);
    expect(physicalPlanReady(ps.state)).toBe(false);
  });

  it('resolving via updateAsset(feed_mode) — the panel\'s exact write — reaches VALIDATED and opens export', async () => {
    const ps = await freshStore(designState());
    ps.applyFibreAssignment(assignFibres(ps.state));      // INVALID first
    expect(physicalPlanReady(ps.state)).toBe(false);

    // BranchClassificationPanel.resolve() does exactly this:
    ps.updateAsset('cables', cableIdx(ps, 'CBL-ON'), { feed_mode: 'PASS_THROUGH' });

    // no more inferred branch
    const net = buildFibreNetwork(ps.state);
    expect(net.edges.find(e => e.id === 'CBL-ON').feedModeInferred).toBe(false);

    // Re-run planning (the panel's "Re-run planning" button → onBranchReplan)
    const res = assignFibres(ps.state);
    expect(res.physicalPlanStatus).toBe('VALIDATED');
    ps.applyFibreAssignment(res);
    expect(ps.state.physicalPlanStatus).toBe('VALIDATED');
    expect(physicalPlanReady(ps.state)).toBe(true);        // splice export now available
  });

  it('editing a capacity after validating immediately closes the export gate', async () => {
    const ps = await freshStore(designState());
    ps.updateAsset('cables', cableIdx(ps, 'CBL-ON'), { feed_mode: 'PASS_THROUGH' });
    ps.applyFibreAssignment(assignFibres(ps.state));
    expect(physicalPlanReady(ps.state)).toBe(true);

    // AssetEditPanel capacity edit, no replan:
    ps.updateAsset('cables', cableIdx(ps, 'CBL-IN'), { fibre_count: 72 });
    expect(ps.state.physicalPlanStatus).toBe('VALIDATED');  // status survives
    expect(physicalPlanReady(ps.state)).toBe(false);         // gate closed (stale fingerprint)
  });

  it('classifying the branch as SPLITTER_OUTPUT instead is honoured (no longer inferred)', async () => {
    const ps = await freshStore(designState());
    ps.updateAsset('cables', cableIdx(ps, 'CBL-ON'), { feed_mode: 'SPLITTER_OUTPUT', splitter_id: 'JNT-001-SP', splitter_port: 1 });
    const net = buildFibreNetwork(ps.state);
    const onward = net.edges.find(e => e.id === 'CBL-ON');
    expect(onward.feedModeInferred).toBe(false);
    expect(onward.feedMode).toBe('SPLITTER_OUTPUT');
  });
});

describe('§4 CBT-tail from a splitter classified as SPLITTER_OUTPUT validates', () => {
  // A CBT with a splitter, fed by a tail from JNT-001 that is an optical output
  // leg (SPLITTER_OUTPUT) — the CBT-tail form's proposed-and-confirmed default.
  function tailState() {
    const s = designState();
    // Make CBL-ON a plain classified pass-through to a terminal splitter, and add
    // a CBT fed by a SPLITTER_OUTPUT tail off JNT-001.
    s.cables[1].properties.feed_mode = 'PASS_THROUGH';
    s.cbts = [{ properties: { cbt_id: 'CBT-1', parent_pole_id: 'POLE-1', has_splitter: true, split_ratio: '1:8' } }];
    s.poles = [{ properties: { pole_id: 'POLE-1' } }];
    s.cbtTails = [{ properties: { tail_id: 'TAIL-1', from_cbt: 'CBT-1', to_joint: 'JNT-001', fibre_count: 1, feed_mode: 'SPLITTER_OUTPUT', splitter_id: 'JNT-001-SP', splitter_port: 2 } }];
    return s;
  }
  it('the tail edge is explicitly SPLITTER_OUTPUT (not inferred)', async () => {
    const ps = await freshStore(tailState());
    const net = buildFibreNetwork(ps.state);
    const tail = net.edges.find(e => e.id === 'TAIL-1');
    expect(tail).toBeTruthy();
    expect(tail.feedModeInferred).toBe(false);
    expect(tail.feedMode).toBe('SPLITTER_OUTPUT');
  });
});

// The panel's SPLITTER_OUTPUT path must REPLAN successfully — not merely make the
// row disappear from the unresolved list. Release blocker: the one-click resolve
// used to write a splitter_id with no port; the branch left the list but the plan
// could not be trusted. The panel now writes complete optical metadata
// (feed_mode + splitter_id + splitter_port), so replanning reaches VALIDATED and
// export opens. This is the golden §11 #5 topology (proven to validate) with the
// tail left UNCLASSIFIED, then resolved exactly as BranchClassificationPanel does.
describe('§4 panel SPLITTER_OUTPUT resolve → replan reaches VALIDATED (not just disappears)', () => {
  function unclassifiedTailState() {
    return {
      stage: 'design', project: { area_id: 'TST' }, buildArea: null,
      cabinet: { properties: { pop_id: 'CAB-1' } },
      chambers: [], ducts: [], dropDucts: [], poles: [], spans: [], addressPoints: [],
      joints: [{ properties: { joint_id: 'JNT-001', has_splitter: true, split_ratio: '1:4' } }],
      cbts: [{ properties: { cbt_id: 'CBT-1', split_ratio: '1:8' } }],
      aerialDrops: [], bundles: [],
      cables: [{ properties: { cable_id: 'CBL-IN', from_node: 'CAB-1', to_node: 'JNT-001', fibre_count: 96, feed_mode: 'PASS_THROUGH' } }],
      // Tail leaves splitter JNT-001 with NO feed_mode -> inferred -> blocks VALIDATED.
      cbtTails: [{ properties: { tail_id: 'TAIL-1', from_cbt: 'CBT-1', to_joint: 'JNT-001', fibre_count: 1 } }],
      fibreAssignments: [], physicalAssignments: [], physicalPlanStatus: 'UNVERIFIED', physicalPlanInputHash: null,
    };
  }
  const tailIdx = (ps) => (ps.state.cbtTails || []).findIndex(t => t.properties.tail_id === 'TAIL-1');

  it('blocks first, then the panel exact SPLITTER_OUTPUT write replans to VALIDATED + export', async () => {
    const ps = await freshStore(unclassifiedTailState());

    const before = assignFibres(ps.state);
    expect(before.physicalPlanStatus).toBe('INVALID');
    expect(before.physicalPlan.errors.some(e => e.code === 'INFERRED_CLASSIFICATION')).toBe(true);
    ps.applyFibreAssignment(before);
    expect(physicalPlanReady(ps.state)).toBe(false);

    // BranchClassificationPanel.resolve(row,'SPLITTER_OUTPUT') now writes COMPLETE
    // optical metadata (id + chosen port), not just a splitter_id:
    ps.updateAsset('cbtTails', tailIdx(ps), { feed_mode: 'SPLITTER_OUTPUT', splitter_id: 'JNT-001-SP', splitter_port: 2 });

    const net = buildFibreNetwork(ps.state);
    const tail = net.edges.find(e => e.id === 'TAIL-1');
    expect(tail.feedModeInferred).toBe(false);
    expect(tail.feedMode).toBe('SPLITTER_OUTPUT');
    expect(tail.splitterPort).toBe(2);

    const after = assignFibres(ps.state);
    expect(after.physicalPlanStatus).toBe('VALIDATED');
    expect(after.physicalPlan.errors.filter(e => e.code.startsWith('OUTPUT_'))).toEqual([]);
    expect(after.splitterPorts['CBT-1']).toBe(2);
    expect(after.logicalAssignments.find(a => a.fibre_role === 'SPLITTER_OUTPUT' && a.bundle_id === 'CBT-1')?.port).toBe(2);
    ps.applyFibreAssignment(after);
    expect(ps.state.cbts[0].properties.feeder_port).toBe(2);
    expect(physicalPlanReady(ps.state)).toBe(true);
  });

  it('keeps a deliberately selected port identical across segment, logical assignment and child write-back', async () => {
    const ps = await freshStore(unclassifiedTailState());
    ps.updateAsset('cbtTails', tailIdx(ps), { feed_mode: 'SPLITTER_OUTPUT', splitter_id: 'JNT-001-SP', splitter_port: 3 });

    const res = assignFibres(ps.state);
    expect(res.physicalPlanStatus).toBe('VALIDATED');
    expect(ps.state.cbtTails[0].properties.splitter_port).toBe(3);
    expect(res.splitterPorts['CBT-1']).toBe(3);
    expect(res.logicalAssignments.find(a => a.fibre_role === 'SPLITTER_OUTPUT' && a.bundle_id === 'CBT-1')?.port).toBe(3);

    ps.applyFibreAssignment(res);
    expect(ps.state.cbts[0].properties.feeder_port).toBe(3);
    expect(physicalPlanReady(ps.state)).toBe(true);
  });

  it('reconciles a proposed child\'s stale feeder_port to the classified segment port', async () => {
    const state = unclassifiedTailState();
    state.cbts[0].properties.status = 'PROPOSED';
    state.cbts[0].properties.feeder_port = 1;
    const ps = await freshStore(state);
    ps.updateAsset('cbtTails', tailIdx(ps), { feed_mode: 'SPLITTER_OUTPUT', splitter_id: 'JNT-001-SP', splitter_port: 3 });

    const res = assignFibres(ps.state);
    expect(res.physicalPlanStatus).toBe('VALIDATED');
    expect(res.splitterPorts['CBT-1']).toBe(3);
    ps.applyFibreAssignment(res);
    expect(ps.state.cbts[0].properties.feeder_port).toBe(3);
  });

  it('fails closed instead of silently moving an installed child to a different selected port', async () => {
    const state = unclassifiedTailState();
    state.cbts[0].properties.status = 'INSTALLED';
    state.cbts[0].properties.feeder_port = 1;
    const ps = await freshStore(state);
    ps.updateAsset('cbtTails', tailIdx(ps), { feed_mode: 'SPLITTER_OUTPUT', splitter_id: 'JNT-001-SP', splitter_port: 3 });

    const res = assignFibres(ps.state);
    expect(res.physicalPlanStatus).toBe('INVALID');
    expect(res.physicalPlan.errors.some(e => e.code === 'OUTPUT_FROZEN_PORT_CONFLICT')).toBe(true);
    expect(res.physicalPlan.errors.some(e => e.code === 'OUTPUT_LOGICAL_PORT_MISMATCH')).toBe(true);
  });

  it('an incomplete SPLITTER_OUTPUT write (id but no port) does NOT reach VALIDATED', async () => {
    const ps = await freshStore(unclassifiedTailState());
    ps.updateAsset('cbtTails', tailIdx(ps), { feed_mode: 'SPLITTER_OUTPUT', splitter_id: 'JNT-001-SP' });
    const res = assignFibres(ps.state);
    expect(res.physicalPlanStatus).toBe('INVALID');
    expect(res.physicalPlan.errors.some(e => e.code === 'OUTPUT_PORT_MISSING')).toBe(true);
  });
});

// The data-level guarantee behind CableForm's no-silent-default: a cable created
// leaving a splitter with NO feed_mode is inferred and blocks validation (the
// form now disables Place until a mode is deliberately chosen, so this state is
// only reachable via legacy/imported data — and it fails closed).
describe('§4 a cable leaving a splitter with no feed_mode fails closed', () => {
  it('is inferred and blocks VALIDATED', async () => {
    const ps = await freshStore(designState()); // CBL-ON leaves JNT-001 with no feed_mode
    const net = buildFibreNetwork(ps.state);
    expect(net.edges.find(e => e.id === 'CBL-ON').feedModeInferred).toBe(true);
    const res = assignFibres(ps.state);
    expect(res.physicalPlanStatus).toBe('INVALID');
    expect(res.physicalPlan.errors.some(e => e.code === 'INFERRED_CLASSIFICATION')).toBe(true);
  });
});
