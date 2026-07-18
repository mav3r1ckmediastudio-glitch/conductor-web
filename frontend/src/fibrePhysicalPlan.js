// fibrePhysicalPlan.js — Second pass: deterministic raw-fibre allocation.
//
// Remediation spec §7. Runs AFTER the demand pass has validated. Walks the
// oriented graph from the POP and, for each incoming fibre-bearing segment,
// allocates its fibres to exactly one of:
//   • SPLITTER_INPUT  — the one raw fibre feeding a local splitter at the node.
//   • THROUGH_SPLICE  — a raw fibre passing to a downstream PASS_THROUGH branch.
//   • DARK_STORAGE    — every remaining fibre (the correct, demand-driven dark).
// Optical splitter-OUTPUT legs are NOT raw fibres and are not allocated here
// (they are logical splitter-port records handled by fibreAssign's Stage 1/2).
//
// Numbering profile (spec §9) — default COLOUR_PRESERVING per Gigaloch Master
// Fibre Design Policy §4 ("like-to-like throughout a straight line; colour
// jumping at junctions is prohibited"): a through fibre keeps its number/colour
// (incoming F2 → onward F2). COMPACT_OUTBOUND is available as an explicit
// alternative profile (incoming F2 → onward F1).
//
// Determinism (spec §11): PASS_THROUGH branches are processed in a stable order
// (by segment id) and fibres are always drawn lowest-first, so repeat runs are
// identical. Installed/frozen fibres are pinned first and never renumbered.

import { splitterIdFor } from './splitterId.js';

const FPT = 12; // fibres per tube (IEC)
function tubeForFibre(n) { return Math.floor((n - 1) / FPT) + 1; }
function posInTube(n) { return ((n - 1) % FPT) + 1; }
function S(v) { return (v === null || v === undefined || v === '') ? null : String(v); }

export const PROFILE_COLOUR_PRESERVING = 'COLOUR_PRESERVING';
export const PROFILE_COMPACT_OUTBOUND = 'COMPACT_OUTBOUND';
const FROZEN_STATES = new Set(['INSTALLED', 'LIVE']);

// Map incoming through-fibre numbers to outgoing numbers per profile.
function mapProfile(inFibres, profile) {
  if (profile === PROFILE_COMPACT_OUTBOUND) return inFibres.map((_, i) => i + 1);
  return inFibres.slice(); // COLOUR_PRESERVING: same number/colour
}

// Build frozen pins from prior INSTALLED/LIVE assignment records, keyed by the
// segment they sit on so we never renumber installed physical fibres.
function buildFrozenPins(existing) {
  const pins = new Map(); // segId -> { tap:Set<abs>, through: Map<toCable, Set<abs>> }
  for (const r of existing || []) {
    const status = S(r.status);
    if (!(FROZEN_STATES.has(status) || r.frozen === true)) continue;
    const seg = S(r.cable_id); if (!seg) continue;
    const abs = absOf(r);
    if (abs == null) continue;
    if (!pins.has(seg)) pins.set(seg, { tap: new Set(), through: new Map() });
    const p = pins.get(seg);
    if (r.fibre_role === 'SPLITTER_INPUT') p.tap.add(abs);
    else if (r.fibre_role === 'THROUGH_SPLICE') {
      const to = S(r.splice_to_cable) || '_';
      const outAbs = outAbsOf(r);
      if (!p.through.has(to)) p.through.set(to, []);
      // Preserve BOTH the incoming AND outgoing fibre number of a frozen
      // through-splice (release-audit P1), so a compact frozen mapping is never
      // silently renumbered on a later run.
      p.through.get(to).push({ in: abs, out: outAbs != null ? outAbs : abs });
    }
  }
  return pins;
}
function outAbsOf(r) {
  const t = parseInt(r.splice_to_tube, 10), f = parseInt(r.splice_to_fibre, 10);
  if (Number.isFinite(t) && Number.isFinite(f)) return (t - 1) * FPT + f;
  return null;
}
function absOf(r) {
  if (r.abs != null) return r.abs;
  const t = parseInt(r.tube_number, 10), f = parseInt(r.fibre_number, 10);
  if (Number.isFinite(t) && Number.isFinite(f)) return (t - 1) * FPT + f;
  return null;
}

