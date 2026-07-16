// fibreNetwork.js — Build a directed, POP-rooted fibre-bearing graph for the
// demand-driven physical planner (Conductor Web).
//
// Part of the demand-driven through-splicing rewrite (remediation spec §4).
// This module ONLY builds and orients the graph and classifies each segment;
// it computes no demand and emits no assignment records.
//
// A "fibre-bearing segment" is a cable, an aerial span, or a CBT tail. Purely
// structural links (chamber bridges, CBT-to-pole risers) are NOT fibre edges
// here — they carry no fibres — but they are used only to keep connectivity for
// orientation; they never carry demand or fibres.
//
// Every real edge is oriented AWAY from the POP (downstream) using BFS distance.
// Each edge carries an explicit feed_mode:
//   • 'PASS_THROUGH'    — raw pass-through branch; propagates downstream demand.
//   • 'SPLITTER_OUTPUT' — an optical output leg of the local splitter at its
//                         upstream node; does NOT add raw demand upstream (the
//                         splitter's single input already supplies it).
// feed_mode is read from segment metadata when present (spec §5 — cable size
// cannot reveal it). When absent it is DEFAULTED (see resolveFeedMode) and the
// default is recorded on the edge as `feedModeInferred: true` so callers/UI can
// surface "assumed" branches for engineer confirmation.

const STD_MODULES = [2, 4, 8, 16, 32];
function S(v) { return (v === null || v === undefined || v === '') ? null : String(v); }
function roundup(n) { for (const s of STD_MODULES) if (n <= s) return s; return n; }
function capRatio(ratio, fallback = 8) {
  const m = String(ratio || '').match(/:(\d+)/);
  return m ? parseInt(m[1], 10) : fallback;
}
function intCap(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : NaN; }
function truthy(v) { return v === true || v === 1 || v === 'true'; }

export const FEED_PASS_THROUGH = 'PASS_THROUGH';
export const FEED_SPLITTER_OUTPUT = 'SPLITTER_OUTPUT';

