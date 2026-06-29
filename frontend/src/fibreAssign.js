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
export function assignFibres(store) {
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
        kids.push({ asset: t, sortKey: [d, t], port: feederPortOf(store, t), status: statusOf(store, t) });
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

    // Dark-store the remaining fibres on the feeder's input cable (the feeder uses
    // exactly 1 input fibre; the rest of the cable terminates dark at this joint).
    if (feederCable && feederCable.fibre_count > 1) {
      const byTube = {};
      for (let abs = 2; abs <= feederCable.fibre_count; abs++) {
        const t = tubeForFibre(abs);
        (byTube[t] = byTube[t] || []).push(posInTube(abs));
      }
      for (const [t, fibs] of Object.entries(byTube)) {
        rec({
          cable_id: feederCable.id, joint_id: p, fibre_role: 'DARK_STORAGE',
          tube_number: parseInt(t, 10), fibre_number: fibs[0], dark_count: fibs.length,
        });
      }
    }

    splitterSummary[p] = mergeSummary(splitterSummary[p], {
      has_splitter: true, split_ratio: ratio, fibre_in: 1, fibre_out: Object.keys(portOf).length,
    });
    L(`Stage-1 feeder ${p} (${ratio}) → ${Object.keys(portOf).length}/${cap} ports`);
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

  // ── STAGE 3: cable/span fibre numbering → THROUGH_SPLICE + DARK_STORAGE ──────
  // Walk every cable and aerial span. At each end-node, determine which fibres are
  // consumed by splitter inputs at that node. The remaining fibres pass straight
  // through (THROUGH_SPLICE pairs) or are unused (DARK_STORAGE).
  //
  // Fibre consumption model (faithful to v2):
  //   • Each splitter at a node consumes exactly 1 fibre on the incoming cable.
  //   • Fibres are consumed in order starting at absolute fibre 1 (T1 F1, T1 F2 …).
  //   • A 1:4 feeder splitter and a 1:8 terminal each consume 1 fibre.
  //   • A THROUGH_SPLICE pairs from_cable[T,F] ↔ to_cable[T,F] for every fibre
  //     that passes through the joint without being consumed.
  //
  // We need a cable adjacency: per node, which cables/spans attach to it.
  const cablesByNode = {};   // nodeId -> [{ id, fibre_count, isSpan }]
  const segInfo = {};        // id -> { fibre_count, from_node, to_node }

  for (const c of store.cables || []) {
    const id = S(c.properties.cable_id); if (!id) continue;
    const fn = S(c.properties.from_node), tn = S(c.properties.to_node);
    const fc = parseInt(c.properties.fibre_count, 10) || 0;
    segInfo[id] = { fibre_count: fc, from_node: fn, to_node: tn, isSpan: false };
    if (fn) { (cablesByNode[fn] = cablesByNode[fn] || []).push({ id, fibre_count: fc, isSpan: false }); }
    if (tn) { (cablesByNode[tn] = cablesByNode[tn] || []).push({ id, fibre_count: fc, isSpan: false }); }
  }
  for (const s of store.spans || []) {
    const id = S(s.properties.span_id); if (!id) continue;
    const fn = S(s.properties.from_node), tn = S(s.properties.to_node);
    const fc = parseInt(s.properties.fibre_count, 10) || 0;
    segInfo[id] = { fibre_count: fc, from_node: fn, to_node: tn, isSpan: true };
    if (fn) { (cablesByNode[fn] = cablesByNode[fn] || []).push({ id, fibre_count: fc, isSpan: true }); }
    if (tn) { (cablesByNode[tn] = cablesByNode[tn] || []).push({ id, fibre_count: fc, isSpan: true }); }
  }

  // CBT tails — the fibre feed from a parent JOINT up the pole chain to a CBT.
  // A CBT's splitter input arrives on its tail, NOT on a cable/span. The tail
  // carries the splitter feed (1 fibre for a 1:8 terminal at the CBT). Index by
  // CBT so we can attribute each CBT's SPLITTER_INPUT to its own tail.
  const tailByCbt = {};   // cbtId -> { id, fibre_count, to_joint }
  for (const t of store.cbtTails || []) {
    const tailId = S(t.properties.tail_id) || S(t.properties.cbttail_id) || S(t.properties.id) || `TAIL-${S(t.properties.from_cbt)}`;
    const cbtId  = S(t.properties.from_cbt);
    const joint  = S(t.properties.to_joint);
    // A 1:8 CBT terminal needs a single feed fibre up the tail. Default 1 if unset.
    const fc = parseInt(t.properties.fibre_count, 10) || 1;
    if (cbtId) {
      tailByCbt[cbtId] = { id: tailId, fibre_count: fc, to_joint: joint };
    }
  }

  // Count splitter inputs consumed at each node (each splitter = 1 fibre in).
  const splitterInputsAtNode = {};   // nodeId -> count
  for (const id of splitterSet) {
    splitterInputsAtNode[id] = (splitterInputsAtNode[id] || 0) + 1;
  }

  // ── CBT splitter inputs arrive via the tail ────────────────────────────────
  // Emit a SPLITTER_INPUT record for every CBT, attributed to its tail (so the
  // splice plan shows "Input fibre: T1 F1 on <tail>"). The CBT consumes its feed
  // off the tail, so we mark the CBT node as NOT additionally consuming a fibre
  // off any span (its span/riser carries the tail through, not a separate feed).
  const cbtFedByTail = new Set();
  for (const c of store.cbts || []) {
    const cbtId = S(c.properties.cbt_id);
    if (!cbtId || !splitterSet.has(cbtId)) continue;
    const tail = tailByCbt[cbtId];
    if (tail) {
      rec({
        cable_id: tail.id, joint_id: cbtId,
        fibre_role: 'SPLITTER_INPUT',
        tube_number: 1, fibre_number: 1,
        splitter_id: cbtId + '-SP',
      });
      cbtFedByTail.add(cbtId);
    }
  }

  // For each cable/span, pair up the two ends and emit splice records.
  // The node closer to the POP is the "in" end; further is the "out" end.
  const processedSegs = new Set();
  for (const [segId, info] of Object.entries(segInfo)) {
    if (processedSegs.has(segId)) continue;
    processedSegs.add(segId);

    const { fibre_count: fc, from_node: fn, to_node: tn, isSpan } = info;
    if (!fc || !fn || !tn) continue;

    // Determine which end is closer to the POP (lower dist = toward cabinet).
    const dFrom = dist.get(fn) ?? 9999;
    const dTo   = dist.get(tn) ?? 9999;
    const inNode  = dFrom < dTo ? fn : tn;   // cabinet side
    const outNode = dFrom < dTo ? tn : fn;   // premises side

    // If the downstream end is a 1:4 feeder splitter, Stage 1 already fully
    // accounts for this cable (1 input fibre + dark storage at the feeder joint).
    // Skip it here to avoid double-emitting SPLITTER_INPUT / DARK_STORAGE.
    if (splitters[outNode] && capOf(splitters[outNode]) === 4) continue;

    // A cable feeds INTO the splitter at its downstream (out) end — that splitter
    // consumes 1 input fibre off this cable. The splitter at the IN end (if any)
    // treats this cable as an OUTPUT leg, not an input, so it consumes nothing here.
    // Terminal (1:8) splitters fed by a tail consume via the tail, not this cable.
    const outIsSplitter = !!splitters[outNode] && !cbtFedByTail.has(outNode);
    const consumedOut = outIsSplitter ? 1 : 0;

    // Emit the splitter input fibre (F1 of this cable) for the downstream splitter.
    let fibrePointer = 1;
    for (let i = 0; i < consumedOut; i++, fibrePointer++) {
      const tube = tubeForFibre(fibrePointer);
      const pos  = posInTube(fibrePointer);
      rec({
        cable_id: segId, joint_id: outNode,
        fibre_role: 'SPLITTER_INPUT',
        tube_number: tube, fibre_number: pos,
        splitter_id: outNode + '-SP',
      });
    }

    // For this cable, find what other cable/span it pairs with at the out-node
    // (the joint that splices it to the next segment toward premises).
    // THROUGH_SPLICE: remaining fibres (fibrePointer..fc) pair identically on both cables.
    // We emit one THROUGH_SPLICE per fibre that BOTH cables can carry — the
    // pass-through is limited by the smaller cable. Fibres on the larger cable
    // beyond the partner's capacity become dark storage at this joint.
    const partnersAtOut = (cablesByNode[outNode] || []).filter(c => c.id !== segId);
    // Use the first partner (highest fibre count wins if tie).
    const partner = partnersAtOut.sort((a, b) => b.fibre_count - a.fibre_count)[0];

    // The number of fibres that can pass through = min(this remaining, partner cap).
    const passThroughLimit = partner ? Math.min(fc, partner.fibre_count) : fc;

    for (let abs = fibrePointer; abs <= passThroughLimit; abs++) {
      const tube = tubeForFibre(abs);
      const pos  = posInTube(abs);
      if (partner) {
        // Only emit once (from this cable's perspective); avoid duplicate if we
        // process the partner later. Track by sorted pair.
        const pairKey = [segId, partner.id].sort().join('|') + '|' + abs;
        if (!processedSegs.has(pairKey)) {
          processedSegs.add(pairKey);
          rec({
            cable_id: segId, joint_id: outNode,
            fibre_role: 'THROUGH_SPLICE',
            tube_number: tube, fibre_number: pos,
            splice_to_cable: partner.id,
            splice_to_tube: tube, splice_to_fibre: pos,
          });
        }
      }
    }

    // DARK_STORAGE:
    //   • Terminal segment (no partner): all fibres after the consumed ones.
    //   • Mismatched splice: fibres on the larger cable beyond the partner cap.
    const darkStart = partner ? passThroughLimit + 1 : fibrePointer;
    if (darkStart <= fc) {
      const byTube = {};
      for (let abs = darkStart; abs <= fc; abs++) {
        const t = tubeForFibre(abs);
        (byTube[t] = byTube[t] || []).push(posInTube(abs));
      }
      for (const [t, fibs] of Object.entries(byTube)) {
        rec({
          cable_id: segId, joint_id: outNode,
          fibre_role: 'DARK_STORAGE',
          tube_number: parseInt(t, 10),
          fibre_number: fibs[0],
          dark_count: fibs.length,
        });
      }
    }
  }

  const stats = {
    splitters: Object.keys(splitters).length,
    terminals: Object.keys(terminals).length,
    feeders: Object.keys(feeders).length,
    assigned, spare, overcap,
  };
  L(`Done — ${stats.splitters} splitters, ${assigned} consumers assigned, ${spare} spare ports, ${overcap} over-capacity.`);

  return { ok: true, reason: 'Assigned.', consumerPorts, splitterPorts, splitterSummary, assignments, log, flags, stats };
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
    assignments: [], log: [reason], flags: [],
    stats: { splitters: 0, terminals: 0, feeders: 0, assigned: 0, spare: 0, overcap: 0 },
  };
}
