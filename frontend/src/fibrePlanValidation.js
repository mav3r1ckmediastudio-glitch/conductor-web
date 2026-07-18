// fibrePlanValidation.js — Enforce the mandatory plan invariants (spec §10)
// before a physical plan may be treated as authoritative / saved.
//
// A validation failure means the plan is NOT authoritative: callers must not
// mark physicalPlanStatus VALIDATED and must not persist the physical records
// as trusted (spec §10 last bullet, §12).
//
// Invariants checked (spec §10):
//   • used + dark = capacity, per segment (each fibre 1..cap accounted once).
//   • No incoming fibre is used more than once at a segment end.
//   • No active fibre number exceeds the segment capacity.
//   • No fibre is both active and dark at the same segment end.
//   • Every through-splice references two real fibre-bearing segments.
//   • Every demanded terminal has a complete route to the POP (was fed).
//   • Every splitter-output branch is explicitly identified (feed_mode set).
//   • Every SPLITTER_OUTPUT leg is a real, uniquely-ported output of an actual
//     upstream splitter (upstream hasSplitter, matching splitter_id, an integer
//     port within the splitter ratio, no two legs sharing a port). A fabricated
//     SPLITTER_OUTPUT — e.g. a POP feeder marked optical — otherwise suppresses
//     the raw-input requirement and validates an unbuildable plan (release blocker).

import { splitterIdFor } from './splitterId.js';

const FPT = 12;
function absOf(r) {
  if (r.abs != null) return r.abs;
  const t = parseInt(r.tube_number, 10), f = parseInt(r.fibre_number, 10);
  if (Number.isFinite(t) && Number.isFinite(f)) return (t - 1) * FPT + f;
  return null;
}
function S(v) { return (v === null || v === undefined || v === '') ? null : String(v); }

