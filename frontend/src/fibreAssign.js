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
  for (const [p, ratio] of Object.entries(splitters)) {
    if (capOf(ratio) !== 4) continue;
    const cap = 4;
    // children = terminal splitters whose nearest upstream splitter is p
    const kids = [];
    for (const t of Object.keys(terminals)) {
      if (t === p) continue;
      if (traceUpToSplitter(t) === p) {
        const d = dist.get(t) ?? 9999;
        kids.push({ asset: t, sortKey: [d, t], port: feederPortOf(store, t), status: statusOf(store, t) });
      }
    }
    const { occupied, portOf, flags: f } = stickyAllocate(kids, cap);
    f.forEach(fl => { flags.push(`${p}: ${fl}`); });
    const spid = p + '-SP';
    rec({ cable_id: null, splitter_id: spid, joint_id: p, fibre_role: 'SPLITTER_INPUT', port: 1 });
    for (let pt = 1; pt <= cap; pt++) {
      if (occupied[pt] !== undefined) {
        const child = occupied[pt];
        splitterPorts[child] = pt;                 // child's feeder_port
        rec({ splitter_id: spid, joint_id: p, fibre_role: 'SPLITTER_OUTPUT', port: pt, downstream: child });
      } else {
        rec({ splitter_id: spid, joint_id: p, fibre_role: 'SPLITTER_OUTPUT_SPARE', port: pt });
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

function emptyResult(reason) {
  return {
    ok: false, reason,
    consumerPorts: {}, splitterPorts: {}, splitterSummary: {},
    assignments: [], log: [reason], flags: [],
    stats: { splitters: 0, terminals: 0, feeders: 0, assigned: 0, spare: 0, overcap: 0 },
  };
}
