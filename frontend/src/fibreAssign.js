// fibreAssign.js — Cascade-aware fibre assignment for Conductor Web
// Ported from the v2 plugin (tools/fibre_assign.py + tools/splitter_topology.py).
//
// WHAT IT DOES
// Allocates every premise consumer to a splitter port through the cascade:
//   • Terminal splitters (1:8) — a CBT (→ aerial drops) or a UG joint (→ bundles).
//     Each consumer is allocated a splitter_port 1..8.
//   • Feeder splitters (1:4) — a joint that feeds ≥2 downstream terminal splitters.
//     Each downstream terminal is allocated a feeder_port 1..4.
// Allocation is sticky + freeze-aware (sticky_allocate): stored ports are honoured,
// INSTALLED/LIVE are frozen, the rest fill the lowest free port deterministically.
// The cascade hierarchy (which feeder feeds which terminal) is derived from the
// network graph by walking toward the cabinet.
//
// STORAGE MODEL (faithful to v2)
// The port is stored on the CONSUMER, never as N slots on the splitter:
//   • aerial drop  → properties.splitter_port   (its CBT terminal port)
//   • bundle       → properties.splitter_port   (its joint terminal port)
//   • child splitter joint/cbt → properties.feeder_port (its port on the parent 1:4)
// Splitters get a summary written back: fibre_in / fibre_out (+ has_splitter /
// split_ratio when auto-derived). The Edit-CBT port grid is then DERIVED live from
// the drops pointing at that CBT — single source of truth, no dual bookkeeping.
//
// cascade_level / cascade_type are user-entered splitter CONFIG (Primary/Secondary,
// RURAL_1_4_1_8 etc.), not computed here — same as v2.
//
// NOTE ON SCOPE: this builds the full cascade ALLOCATION (1:4 → 1:8) plus the core
// assignment records (SPLITTER_INPUT / SPLITTER_OUTPUT / SPARE). The deep
// splice-level records (through-splices, dark storage, feeder propagation fibre
// numbering) that v2 emits for its splice-plan export are deferred until the web
// splice-plan tool exists — there is nothing to consume them yet.

import { buildFibreGraph } from './fibreTrace.js';
import { buildFibreNetwork } from './fibreNetwork.js';
import { planPhysicalFibres } from './fibrePlanner.js';

const FROZEN_STATES = new Set(['INSTALLED', 'LIVE']);
const STD_MODULES = [2, 4, 8, 16, 32];

function S(v) { return (v === null || v === undefined || v === '') ? null : String(v); }
function roundup(n) { for (const s of STD_MODULES) if (n <= s) return s; return n; }
function capOf(ratio, fallback = 8) {
  const m = String(ratio || '').match(/:(\d+)/);
  return m ? parseInt(m[1], 10) : fallback;
}
function cmpKey(a, b) {
  const sa = Array.isArray(a) ? a.join('\x00') : String(a);
  const sb = Array.isArray(b) ? b.join('\x00') : String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}
function groupBy(arr, keyFn) {
  const m = {};
  for (const x of arr) { const k = keyFn(x); if (k == null) continue; (m[k] = m[k] || []).push(x); }
  return m;
}

// Fibre numbering (12 fibres per tube), kept for assignment-record fidelity.
function tubeForFibre(n, fpt = 12) { return Math.floor((n - 1) / fpt) + 1; }
function posInTube(n, fpt = 12)    { return ((n - 1) % fpt) + 1; }

