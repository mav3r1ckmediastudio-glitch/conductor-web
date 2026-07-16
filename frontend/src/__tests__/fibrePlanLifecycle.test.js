// fibrePlanLifecycle.test.js — Release-audit P0-1 regression suite.
// Proves an exported plan is bound to the exact current project state: editing
// any planning input closes the export gate, and a non-validating rerun makes
// the current status INVALID (never silently preserves a prior VALIDATED plan).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { assignFibres } from '../fibreAssign.js';
import { physicalPlanReady } from '../splicePlan.js';
import { hashPhysicalPlanInputs } from '../fibrePlanInputs.js';

function makeLocalStorageMock() {
  const store = new Map();
  return { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };
}
beforeEach(() => { vi.resetModules(); vi.stubGlobal('localStorage', makeLocalStorageMock()); });

function designState(over = {}) {
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
      { properties: { cable_id: 'CBL-ON', from_node: 'JNT-001', to_node: 'JNT-002', fibre_count: 48, feed_mode: 'PASS_THROUGH' } },
    ],
    fibreAssignments: [], physicalAssignments: [], physicalPlanStatus: 'UNVERIFIED', physicalPlanInputHash: null,
    ...over,
  };
}

async function freshStore(state) {
  const mod = await import('../projectStore.js');
  const ps = mod.projectStore;
  ps.restoreState(structuredClone(state));
  return ps;
}

describe('P0-1: a validated plan is bound to current project state', () => {
  it('validates, stamps a fingerprint, and reads ready right after assigning', async () => {
    const ps = await freshStore(designState());
    const res = assignFibres(ps.state);
    expect(res.physicalPlanStatus).toBe('VALIDATED');
    ps.applyFibreAssignment(res);
    expect(ps.state.physicalPlanStatus).toBe('VALIDATED');
    expect(ps.state.physicalPlanInputHash).toBeTruthy();
    expect(ps.state.physicalAssignments.length).toBeGreaterThan(0);
    expect(physicalPlanReady(ps.state)).toBe(true);
  });

  it('editing a cable capacity closes the export gate (status still VALIDATED, but stale)', async () => {
    const ps = await freshStore(designState());
    ps.applyFibreAssignment(assignFibres(ps.state));
    expect(physicalPlanReady(ps.state)).toBe(true);
    const edited = structuredClone(ps.state);
    edited.cables[0].properties.fibre_count = 72;   // change capacity, do NOT replan
    ps.restoreState(edited);
    expect(ps.state.physicalPlanStatus).toBe('VALIDATED');   // status survived
    expect(physicalPlanReady(ps.state)).toBe(false);          // but gate is closed
  });

  it('changing an endpoint closes the export gate', async () => {
    const ps = await freshStore(designState());
    ps.applyFibreAssignment(assignFibres(ps.state));
    const edited = structuredClone(ps.state);
    edited.cables[1].properties.to_node = 'JNT-XYZ';
    ps.restoreState(edited);
    expect(physicalPlanReady(ps.state)).toBe(false);
  });

  it('adding a branch closes the export gate', async () => {
    const ps = await freshStore(designState());
    ps.applyFibreAssignment(assignFibres(ps.state));
    const edited = structuredClone(ps.state);
    edited.joints.push({ properties: { joint_id: 'JNT-003', has_splitter: true, split_ratio: '1:8' } });
    edited.cables.push({ properties: { cable_id: 'CBL-C', from_node: 'JNT-001', to_node: 'JNT-003', fibre_count: 48, feed_mode: 'PASS_THROUGH' } });
    ps.restoreState(edited);
    expect(physicalPlanReady(ps.state)).toBe(false);
  });

  it('a non-validating rerun makes the current status INVALID and clears the physical plan', async () => {
    const ps = await freshStore(designState());
    ps.applyFibreAssignment(assignFibres(ps.state));
    expect(ps.state.physicalPlanStatus).toBe('VALIDATED');
    // Shrink the feeder below demand → capacity failure on rerun.
    const edited = structuredClone(ps.state);
    edited.cables[0].properties.fibre_count = 1;
    ps.restoreState(edited);
    ps.applyFibreAssignment(assignFibres(ps.state));
    expect(ps.state.physicalPlanStatus).toBe('INVALID');
    expect(ps.state.physicalAssignments).toEqual([]);
    expect(ps.state.physicalPlanInputHash).toBeNull();
    expect(physicalPlanReady(ps.state)).toBe(false);
  });

  it('a missing fingerprint fails closed even if status says VALIDATED', () => {
    const s = designState({ physicalPlanStatus: 'VALIDATED', physicalPlanInputHash: null });
    expect(physicalPlanReady(s)).toBe(false);
  });

  it('a matching fingerprint reads ready; tampering the hash closes the gate', () => {
    const s = designState({ physicalPlanStatus: 'VALIDATED' });
    s.physicalPlanInputHash = hashPhysicalPlanInputs(s);
    expect(physicalPlanReady(s)).toBe(true);
    s.physicalPlanInputHash = 'p2-deadbeefdeadbeef-1';
    expect(physicalPlanReady(s)).toBe(false);
  });
});
