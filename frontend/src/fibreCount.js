// fibreCount.js — Fibre utilisation (used / spare / total) per cable and span segment.
//
// Uses the same buildFibreGraph as trace/assign. Counts utilisation by summing
// the fibre_count of all SPLITTER_OUTPUT assignment records that flow THROUGH
// each segment on the BFS tree from the POP. This is the downstream-demand model:
// every segment carries the aggregate fibre demand of everything fed through it.
//
// WHAT "used" MEANS HERE:
//   • A terminal splitter (1:8) consumes 1 feeder fibre into it.
//   • Its n occupied ports consume 1 fibre each out to the premises.
//   • A feeder splitter (1:4) consumes 1 feeder fibre in; each connected terminal
//     consumes 1 fibre out.
//   • A cable/span segment's used count = number of distinct terminal splitters
//     (and their consumer drops) fed through it, reading downstream from the POP.
//
// SIMPLE APPROACH (faithful to what the panel needs):
//   Walk every segment. For each segment, find all terminal splitters downstream
//   of it (using the BFS parent tree from the POP). Sum their consumer counts.
//   "Fibre capacity" of the segment = cable/span fibre_count property.
//
// Returns:
//   {
//     ok, reason,
//     segments: [
//       {
//         id,           // cable_id or span_id
//         collection,   // 'cables' | 'spans'
//         feature,      // the GeoJSON feature
//         fibre_count,  // capacity from properties
//         used,         // fibres consumed (consumers flowing through this segment)
//         spare,        // fibre_count - used (clamped to 0 min)
//         pct,          // utilisation 0..100 (rounded)
//         downstream_terminals, // count of terminal splitters served through it
//         downstream_consumers, // count of consumer drops/bundles served through it
//       }, …
//     ],
//     totals: { cables, spans, total_fibre_km, avg_pct, max_pct, overloaded },
//     log: [str],
//   }

import { buildFibreGraph } from './fibreTrace.js';

function S(v) { return (v === null || v === undefined) ? '' : String(v); }
function intOr(v, fallback) { const n = parseInt(v, 10); return isNaN(n) ? fallback : n; }

// BFS from POP — gives every node its parent toward the POP (used to walk upstream)
// and its distance (used to determine downstream direction).
function bfsFromPop(adj, popId) {
  const dist   = new Map([[popId, 0]]);
  const parent = new Map();
  const queue  = [popId];
  while (queue.length) {
    const cur = queue.shift();
    for (const e of (adj.get(cur) || [])) {
      if (!dist.has(e.to)) {
        dist.set(e.to, dist.get(cur) + 1);
        parent.set(e.to, cur);
        queue.push(e.to);
      }
    }
  }
  return { dist, parent };
}

// Given a node, collect all nodes DOWNSTREAM of it (further from POP) via DFS.
function downstreamNodes(startNode, adj, dist) {
  const startDist = dist.get(startNode) ?? -1;
  const found = new Set();
  const stack = [startNode];
  const seen  = new Set();
  while (stack.length) {
    const n = stack.pop();
    if (seen.has(n)) continue;
    seen.add(n);
    found.add(n);
    for (const e of (adj.get(n) || [])) {
      if ((dist.get(e.to) ?? -1) > startDist) stack.push(e.to);
    }
  }
  return found;
}

