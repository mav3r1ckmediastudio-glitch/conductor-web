// cascadeDelete.js — Computes cascading cleanup for deleteAsset().
//
// THE BUG THIS FIXES: projectStore.deleteAsset() used to just splice the
// target out of its own collection and stop. Every OTHER record that
// referenced it — cables/spans with that node as an endpoint, bundles hung
// off a deleted joint, aerial drops hung off a deleted pole/CBT, fibre
// assignments naming a now-gone joint/cable/bundle — was left pointing at a
// dead ID forever. designHealth.js's Check 2c/2d correctly flags all of
// these as "Broken connectivity" errors, but there was no way to ever clear
// them short of hand-editing the saved project file. On a real project this
// silently accumulates: found live via Conductor Web on 02/07/26 — a single
// deleted pole (SCOT-PH1-POL-001) plus its four aerial spans had left 402
// dangling fibreAssignments records behind, reported by Design Health as
// 402 blocking errors on a project that was otherwise fine.
//
// DESIGN: two different cleanup actions depending on what the reference
// actually means (this distinction already existed as comments in
// designHealth.js — this file is the first place it's actually enforced):
//
//   CASCADE (delete the dependent too): the dependent record is meaningless
//   without the thing that was deleted — a cable with one end gone, a
//   bundle hanging off a joint that no longer exists, an aerial drop off a
//   deleted pole, a fibre assignment naming a joint/cable/bundle that's
//   gone. These are deleted, and the deletion is applied recursively (e.g.
//   deleting a joint cascades to its bundles, which cascades to any fibre
//   assignments naming those bundles).
//
//   NULL OUT (clear the FK, keep the record): the reference was always
//   allowed to be empty in normal use — a cable's duct_id when digitised
//   before its duct existed, a bundle's uprn before address import, a
//   joint's chamber_id if the chamber is later removed. Deleting the
//   referenced asset just returns the dependent to that same legitimate
//   "unset" state instead of leaving a dangling ID behind.
//
// This module is pure: given a state snapshot and an (collection, index) to
// delete, it returns { patch, summary } and touches nothing itself — no
// store, no map, no DOM. projectStore.deleteAsset() applies the patch.

import { getAssetId, NODE_COLLECTIONS, AERIAL_NODE_COLLECTIONS } from './assetSchema.js';

function idOf(feature, field) {
  const v = feature?.properties?.[field];
  return v != null && v !== '' ? String(v) : '';
}

function bump(summary, action, collection, n = 1) {
  if (n === 0) return;
  summary[action][collection] = (summary[action][collection] || 0) + n;
}

/**
 * Compute the full cascade for deleting `state[collection][index]`.
 *
 * Returns:
 * {
 *   patch:   { [collection]: newArray, ... }  — only touched collections
 *   summary: {
 *     removed: { [collection]: count },  // records deleted as a result
 *     nulled:  { [collection]: count },  // records with an FK cleared
 *   }
 * }
 * Returns null if the target doesn't exist.
 */
