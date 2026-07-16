// projectSchema.test.js — Regression suite for projectSchema.js.
//
// WHY THIS EXISTS: the 15 Jul 2026 Commercial Readiness Audit flagged
// projectStore.js's load()/loadExternalState() as doing a blind
// `{ ...DEFAULT_STATE, ...JSON.parse(raw) }` shallow merge with no shape
// validation at all — a malformed file would silently become live state.
// projectSchema.js closes that gap; this suite pins down validateProjectState()
// directly (pure function, no localStorage/DOM needed), independent of how
// projectStore.js wires it in (that integration is covered separately in
// projectStoreValidation.test.js).
//
// Run with: npm test

import { describe, it, expect } from 'vitest';
import { validateProjectState, stampVersion, SCHEMA_VERSION, ARRAY_FIELDS } from '../projectSchema.js';
// (migration suite appended below)

describe('projectSchema — validateProjectState: rejection cases (ok:false)', () => {
  it('rejects null', () => {
    const result = validateProjectState(null);
    expect(result.ok).toBe(false);
    expect(result.state).toBe(null);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects a non-object (string)', () => {
    const result = validateProjectState('not a project');
    expect(result.ok).toBe(false);
  });

  it('rejects an array (arrays are objects in JS typeof, but not a project shape)', () => {
    const result = validateProjectState([1, 2, 3]);
    expect(result.ok).toBe(false);
  });

  it('rejects a schemaVersion newer than this build understands', () => {
    const result = validateProjectState({ schemaVersion: SCHEMA_VERSION + 1, cables: [] });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/newer version/i);
  });

  it('rejects a non-numeric schemaVersion', () => {
    const result = validateProjectState({ schemaVersion: 'two', cables: [] });
    expect(result.ok).toBe(false);
  });
});

