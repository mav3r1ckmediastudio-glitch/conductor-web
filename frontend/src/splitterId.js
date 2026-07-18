// splitterId.js — Single source of truth for the splitter-id convention.
//
// A splitter living at a node (joint or CBT) has a synthetic id derived from
// that node: `${nodeId}-SP`. This is used as the splitter's pigtail cable_id in
// physical assignment records, and is the value a designer types into the
// `splitter_id` field on a SPLITTER_OUTPUT segment.
//
// Review 17 Jul 2026 (item 5): this suffix was previously re-derived by hand in
// 11 places across 8 files, including a user-facing input placeholder and a
// mandatory plan invariant. Those must agree forever, so they now agree here.
//
// NOTE: fibrePlanValidation.js re-derives the expected id from the edge's
// upstream node as a mandatory invariant (spec §10). That check is deliberately
// INDEPENDENT of what the designer typed — it is what makes a typo'd splitter_id
// fail closed rather than silently mis-plan. It uses splitterIdFor() for the
// convention, but the comparison remains its own.

export const SPLITTER_ID_SUFFIX = '-SP';

// The canonical splitter id for a node. Returns null for a missing node id so
// callers never fabricate a bare '-SP'.
export function splitterIdFor(nodeId) {
  if (nodeId === null || nodeId === undefined || nodeId === '') return null;
  return `${nodeId}${SPLITTER_ID_SUFFIX}`;
}

// True when an id follows the splitter convention. Used to exclude synthetic
// splitter pigtails from checks that expect a real cable/span id.
export function isSplitterId(id) {
  return typeof id === 'string' ? id.endsWith(SPLITTER_ID_SUFFIX) : String(id ?? '').endsWith(SPLITTER_ID_SUFFIX);
}
