// projectSchema.js — versioned project-file schema, validation and safe
// loading for save/load (localStorage) and .conductor file import.
//
// WHY THIS EXISTS: projectStore.js's load()/loadExternalState() previously
// did a blind `{ ...DEFAULT_STATE, ...JSON.parse(raw) }` shallow merge with
// no shape checking at all. A malformed or hand-edited file — a wrong-typed
// field, a collection that isn't a list, a file saved by a future app
// version — would silently become the live project state and only fail
// later, deep inside some unrelated map tool, with no diagnostic pointing
// back at "the file you opened was bad." Flagged P0 in the 15 Jul 2026
// Commercial Readiness Audit: "Introduce versioned project-file validation,
// migration, backup and recovery tests."
//
// SCOPE: this validates STRUCTURE/TYPES and stamps/checks the schema
// version. It does NOT check referential integrity between assets (a
// dangling joint_id, an orphaned cable endpoint, etc.) — that's Design
// Health (designHealth.js) and repairProject.js's job, and stays there.
// This module only answers "is this even a shape ProjectStore can safely
// hold," which the FK-integrity checks currently assume without verifying.
//
// SCHEMA_VERSION bumps whenever a field is renamed, removed, or changes
// required type — i.e. whenever an old file could be misread by new code
// without an explicit migration step. Purely additive fields (a new
// optional collection, a new optional property) do NOT need a bump;
// ARRAY_FIELDS/OBJECT_OR_NULL_FIELDS below just gets extended.

// v2 (release-audit P0-2): introduced the separate physical fibre-plan layer
// (physicalAssignments + physicalPlanStatus + physicalPlanInputHash) and
// redefined fibreAssignments as the LOGICAL layer only. Because the MEANING of
// stored data changed — not just its structure — the version is bumped so older
// builds refuse a v2 file rather than misread it as a complete physical plan.
export const SCHEMA_VERSION = 2;

// Every collection ProjectStore expects to be an array. Single source of
// truth here (rather than re-deriving from projectStore.js's DEFAULT_STATE)
// so this module has no import-cycle dependency on it.
export const ARRAY_FIELDS = [
  'chambers', 'ducts', 'joints', 'dropDucts', 'cables', 'bundles',
  'poles', 'cbts', 'spans', 'aerialDrops', 'cbtTails', 'addressPoints',
  'fibreAssignments', 'physicalAssignments',
];

// Fields that must be a plain object or null/undefined — never an
// array/string/number.
const OBJECT_OR_NULL_FIELDS = ['project', 'buildArea', 'cabinet'];

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Validate + repair a raw parsed project object before it becomes live
 * ProjectStore state. Never throws — always returns a report so callers
 * decide what "invalid" means for their context (autosave vs. explicit
 * file open).
 *
 * @returns {{ ok: boolean, errors: string[], warnings: string[], state: object|null }}
 *   ok       - false only when the input is unusable outright: not an
 *              object at all, or it declares a schemaVersion newer than
 *              this build understands (we cannot safely guess a future
 *              shape — this is the "reject" path).
 *   errors   - reasons ok is false. Empty when ok is true.
 *   warnings - fields that were coerced/repaired to a safe default. Empty
 *              on a clean, current-version file. Non-empty means data was
 *              silently unusable and has been dropped back to empty —
 *              callers should surface this to the user, not swallow it.
 *   state    - the repaired object (only meaningful when ok is true).
 *              Callers still merge this over their own defaults, to fill
 *              in any field this file predates entirely.
 */
export function validateProjectState(raw) {
  const errors = [];
  const warnings = [];
  const migrations = [];

  if (!isPlainObject(raw)) {
    return {
      ok: false,
      errors: ['File content is not a Conductor project object.'],
      warnings,
      migrations,
      state: null,
    };
  }

  const declaredVersion = raw.schemaVersion;
  if (declaredVersion !== undefined) {
    if (typeof declaredVersion !== 'number' || !Number.isFinite(declaredVersion)) {
      errors.push(`schemaVersion is present but not a valid number ("${declaredVersion}").`);
      return { ok: false, errors, warnings, migrations, state: null };
    }
    if (declaredVersion > SCHEMA_VERSION) {
      errors.push(
        `This project was saved by a newer version of Conductor (schema v${declaredVersion}) than this app supports (v${SCHEMA_VERSION}). Update the app before opening it, to avoid losing data this version doesn't understand.`
      );
      return { ok: false, errors, warnings, migrations, state: null };
    }
  }
  // declaredVersion === undefined -> pre-versioning legacy file (schema v0).
  // Treated as v0 and allowed through the repair path below, same as any
  // other out-of-date-but-salvageable file.

  const state = { ...raw };

  for (const field of ARRAY_FIELDS) {
    if (state[field] === undefined) continue;   // absent is fine, caller's defaults fill it
    if (!Array.isArray(state[field])) {
      warnings.push(`"${field}" was not a list (found ${typeof state[field]}) — reset to empty.`);
      state[field] = [];
    }
  }

  for (const field of OBJECT_OR_NULL_FIELDS) {
    if (state[field] === undefined || state[field] === null) continue;
    if (!isPlainObject(state[field])) {
      warnings.push(`"${field}" was not a valid object (found ${Array.isArray(state[field]) ? 'a list' : typeof state[field]}) — reset to empty.`);
      state[field] = null;
    }
  }

  if (state.stage !== undefined && typeof state.stage !== 'string') {
    warnings.push('"stage" was not a valid value — reset to "setup".');
    state.stage = 'setup';
  }

  // ── v1 → v2 migration (release-audit P0-2) ──────────────────────────────────
  // A pre-v2 project cannot carry a trustworthy demand-driven physical plan (the
  // planner and its layer did not exist). Migrate it to an explicitly UNVERIFIED
  // state that must be recalculated before any splice-plan export. Legacy
  // fibreAssignments are preserved as logical/unverified data — never presented
  // as a validated physical plan. Reported via `migrations` (distinct from the
  // type-repair `warnings` channel) so callers can surface a one-time notice.
  const preV2 = declaredVersion === undefined || declaredVersion < 2;
  if (preV2) {
    state.physicalAssignments = [];
    state.physicalPlanStatus = 'UNVERIFIED';
    state.physicalPlanInputHash = null;
    migrations.push('Upgraded to project schema v2: the physical fibre plan is UNVERIFIED and must be recalculated before splice-plan export.');
  }

  state.schemaVersion = SCHEMA_VERSION;   // always stamp current on the way out
  return { ok: true, errors, warnings, migrations, state };
}

/**
 * Stamp version metadata onto a state object immediately before it's
 * serialized for save (localStorage autosave or .conductor file write).
 * Idempotent — safe to call on every save.
 */
export function stampVersion(state, appVersion) {
  state.schemaVersion = SCHEMA_VERSION;
  if (appVersion) state.appVersion = appVersion;
  return state;
}