// allocatePhysicalFibres(network, demandPlan, opts) →
//   { ok, errors, records }
export function allocatePhysicalFibres(network, demandPlan, opts = {}) {
  const profile = opts.profile || PROFILE_COLOUR_PRESERVING;
  const pins = buildFrozenPins(opts.existingAssignments);
  const errors = [];
  const records = [];
  let counter = 0;
  const rec = (o) => { counter++; records.push({ assign_id: 'PHY-' + String(counter).padStart(4, '0'), ...o }); };

  const emitDark = (segId, joint, absList) => {
    if (!absList.length) return;
    const byTube = {};
    for (const a of absList) (byTube[tubeForFibre(a)] = byTube[tubeForFibre(a)] || []).push(posInTube(a));
    const darkAbs = absList.slice().sort((a, b) => a - b);
    for (const t of Object.keys(byTube).map(Number).sort((x, y) => x - y)) {
      rec({ cable_id: segId, joint_id: joint, fibre_role: 'DARK_STORAGE', tube_number: t, fibre_number: byTube[t][0], dark_count: byTube[t].length, dark_abs: darkAbs.filter(a => tubeForFibre(a) === t) });
    }
  };

  const passChildren = (nodeId) =>
    (network.outEdges.get(nodeId) || [])
      .filter(e => e.feedMode === 'PASS_THROUGH')
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const seen = new Set();

  // Allocate the fibres of `incomingEdge` as they enter `nodeId`.
  // `available` is a sorted-ascending array of fibre numbers on incomingEdge.
  function allocateAt(nodeId, incomingEdge, available) {
    if (seen.has(incomingEdge.id + '>' + nodeId)) return; // safety vs cycles
    seen.add(incomingEdge.id + '>' + nodeId);
    const node = network.nodes.get(nodeId);
    const segPins = pins.get(incomingEdge.id) || { tap: new Set(), through: new Map() };
    const pool = available.slice().sort((a, b) => a - b);
    const take = (n, prefer) => {
      const out = [];
      // honour pinned (prefer) fibres first, in order
      for (const p of (prefer || [])) { const i = pool.indexOf(p); if (i >= 0 && out.length < n) { pool.splice(i, 1); out.push(p); } }
      while (out.length < n && pool.length) out.push(pool.shift());
      return out.sort((a, b) => a - b);
    };

    // 1) local splitter input (tap)
    if (node && node.hasSplitter) {
      const [tap] = take(1, [...segPins.tap]);
      if (tap != null) rec({ cable_id: incomingEdge.id, joint_id: nodeId, fibre_role: 'SPLITTER_INPUT', tube_number: tubeForFibre(tap), fibre_number: posInTube(tap), splitter_id: splitterIdFor(nodeId), abs: tap });
      else errors.push({ code: 'NO_INPUT_FIBRE', message: `Splitter ${nodeId} has no free input fibre on ${incomingEdge.id}.`, id: nodeId });
    }

    // 2) raw pass-through branches (deterministic order)
    for (const e of passChildren(nodeId)) {
      const need = demandPlan.edgeRequired.get(e.id) || 0;
      if (need <= 0) { emitDark(e.id, nodeId, range1(e.capacity)); continue; } // onward segment fully dark at this joint

      const usedOut = new Set();
      const outCursor = { v: 1 };
      const emitThrough = (inAbs, outAbs) => {
        if (outAbs > e.capacity) {
          errors.push({ code: 'OUT_OF_RANGE', message: `Fibre ${outAbs} exceeds capacity ${e.capacity} on onward ${e.id}. Under the colour-preserving profile the incoming fibre number must exist on the onward cable; use a larger onward cable or the compact profile.`, id: e.id });
          return false;
        }
        rec({ cable_id: incomingEdge.id, joint_id: nodeId, fibre_role: 'THROUGH_SPLICE', tube_number: tubeForFibre(inAbs), fibre_number: posInTube(inAbs), splice_to_cable: e.id, splice_to_tube: tubeForFibre(outAbs), splice_to_fibre: posInTube(outAbs), abs: inAbs });
        usedOut.add(outAbs);
        return true;
      };
      const outFor = (inAbs) => {
        if (profile === PROFILE_COMPACT_OUTBOUND) { let o = outCursor.v; while (usedOut.has(o)) o++; outCursor.v = o + 1; return o; }
        return inAbs; // COLOUR_PRESERVING: keep the number/colour
      };

      let placed = 0;
      // 2a) frozen pairs first — preserve exact in AND out.
      for (const pair of (segPins.through.get(e.id) || [])) {
        if (placed >= need) break;
        const i = pool.indexOf(pair.in);
        if (i < 0) continue;               // pinned in-fibre no longer available (topology changed)
        pool.splice(i, 1);
        if (emitThrough(pair.in, pair.out)) placed++;
      }
      // 2b) remaining demand from the pool, numbered per profile.
      const branchOut = [];
      while (placed < need && pool.length) {
        const inAbs = pool.shift();
        const outAbs = outFor(inAbs);
        if (emitThrough(inAbs, outAbs)) { branchOut.push(outAbs); placed++; }
      }
      if (placed < need) errors.push({ code: 'UNDERFILL', message: `Segment ${incomingEdge.id} could not supply ${need} through fibre(s) to ${e.id}.`, id: e.id });

      // onward segment: fibres not carrying a through-splice are dark at this joint
      emitDark(e.id, nodeId, range1(e.capacity).filter(f => !usedOut.has(f)));
      // recurse with the fibres that actually continue down the branch
      allocateAt(e.to, e, [...usedOut].sort((a, b) => a - b));
    }

    // 3) remainder of the incoming segment is dark at this joint
    emitDark(incomingEdge.id, nodeId, pool);
  }

  // Kick off from every feeder edge leaving the POP.
  for (const e of (network.outEdges.get(network.root) || [])) {
    if (e.feedMode !== 'PASS_THROUGH') continue;
    allocateAt(e.to, e, range1(e.capacity));
  }

  return { ok: errors.length === 0, errors, records };
}

function range1(n) { const a = []; for (let i = 1; i <= n; i++) a.push(i); return a; }
