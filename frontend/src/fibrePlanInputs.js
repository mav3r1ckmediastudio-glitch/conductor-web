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
// ratios, feed modes, allocation profile, frozen physical fibres). Derived
// allocation outputs written back by applyFibreAssignment (feeder_port /
// splitter_port on assets, fibre_in / fibre_out summaries) are deliberately
// EXCLUDED so that persisting a fresh plan does not immediately invalidate it.

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
  parts.push('PROFILE\x1e' + String(store.allocationProfile || 'COLOUR_PRESERVING'));
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

export function hashPhysicalPlanInputs(store) {
  const s = canonicalPlanInputs(store);
  return 'p2-' + djb2(s).toString(16).padStart(8, '0') + fnv1a(s).toString(16).padStart(8, '0') + '-' + s.length.toString(16);
}