// validatePhysicalPlan(network, demandPlan, records) →
//   { ok, errors: [{code,message,id?}] }
export function validatePhysicalPlan(network, demandPlan, records) {
  const errors = [];
  const add = (code, message, id) => errors.push({ code, message, id });

  const capOf = new Map(network.edges.map(e => [e.id, e.capacity]));
  const realSeg = new Set(network.edges.map(e => e.id));

  const active = new Map();  // seg -> Set<abs>
  const dark = new Map();    // seg -> Set<abs>
  const A = (seg) => active.get(seg) || active.set(seg, new Set()).get(seg);
  const D = (seg) => dark.get(seg) || dark.set(seg, new Set()).get(seg);

  const endUse = new Map();
  const bumpEnd = (seg, joint, abs) => {
    const k = seg + '|' + joint;
    if (!endUse.has(k)) endUse.set(k, new Map());
    const m = endUse.get(k);
    m.set(abs, (m.get(abs) || 0) + 1);
  };

  const outUse = new Map(); // (to|outAbs) -> count
  const bumpOut = (to, abs) => {
    const k = to + '|' + abs;
    outUse.set(k, (outUse.get(k) || 0) + 1);
  };

  for (const r of records) {
    const seg = S(r.cable_id);
    if (r.fibre_role === 'SPLITTER_INPUT') {
      const a = absOf(r); if (a == null || !seg) continue;
      A(seg).add(a); bumpEnd(seg, S(r.joint_id), a);
      if (a > (capOf.get(seg) ?? Infinity)) add('OVER_CAP', `Splitter-input fibre ${a} exceeds capacity of ${seg}.`, seg);
    } else if (r.fibre_role === 'THROUGH_SPLICE') {
      const a = absOf(r); const to = S(r.splice_to_cable);
      const outAbs = (parseInt(r.splice_to_tube, 10) - 1) * FPT + parseInt(r.splice_to_fibre, 10);
      if (seg) { A(seg).add(a); bumpEnd(seg, S(r.joint_id), a); if (a > (capOf.get(seg) ?? Infinity)) add('OVER_CAP', `Through fibre ${a} exceeds capacity of ${seg}.`, seg); }
      if (to) { A(to).add(outAbs); if (Number.isFinite(outAbs)) bumpOut(to, outAbs); if (outAbs > (capOf.get(to) ?? Infinity)) add('OVER_CAP', `Through fibre ${outAbs} exceeds capacity of onward ${to}.`, to); }
      if (!seg || !realSeg.has(seg)) add('THROUGH_UNREAL', `Through-splice references non-existent segment ${seg}.`, seg);
      if (!to || !realSeg.has(to)) add('THROUGH_UNREAL', `Through-splice references non-existent onward segment ${to}.`, to);
    } else if (r.fibre_role === 'DARK_STORAGE') {
      if (!seg) continue;
      const list = Array.isArray(r.dark_abs) ? r.dark_abs : [];
      for (const a of list) D(seg).add(a);
    }
  }

  for (const [k, m] of endUse) for (const [abs, n] of m) if (n > 1) add('REUSE', `Fibre ${abs} is used ${n} times at segment end ${k}.`, k);

  for (const [k, n] of outUse) {
    if (n <= 1) continue;
    const [to, abs] = k.split('|');
    add('OUT_REUSE', `Onward fibre ${abs} on ${to} is claimed by ${n} through-splices.`, to);
  }

  for (const e of network.edges) {
    const act = active.get(e.id) || new Set();
    const drk = dark.get(e.id) || new Set();
    for (const a of act) if (drk.has(a)) add('ACTIVE_AND_DARK', `Fibre ${a} on ${e.id} is both active and dark.`, e.id);
    if (act.size || drk.size) {
      const accounted = act.size + [...drk].filter(a => !act.has(a)).length;
      if (accounted !== e.capacity) add('CONSERVATION', `Segment ${e.id}: used+dark=${accounted} but capacity=${e.capacity}.`, e.id);
    }
  }

  const fed = new Set(records.filter(r => r.fibre_role === 'SPLITTER_INPUT').map(r => S(r.joint_id)));
  for (const node of network.nodes.values()) {
    if (!node.hasSplitter) continue;
    const ins = network.inEdges.get(node.id) || [];
    const opticallyFed = ins.length > 0 && ins.every(e => e.feedMode === 'SPLITTER_OUTPUT');
    if (opticallyFed) continue;
    if (!fed.has(node.id)) add('UNFED_TERMINAL', `Splitter ${node.id} has no validated input fibre / route to the POP.`, node.id);
  }

  for (const e of network.edges) if (!e.feedMode) add('UNCLASSIFIED_BRANCH', `Segment ${e.id} has no feed_mode classification.`, e.id);

  for (const e of network.edges) {
    const up = network.nodes.get(e.from);
    if (e.feedModeInferred && up && up.hasSplitter) {
      add('INFERRED_CLASSIFICATION', `Branch ${e.id} leaves splitter ${e.from} with an inferred feed_mode. Set feed_mode (PASS_THROUGH or SPLITTER_OUTPUT) explicitly before this plan can be validated.`, e.id);
    }
  }

  // Every SPLITTER_OUTPUT leg must be a physically real optical output of an
  // actual upstream splitter (release blocker: without this an explicit
  // feed_mode:SPLITTER_OUTPUT is trusted blindly — e.g. a POP feeder marked as an
  // optical leg with a fabricated splitter_id and no port — which exempts the
  // downstream terminal from its raw-input requirement and yields an exportable
  // VALIDATED plan with no fibres). Prove the premises and fail closed. The
  // splitter for node X is identified as X-SP (the convention written by the
  // creation forms and the resolution panel, and read by defaultFeedMode).
  const portUse = new Map(); // (splitterId|port) -> [edgeId, ...]
  const childUse = new Map(); // downstream child splitter -> [edgeId, ...]
  for (const e of network.edges) {
    if (e.feedMode !== 'SPLITTER_OUTPUT') continue;
    const up = network.nodes.get(e.from);
    if (!up || !up.hasSplitter) {
      add('OUTPUT_WITHOUT_SPLITTER', `Segment ${e.id} is classified SPLITTER_OUTPUT but its upstream node ${e.from} has no splitter — an optical output leg must leave a splitter.`, e.id);
      continue;
    }
    const expectId = splitterIdFor(e.from);
    if (!e.splitterId || e.splitterId !== expectId) {
      add('OUTPUT_SPLITTER_MISMATCH', `Segment ${e.id}: SPLITTER_OUTPUT splitter_id ${e.splitterId ?? '(none)'} does not identify the upstream splitter ${expectId}.`, e.id);
    }
    if (!Number.isInteger(e.splitterPort)) {
      add('OUTPUT_PORT_MISSING', `Segment ${e.id} is a SPLITTER_OUTPUT leg but has no integer splitter_port.`, e.id);
      continue;
    }
    const outCap = Number.isFinite(up.cap) ? up.cap : 0;
    if (e.splitterPort < 1 || e.splitterPort > outCap) {
      add('OUTPUT_PORT_RANGE', `Segment ${e.id}: splitter_port ${e.splitterPort} is outside the 1..${outCap} range of splitter ${expectId} (${up.ratio || '1:?'}).`, e.id);
    }
    const key = expectId + '|' + e.splitterPort;
    (portUse.get(key) || portUse.set(key, []).get(key)).push(e.id);

    // An optical output must feed exactly one next splitter/CBT. Walk only
    // downstream and stop at the first splitter on each branch; this permits a
    // pass-through segment between the output leg and its terminal while still
    // rejecting dead or branching optical legs.
    const children = firstDownstreamSplitters(network, e.to);
    if (children.size === 0) {
      add('OUTPUT_CHILD_MISSING', `Segment ${e.id} is a SPLITTER_OUTPUT leg but its downstream branch reaches no splitter/CBT.`, e.id);
    } else if (children.size > 1) {
      add('OUTPUT_CHILD_AMBIGUOUS', `Segment ${e.id} reaches multiple next splitters (${[...children].join(', ')}). One optical output must feed exactly one downstream child.`, e.id);
    } else {
      const child = [...children][0];
      (childUse.get(child) || childUse.set(child, []).get(child)).push(e.id);
    }
  }
  for (const [key, ids] of portUse) {
    if (ids.length <= 1) continue;
    const [sid, port] = key.split('|');
    add('OUTPUT_PORT_REUSE', `Splitter ${sid} port ${port} is claimed by ${ids.length} output legs (${ids.join(', ')}). Each optical output must use a distinct port.`, ids[0]);
  }
  for (const [child, ids] of childUse) {
    if (ids.length <= 1) continue;
    add('OUTPUT_CHILD_REUSE', `Downstream splitter ${child} is claimed by multiple optical outputs (${ids.join(', ')}).`, ids[0]);
  }

  for (const e of network.edges) {
    if (e.feedMode !== 'PASS_THROUGH') continue;
    if (!network.dist.has(e.to)) continue;
    const touched = (active.get(e.id) && active.get(e.id).size) || (dark.get(e.id) && dark.get(e.id).size);
    if (!touched) add('INCOMPLETE_SEGMENT', `Pass-through segment ${e.id} is neither spliced nor dark-stored — its fibres are unaccounted for.`, e.id);
  }

  for (const er of (network.errors || [])) add(er.code, er.message, er.id);
  for (const er of (demandPlan.errors || [])) add(er.code, er.message, er.id);

  return { ok: errors.length === 0, errors };
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
