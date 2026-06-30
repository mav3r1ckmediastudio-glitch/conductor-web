// projectStoreEviction.test.js — Regression suite for the localStorage
// eviction / file-binding logic added to projectStore.js this session.
//
// Background: previously every project ever opened got a full JSON copy
// permanently duplicated in localStorage, with no eviction, even after a
// .conductor file was bound for it — the actual cause of the quota problem
// this session investigated. The fix: once a project is confirmed file-bound
// (fsaa.js calls setFileBound), its full localStorage blob is dropped the
// moment you switch away from it. The lightweight index entry (name/area/date
// for the Open list, plus the fileBound/fileName flags) is always kept.
// Unbound projects keep full retention — they have no other copy of their data.
//
// projectStore.js has no DOM/IndexedDB dependency of its own (fsaa.js depends
// on it, not the other way round), so this is testable with a plain in-memory
// localStorage mock — no jsdom needed.
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

// projectStore.js holds module-level state (it reads localStorage and builds
// its initial state at import time, via the singleton's constructor), so each
// test needs a completely fresh module instance.
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('localStorage', makeLocalStorageMock());
});

describe('projectStore — file-bound blob eviction', () => {
  it('evicts a project\'s full blob on switch-away once it is file-bound, but keeps the index entry', async () => {
    const { projectStore } = await import('../projectStore.js');

    // Project A: create it, give it some content, then mark it file-bound
    // (mirrors what fsaa.js does after saveAs()/openFile() succeeds).
    projectStore.newProject();
    const idA = projectStore.activeId();
    projectStore.setupProject({ name: 'Project A', areaId: 'ENG-A1' });
    projectStore.setFileBound(idA, true, 'project-a.conductor');

    expect(localStorage.getItem(`conductor_web_project_${idA}`)).not.toBeNull();

    // Switch to a brand-new project — this should evict A's full blob.
    projectStore.newProject();
    const idB = projectStore.activeId();

    expect(idB).not.toBe(idA);
    expect(localStorage.getItem(`conductor_web_project_${idA}`)).toBeNull();

    // The index entry must survive eviction (Open list still needs name/area/date).
    const list = projectStore.listProjects();
    const entryA = list.find(e => e.id === idA);
    expect(entryA).toBeTruthy();
    expect(entryA.name).toBe('Project A');
    expect(entryA.fileBound).toBe(true);
    expect(entryA.fileName).toBe('project-a.conductor');
  });

  it('does NOT evict an unbound project\'s blob on switch-away (its only safety net)', async () => {
    const { projectStore } = await import('../projectStore.js');

    projectStore.newProject();
    const idA = projectStore.activeId();
    projectStore.setupProject({ name: 'Unbound Project', areaId: 'ENG-B1' });
    // Deliberately never call setFileBound — this project has no .conductor file.

    projectStore.newProject();   // switch away

    expect(localStorage.getItem(`conductor_web_project_${idA}`)).not.toBeNull();
  });

  it('openProject() loads normally when a blob is present, regardless of fileBound', async () => {
    const { projectStore } = await import('../projectStore.js');

    projectStore.newProject();
    const idA = projectStore.activeId();
    projectStore.setupProject({ name: 'Project A', areaId: 'ENG-A1' });

    projectStore.newProject();   // switch to B so A is no longer active
    const result = projectStore.openProject(idA);

    expect(result).toEqual({ ok: true });
    expect(projectStore.activeId()).toBe(idA);
    expect(projectStore.project?.name).toBe('Project A');
  });

  it('openProject() reports needsFileResume when the blob was evicted but the project is file-bound', async () => {
    const { projectStore } = await import('../projectStore.js');

    projectStore.newProject();
    const idA = projectStore.activeId();
    projectStore.setupProject({ name: 'Project A', areaId: 'ENG-A1' });
    projectStore.setFileBound(idA, true, 'project-a.conductor');

    projectStore.newProject();   // switch away — evicts A's blob (per test 1)
    expect(localStorage.getItem(`conductor_web_project_${idA}`)).toBeNull();

    const result = projectStore.openProject(idA);

    expect(result.ok).toBe(false);
    expect(result.needsFileResume).toBe(true);
    expect(result.fileName).toBe('project-a.conductor');

    // The active id should already point at A, ready for fsaa.resumeProjectFile()
    // to write/persist under the correct key once it loads from disk.
    expect(projectStore.activeId()).toBe(idA);
  });

  it('openProject() returns a plain failure for an unbound project with no blob (genuinely gone)', async () => {
    const { projectStore } = await import('../projectStore.js');

    projectStore.newProject();
    // Don't even setupProject — just simulate a dangling/corrupt reference:
    // an id that was never indexed and has no blob at all.
    const result = projectStore.openProject('p_does_not_exist');

    expect(result.ok).toBe(false);
    expect(result.needsFileResume).toBeUndefined();
  });

  it('setFileBound flags survive a subsequent normal save (upsertIndex must not clobber them)', async () => {
    const { projectStore } = await import('../projectStore.js');

    projectStore.newProject();
    const idA = projectStore.activeId();
    projectStore.setFileBound(idA, true, 'project-a.conductor');

    // A normal edit triggers _update() -> save() -> upsertIndex(). This used to
    // be the easy way to accidentally wipe fileBound if upsertIndex rebuilt the
    // entry from scratch instead of merging.
    projectStore.setupProject({ name: 'Project A', areaId: 'ENG-A1' });

    const entry = projectStore.listProjects().find(e => e.id === idA);
    expect(entry.fileBound).toBe(true);
    expect(entry.fileName).toBe('project-a.conductor');
  });

  it('deleteProject() removes the blob and index entry, and emits project-deleted with the id', async () => {
    const { projectStore } = await import('../projectStore.js');

    projectStore.newProject();
    const idA = projectStore.activeId();
    projectStore.setupProject({ name: 'Project A', areaId: 'ENG-A1' });

    let emittedEvent = null;
    let emittedExtra = null;
    projectStore.on((event, _state, extra) => {
      if (event === 'project-deleted') { emittedEvent = event; emittedExtra = extra; }
    });

    projectStore.deleteProject(idA);

    expect(localStorage.getItem(`conductor_web_project_${idA}`)).toBeNull();
    expect(projectStore.listProjects().find(e => e.id === idA)).toBeUndefined();
    expect(emittedEvent).toBe('project-deleted');
    expect(emittedExtra).toBe(idA);
  });
});