// ── Sticky, freeze-aware port allocation ─────────────────────────────────────
// consumers: [{ asset, sortKey, port (int|null), status }]
// Returns { occupied {port:asset}, portOf {asset:port}, flags [str] }.
export function stickyAllocate(consumers, cap) {
  const occupied = {};
  const portOf = {};
  const flags = [];

  const stored = consumers.filter(c => c.port && c.port >= 1 && c.port <= cap);
  const fresh  = consumers.filter(c => !(c.port && c.port >= 1 && c.port <= cap));

  stored.sort((a, b) => {
    const fa = FROZEN_STATES.has(a.status) ? 0 : 1;
    const fb = FROZEN_STATES.has(b.status) ? 0 : 1;
    if (fa !== fb) return fa - fb;
    if (a.port !== b.port) return a.port - b.port;
    return cmpKey(a.sortKey, b.sortKey);
  });
  for (const c of stored) {
    if (occupied[c.port] !== undefined) {
      flags.push(`COLLISION port ${c.port}: ${occupied[c.port]} vs ${c.asset}`);
    } else {
      occupied[c.port] = c.asset; portOf[c.asset] = c.port;
    }
  }

  const free = [];
  for (let p = 1; p <= cap; p++) if (occupied[p] === undefined) free.push(p);

  fresh.sort((a, b) => cmpKey(a.sortKey, b.sortKey));
  for (const c of fresh) {
    if (free.length) { const p = free.shift(); occupied[p] = c.asset; portOf[c.asset] = p; }
    else flags.push(`OVERCAP: ${c.asset} (no free port within cap ${cap})`);
  }

  for (const c of consumers) {
    if (FROZEN_STATES.has(c.status) && portOf[c.asset] === undefined) {
      flags.push(`FROZEN_UNPLACED: ${c.asset} (status=${c.status})`);
    }
  }
  return { occupied, portOf, flags };
}

// ── BFS from the POP: distance + parent-toward-cabinet ───────────────────────
// Gives every node a parent on its shortest path to the POP, so we can walk
// "up" the (undirected) graph toward the cabinet to find cascade parents.
function bfsFromPop(adj, popId) {
  const parent = new Map();   // node -> parent toward POP
  const dist = new Map([[popId, 0]]);
  const queue = [popId];
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
  return { parent, dist };
}

