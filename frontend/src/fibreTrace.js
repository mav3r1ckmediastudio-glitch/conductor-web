// fibreTrace.js — Pure fibre-trace engine for Conductor Web
// Ported from the v2 plugin's validate_routes.py / fibre_trace.py trace logic.
//
// Traces a premise back to the cabinet (POP) through the fibre graph:
//   • UG path:     premise → bundle → JOINT → cables (BFS) → POP
//   • Aerial path: premise → aerial drop → CBT → spans (BFS) → JOINT → cables → POP
//
// Cables and spans are treated as ONE undirected graph. This works because (as
// of the spans-carry-fibre change) both carry from_node / to_node references and
// share the from_node_type / to_node_type field naming — a span IS the aerial
// cable, and a span terminating at a JOINT is the UG↔aerial transition.
//
// NO map / DOM dependencies. `store` is projectStore.state (or any object with
// the same arrays). Everything is a pure function of the store + a uprn, so the
// engine is unit-testable on its own.

export const STATUS_OK       = 'ROUTED';
export const STATUS_PARTIAL  = 'PARTIAL';
export const STATUS_UNSERVED = 'UNSERVED';

// ── Node resolution ──────────────────────────────────────────────────────────
// Map a node id (string) to its asset: type, coordinates, display label.
// Looks across cabinet (POP), joints, CBTs, and poles — the four node families
// that cables/spans can connect to.
export function resolveNode(store, id) {
  if (id == null) return null;
  const sid = String(id);

  const cab = store.cabinet;
  if (cab && String(cab.properties.pop_id) === sid) {
    return { type: 'POP', label: 'Cabinet', coords: cab.geometry.coordinates };
  }
  for (const j of store.joints || []) {
    if (String(j.properties.joint_id) === sid) {
      return { type: 'JOINT', label: 'Joint', coords: j.geometry.coordinates };
    }
  }
  for (const c of store.cbts || []) {
    if (String(c.properties.cbt_id) === sid) {
      return { type: 'CBT', label: 'CBT', coords: c.geometry.coordinates };
    }
  }
  for (const p of store.poles || []) {
    if (String(p.properties.pole_id) === sid) {
      return { type: 'POLE', label: 'Pole', coords: p.geometry.coordinates };
    }
  }
  return null;
}

// ── Graph construction ───────────────────────────────────────────────────────
// Build an undirected adjacency map from cables + spans (+ structural risers,
// chamber bridges, and CBT tails). Each edge records the source feature + which
// collection it came from, so callers can highlight geometry and label it.
// Exported so the fibre-assign engine shares the exact same graph as the trace.
export function buildFibreGraph(store) {
  const adj = new Map(); // nodeId -> [{ to, feature, collection }]

  function addEdge(a, b, feature, collection) {
    if (a == null || b == null) return;
    const sa = String(a), sb = String(b);
    if (sa === 'unknown' || sb === 'unknown' || sa === '' || sb === '') return;
    if (!adj.has(sa)) adj.set(sa, []);
    if (!adj.has(sb)) adj.set(sb, []);
    adj.get(sa).push({ to: sb, feature, collection });
    adj.get(sb).push({ to: sa, feature, collection });
  }

  for (const c of store.cables || []) {
    addEdge(c.properties.from_node, c.properties.to_node, c, 'cables');
  }
  for (const s of store.spans || []) {
    addEdge(s.properties.from_node, s.properties.to_node, s, 'spans');
  }

  // ── Riser edges: CBT → its parent pole ─────────────────────────────────────
  // A CBT physically sits on a pole and stores parent_pole_id. The span network
  // attaches to POLES, not CBTs — so without this link a CBT (the entry point for
  // an aerial premise) is islanded from the spans on its own pole. This bridges
  // the riser: premise → drop → CBT → [this edge] → parent pole → spans → …
  // Zero-length structural edge; no geometry needed (CBT and pole are co-located).
  for (const cbt of store.cbts || []) {
    const cid = cbt.properties.cbt_id;
    const pid = cbt.properties.parent_pole_id;
    if (cid && pid) {
      const riser = { properties: { length_m: 0, _structural: true }, geometry: null };
      addEdge(cid, pid, riser, 'riser');
    }
  }

  // ── CBT tail edges: CBT → its feed joint ───────────────────────────────────
  // A CBT tail is the fibre feed from a CBT down to a UG joint (cbtTails:
  // from_cbt → to_joint). This is the alternative (and in many designs, the
  // primary) way a CBT is fed — distinct from the span/riser path. Adding it
  // means an aerial premise fed via a tail traces and assigns correctly.
  for (const t of store.cbtTails || []) {
    addEdge(t.properties.from_cbt, t.properties.to_joint, t, 'cbttail');
  }

  // ── Bridge edges: JOINT ↔ its chamber ──────────────────────────────────────
  // A joint lives in a chamber and stores chamber_id. Cables snap to chambers OR
  // joints; spans snap to joints. If a cable references the chamber_id while a
  // span references the joint_id (or vice-versa), the two halves wouldn't meet
  // without this link. Harmless when both reference the same id.
  for (const j of store.joints || []) {
    const jid = j.properties.joint_id;
    const chid = j.properties.chamber_id;
    if (jid && chid && String(jid) !== String(chid)) {
      const bridge = { properties: { length_m: 0, _structural: true }, geometry: null };
      addEdge(jid, chid, bridge, 'bridge');
    }
  }

  return adj;
}

