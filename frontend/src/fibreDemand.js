// fibreDemand.js — Post-order demand pass for the demand-driven physical planner.
//
// Remediation spec §6. Computes how many RAW fibres each directed edge must
// carry, based purely on downstream demand — NOT on cable capacity. Emits NO
// assignment records; it only annotates a demand plan.
//
// Demand rules (spec §6):
//   • A terminal 1:8 splitter requires one raw input fibre.
//   • A 1:4 feeder requires one raw input fibre.
//   • Premises behind a terminal splitter do NOT each consume a feeder fibre.
//   • A child served through a local 1:4/1:8 optical OUTPUT (feed_mode
//     SPLITTER_OUTPUT) does NOT propagate separate raw demand upstream.
//   • A downstream PASS_THROUGH branch contributes its recursively-calculated
//     demand.
//   • Reserve fibres are added only by an explicit engineering profile, never by
//     capacity-fill (no reserves added here).
//
// Capacity is a VALIDATION, not an allocation rule: if an edge's required
// fibres exceed its capacity we throw CapacityError. We never silently clamp
// with Math.min() (that is the original defect).

import { FEED_PASS_THROUGH } from './fibreNetwork.js';

export class CapacityError extends Error {
  constructor(edgeId, required, capacity) {
    super(`Capacity exceeded on segment ${edgeId}: needs ${required} fibre(s) but only ${capacity} available.`);
    this.name = 'CapacityError';
    this.edgeId = edgeId;
    this.required = required;
    this.capacity = capacity;
  }
}

// computeDemand(network) →
//   { ok, errors, nodeDemand: Map<nodeId,int>, edgeRequired: Map<edgeId,int> }
// Throws CapacityError on the first over-capacity edge (spec §6 mandatory
// behaviour). Also guards against cycles that slipped past the network builder.
export function computeDemand(network) {
  const errors = [];
  const nodeDemand = new Map();
  const edgeRequired = new Map();
  const visiting = new Set();

  const passChildren = (nodeId) =>
    (network.outEdges.get(nodeId) || []).filter(e => e.feedMode === FEED_PASS_THROUGH);

  function demandAt(nodeId) {
    if (nodeDemand.has(nodeId)) return nodeDemand.get(nodeId);
    if (visiting.has(nodeId)) throw new Error(`Cycle detected at node ${nodeId} during demand pass.`);
    visiting.add(nodeId);

    const node = network.nodes.get(nodeId);
    let demand = node && node.hasSplitter ? 1 : 0;   // local raw fibre demand
    for (const e of passChildren(nodeId)) {
      const childDemand = demandAt(e.to);
      edgeRequired.set(e.id, childDemand);
      demand += childDemand;
    }

    visiting.delete(nodeId);
    nodeDemand.set(nodeId, demand);
    return demand;
  }

  // Root feeders: each edge leaving the POP carries its child's full demand.
  for (const e of (network.outEdges.get(network.root) || [])) {
    if (e.feedMode === FEED_PASS_THROUGH) {
      const d = demandAt(e.to);
      edgeRequired.set(e.id, d);
    } else {
      edgeRequired.set(e.id, 0);
    }
  }
  // Ensure every reachable node has a computed demand (covers assets not on a
  // POP-rooted feeder edge — they become "disconnected demanded asset" errors).
  for (const node of network.nodes.values()) {
    if (node.id === network.root) continue;
    if (!nodeDemand.has(node.id)) {
      try { demandAt(node.id); } catch (e) { errors.push({ code: 'DEMAND_CYCLE', message: e.message, id: node.id }); }
      if ((node.hasSplitter || node.consumers > 0) && !(network.inEdges.get(node.id) || []).length) {
        errors.push({ code: 'DISCONNECTED_DEMAND', message: `Demanded asset ${node.id} has no upstream feeder to the POP.`, id: node.id });
      }
    }
  }

  // Capacity validation (throws on first breach — no partial plan).
  for (const e of network.edges) {
    const req = edgeRequired.has(e.id) ? edgeRequired.get(e.id) : 0;
    if (req > e.capacity) throw new CapacityError(e.id, req, e.capacity);
  }

  return { ok: errors.length === 0, errors, nodeDemand, edgeRequired };
}