// ── Main entry ───────────────────────────────────────────────────────────────
// Returns a result object (pure — does NOT mutate the store):
//   {
//     ok, reason,
//     consumerPorts: { 'aerialDrops:<id>': port, 'bundles:<id>': port },
//     splitterPorts: { '<jointOrCbtId>': feederPort },     // child→feeder port
//     splitterSummary: { '<id>': { has_splitter, split_ratio, fibre_in, fibre_out } },
//     assignments: [ record, … ],
//     log: [str], flags: [str],
//     stats: { splitters, terminals, feeders, assigned, spare, overcap },
//   }
export function assignFibres(store, opts = {}) {
  const log = [];
  const flags = [];
  const L = (m) => log.push(m);

  const cabinet = store.cabinet;
  if (!cabinet) {
    return emptyResult('No cabinet placed — nothing to assign.');
  }
  const popId = S(cabinet.properties.pop_id);

  // Node types across the graph.
  const nodeType = {};
  for (const c of store.cbts || [])   nodeType[S(c.properties.cbt_id)]   = 'CBT';
  for (const j of store.joints || []) nodeType[S(j.properties.joint_id)] = S(j.properties.joint_type) || 'SPLICE';
  nodeType[popId] = 'POP';

  // Consumer indexes.
  const dropsByCbt    = groupBy(store.aerialDrops || [], d => S(d.properties.from_cbt));
  const bundlesByJoint = groupBy(store.bundles || [],     b => S(b.properties.from_joint));

  // ── Declared splitters ─────────────────────────────────────────────────────
  // Every CBT is a terminal 1:8 splitter (that is what a CBT is). UG joints are
  // splitters only when has_splitter is set. split_ratio defaults to 1:8 for CBTs.
  const splitters = {};   // id -> ratio
  for (const c of store.cbts || []) {
    const id = S(c.properties.cbt_id);
    splitters[id] = S(c.properties.split_ratio) || '1:8';
  }
  for (const j of store.joints || []) {
    const id = S(j.properties.joint_id);
    if (j.properties.has_splitter === true || j.properties.has_splitter === 1 || j.properties.has_splitter === 'true') {
      splitters[id] = S(j.properties.split_ratio) || '1:8';
    }
  }

  // ── Auto-derive missing splitters from topology ────────────────────────────
  const adj = buildFibreGraph(store);
  const { parent, dist } = bfsFromPop(adj, popId);
  // The physical network owns explicit branch classification. Stage 1 consults
  // it so a port selected on a SPLITTER_OUTPUT segment is also the port written
  // into the logical cascade assignment (one source of truth).
  const classifiedNetwork = buildFibreNetwork(store);

  // Terminals = nodes with direct consumers.
  const terminals = {};   // id -> consumer count
  for (const id in nodeType) {
    if (id === popId) continue;
    const n = nodeType[id] === 'CBT'
      ? (dropsByCbt[id] || []).length
      : (bundlesByJoint[id] || []).length;
    if (n > 0) terminals[id] = n;
  }

  // out-neighbours = neighbours further from the POP (downstream).
  const outNeighbours = (node) => {
    const d = dist.get(node);
    if (d === undefined) return [];
    return (adj.get(node) || [])
      .map(e => e.to)
      .filter(to => (dist.get(to) ?? -1) > d);
  };
  const downstreamTerminals = (node) => {
    const found = new Set(), seen = new Set(), stack = [node];
    while (stack.length) {
      const x = stack.pop();
      if (seen.has(x)) continue;
      seen.add(x);
      if (terminals[x]) found.add(x);
      for (const t of outNeighbours(x)) stack.push(t);
    }
    return found;
  };

  // Feeders = non-terminal nodes with ≥2 downstream-terminal branches.
  const feeders = {};   // id -> downstream terminal count
  for (const id in nodeType) {
    if (terminals[id] || id === popId) continue;
    let termBranches = 0;
    for (const nb of outNeighbours(id)) if (downstreamTerminals(nb).size) termBranches++;
    if (termBranches >= 2) feeders[id] = downstreamTerminals(id).size;
  }

  // Fill in any splitter the designer did not explicitly declare.
  for (const [t, cons] of Object.entries(terminals)) {
    if (!splitters[t]) { splitters[t] = `1:${roundup(cons)}`; L(`Auto-derived terminal splitter ${t} = ${splitters[t]}`); }
  }
  for (const [f, tc] of Object.entries(feeders)) {
    if (!splitters[f]) { splitters[f] = `1:${roundup(tc)}`; L(`Auto-derived feeder splitter ${f} = ${splitters[f]}`); }
  }

  // ── Cascade parent finding ─────────────────────────────────────────────────
  // Walk from a splitter toward the POP; the first OTHER splitter found is its
  // parent feeder. Splitters with no upstream splitter are fed straight from the
  // cabinet (cascade root).
  const splitterSet = new Set(Object.keys(splitters));
  const traceUpToSplitter = (node) => {
    let cur = parent.get(node);
    const seen = new Set([node]);
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      if (splitterSet.has(cur)) return cur;
      cur = parent.get(cur);
    }
    return null;
  };

  // ── Build the result ───────────────────────────────────────────────────────
  const consumerPorts = {};
  const splitterPorts = {};
  const splitterSummary = {};
  const assignments = [];
  let counter = 0;
  const rec = (o) => { counter++; assignments.push({ assign_id: 'ASN-' + String(counter).padStart(4, '0'), ...o }); };

  let assigned = 0, spare = 0, overcap = 0;
  const logicalErrors = [];
  const expectedOutputPorts = new Map(); // child splitter -> canonical edge port

  // ── STAGE 1: feeder splitters (1:4) — allocate child terminals to ports ─────
  // Matches v2 exactly: the feeder's downstream child (a terminal joint OR a CBT)
  // is stored in the SPLITTER_OUTPUT record's bundle_id field, with a tube/fibre
  // number on the splitter's pigtail (splitter_id used as the synthetic cable_id).
  // The SPLITTER_INPUT is attributed to the real feeder cable arriving from the
  // POP side, and the remaining fibres on that cable are DARK_STORAGE at the joint.
  //
  // This is the upstream end of the CBT-tail feed: a 1:4 feeder joint that feeds a
  // CBT records SPLITTER_OUTPUT bundle_id=<cbtId>, exactly as it would for a
  // downstream UG terminal joint. (Confirmed against v2 TARVIN project: JNT-002-SP
  // PO3/PO4 → bundle_id CBT-001/CBT-002.)
  for (const [p, ratio] of Object.entries(splitters)) {
    if (capOf(ratio) !== 4) continue;
    const cap = 4;
    // children = downstream splitters (terminals OR any declared splitter, incl.
    // tail-fed CBTs that have no consumers yet) whose nearest upstream splitter is p.
    // Using splitterSet (not just terminals) means a CBT fed off this feeder is
    // found even before its drops are placed — matching v2 (PO3→CBT-001 etc.).
    const kids = [];
    for (const t of splitterSet) {
      if (t === p) continue;
      if (capOf(splitters[t]) === 4) continue;   // another feeder is not a child here
      if (traceUpToSplitter(t) === p) {
        const d = dist.get(t) ?? 9999;
        const status = statusOf(store, t);
        const storedPort = feederPortOf(store, t);
        const classified = splitterOutputForChild(classifiedNetwork, p, t);
        let port = storedPort;

        if (classified && Number.isInteger(classified.port)) {
          const prior = expectedOutputPorts.get(t);
          if (prior && (prior.parent !== p || prior.port !== classified.port || prior.edgeId !== classified.edgeId)) {
            logicalErrors.push({
              code: 'OUTPUT_CHILD_REUSE', id: classified.edgeId,
              message: `Downstream splitter ${t} is associated with more than one optical output (${prior.edgeId} and ${classified.edgeId}).`,
            });
          } else {
            expectedOutputPorts.set(t, { parent: p, edgeId: classified.edgeId, port: classified.port });
          }

          // Proposed assets are reconciled to the segment's canonical port.
          // Installed/live assets fail closed instead of being silently moved.
          if (storedPort != null && storedPort !== classified.port && FROZEN_STATES.has(status)) {
            logicalErrors.push({
              code: 'OUTPUT_FROZEN_PORT_CONFLICT', id: classified.edgeId,
              message: `Segment ${classified.edgeId} selects splitter port ${classified.port} for ${t}, but the ${status} asset is frozen on feeder_port ${storedPort}. Resolve the conflict explicitly.`,
            });
          } else {
            port = classified.port;
          }
        }

        kids.push({ asset: t, sortKey: [d, t], port, status });
      }
    }
    const { occupied, portOf, flags: f } = stickyAllocate(kids, cap);
    f.forEach(fl => { flags.push(`${p}: ${fl}`); });
    const spid = p + '-SP';

    // Resolve the feeder cable arriving at this joint from the cabinet side.
    const feederCable = feederCableInto(store, p, dist);
    const inCableId = feederCable ? feederCable.id : null;

    rec({
      cable_id: inCableId, splitter_id: spid, joint_id: p,
      fibre_role: 'SPLITTER_INPUT', port: 1,
      tube_number: 1, fibre_number: 1,
    });
    for (let pt = 1; pt <= cap; pt++) {
      if (occupied[pt] !== undefined) {
        const child = occupied[pt];
        splitterPorts[child] = pt;                 // child's feeder_port
        rec({
          splitter_id: spid, joint_id: p, fibre_role: 'SPLITTER_OUTPUT', port: pt,
          cable_id: spid,                          // synthetic splitter pigtail (v2 convention)
          bundle_id: child,                        // downstream child id (joint OR cbt) — v2 field
          downstream: child,                       // kept for web back-compat (feeder port grid)
          tube_number: tubeForFibre(pt), fibre_number: posInTube(pt),
        });
      } else {
        rec({ splitter_id: spid, joint_id: p, fibre_role: 'SPLITTER_OUTPUT_SPARE', port: pt });
      }
    }

    // NOTE (demand-driven through-splicing): the Stage-1 blanket
    // DARK_STORAGE emission for the feeder's input cable was a capacity-fill
    // artefact — it dark-stored "everything the feeder didn't use" off cable
    // capacity, not off downstream demand. Per the remediation spec §2 it stays
    // dropped here; physical dark storage is now owned by the demand-driven
    // planner (fibrePhysicalPlan.js). Splitter-port allocation (SPLITTER_INPUT /
    // SPLITTER_OUTPUT / SPARE above) is unaffected.

    splitterSummary[p] = mergeSummary(splitterSummary[p], {
      has_splitter: true, split_ratio: ratio, fibre_in: 1, fibre_out: Object.keys(portOf).length,
    });
    L(`Stage-1 feeder ${p} (${ratio}) → ${Object.keys(portOf).length}/${cap} ports`);
  }

  // Defence in depth: even if allocation logic changes later, never report a
  // validated run when the logical splice output disagrees with the explicitly
  // classified physical segment.
  for (const [child, expected] of expectedOutputPorts) {
    const actual = splitterPorts[child];
    if (actual !== expected.port) {
      logicalErrors.push({
        code: 'OUTPUT_LOGICAL_PORT_MISMATCH', id: expected.edgeId,
        message: `Segment ${expected.edgeId} selects splitter port ${expected.port} for ${child}, but logical allocation produced ${actual ?? '(unassigned)'}.`,
      });
    }
  }

  // ── STAGE 2: terminal splitters (1:8 etc.) — allocate consumers to ports ────
  for (const [sp, ratio] of Object.entries(splitters)) {
    if (capOf(ratio) === 4) continue;             // skip feeders
    const isCbt = nodeType[sp] === 'CBT';
    const cap = capOf(ratio, 8);

    const consumerFeatures = isCbt ? (dropsByCbt[sp] || []) : (bundlesByJoint[sp] || []);
    const idField = isCbt ? 'adrop_id' : 'bundle_id';
    const collection = isCbt ? 'aerialDrops' : 'bundles';

    const cons = consumerFeatures.map(f => ({
      asset: S(f.properties[idField]),
      sortKey: S(f.properties[idField]) || '',
      port: intOrNull(f.properties.splitter_port),
      status: S(f.properties.status) || 'PROPOSED',
    }));

    const { occupied, portOf, flags: f } = stickyAllocate(cons, cap);
    f.forEach(fl => { flags.push(`${sp}: ${fl}`); if (fl.startsWith('OVERCAP')) overcap++; });

    const spid = sp + '-SP';
    rec({ splitter_id: spid, joint_id: sp, fibre_role: 'SPLITTER_INPUT', port: 1 });

    for (let p = 1; p <= cap; p++) {
      if (occupied[p] !== undefined) {
        const asset = occupied[p];
        consumerPorts[`${collection}:${asset}`] = p;
        assigned++;
        rec({ splitter_id: spid, joint_id: sp, fibre_role: 'SPLITTER_OUTPUT', port: p,
              bundle_id: asset, tube_number: tubeForFibre(p), fibre_number: posInTube(p) });
      } else {
        spare++;
        rec({ splitter_id: spid, joint_id: sp, fibre_role: 'SPLITTER_OUTPUT_SPARE', port: p });
      }
    }

    splitterSummary[sp] = mergeSummary(splitterSummary[sp], {
      has_splitter: true, split_ratio: ratio, fibre_in: 1, fibre_out: Object.keys(portOf).length,
    });
    L(`Stage-2 ${isCbt ? 'CBT' : 'joint'} ${sp} (${ratio}) → ${Object.keys(portOf).length}/${cap} ports`);
  }

  // ── STAGE 3: demand-driven physical fibre plan ──────────────────────────────
  // The capacity-fill Stage 3 has been replaced by the demand-driven physical
  // planner (fibreNetwork -> fibreDemand -> fibrePhysicalPlan -> fibrePlanValidation,
  // orchestrated by planPhysicalFibres). It runs as a separate, validated pass and
  // is NEVER mixed into the logical splitter-port records above. Its output is
  // returned as `physicalAssignments` and is authoritative only when its
  // validation passes (physicalPlanStatus === 'VALIDATED').
  const physical = planPhysicalFibres(store, {
    profile: opts.profile,
    existingAssignments: (store.physicalAssignments && store.physicalAssignments.length)
      ? store.physicalAssignments : store.fibreAssignments,
  });
  if (logicalErrors.length) {
    physical.errors = [...(physical.errors || []), ...logicalErrors];
    physical.ok = false;
    physical.status = 'INVALID';
  }
  L(`Physical plan: ${physical.status}` + (physical.errors && physical.errors.length ? ` (${physical.errors.length} issue(s))` : ''));

  const stats = {
    splitters: Object.keys(splitters).length,
    terminals: Object.keys(terminals).length,
    feeders: Object.keys(feeders).length,
    assigned, spare, overcap,
  };
  L(`Done — ${stats.splitters} splitters, ${assigned} consumers assigned, ${spare} spare ports, ${overcap} over-capacity.`);

  // Logical (splitter-port) records and physical (raw-fibre) records are kept in
  // separate, explicitly-typed arrays so the two layers can never be confused
  // (remediation spec §12). `assignments` remains the logical layer for existing
  // consumers; `physicalAssignments` carries the validated physical plan.
  const logicalAssignments = assignments.map(a => ({ ...a, plan_layer: 'LOGICAL' }));
  const physicalAssignments = (physical.records || []).map(a => ({ ...a, plan_layer: 'PHYSICAL' }));
  return {
    ok: true, reason: 'Assigned.',
    consumerPorts, splitterPorts, splitterSummary,
    assignments: logicalAssignments,
    logicalAssignments,
    physicalAssignments,
    physicalPlan: { status: physical.status, errors: physical.errors || [] },
    log, flags, stats,
    // Physical plan is authoritative only when it validated. Otherwise ports are
    // still trustworthy but the raw-fibre plan stays gated (PORTS_ONLY).
    assignmentMode: physical.status === 'VALIDATED' ? 'FULL' : 'PORTS_ONLY',
    physicalPlanStatus: physical.status,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function intOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}