// Back-compat alias for internal trace use.
function buildGraph(store) { return buildFibreGraph(store); }

// ── Entry resolution ─────────────────────────────────────────────────────────
// Find the asset that connects this premise into the network. UG premises join
// via a bundle (→ JOINT); aerial premises join via an aerial drop (→ CBT).
// Bundle takes priority if a premise somehow has both.
function resolveEntry(store, uprn) {
  const sup = String(uprn);

  const bundle = (store.bundles || []).find(b => String(b.properties.uprn) === sup);
  if (bundle && bundle.properties.from_joint) {
    return {
      feature: bundle,
      kind: 'bundle',
      label: 'Bundle',
      assetId: bundle.properties.bundle_id || '',
      node: String(bundle.properties.from_joint),
    };
  }

  const drop = (store.aerialDrops || []).find(d => String(d.properties.uprn) === sup);
  if (drop && drop.properties.from_cbt) {
    return {
      feature: drop,
      kind: 'adrop',
      label: 'Aerial Drop',
      assetId: drop.properties.adrop_id || '',
      node: String(drop.properties.from_cbt),
    };
  }

  return null;
}

// ── Main trace ───────────────────────────────────────────────────────────────
// Returns:
//   {
//     status,            // ROUTED | PARTIAL | UNSERVED
//     reason,            // human-readable explanation
//     uprn,
//     entry,             // { feature, kind, label, assetId, node } | null
//     nodes,             // ordered node ids [entryNode … POP]
//     edges,             // ordered edge objects { to, feature, collection }
//     hops,              // display rows: { kind, label, id }
//     lengthM,           // total traced length (entry + every edge), metres
//   }
export function traceFibre(store, uprn) {
  const cabinet = store.cabinet;
  if (!cabinet) {
    return {
      status: STATUS_UNSERVED, reason: 'No cabinet placed.',
      uprn, entry: null, nodes: [], edges: [], hops: [], lengthM: 0,
    };
  }
  const popId = String(cabinet.properties.pop_id);

  const entry = resolveEntry(store, uprn);
  if (!entry) {
    return {
      status: STATUS_UNSERVED,
      reason: 'No bundle or aerial drop connects this premise to the network.',
      uprn, entry: null, nodes: [], edges: [], hops: [], lengthM: 0,
    };
  }

  const adj = buildGraph(store);

  // BFS from the entry node to the POP.
  const prev = new Map();              // nodeId -> { from, edge }
  const visited = new Set([entry.node]);
  const queue = [entry.node];
  let found = (entry.node === popId);

  // Track the deepest node reached (greatest hop-distance from the entry node).
  // On a PARTIAL this is the break frontier — the furthest the fibre graph
  // carries before the path home dead-ends. Mirrors v2 find_break_asset, which
  // flies to the last asset of the longest partial path (best_partial).
  const depth = new Map([[entry.node, 0]]);
  let deepestNode = entry.node, deepestDepth = 0;

  while (queue.length && !found) {
    const cur = queue.shift();
    for (const e of (adj.get(cur) || [])) {
      if (!visited.has(e.to)) {
        visited.add(e.to);
        prev.set(e.to, { from: cur, edge: e });
        const d = (depth.get(cur) || 0) + 1;
        depth.set(e.to, d);
        if (d > deepestDepth) { deepestDepth = d; deepestNode = e.to; }
        if (e.to === popId) { found = true; break; }
        queue.push(e.to);
      }
    }
  }

  if (!found) {
    // Entry asset exists but no path home. Diagnose WHERE it breaks by reporting
    // what the BFS could reach from the entry, and whether the POP is even wired.
    const reachedTypes = {};        // { JOINT: 2, POLE: 5, CBT: 3, ... }
    let reachedJoint = false;
    for (const nid of visited) {
      const n = resolveNode(store, nid);
      const t = n ? n.type : 'UNKNOWN';
      reachedTypes[t] = (reachedTypes[t] || 0) + 1;
      if (t === 'JOINT') reachedJoint = true;
    }
    const popInGraph = adj.has(popId);
    const typeSummary = Object.entries(reachedTypes)
      .map(([t, n]) => `${n} ${t}`).join(', ');

    let reason;
    if (entry.node === popId) {
      reason = 'Premise entry resolves directly to the POP (unusual topology).';
    } else if (!popInGraph) {
      reason = `The cabinet (${popId}) has no cable connected to it — nothing in the ` +
               `network references the POP. Draw a feeder cable from the first joint to the cabinet.`;
    } else if (!reachedJoint) {
      reason = `Reached ${typeSummary} from the entry, but never reached a JOINT — so the ` +
               `aerial network isn't joined to the underground cable network. Draw a span (or duct) ` +
               `from the pole chain into the chamber/joint that carries the UG cable.`;
    } else {
      reason = `Reached ${typeSummary} including a JOINT, but no cable path continues from there ` +
               `to the cabinet. Check the cables between that joint and the POP are drawn and snapped.`;
    }

    // Break asset: walk back from the deepest-reached node toward the entry
    // until a node resolves to a real feature with coordinates. This mirrors v2
    // find_break_asset, which walks the longest partial path from its end
    // backwards and returns the first asset that resolves to geometry. Preferring
    // the deepest node points the user at the furthest live point of the build —
    // the joint/CBT/pole where the route actually dies — not the premise.
    let breakNode = null;
    {
      let bid = deepestNode;
      const guard = new Set();
      while (bid != null && !guard.has(bid)) {
        guard.add(bid);
        const n = resolveNode(store, bid);
        if (n && Array.isArray(n.coords) && n.coords.length >= 2) {
          breakNode = { id: String(bid), type: n.type, coords: n.coords };
          break;
        }
        const p = prev.get(bid);
        bid = p ? p.from : null;
      }
    }

    return {
      status: STATUS_PARTIAL, reason, uprn, entry,
      nodes: [entry.node], edges: [],
      hops: buildHops(store, entry, [entry.node], []),
      lengthM: lengthOf(entry.feature),
      reached: reachedTypes,
      breakNode,   // { id, type, coords } | null — fly-to target for the UI
    };
  }

  // Reconstruct path: POP back to entry node.
  const nodePath = [];
  const edgePath = [];
  let cur = popId;
  while (cur !== entry.node) {
    nodePath.push(cur);
    const p = prev.get(cur);
    edgePath.push(p.edge);
    cur = p.from;
  }
  nodePath.push(entry.node);
  nodePath.reverse();
  edgePath.reverse();

  let lengthM = lengthOf(entry.feature);
  for (const e of edgePath) lengthM += lengthOf(e.feature);

  return {
    status: STATUS_OK, reason: 'Routed to cabinet.', uprn, entry,
    nodes: nodePath, edges: edgePath,
    hops: buildHops(store, entry, nodePath, edgePath),
    lengthM: Math.round(lengthM),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function lengthOf(feature) {
  const v = feature?.properties?.length_m;
  return (typeof v === 'number' && !isNaN(v)) ? v : 0;
}

// Build a flat, ordered list of display rows for the panel:
//   premise → entry asset → node → edge → node → edge → … → POP
function buildHops(store, entry, nodePath, edgePath) {
  const hops = [];

  if (entry) {
    hops.push({ kind: entry.kind, label: entry.label, id: entry.assetId });
  }

  for (let i = 0; i < nodePath.length; i++) {
    const n = resolveNode(store, nodePath[i]);
    hops.push({
      kind: n ? n.type : 'NODE',
      label: n ? n.label : 'Node',
      id: nodePath[i],
    });

    if (i < edgePath.length) {
      const coll = edgePath[i].collection;
      const ef = edgePath[i].feature;
      let label, id;
      if (coll === 'spans')       { label = 'Aerial Span'; id = ef.properties.span_id  || ''; }
      else if (coll === 'cables') { label = 'Cable';       id = ef.properties.cable_id || ''; }
      else if (coll === 'riser')  { label = 'Pole Riser';  id = ''; }
      else if (coll === 'bridge') { label = 'Chamber';     id = ''; }
      else                        { label = 'Link';        id = ''; }
      hops.push({ kind: 'edge', label, id });
    }
  }

  return hops;
}