export function countFibres(store) {
  const log = [];
  const L = (m) => log.push(m);

  const cabinet = store.cabinet;
  if (!cabinet) return { ok: false, reason: 'No cabinet placed.', segments: [], totals: {}, log };
  const popId = S(cabinet.properties.pop_id);

  // Build the graph
  const adj = buildFibreGraph(store);
  if (!adj.has(popId)) {
    return { ok: false, reason: 'Cabinet has no connected cables — nothing to count.', segments: [], totals: {}, log };
  }
  const { dist } = bfsFromPop(adj, popId);

  // Build consumer-by-node index: nodeId → count of direct consumers (drops or bundles)
  const consumersByNode = {};
  for (const c of store.cbts || []) {
    const id = S(c.properties.cbt_id);
    const drops = (store.aerialDrops || []).filter(d => S(d.properties.from_cbt) === id);
    if (drops.length) consumersByNode[id] = (consumersByNode[id] || 0) + drops.length;
  }
  for (const j of store.joints || []) {
    const id = S(j.properties.joint_id);
    const hasSplit = j.properties.has_splitter === true || j.properties.has_splitter === 1 || j.properties.has_splitter === 'true';
    if (hasSplit) {
      const bundles = (store.bundles || []).filter(b => S(b.properties.from_joint) === id);
      if (bundles.length) consumersByNode[id] = (consumersByNode[id] || 0) + bundles.length;
    }
  }

  // Total consumers downstream of a node = sum of consumersByNode for all downstream nodes
  function consumersDownstream(nodeId) {
    const dn = downstreamNodes(nodeId, adj, dist);
    let sum = 0;
    for (const id of dn) sum += consumersByNode[id] || 0;
    return sum;
  }

  // Process each cable and span segment.
  // For a segment A–B, the downstream end is whichever node is further from the POP.
  // Consumers downstream of the downstream end flow through this segment.
  const segments = [];

  function processSegments(collection, idField) {
    for (const feature of store[collection] || []) {
      const p = feature.properties;
      const id = S(p[idField]);
      const cap = intOr(p.fibre_count, 0);
      const fromNode = S(p.from_node);
      const toNode   = S(p.to_node);

      // Determine which end is downstream (further from POP)
      const dFrom = dist.get(fromNode) ?? -1;
      const dTo   = dist.get(toNode)   ?? -1;
      const downstreamEnd = dTo > dFrom ? toNode : fromNode;

      // Consumers flowing through this segment = those downstream of the downstream end
      const used   = consumersDownstream(downstreamEnd);
      const spare  = Math.max(0, cap - used);
      const pct    = cap > 0 ? Math.round((used / cap) * 100) : 0;

      segments.push({
        id,
        collection,
        feature,
        fibre_count: cap,
        used,
        spare,
        pct,
        downstream_consumers: used,
        // Count distinct terminal-splitter nodes downstream
        downstream_terminals: (() => {
          const dn = downstreamNodes(downstreamEnd, adj, dist);
          let t = 0;
          for (const nid of dn) if (consumersByNode[nid]) t++;
          return t;
        })(),
        length_m: intOr(p.length_m, 0),
      });
    }
  }

  processSegments('cables', 'cable_id');
  processSegments('spans',  'span_id');

  // Totals
  const cableSegs = segments.filter(s => s.collection === 'cables');
  const spanSegs  = segments.filter(s => s.collection === 'spans');
  const allPcts   = segments.filter(s => s.fibre_count > 0).map(s => s.pct);
  const totalFibreM = segments.reduce((sum, s) => sum + (s.length_m || 0), 0);
  const overloaded = segments.filter(s => s.used > s.fibre_count && s.fibre_count > 0).length;
  const maxPct = allPcts.length ? Math.max(...allPcts) : 0;
  const avgPct = allPcts.length ? Math.round(allPcts.reduce((a, b) => a + b, 0) / allPcts.length) : 0;

  const totals = {
    cables:        cableSegs.length,
    spans:         spanSegs.length,
    total_fibre_km: (totalFibreM / 1000).toFixed(2),
    avg_pct:       avgPct,
    max_pct:       maxPct,
    overloaded,
  };

  L(`Fibre count: ${segments.length} segment(s) — avg ${avgPct}% utilisation, peak ${maxPct}%, ${overloaded} overloaded.`);
  if (overloaded) L(`⚠ ${overloaded} segment(s) over capacity — check cable fibre_count vs. consumer demand.`);

  return { ok: true, reason: 'Counted.', segments, totals, log };
}