describe('projectSchema — validateProjectState: clean pass-through (ok:true, no warnings)', () => {
  it('accepts a well-formed current-version state with no warnings', () => {
    const input = { schemaVersion: SCHEMA_VERSION, cables: [], joints: [], project: { name: 'Test' } };
    const result = validateProjectState(input);
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.state.cables).toEqual([]);
    expect(result.state.project).toEqual({ name: 'Test' });
  });

  it('accepts a legacy pre-versioning file (no schemaVersion field) as v0, no error', () => {
    const result = validateProjectState({ cables: [], joints: [] });
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('stamps SCHEMA_VERSION onto the returned state regardless of input version', () => {
    const result = validateProjectState({ cables: [] });
    expect(result.state.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('leaves fields absent from the input absent in the output (caller fills defaults)', () => {
    const result = validateProjectState({});
    expect(result.ok).toBe(true);
    expect(result.state.cables).toBeUndefined();
  });
});

describe('projectSchema — validateProjectState: repair cases (ok:true, warnings non-empty)', () => {
  it('repairs a wrong-typed array field (string) back to an empty array, with a warning', () => {
    const result = validateProjectState({ cables: 'oops, not a list' });
    expect(result.ok).toBe(true);
    expect(result.state.cables).toEqual([]);
    expect(result.warnings.some(w => w.includes('cables'))).toBe(true);
  });

  it('repairs a wrong-typed array field (object) back to an empty array', () => {
    const result = validateProjectState({ joints: { not: 'a list' } });
    expect(result.ok).toBe(true);
    expect(result.state.joints).toEqual([]);
  });

  it('repairs a wrong-typed array field (number)', () => {
    const result = validateProjectState({ poles: 42 });
    expect(result.ok).toBe(true);
    expect(result.state.poles).toEqual([]);
  });

  it('every declared ARRAY_FIELDS entry is independently checked', () => {
    const bad = Object.fromEntries(ARRAY_FIELDS.map(f => [f, 'not-a-list']));
    const result = validateProjectState(bad);
    expect(result.ok).toBe(true);
    for (const f of ARRAY_FIELDS) expect(result.state[f]).toEqual([]);
    expect(result.warnings).toHaveLength(ARRAY_FIELDS.length);
  });

  it('repairs a wrong-typed object field (project as an array) to null, with a warning', () => {
    const result = validateProjectState({ project: [1, 2, 3] });
    expect(result.ok).toBe(true);
    expect(result.state.project).toBe(null);
    expect(result.warnings.some(w => w.includes('project'))).toBe(true);
  });

  it('repairs a wrong-typed object field (buildArea as a string)', () => {
    const result = validateProjectState({ buildArea: 'nope' });
    expect(result.ok).toBe(true);
    expect(result.state.buildArea).toBe(null);
  });

  it('does not warn about a null object field (that is a legitimate "not set" state)', () => {
    const result = validateProjectState({ project: null, cabinet: null });
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('repairs a wrong-typed stage field back to "setup"', () => {
    const result = validateProjectState({ stage: 12345 });
    expect(result.ok).toBe(true);
    expect(result.state.stage).toBe('setup');
    expect(result.warnings.some(w => w.includes('stage'))).toBe(true);
  });

  it('a correctly-typed stage string is left untouched', () => {
    const result = validateProjectState({ stage: 'design' });
    expect(result.state.stage).toBe('design');
    expect(result.warnings).toHaveLength(0);
  });

  it('does not mutate the caller\'s original object', () => {
    const input = { cables: 'oops' };
    validateProjectState(input);
    expect(input.cables).toBe('oops');   // original untouched, only the returned copy is repaired
  });
});

describe('projectSchema — stampVersion', () => {
  it('stamps schemaVersion onto a plain object', () => {
    const state = {};
    stampVersion(state);
    expect(state.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('stamps appVersion when provided', () => {
    const state = {};
    stampVersion(state, '1.2.3');
    expect(state.appVersion).toBe('1.2.3');
  });

  it('does not add an appVersion field when none is provided', () => {
    const state = {};
    stampVersion(state);
    expect(state.appVersion).toBeUndefined();
  });

  it('is idempotent — calling twice does not change the outcome', () => {
    const state = {};
    stampVersion(state, '1.0.0');
    stampVersion(state, '1.0.0');
    expect(state.schemaVersion).toBe(SCHEMA_VERSION);
    expect(state.appVersion).toBe('1.0.0');
  });

  it('mutates and returns the same object', () => {
    const state = { foo: 'bar' };
    const result = stampVersion(state, '1.0.0');
    expect(result).toBe(state);
    expect(result.foo).toBe('bar');
  });
});

describe('projectSchema — v1 -> v2 migration (release-audit P0-2)', () => {
  it('SCHEMA_VERSION is at least 2', () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(2);
  });

  it('migrates a v1 project to an UNVERIFIED physical plan that must be replanned', () => {
    const v1 = { schemaVersion: 1, cables: [], joints: [], fibreAssignments: [{ assign_id: 'A1', fibre_role: 'THROUGH_SPLICE' }] };
    const r = validateProjectState(v1);
    expect(r.ok).toBe(true);
    expect(r.state.schemaVersion).toBe(SCHEMA_VERSION);
    expect(r.state.physicalPlanStatus).toBe('UNVERIFIED');
    expect(r.state.physicalAssignments).toEqual([]);
    expect(r.state.physicalPlanInputHash).toBeNull();
    expect(r.migrations.length).toBeGreaterThan(0);
    // legacy assignments are preserved (as logical/unverified data), not deleted
    expect(r.state.fibreAssignments).toHaveLength(1);
  });

  it('migrates a legacy pre-versioning (v0) project too', () => {
    const r = validateProjectState({ cables: [], joints: [] });
    expect(r.state.physicalPlanStatus).toBe('UNVERIFIED');
    expect(r.migrations.length).toBeGreaterThan(0);
  });

  it('a v1 project that (invalidly) claims a validated physical plan is forced to UNVERIFIED', () => {
    const r = validateProjectState({ schemaVersion: 1, physicalPlanStatus: 'VALIDATED', physicalPlanInputHash: 'p2-abc-1', cables: [] });
    expect(r.state.physicalPlanStatus).toBe('UNVERIFIED');
    expect(r.state.physicalPlanInputHash).toBeNull();
  });

  it('does NOT downgrade a genuine v2 project (no migration, status preserved)', () => {
    const r = validateProjectState({ schemaVersion: 2, physicalPlanStatus: 'VALIDATED', physicalPlanInputHash: 'p2-abc-1', physicalAssignments: [], cables: [] });
    expect(r.migrations).toHaveLength(0);
    expect(r.state.physicalPlanStatus).toBe('VALIDATED');
    expect(r.state.physicalPlanInputHash).toBe('p2-abc-1');
  });

  it('a build rejects a project from a newer schema than it understands (older app vs v2 file)', () => {
    const r = validateProjectState({ schemaVersion: SCHEMA_VERSION + 1, cables: [] });
    expect(r.ok).toBe(false);
    expect(r.state).toBeNull();
  });
});