// ── Build ─────────────────────────────────────────────────────────────────────
// Returns:
//   {
//     ok, errors: [{code,message,id?}],
//     root,                         // POP id
//     nodes: Map<id, { id, type, hasSplitter, ratio, cap, consumers }>,
//     edges: [ edge ],             // oriented from→to (downstream)
//     outEdges: Map<id, edge[]>,   // downstream edges leaving a node
//     inEdges:  Map<id, edge[]>,   // upstream edges entering a node (POP side)
//     dist: Map<id, number>,
//   }
// edge = { id, collection, from, to, capacity, feedMode, feedModeInferred,
//          splitterId, splitterPort }
export function buildFibreNetwork(store) {
  const errors = [];
  const cabinet = store.cabinet;
  if (!cabinet || !cabinet.properties) {
    return emptyNetwork([{ code: 'NO_POP', message: 'No cabinet/POP placed — cannot root the fibre graph.' }]);
  }
  const root = S(cabinet.properties.pop_id);
  if (!root) {
    return emptyNetwork([{ code: 'NO_POP', message: 'Cabinet has no pop_id — cannot root the fibre graph.' }]);
  }

  // ── Node table ──────────────────────────────────────────────────────────────
  const nodes = new Map();
  const ensureNode = (id, type) => {
    const sid = S(id); if (!sid) return null;
    if (!nodes.has(sid)) nodes.set(sid, { id: sid, type: type || 'NODE', hasSplitter: false, ratio: null, cap: 0, consumers: 0 });
    else if (type && nodes.get(sid).type === 'NODE') nodes.get(sid).type = type;
    return nodes.get(sid);
  };
  ensureNode(root, 'POP');
  for (const c of store.cbts || []) {
    const n = ensureNode(S(c.properties.cbt_id), 'CBT');
    if (n) { n.hasSplitter = true; n.ratio = S(c.properties.split_ratio) || '1:8'; n.cap = capRatio(n.ratio, 8); }
  }
  for (const j of store.joints || []) {
    const n = ensureNode(S(j.properties.joint_id), 'JOINT');
    if (n && truthy(j.properties.has_splitter)) { n.hasSplitter = true; n.ratio = S(j.properties.split_ratio) || '1:8'; n.cap = capRatio(n.ratio, 8); }
  }

  // Count direct consumers (drops on a CBT, bundles on a joint). A node with
  // consumers is a terminal splitter even if the designer didn't declare it.
  for (const d of store.aerialDrops || []) { const n = nodes.get(S(d.properties.from_cbt)); if (n) n.consumers++; }
  for (const b of store.bundles || [])     { const n = nodes.get(S(b.properties.from_joint)); if (n) n.consumers++; }
  for (const n of nodes.values()) {
    if (!n.hasSplitter && n.consumers > 0) { n.hasSplitter = true; n.ratio = `1:${roundup(n.consumers)}`; n.cap = capRatio(n.ratio, 8); n.autoTerminal = true; }
  }

  // ── Raw undirected fibre segments (with capacities) ──────────────────────────
  const rawSegs = [];   // { id, collection, a, b, capacity, props }
  const seenSegIds = new Map();   // id -> collection, for cross-collection uniqueness
  const pushSeg = (id, collection, a, b, capacity, props) => {
    const sid = S(id), sa = S(a), sb = S(b);
    if (!sid) { errors.push({ code: 'SEG_NO_ID', message: `A ${collection} segment has no id and was skipped.` }); return; }
    // Segment ids must be unique across cables, spans AND CBT tails — the graph
    // keys edges by id, so a duplicate would silently merge two physical
    // segments. Reject before graph construction (release-audit P1).
    if (seenSegIds.has(sid)) { errors.push({ code: 'DUP_SEGMENT_ID', message: `Duplicate segment id ${sid} (in ${seenSegIds.get(sid)} and ${collection}). Segment ids must be unique across cables, spans and CBT tails.`, id: sid }); return; }
    seenSegIds.set(sid, collection);
    if (!sa || !sb) { errors.push({ code: 'SEG_ENDPOINT', message: `Segment ${sid} is missing an endpoint.`, id: sid }); return; }
    if (!Number.isFinite(capacity) || capacity <= 0) { errors.push({ code: 'SEG_CAPACITY', message: `Segment ${sid} has a missing or invalid fibre_count.`, id: sid }); return; }
    ensureNode(sa); ensureNode(sb);
    rawSegs.push({ id: sid, collection, a: sa, b: sb, capacity, props });
  };
  for (const c of store.cables || []) pushSeg(c.properties.cable_id, 'cables', c.properties.from_node, c.properties.to_node, intCap(c.properties.fibre_count), c.properties);
  for (const s of store.spans || [])  pushSeg(s.properties.span_id,  'spans',  s.properties.from_node, s.properties.to_node, intCap(s.properties.fibre_count), s.properties);
  for (const t of store.cbtTails || []) {
    // A CBT tail feeds a CBT's splitter input from a joint. Default 1 fibre.
    const cap = Number.isFinite(intCap(t.props?.fibre_count)) ? intCap(t.props?.fibre_count) : (Number.isFinite(intCap(t.properties?.fibre_count)) ? intCap(t.properties.fibre_count) : 1);
    const tid = S(t.properties.tail_id) || S(t.properties.cbttail_id) || (t.properties.from_cbt ? `TAIL-${S(t.properties.from_cbt)}` : null);
    pushSeg(tid, 'cbtTails', t.properties.from_cbt, t.properties.to_joint, cap || 1, t.properties);
  }

  // Structural-only connectivity (risers/bridges) — for orientation reachability
  // only. These are NOT fibre edges and never carry demand or fibres.
  const structAdj = new Map();
  const addStruct = (a, b) => { const sa = S(a), sb = S(b); if (!sa || !sb) return; (structAdj.get(sa) || structAdj.set(sa, []).get(sa)).push(sb); (structAdj.get(sb) || structAdj.set(sb, []).get(sb)).push(sa); };
  for (const cbt of store.cbts || []) if (cbt.properties.parent_pole_id) addStruct(cbt.properties.cbt_id, cbt.properties.parent_pole_id);
  for (const j of store.joints || []) if (j.properties.chamber_id && S(j.properties.chamber_id) !== S(j.properties.joint_id)) addStruct(j.properties.joint_id, j.properties.chamber_id);

  // ── BFS distance from POP over fibre + structural edges ──────────────────────
  const adj = new Map();
  const link = (a, b, seg) => { (adj.get(a) || adj.set(a, []).get(a)).push({ to: b, seg }); (adj.get(b) || adj.set(b, []).get(b)).push({ to: a, seg }); };
  for (const s of rawSegs) link(s.a, s.b, s);
  for (const [a, bs] of structAdj) for (const b of bs) link(a, b, null);

  const dist = new Map([[root, 0]]);
  const q = [root];
  while (q.length) {
    const cur = q.shift();
    for (const e of (adj.get(cur) || [])) if (!dist.has(e.to)) { dist.set(e.to, dist.get(cur) + 1); q.push(e.to); }
  }

  // ── Orient fibre edges downstream; detect cycles / ambiguous feeders ─────────
  const edges = [];
  const outEdges = new Map();
  const inEdges = new Map();
  const addOut = (id, e) => (outEdges.get(id) || outEdges.set(id, []).get(id)).push(e);
  const addIn  = (id, e) => (inEdges.get(id)  || inEdges.set(id,  []).get(id)).push(e);

  for (const s of rawSegs) {
    const da = dist.has(s.a) ? dist.get(s.a) : Infinity;
    const db = dist.has(s.b) ? dist.get(s.b) : Infinity;
    if (da === Infinity && db === Infinity) { errors.push({ code: 'DISCONNECTED', message: `Segment ${s.id} is not connected to the POP.`, id: s.id }); continue; }
    if (da === db) { errors.push({ code: 'AMBIGUOUS_ORIENT', message: `Segment ${s.id} connects two nodes equidistant from the POP — orientation is ambiguous (possible loop).`, id: s.id }); continue; }
    const from = da < db ? s.a : s.b;   // cabinet side
    const to   = da < db ? s.b : s.a;   // premises side
    const edge = {
      id: s.id, collection: s.collection, from, to, capacity: s.capacity,
      feedMode: null, feedModeInferred: false,
      splitterId: S(s.props?.splitter_id) || null,
      splitterPort: s.props?.splitter_port != null ? parseInt(s.props.splitter_port, 10) : null,
    };
    edges.push(edge); addOut(from, edge); addIn(to, edge);
  }

  // A node fed by >1 fibre edge from the cabinet side is an ambiguous multi-feeder.
  for (const [id, ins] of inEdges) if (ins.length > 1) errors.push({ code: 'MULTI_FEEDER', message: `Node ${id} has ${ins.length} upstream feeders — ambiguous. Exactly one is required.`, id });

  // ── Resolve feed_mode for each edge (explicit metadata, else default) ─────────
  for (const e of edges) {
    const explicit = S(e.__rawFeed) || resolveExplicitFeed(store, e);
    if (explicit === FEED_PASS_THROUGH || explicit === FEED_SPLITTER_OUTPUT) { e.feedMode = explicit; }
    else { e.feedMode = defaultFeedMode(nodes, e); e.feedModeInferred = true; }
  }

  return {
    ok: errors.filter(x => x.code !== 'SEG_NO_ID').length === 0 || errors.length === 0,
    errors, root, nodes, edges, outEdges, inEdges, dist,
  };
}