function statusOf(store, jointOrCbtId) {
  for (const j of store.joints || []) if (S(j.properties.joint_id) === jointOrCbtId) return S(j.properties.status) || 'PROPOSED';
  for (const c of store.cbts || [])   if (S(c.properties.cbt_id)   === jointOrCbtId) return S(c.properties.status) || 'PROPOSED';
  return 'PROPOSED';
}
function feederPortOf(store, jointOrCbtId) {
  for (const j of store.joints || []) if (S(j.properties.joint_id) === jointOrCbtId) return intOrNull(j.properties.feeder_port);
  for (const c of store.cbts || [])   if (S(c.properties.cbt_id)   === jointOrCbtId) return intOrNull(c.properties.feeder_port);
  return null;
}

// Return the explicit optical-output edge whose downstream branch first reaches
// `childId`. Traversal stops at the first splitter on each branch, so a segment
// cannot be associated with a more distant splitter through another splitter.
function splitterOutputForChild(network, parentId, childId) {
  if (!network || !network.root) return null;
  const matches = [];
  for (const edge of (network.outEdges.get(parentId) || [])) {
    if (edge.feedMode !== 'SPLITTER_OUTPUT' || edge.feedModeInferred) continue;
    if (edge.splitterId !== `${parentId}-SP`) continue;
    const children = firstDownstreamSplitters(network, edge.to);
    if (children.has(childId)) matches.push({ edgeId: edge.id, port: edge.splitterPort });
  }
  return matches.length === 1 ? matches[0] : null;
}

