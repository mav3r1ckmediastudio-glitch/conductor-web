// projectStoreSession.test.js — Regression suite for snapshotState()/
// restoreState() on projectStore.js, added to back continuous tool sessions
// (place/edit/delete/move stay live across repeated actions; RMB -> Cancel
// must fully roll back everything done since the tool was activated — see
// startToolSession() in mapTools.js and docs/conductor-web-context.md,
// agreed 2 Jul 2026).
//
// Full-state deep clone/restore rather than an action-by-action undo log —
// these tests exist to pin down exactly that: restore must undo adds,
// deletes AND in-place property/geometry updates uniformly, since they're
// all just "the state differs from the snapshot" to this mechanism.
//
// Same in-memory localStorage mock and per-test fresh-module pattern as
// projectStoreEviction.test.js, since projectStore.js has no other DOM
// dependency of its own.
//
// Run with: npm test

import { describe, it, expect, beforeEach, vi } from 'vitest';

function makeLocalStorageMock() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    _dump: () => Object.fromEntries(store),
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('localStorage', makeLocalStorageMock());
});

function makeChamber(chamberId) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-4.5, 56.7] },
    properties: { chamber_id: chamberId, chamber_seq: 1, compass_dir: 'N', area_id: 'SCOT-PH1' },
  };
}

describe('projectStore — session snapshot / restore', () => {
  it('snapshotState() returns a deep clone, not a live reference', async () => {
    const { projectStore } = await import('../projectStore.js');
    projectStore.newProject();
    projectStore.setupProject({ name: 'Project A', areaId: 'SCOT-PH1' });
    projectStore.addChamber(makeChamber('SCOT-PH1-CMBR-0001'));

    const snapshot = projectStore.snapshotState();
    snapshot.chambers.push(makeChamber('SCOT-PH1-CMBR-9999')); // mutate the snapshot directly

    expect(projectStore.state.chambers).toHaveLength(1); // live state must be unaffected
  });

  it('restoreState() undoes assets added during a session (the placement-tool case)', async () => {
    const { projectStore } = await import('../projectStore.js');
    projectStore.newProject();
    projectStore.setupProject({ name: 'Project A', areaId: 'SCOT-PH1' });
    projectStore.addChamber(makeChamber('SCOT-PH1-CMBR-0001'));

    const snapshot = projectStore.snapshotState(); // session starts here — 1 chamber already placed
    projectStore.addChamber(makeChamber('SCOT-PH1-CMBR-1001'));
    projectStore.addChamber(makeChamber('SCOT-PH1-CMBR-2001'));
    expect(projectStore.state.chambers).toHaveLength(3);

    projectStore.restoreState(snapshot); // Cancel

    expect(projectStore.state.chambers).toHaveLength(1);
    expect(projectStore.state.chambers[0].properties.chamber_id).toBe('SCOT-PH1-CMBR-0001');
  });

  it('restoreState() undoes a delete made during a session (the delete-tool case)', async () => {
    const { projectStore } = await import('../projectStore.js');
    projectStore.newProject();
    projectStore.setupProject({ name: 'Project A', areaId: 'SCOT-PH1' });
    projectStore.addChamber(makeChamber('SCOT-PH1-CMBR-0001'));
    projectStore.addChamber(makeChamber('SCOT-PH1-CMBR-1001'));

    const snapshot = projectStore.snapshotState();
    projectStore.deleteAsset('chambers', 0);
    expect(projectStore.state.chambers).toHaveLength(1);

    projectStore.restoreState(snapshot);

    expect(projectStore.state.chambers).toHaveLength(2);
    expect(projectStore.state.chambers.map(c => c.properties.chamber_id)).toEqual([
      'SCOT-PH1-CMBR-0001', 'SCOT-PH1-CMBR-1001',
    ]);
  });

  it('restoreState() undoes a move made during a session (the move-tool case)', async () => {
    const { projectStore } = await import('../projectStore.js');
    projectStore.newProject();
    projectStore.setupProject({ name: 'Project A', areaId: 'SCOT-PH1' });
    projectStore.addChamber(makeChamber('SCOT-PH1-CMBR-0001'));

    const snapshot = projectStore.snapshotState();
    projectStore.updateAssetGeometry('chambers', 0, [-5.1, 57.2]);
    expect(projectStore.state.chambers[0].geometry.coordinates).toEqual([-5.1, 57.2]);

    projectStore.restoreState(snapshot);

    expect(projectStore.state.chambers[0].geometry.coordinates).toEqual([-4.5, 56.7]);
  });

  it('restoreState() undoes an edit made during a session (the edit-tool case)', async () => {
    const { projectStore } = await import('../projectStore.js');
    projectStore.newProject();
    projectStore.setupProject({ name: 'Project A', areaId: 'SCOT-PH1' });
    projectStore.addChamber(makeChamber('SCOT-PH1-CMBR-0001'));

    const snapshot = projectStore.snapshotState();
    projectStore.updateAsset('chambers', 0, { chamber_seq: 42 });
    expect(projectStore.state.chambers[0].properties.chamber_seq).toBe(42);

    projectStore.restoreState(snapshot);

    expect(projectStore.state.chambers[0].properties.chamber_seq).toBe(1);
  });

  it('restoreState() persists the rollback and emits change, same as any other mutation', async () => {
    const { projectStore } = await import('../projectStore.js');
    projectStore.newProject();
    const id = projectStore.activeId();
    projectStore.setupProject({ name: 'Project A', areaId: 'SCOT-PH1' });

    const snapshot = projectStore.snapshotState();
    projectStore.addChamber(makeChamber('SCOT-PH1-CMBR-0001'));

    let changeEmitted = false;
    projectStore.on((event) => { if (event === 'change') changeEmitted = true; });

    projectStore.restoreState(snapshot);

    expect(changeEmitted).toBe(true);
    const persisted = JSON.parse(localStorage.getItem(`conductor_web_project_${id}`));
    expect(persisted.chambers).toHaveLength(0);
  });

  it('Save (no restoreState call) leaves everything placed during the session intact', async () => {
    const { projectStore } = await import('../projectStore.js');
    projectStore.newProject();
    projectStore.setupProject({ name: 'Project A', areaId: 'SCOT-PH1' });

    projectStore.snapshotState(); // session starts — snapshot taken but never used
    projectStore.addChamber(makeChamber('SCOT-PH1-CMBR-0001'));
    projectStore.addChamber(makeChamber('SCOT-PH1-CMBR-1001'));
    // Save: session just ends, restoreState() is never called.

    expect(projectStore.state.chambers).toHaveLength(2);
  });
});