// Explicit feed_mode written on the segment properties (spec §5).
function resolveExplicitFeed(store, edge) {
  const findProps = () => {
    if (edge.collection === 'cables') return (store.cables || []).find(c => S(c.properties.cable_id) === edge.id)?.properties;
    if (edge.collection === 'spans')  return (store.spans  || []).find(s => S(s.properties.span_id)  === edge.id)?.properties;
    if (edge.collection === 'cbtTails') return (store.cbtTails || []).find(t => (S(t.properties.tail_id) || S(t.properties.cbttail_id) || `TAIL-${S(t.properties.from_cbt)}`) === edge.id)?.properties;
    return null;
  };
  const p = findProps();
  return p ? S(p.feed_mode) : null;
}

// Default when feed_mode is absent. Conservative and matches the worked examples:
// an onward segment is a raw PASS_THROUGH branch UNLESS it is explicitly an
// optical output leg of the upstream node's splitter (identified by carrying a
// splitter_id/splitter_port that belongs to the upstream node's splitter).
function defaultFeedMode(nodes, edge) {
  const up = nodes.get(edge.from);
  if (up && up.hasSplitter && edge.splitterId && edge.splitterId === `${edge.from}-SP`) return FEED_SPLITTER_OUTPUT;
  return FEED_PASS_THROUGH;
}

function emptyNetwork(errors) {
  return { ok: false, errors, root: null, nodes: new Map(), edges: [], outEdges: new Map(), inEdges: new Map(), dist: new Map() };
}

export function isSplitterNode(node) { return !!(node && node.hasSplitter); }
