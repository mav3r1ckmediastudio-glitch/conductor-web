// fibrePlanInputs.js — Canonical fingerprint of every project field that can
// affect the PHYSICAL fibre plan.
//
// Release-audit P0-1 (stale-plan lifecycle): a plan validated for an earlier
// project state must not stay exportable after the topology/capacity changes.
// We fingerprint the plan inputs and store the hash with the validated plan;
// the export gate (splicePlan.physicalPlanReady) then requires BOTH a VALIDATED
// status AND stored-hash === current-hash. Any edit to a planning input changes
// the hash, which closes the gate until the plan is recomputed and re-validated.
//
// IMPORTANT: only RAW planning inputs are fingerprinted (topology, capacities,
// ratios, feed modes, frozen physical fibres). Derived
// allocation outputs written back by applyFibreAssignment (feeder_port /
// splitter_port on assets, fibre_in / fibre_out summaries) are deliberately
// EXCLUDED so that persisting a fresh plan does not immediately invalidate it.
//
// ── ALLOCATION PROFILE IS NOT FINGERPRINTED (review 17 Jul 2026, item 2) ──────
// This previously hashed `store.allocationProfile`, a field that exists NOWHERE
// else in the codebase — nothing writes it, and it is not a projectStore getter.
// The term always evaluated to the literal 'COLOUR_PRESERVING' and contributed
// nothing, while the header claimed the fingerprint covered it. The dead term is
// gone and the claim withdrawn.
//
// The profile is currently a CALL-TIME option (fibreAssign.js -> opts.profile ->
// fibrePlanner.js), not project state. That is why omitting it is safe TODAY:
// profile can only enter at compute time, so changing it forces a recompute,
// which stores a fresh hash. The staleness this gate exists to catch cannot
// arise for a value that is not persisted.
//
// >>> IF ALLOCATION PROFILE EVER BECOMES A PERSISTED PROJECT SETTING, IT MUST BE
// >>> ADDED BACK TO canonicalPlanInputs() AND THE HASH PREFIX BUMPED. Without
// >>> that, a plan validated under COLOUR_PRESERVING stays exportable after a
// >>> switch to COMPACT_OUTBOUND — exactly the P0-1 class this module closes.
// Decision on whether to promote profile to a store field is OPEN — PW's call.

function P(x) { return x && x.properties ? x.properties : (x || {}); }
function field(o, k) { const v = P(o)[k]; return v === undefined || v === null ? '' : String(v); }
function rows(list, keys) {
  return (list || []).map(x => keys.map(k => field(x, k)).join('\x1f')).sort();
}

// Only INSTALLED/LIVE physical fibres constrain a future allocation, so only
// those belong in the fingerprint (they pin fibre numbers).
function frozenRows(store) {
  const FROZEN = new Set(['INSTALLED', 'LIVE']);
  return (store.physicalAssignments || [])
    .filter(r => FROZEN.has(String(r.status)) || r.frozen === true)
    .map(r => [r.cable_id, r.fibre_role, r.tube_number, r.fibre_number, r.splice_to_cable, r.splice_to_tube, r.splice_to_fibre].map(v => v == null ? '' : String(v)).join('\x1f'))
    .sort();
}

export function canonicalPlanInputs(store) {
  if (!store) return '';
  const parts = [];
  parts.push('POP\x1e' + field(store.cabinet, 'pop_id'));
  parts.push('JOINTS\x1e' + rows(store.joints, ['joint_id', 'has_splitter', 'split_ratio', 'joint_type', 'chamber_id']).join('\x1d'));
  parts.push('CBTS\x1e' + rows(store.cbts, ['cbt_id', 'split_ratio', 'parent_pole_id']).join('\x1d'));
  parts.push('CABLES\x1e' + rows(store.cables, ['cable_id', 'from_node', 'to_node', 'fibre_count', 'feed_mode', 'splitter_id', 'splitter_port']).join('\x1d'));
  parts.push('SPANS\x1e' + rows(store.spans, ['span_id', 'from_node', 'to_node', 'fibre_count', 'feed_mode', 'splitter_id', 'splitter_port']).join('\x1d'));
  parts.push('TAILS\x1e' + rows(store.cbtTails, ['tail_id', 'cbttail_id', 'from_cbt', 'to_joint', 'fibre_count', 'feed_mode', 'splitter_id', 'splitter_port']).join('\x1d'));
  parts.push('DROPS\x1e' + rows(store.aerialDrops, ['adrop_id', 'from_cbt']).join('\x1d'));
  parts.push('BUNDLES\x1e' + rows(store.bundles, ['bundle_id', 'from_joint']).join('\x1d'));
  parts.push('FROZEN\x1e' + frozenRows(store).join('\x1d'));
  return parts.join('\n');
}

// Two independent 32-bit rolling hashes concatenated → a 64-bit fingerprint,
// dependency-free (browser + node) and collision-resistant enough for a
// change-detection guard. Not a security hash and does not need to be.
function djb2(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = (((h << 5) + h) + s.charCodeAt(i)) >>> 0; return h; }
function fnv1a(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; } return h >>> 0; }

// Prefix is a FORMAT version for the canonical string, not the app version.
// Bump it whenever canonicalPlanInputs() changes shape, so an old stored hash
// can never accidentally equal a new computed one. p2 -> p3: dropped the dead
// PROFILE term (review 17 Jul 2026, item 2). Consequence, and it is the correct
// direction: any project saved with a p2- hash mismatches on load, so its export
// gate closes until Fibre Assign is re-run. Fail-closed, by design.
export function hashPhysicalPlanInputs(store) {
  const s = canonicalPlanInputs(store);
  return 'p3-' + djb2(s).toString(16).padStart(8, '0') + fnv1a(s).toString(16).padStart(8, '0') + '-' + s.length.toString(16);
}
