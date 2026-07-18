// repairProject.js — One-time sweep to fix EXISTING dangling FK references.
//
// WHY THIS EXISTS: cascadeDelete.js stops NEW dangling references from being
// created going forward, but does nothing about the ones already sitting in
// projects saved before that fix landed. Found live on 02/07/26: the SCOT-PH1
// project carried 402 dangling fibreAssignment records (plus orphaned spans)
// left behind by a pole deleted long before cascadeDelete existed. Deleting
// the already-gone pole again can't clear them — it's gone — so those records
// need a dedicated repair pass that scans for references pointing at nothing
// and cleans them up in place.
//
// SAME RULES AS cascadeDelete.js, applied in the other direction. Where
// cascadeDelete starts from "this asset is being deleted, sweep its
// dependents", repairProject starts from "this reference points at an ID that
// doesn't exist, fix it" — but the CASCADE-vs-NULL-OUT distinction is
// identical and deliberately kept in step:
//   CASCADE (delete the record):  a cable/span with a missing endpoint, a
//     bundle off a missing joint, a drop off a missing pole/CBT, a fibre
//     assignment naming a missing joint/cable/bundle. These are meaningless
//     with the reference broken.
//   NULL OUT (clear the field):   a cable's missing duct_id, a joint's
//     missing chamber_id, a bundle's missing uprn. These are legitimately
//     optional — a broken one just returns to the normal "unset" state.
//
// Cascading is iterated to a fixpoint: deleting an orphaned span can orphan a
// fibre assignment that named it, so the sweep repeats until a full pass
// makes no further change. This matters because the live data had exactly
// this shape (pole gone -> span already orphaned -> assignments naming the
// span still present).
//
// PURE: analyseProject() and repairProject() take a state object and return
// results/patch without touching any store, map, or DOM — same contract as
// cascadeDelete.js. The caller (projectStore.repair()) applies the patch;
// the UI shows analyseProject()'s report first (dry run) before the user
// confirms.

import { getAssetId } from './assetSchema.js';
import { isSplitterId } from './splitterId.js';

// Build the set of currently-existing IDs for a collection.
function idSet(state, collection) {
  const arr = state[collection] || [];
  const s = new Set();
  for (const f of arr) {
    const id = getAssetId(collection, f);
    if (id) s.add(id);
  }
  return s;
}

function has(set, v) {
  return v != null && v !== '' && set.has(String(v));
}
function isSet(v) {
  return v != null && v !== '';
}

/**
 * Run one repair pass over `state`, mutating the provided working arrays in
 * place. Returns the number of individual changes made this pass (0 means the
 * project is clean / no further passes needed). Internal helper — callers use
 * repairProject() / analyseProject() below, which iterate this to a fixpoint.
 *
 * `tally` accumulates { removed, nulled } across passes.
 */
function repairPass(work, tally) {
  let changes = 0;

  // Rebuild lookup sets fresh each pass — a prior pass may have removed nodes,
  // which is exactly what can turn a previously-valid reference dangling.
  const chamberIds = idSet(work, 'chambers');
  const jointIds   = idSet(work, 'joints');
  const poleIds    = idSet(work, 'poles');
  const cbtIds     = idSet(work, 'cbts');
  const ductIds    = idSet(work, 'ducts');
  const cableIds   = idSet(work, 'cables');
  const spanIds    = idSet(work, 'spans');
  const bundleIds  = idSet(work, 'bundles');
  const dropIds    = idSet(work, 'aerialDrops');
  const uprns      = idSet(work, 'addressPoints');

  const nodeIds = new Set([...chamberIds, ...jointIds, ...poleIds, ...cbtIds]);
  if (work.cabinet?.properties?.cabinet_id) nodeIds.add(String(work.cabinet.properties.cabinet_id));
  if (work.cabinet?.properties?.pop_id)     nodeIds.add(String(work.cabinet.properties.pop_id));
  const aerialNodeIds = new Set([...poleIds, ...cbtIds]);

  // fibreAssignment cable_id may be a real cable OR a real span (fibre runs
  // through aerial spans too) OR a synthetic "<jointId>-SP" splitter pigtail
  // (fibreAssign.js) — none of those is dangling.
  const cableOrSpanIds = new Set([...cableIds, ...spanIds]);

  const remove = (collection, predicate) => {
    const arr = work[collection];
    if (!Array.isArray(arr)) return;
    let n = 0;
    for (let i = arr.length - 1; i >= 0; i--) {
      if (predicate(arr[i].properties || arr[i] || {})) { arr.splice(i, 1); n++; }
    }
    if (n) { tally.removed[collection] = (tally.removed[collection] || 0) + n; changes += n; }
  };

  const nullOut = (collection, field, predicate) => {
    const arr = work[collection];
    if (!Array.isArray(arr)) return;
    let n = 0;
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i].properties || {};
      if (predicate(p)) {
        arr[i] = { ...arr[i], properties: { ...p, [field]: null } };
        n++;
      }
    }
    if (n) { tally.nulled[collection] = (tally.nulled[collection] || 0) + n; changes += n; }
  };

  // ── CASCADE removals ───────────────────────────────────────────────────────

  // Cables: either endpoint missing → remove.
  remove('cables', p =>
    (isSet(p.from_node) && !has(nodeIds, p.from_node)) ||
    (isSet(p.to_node)   && !has(nodeIds, p.to_node)));

  // Spans: either endpoint missing → remove.
  remove('spans', p =>
    (isSet(p.from_node) && !has(nodeIds, p.from_node)) ||
    (isSet(p.to_node)   && !has(nodeIds, p.to_node)));

  // Bundles: from_joint missing → remove.
  remove('bundles', p => isSet(p.from_joint) && !has(jointIds, p.from_joint));

  // Aerial drops: from_cbt / from_node (legacy) missing → remove.
  remove('aerialDrops', p =>
    (isSet(p.from_cbt)  && !has(cbtIds, p.from_cbt)) ||
    (isSet(p.from_node) && !has(aerialNodeIds, p.from_node)));

  // CBT tails: cbt_id missing → remove.
  remove('cbtTails', p => isSet(p.cbt_id) && !has(cbtIds, p.cbt_id));

  // Fibre assignments: joint_id / cable_id / bundle_id all role-aware, exactly
  // as designHealth.js Check 2d validates them (synthetic -SP pigtails and
  // downstream joint/CBT bundle_ids are NOT dangling).
  remove('fibreAssignments', p => {
    if (isSet(p.joint_id) && !has(jointIds, p.joint_id) && !has(cbtIds, p.joint_id)) return true;
    if (isSet(p.cable_id) && !isSplitterId(p.cable_id) && !has(cableOrSpanIds, p.cable_id)) return true;
    if (isSet(p.bundle_id)
        && !has(jointIds, p.bundle_id) && !has(cbtIds, p.bundle_id)
        && !has(bundleIds, p.bundle_id) && !has(dropIds, p.bundle_id)) return true;
    return false;
  });

  // ── NULL-OUT (legitimate-optional FKs) ─────────────────────────────────────
  // Only a SET-but-dangling value is cleared; an already-null value is normal.
  nullOut('cables', 'duct_id',    p => isSet(p.duct_id)    && !has(ductIds, p.duct_id));
  nullOut('joints', 'chamber_id', p => isSet(p.chamber_id) && !has(chamberIds, p.chamber_id));
  nullOut('bundles', 'uprn',      p => isSet(p.uprn)       && !has(uprns, p.uprn));

  return changes;
}