export function computeCascadeDelete(state, collection, index) {
  const arr = state[collection];
  if (!Array.isArray(arr) || index < 0 || index >= arr.length) return null;

  const target = arr[index];
  const targetId = getAssetId(collection, target);

  // Working copies of every collection we might touch. Only collections
  // actually mutated get included in the final patch.
  const work = {};
  const touched = new Set();
  const get = (name) => {
    if (!work[name]) work[name] = (state[name] || []).slice();
    return work[name];
  };
  const markTouched = (name) => touched.add(name);

  const summary = { removed: {}, nulled: {} };

  // Delete the target itself.
  get(collection).splice(get(collection).indexOf(target), 1);
  markTouched(collection);

  if (!targetId) {
    // No ID to cascade on (shouldn't normally happen) — just the direct
    // delete above.
    return { patch: buildPatch(work, touched), summary };
  }

  // Queue of { collection, id } pairs still needing their dependents swept.
  // Seeded with the thing that was just deleted; grows as cascaded deletes
  // themselves need their own dependents cleaned up (e.g. deleting a joint
  // cascades to a bundle, and that bundle's id must then be swept out of
  // fibreAssignments too).
  const queue = [{ collection, id: targetId }];
  const seen = new Set([`${collection}:${targetId}`]);

  const enqueue = (coll, id) => {
    if (!id) return;
    const key = `${coll}:${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    queue.push({ collection: coll, id });
  };

  while (queue.length) {
    const { collection: coll, id } = queue.shift();
    const isNode = NODE_COLLECTIONS.includes(coll);
    const isAerialNode = AERIAL_NODE_COLLECTIONS.includes(coll);

    // ── Cables: from_node / to_node, cascade-delete on either end ──────────
    if (isNode) {
      const cables = get('cables');
      for (let i = cables.length - 1; i >= 0; i--) {
        const p = cables[i].properties || {};
        if (String(p.from_node || '') === id || String(p.to_node || '') === id) {
          const cid = idOf(cables[i], 'cable_id');
          cables.splice(i, 1);
          markTouched('cables');
          bump(summary, 'removed', 'cables');
          enqueue('cables', cid);
        }
      }

      // ── Spans: from_node / to_node, cascade-delete on either end ─────────
      const spans = get('spans');
      for (let i = spans.length - 1; i >= 0; i--) {
        const p = spans[i].properties || {};
        if (String(p.from_node || '') === id || String(p.to_node || '') === id) {
          const sid = idOf(spans[i], 'span_id');
          spans.splice(i, 1);
          markTouched('spans');
          bump(summary, 'removed', 'spans');
          // Spans share fibreAssignments.cable_id's ID namespace (fibre runs
          // through aerial spans same as ducted cables) — sweep the same way.
          enqueue('cables', sid);
        }
      }

      // ── Bundles: from_joint ────────────────────────────────────────────
      const bundles = get('bundles');
      for (let i = bundles.length - 1; i >= 0; i--) {
        const p = bundles[i].properties || {};
        if (String(p.from_joint || '') === id) {
          const bid = idOf(bundles[i], 'bundle_id');
          bundles.splice(i, 1);
          markTouched('bundles');
          bump(summary, 'removed', 'bundles');
          enqueue('bundles', bid);
        }
      }

      // ── CBT tails: cbt_id ─────────────────────────────────────────────
      const tails = get('cbtTails');
      for (let i = tails.length - 1; i >= 0; i--) {
        const p = tails[i].properties || {};
        if (String(p.cbt_id || '') === id) {
          tails.splice(i, 1);
          markTouched('cbtTails');
          bump(summary, 'removed', 'cbtTails');
        }
      }

      // ── Fibre assignments: joint_id (splitter node itself) ─────────────
      sweepAssignments(get('fibreAssignments'), (p) => String(p.joint_id || '') === id, summary, markTouched);
    }

    // ── Aerial drops: from_node (legacy) / from_cbt, poles + CBTs only ────
    if (isAerialNode) {
      const drops = get('aerialDrops');
      for (let i = drops.length - 1; i >= 0; i--) {
        const p = drops[i].properties || {};
        if (String(p.from_node || '') === id || String(p.from_cbt || '') === id) {
          const did = idOf(drops[i], 'adrop_id') || idOf(drops[i], 'drop_id');
          drops.splice(i, 1);
          markTouched('aerialDrops');
          bump(summary, 'removed', 'aerialDrops');
          enqueue('aerialDrops', did);
        }
      }
    }

    // ── Chambers specifically: joints snapped to this chamber lose the
    // snap but are NOT deleted — chamber_id is a legitimate-null field
    // (see designHealth.js's comment on Check 2d: only a set-but-dangling
    // chamber_id is an error, unset is normal). ─────────────────────────
    if (coll === 'chambers') {
      const joints = get('joints');
      let n = 0;
      for (const j of joints) {
        if (String(j.properties?.chamber_id || '') === id) {
          j.properties = { ...j.properties, chamber_id: null };
          n++;
        }
      }
      if (n) { markTouched('joints'); bump(summary, 'nulled', 'joints', n); }
    }

    // ── Ducts: cables referencing this duct lose the snap, not the cable
    // (duct_id is a legitimate-null field — see designHealth.js Check 2d). ─
    if (coll === 'ducts') {
      const cables = get('cables');
      let n = 0;
      for (const c of cables) {
        if (String(c.properties?.duct_id || '') === id) {
          c.properties = { ...c.properties, duct_id: null };
          n++;
        }
      }
      if (n) { markTouched('cables'); bump(summary, 'nulled', 'cables', n); }
    }

    // ── Address points: bundles referencing this uprn lose the match, not
    // the bundle (uprn is a legitimate-null field — premise not yet
    // imported / matched later, per designHealth.js Check 2d). ────────────
    if (coll === 'addressPoints') {
      const bundles = get('bundles');
      let n = 0;
      for (const b of bundles) {
        if (String(b.properties?.uprn || '') === id) {
          b.properties = { ...b.properties, uprn: null };
          n++;
        }
      }
      if (n) { markTouched('bundles'); bump(summary, 'nulled', 'bundles', n); }
    }

    // ── Cables / spans: fibre assignments naming this as cable_id ─────────
    if (coll === 'cables') {
      sweepAssignments(get('fibreAssignments'), (p) => String(p.cable_id || '') === id, summary, markTouched);
    }

    // ── Bundles / aerial drops: fibre assignments naming this as
    // bundle_id (role-aware — see designHealth.js Check 2d comment: a
    // fibre assignment's bundle_id is either a real bundle/aerial-drop
    // consumer id, or a downstream joint/CBT id — the joint/CBT case is
    // already handled by the isNode branch above). ────────────────────────
    if (coll === 'bundles' || coll === 'aerialDrops') {
      sweepAssignments(get('fibreAssignments'), (p) => String(p.bundle_id || '') === id, summary, markTouched);
    }
  }

  return { patch: buildPatch(work, touched), summary };
}

// fibreAssignments records are flat objects ({ assign_id, joint_id, ... }),
// not GeoJSON-style { properties }, per fibreAssign.js's rec() helper.
function sweepAssignments(assignments, matches, summary, markTouched) {
  let n = 0;
  for (let i = assignments.length - 1; i >= 0; i--) {
    if (matches(assignments[i])) {
      assignments.splice(i, 1);
      n++;
    }
  }
  if (n) { markTouched('fibreAssignments'); bump(summary, 'removed', 'fibreAssignments', n); }
}

function buildPatch(work, touched) {
  const patch = {};
  for (const name of touched) patch[name] = work[name];
  return patch;
}
