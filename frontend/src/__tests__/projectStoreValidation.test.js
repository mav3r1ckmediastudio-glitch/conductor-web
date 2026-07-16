// projectStoreValidation.test.js — Regression suite for projectStore.js's
// use of projectSchema.js on the load()/save()/loadExternalState() paths.
//
// WHY THIS EXISTS: projectSchema.test.js pins down validateProjectState()
// as a pure function in isolation. This suite pins down the WIRING — that
// projectStore.js actually calls it at the right points, actually stamps
// versions on save, and actually leaves state untouched (rather than
// half-applying a bad file) when validation rejects. This is the P0 gap
// from the 15 Jul 2026 Commercial Readiness Audit: "Introduce versioned
// project-file validation, migration, backup and recovery tests."
//
// Same in-memory localStorage mock + per-test fresh-module pattern as
// projectStoreEviction.test.js / projectStoreSession.test.js, since
// projectStore.js has no other DOM dependency of its own.
//
// Run with: npm test

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SCHEMA_VERSION } from '../projectSchema.js';

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

describe('projectStore — save() stamps version metadata', () => {
  it('stamps schemaVersion onto the state written to localStorage', async () => {
    const { projectStore } = await import('../projectStore.js');
    projectStore.newProject();
    projectStore.setupProject({ name: 'Project A', areaId: 'SCOT-PH1' });

    expect(projectStore.state.schemaVersion).toBe(SCHEMA_VERSION);

    const id = projectStore.activeId();
    const raw = JSON.parse(localStorage.getItem(`conductor_web_project_${id}`));
    expect(raw.schemaVersion).toBe(SCHEMA_VERSION);
  });
});

describe('projectStore — load() validates before merging', () => {
  it('a clean, well-formed saved project round-trips with no warnings', async () => {
    const { projectStore } = await import('../projectStore.js');
    projectStore.newProject();
    projectStore.setupProject({ name: 'Round Trip', areaId: 'AREA-1' });
    projectStore.addChamber({
      type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { chamber_id: 'AREA-1-CMBR-0001' },
    });
    projectStore.flush();

    // Reload via a fresh module instance, same mocked localStorage contents.
    vi.resetModules();
    const { projectStore: reloaded } = await import('../projectStore.js');
    expect(reloaded.state.chambers).toHaveLength(1);
    expect(reloaded.state.chambers[0].properties.chamber_id).toBe('AREA-1-CMBR-0001');
  });

  it('a wrong-typed collection in the saved blob is repaired to empty and warned about, not crashed on', async () => {
    const { projectStore } = await import('../projectStore.js');
    projectStore.newProject();
    projectStore.setupProject({ name: 'Corrupt Cables', areaId: 'AREA-1' });
    const id = projectStore.activeId();

    // Hand-corrupt the persisted blob as if a bad external edit happened.
    const raw = JSON.parse(localStorage.getItem(`conductor_web_project_${id}`));
    raw.cables = 'this should be an array';
    localStorage.setItem(`conductor_web_project_${id}`, JSON.stringify(raw));

    const { onToast } = await import('../toast.js');
    const toasts = [];
    onToast(t => toasts.push(t));

    vi.resetModules();
    // Re-subscribe after resetModules — toast.js module state was cleared too.
    const { onToast: onToast2 } = await import('../toast.js');
    const toasts2 = [];
    onToast2(t => toasts2.push(t));
    const { projectStore: reloaded } = await import('../projectStore.js');

    expect(reloaded.state.cables).toEqual([]);
    expect(toasts2.some(t => t.type === 'warning' && /cables/.test(t.message))).toBe(true);
  });

  it('a corrupted (non-JSON) saved blob falls back to a blank project instead of throwing', async () => {
    const { projectStore } = await import('../projectStore.js');
    projectStore.newProject();
    const id = projectStore.activeId();
    localStorage.setItem(`conductor_web_project_${id}`, '{not valid json');

    vi.resetModules();
    vi.stubGlobal('localStorage', {
      getItem: (k) => (k === 'conductor_web_active' ? id : (k === `conductor_web_project_${id}` ? '{not valid json' : null)),
      setItem: () => {},
      removeItem: () => {},
    });
    expect(async () => { await import('../projectStore.js'); }).not.toThrow();
    const { projectStore: reloaded } = await import('../projectStore.js');
    expect(reloaded.state.cables).toEqual([]);
    expect(reloaded.state.stage).toBe('setup');
  });

  it('a saved project declaring a future schemaVersion is rejected, falling back to a blank project', async () => {
    const { projectStore } = await import('../projectStore.js');
    projectStore.newProject();
    const id = projectStore.activeId();
    const future = { schemaVersion: SCHEMA_VERSION + 1, cables: [], stage: 'design' };
    localStorage.setItem(`conductor_web_project_${id}`, JSON.stringify(future));
    localStorage.setItem('conductor_web_active', id);

    vi.resetModules();
    const { projectStore: reloaded } = await import('../projectStore.js');
    expect(reloaded.state.stage).toBe('setup');   // blank DEFAULT_STATE, future data was NOT adopted
  });
});

describe('projectStore — loadExternalState() (.conductor file open path)', () => {
  it('accepts a well-formed external state and applies it, reporting ok:true with no warnings', async () => {
    const { projectStore } = await import('../projectStore.js');
    const result = projectStore.loadExternalState({
      schemaVersion: SCHEMA_VERSION,
      stage: 'design',
      cables: [{ properties: { cable_id: 'CBL-1' } }],
    });
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(projectStore.state.cables).toHaveLength(1);
    expect(projectStore.state.stage).toBe('design');
  });

  it('rejects a malformed external state and leaves the current project untouched', async () => {
    const { projectStore } = await import('../projectStore.js');
    projectStore.newProject();
    projectStore.setupProject({ name: 'Untouched Project', areaId: 'AREA-1' });
    const before = projectStore.state;

    const result = projectStore.loadExternalState('not an object at all');

    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(projectStore.state).toBe(before);   // same reference — nothing was replaced
    expect(projectStore.state.project.name).toBe('Untouched Project');
  });

  it('rejects an external state from a newer schema version, leaving the current project untouched', async () => {
    const { projectStore } = await import('../projectStore.js');
    projectStore.newProject();
    projectStore.setupProject({ name: 'Stays Open', areaId: 'AREA-1' });

    const result = projectStore.loadExternalState({ schemaVersion: SCHEMA_VERSION + 5, cables: [] });

    expect(result.ok).toBe(false);
    expect(projectStore.state.project.name).toBe('Stays Open');
  });

  it('applies a repairable external state and reports what was repaired', async () => {
    const { projectStore } = await import('../projectStore.js');
    const result = projectStore.loadExternalState({ joints: 'oops', stage: 'design' });

    expect(result.ok).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(projectStore.state.joints).toEqual([]);
    expect(projectStore.state.stage).toBe('design');
  });
});
