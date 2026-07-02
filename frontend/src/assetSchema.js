// assetSchema.js — Single source of truth for asset ID fields and the FK
// relationships between collections.
//
// WHY THIS EXISTS: designHealth.js's FK integrity check (2c/2d) has always
// known which field on which collection points at which other collection —
// but that knowledge only ever existed as inline `.filter()`/`.find()` calls
// scattered through designHealth.js, nowhere else. deleteAsset() in
// projectStore.js had no access to it, so deleting a pole/joint/cable left
// every dependent record (cables, spans, bundles, aerial drops, fibre
// assignments) silently pointing at nothing — the exact class of bug
// designHealth.js's Check 2c/2d exists to catch. This file extracts that
// knowledge into one place so both designHealth.js (read-only: "is this
// broken?") and cascadeDelete.js (destructive: "clean this up on delete")
// stay in sync by construction instead of by two people remembering to keep
// two files in step.
//
// Deliberately NOT importing this into designHealth.js in this pass — that
// would mean re-deriving allNodeIds/aerialNodeIds/etc. from generic metadata
// instead of the explicit per-check sets it has now, which is a bigger,
// riskier refactor than this fix calls for. Left as a documented follow-up
// (see handoff notes) — designHealth.js's own ID-set construction (lines
// 200-218) is hand-verified against this schema below and must be kept in
// step manually until that refactor happens.

// Collection → the property name holding that asset's own ID.
// aerialDrops is the one exception: legacy data may use either field name,
// so a drop's "own ID" is whichever of the two is actually set.
export const ID_FIELDS = {
  chambers:      'chamber_id',
  ducts:         'duct_id',
  joints:        'joint_id',
  dropDucts:     'drop_duct_id',
  cables:        'cable_id',
  bundles:       'bundle_id',
  poles:         'pole_id',
  cbts:          'cbt_id',
  spans:         'span_id',
  aerialDrops:   ['adrop_id', 'drop_id'],
  cbtTails:      'tail_id',
  addressPoints: 'uprn',
};

// Returns the asset's own ID as a string, or '' if it has none set.
export function getAssetId(collection, feature) {
  const p = feature?.properties || {};
  const field = ID_FIELDS[collection];
  if (!field) return '';
  if (Array.isArray(field)) {
    for (const f of field) {
      if (p[f] != null && p[f] !== '') return String(p[f]);
    }
    return '';
  }
  return p[field] != null && p[field] !== '' ? String(p[field]) : '';
}

// Collections that act as network "nodes" — valid endpoints for a cable or
// aerial span's from_node/to_node. Mirrors designHealth.js's allNodeIds
// (chambers, joints, poles, cbts — cabinet is handled separately since it
// isn't a store array).
export const NODE_COLLECTIONS = ['chambers', 'joints', 'poles', 'cbts'];

// Collections that can act as the from_node of an aerial drop (legacy field)
// or the from_cbt of an aerial drop (current field): poles and CBTs only.
export const AERIAL_NODE_COLLECTIONS = ['poles', 'cbts'];