// Deep-clone only the collections repair can touch, so callers never mutate
// the live state object. cabinet is referenced read-only (never mutated) so a
// shallow copy is fine for it.
const REPAIRABLE = [
  'cables', 'spans', 'bundles', 'aerialDrops', 'cbtTails',
  'fibreAssignments', 'joints', 'chambers', 'ducts', 'addressPoints',
  'poles', 'cbts',
];

function cloneWork(state) {
  const work = { cabinet: state.cabinet };
  for (const c of REPAIRABLE) {
    work[c] = Array.isArray(state[c]) ? JSON.parse(JSON.stringify(state[c])) : [];
  }
  return work;
}

/**
 * Compute the repair without applying it (DRY RUN). Returns:
 * {
 *   clean:   boolean,                       // true if nothing needs fixing
 *   passes:  number,                        // fixpoint iterations taken
 *   removed: { [collection]: count },       // records that WOULD be removed
 *   nulled:  { [collection]: count },       // fields that WOULD be cleared
 *   total:   number,                        // grand total of changes
 * }
 * Does not mutate `state`.
 */
export function analyseProject(state) {
  const work = cloneWork(state);
  const tally = { removed: {}, nulled: {} };
  let passes = 0;
  // Iterate to a fixpoint: each pass can orphan records that the next pass
  // then cleans up. Hard cap guards against any pathological non-convergence.
  while (passes < 25) {
    const changed = repairPass(work, tally);
    passes++;
    if (changed === 0) break;
  }
  const total =
    Object.values(tally.removed).reduce((a, b) => a + b, 0) +
    Object.values(tally.nulled).reduce((a, b) => a + b, 0);
  return { clean: total === 0, passes, removed: tally.removed, nulled: tally.nulled, total };
}

/**
 * Compute the repair AND return the patch to apply it. Returns:
 * {
 *   patch:   { [collection]: newArray, ... }  // only collections that changed
 *   summary: same shape as analyseProject()
 * }
 * Does not mutate `state` — the caller applies `patch`.
 */
export function repairProject(state) {
  const work = cloneWork(state);
  const tally = { removed: {}, nulled: {} };
  let passes = 0;
  while (passes < 25) {
    const changed = repairPass(work, tally);
    passes++;
    if (changed === 0) break;
  }

  // Build a patch of only the collections that actually differ from the input,
  // so an already-clean project produces an empty patch (no pointless write).
  const patch = {};
  const touchedCollections = new Set([
    ...Object.keys(tally.removed),
    ...Object.keys(tally.nulled),
  ]);
  for (const c of touchedCollections) patch[c] = work[c];

  const total =
    Object.values(tally.removed).reduce((a, b) => a + b, 0) +
    Object.values(tally.nulled).reduce((a, b) => a + b, 0);

  return {
    patch,
    summary: { clean: total === 0, passes, removed: tally.removed, nulled: tally.nulled, total },
  };
}