function firstDownstreamSplitters(network, startId) {
  const found = new Set();
  const seen = new Set();
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    const node = network.nodes.get(id);
    if (node && node.hasSplitter) {
      found.add(id);
      continue;
    }
    for (const edge of (network.outEdges.get(id) || [])) queue.push(edge.to);
  }
  return found;
}
function mergeSummary(existing, add) { return { ...(existing || {}), ...add }; }

// Find the cable arriving at `jointId` from the cabinet side — i.e. the cable
// whose other end is closer to the POP (lower BFS distance). This is the feeder
// splitter's input cable. Returns { id, fibre_count } or null.
function feederCableInto(store, jointId, dist) {
  const jid = String(jointId);
  const dJoint = dist.get(jid) ?? 9999;
  let best = null;
  for (const c of store.cables || []) {
    const fn = String(c.properties.from_node ?? '');
    const tn = String(c.properties.to_node ?? '');
    let other = null;
    if (fn === jid) other = tn;
    else if (tn === jid) other = fn;
    else continue;
    const dOther = dist.get(other) ?? 9999;
    if (dOther < dJoint) {
      const fc = parseInt(c.properties.fibre_count, 10) || 0;
      // Prefer the highest-fibre feeder if several arrive.
      if (!best || fc > best.fibre_count) {
        best = { id: String(c.properties.cable_id), fibre_count: fc };
      }
    }
  }
  return best;
}

function emptyResult(reason) {
  return {
    ok: false, reason,
    consumerPorts: {}, splitterPorts: {}, splitterSummary: {},
    assignments: [], logicalAssignments: [], physicalAssignments: [],
    physicalPlan: { status: 'UNVERIFIED', errors: [] },
    log: [reason], flags: [],
    stats: { splitters: 0, terminals: 0, feeders: 0, assigned: 0, spare: 0, overcap: 0 },
    assignmentMode: 'PORTS_ONLY',
    physicalPlanStatus: 'UNVERIFIED',
  };
}
