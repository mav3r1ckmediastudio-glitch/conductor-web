// mapIds.js
// Deterministic asset-ID generators (directional base tables + next*Id). Read projectStore state.

import { projectStore } from './projectStore.js';

// ── CABINET TOOL ──────────────────────────────────────────────────────────────

export function nextPopId(areaId) {
  const prefix = `${areaId}-CAB-`;
  const existing = new Set();
  const cab = projectStore.cabinet;
  if (cab) {
    const pid = cab.properties.pop_id || '';
    if (pid.startsWith(prefix)) {
      const n = parseInt(pid.replace(prefix, '').split('(')[0]);
      if (!isNaN(n)) existing.add(n);
    }
  }
  let n = 1;
  while (existing.has(n)) n++;
  return `${prefix}${String(n).padStart(3, '0')}`;
}

// ── CHAMBER TOOL ─────────────────────────────────────────────────────────────

const CHAMBER_BASE = { N: 1,    S: 1001, W: 2001, E: 3001 };
const CHAMBER_MAX  = { N: 999,  S: 1999, W: 2999, E: 3999 };

export function nextChamberId(areaId, direction) {
  const prefix = `${areaId}-CMBR-`;
  const base = CHAMBER_BASE[direction];
  const max  = CHAMBER_MAX[direction];
  const existing = new Set();
  for (const ch of projectStore.chambers) {
    const seq = ch.properties.chamber_seq;
    if (seq >= base && seq <= max) existing.add(seq);
  }
  let n = base;
  while (existing.has(n) && n <= max) n++;
  if (n > max) throw new Error(`No available chamber numbers for direction ${direction}`);
  return { id: `${prefix}${String(n).padStart(4, '0')}`, seq: n };
}

// ── POLE TOOL ──────────────────────────────────────────────────────────────

export function nextPoleId(areaId) {
  const prefix = `${areaId}-POL-`;
  const existing = new Set();
  for (const pole of projectStore.poles) {
    const id = pole.properties.pole_id || '';
    if (id.startsWith(prefix)) {
      const n = parseInt(id.replace(prefix, ''), 10);
      if (!isNaN(n)) existing.add(n);
    }
  }
  let n = 1;
  while (existing.has(n)) n++;
  return `${prefix}${String(n).padStart(3, '0')}`;
}

// ── CBT TOOL ────────────────────────────────────────────────────────────────
// Snaps to an existing POLE (required). The CBT shares the pole's coordinates
// and stores a parent_pole_id reference. Mirrors the JOINT tool pattern.

export function nextCBTId(areaId) {
  const prefix = `${areaId}-CBT-`;
  const existing = new Set();
  for (const c of projectStore.cbts) {
    const id = c.properties.cbt_id || '';
    if (id.startsWith(prefix)) {
      const n = parseInt(id.replace(prefix, ''), 10);
      if (!isNaN(n)) existing.add(n);
    }
  }
  let n = 1;
  while (existing.has(n)) n++;
  return `${prefix}${String(n).padStart(3, '0')}`;
}

export function nextSpanId(areaId) {
  const prefix = `${areaId}-SPAN-`;
  const existing = new Set();
  for (const s of projectStore.spans) {
    const id = s.properties.span_id || '';
    if (id.startsWith(prefix)) {
      const n = parseInt(id.replace(prefix, ''), 10);
      if (!isNaN(n)) existing.add(n);
    }
  }
  let n = 1;
  while (existing.has(n)) n++;
  return `${prefix}${String(n).padStart(3, '0')}`;
}

export function nextAerialDropId(areaId) {
  const prefix = `${areaId}-ADROP-`;
  const existing = new Set();
  for (const d of projectStore.aerialDrops) {
    const id = d.properties.adrop_id || '';
    if (id.startsWith(prefix)) {
      const n = parseInt(id.replace(prefix, ''), 10);
      if (!isNaN(n)) existing.add(n);
    }
  }
  let n = 1;
  while (existing.has(n)) n++;
  return `${prefix}${String(n).padStart(3, '0')}`;
}

// ── CBT TAIL TOOL ─────────────────────────────────────────────────────────────
// A fibre tail from a CBT, along the aerial route (CBT → poles), back to its
// parent underground joint. Multi-vertex:
//   • Click 1 MUST snap to a CBT       → start of tail (CBT must not already
//                                         have a tail — one tail per CBT)
//   • Intermediate clicks snap to POLE → follow the pole/span route
//   • Final click MUST snap to a JOINT → sets the terminus vertex
//   • RMB finishes (consistent with every other line tool). The last committed
//     vertex must be a JOINT, or the finish is rejected.
// HARD-STOP at 350m: the plugin enforces a 350m ceiling on CBT tails. Adding a
// vertex that would push the running chain length over 350m is REJECTED — the
// click is ignored and the vertex is not added, so an over-length tail can never
// be saved. The true measured length is stored in length_m for the BoM.
// Esc cancels. Ctrl/⌘-Z pops the last vertex. After a save the tool returns to
// default (a CBT can only ever have one tail, so there is nothing to re-arm to).

export const CBT_TAIL_MAX_M = 350;

// Set of cbt_ids that already have a tail — used to block starting a second one.
export function cbtsWithTail() {
  const s = new Set();
  for (const t of projectStore.cbtTails) {
    if (t.properties.from_cbt) s.add(t.properties.from_cbt);
  }
  return s;
}

export function nextCBTTailId(areaId) {
  const prefix = `${areaId}-TAIL-`;
  const existing = new Set();
  for (const t of projectStore.cbtTails) {
    const id = t.properties.tail_id || '';
    if (id.startsWith(prefix)) {
      const n = parseInt(id.replace(prefix, ''), 10);
      if (!isNaN(n)) existing.add(n);
    }
  }
  let n = 1;
  while (existing.has(n)) n++;
  return `${prefix}${String(n).padStart(3, '0')}`;
}

// ── JOINT TOOL ────────────────────────────────────────────────────────────────

export function nextJointId(areaId) {
  const prefix = `${areaId}-JNT-`;
  const existing = new Set();
  for (const j of projectStore.joints) {
    const id = j.properties.joint_id || '';
    if (id.startsWith(prefix)) {
      const n = parseInt(id.replace(prefix, ''), 10);
      if (!isNaN(n)) existing.add(n);
    }
  }
  let n = 1;
  while (existing.has(n)) n++;
  return `${prefix}${String(n).padStart(3, '0')}`;
}

// ── DROP DUCT TOOL ────────────────────────────────────────────────────────────
// Two-click: click 1 = start (joint/chamber), click 2 = end (premise/free).
// RMB saves immediately with no form. Auto-saves with PROPOSED status.

export function nextDropDuctId(areaId) {
  const prefix = `${areaId}-DDCT-`;
  const existing = new Set();
  for (const d of projectStore.dropDucts) {
    const id = d.properties.ddct_id || '';
    if (id.startsWith(prefix)) {
      const n = parseInt(id.replace(prefix, ''), 10);
      if (!isNaN(n)) existing.add(n);
    }
  }
  let n = 1;
  while (existing.has(n)) n++;
  return `${prefix}${String(n).padStart(3, '0')}`;
}

// ── CABLE TOOL ────────────────────────────────────────────────────────────────
// Multi-vertex line, snaps to joints and POP only.
// RMB finishes and opens CableForm in right panel.

export function nextCableId(areaId) {
  const prefix = `${areaId}-CBL-`;
  const existing = new Set();
  for (const c of projectStore.cables) {
    const id = c.properties.cable_id || '';
    if (id.startsWith(prefix)) {
      const n = parseInt(id.replace(prefix, ''), 10);
      if (!isNaN(n)) existing.add(n);
    }
  }
  let n = 1;
  while (existing.has(n)) n++;
  return `${prefix}${String(n).padStart(3, '0')}`;
}

// ── BUNDLE TOOL ───────────────────────────────────────────────────────────────
// Two-click: click 1 = joint, click 2 = premise. Auto-saves, no form.
// Tool stays active after each save for rapid placement.

export function nextBundleId(areaId) {
  const prefix = `${areaId}-BDL-`;
  const existing = new Set();
  for (const b of projectStore.bundles) {
    const id = b.properties.bundle_id || '';
    if (id.startsWith(prefix)) {
      const n = parseInt(id.replace(prefix, ''), 10);
      if (!isNaN(n)) existing.add(n);
    }
  }
  let n = 1;
  while (existing.has(n)) n++;
  return `${prefix}${String(n).padStart(3, '0')}`;
}

// ── DUCT TOOL ─────────────────────────────────────────────────────────────────

const DUCT_BASE = { N: 1,   S: 100, E: 200, W: 300 };
const DUCT_MAX  = { N: 99,  S: 199, E: 299, W: 399 };

export function nextDuctId(areaId, direction) {
  const prefix = `${areaId}-DUCT-`;
  const base = DUCT_BASE[direction];
  const max  = DUCT_MAX[direction];
  const existing = new Set();
  for (const d of projectStore.ducts) {
    const seq = d.properties.duct_seq;
    if (seq >= base && seq <= max) existing.add(seq);
  }
  let n = base;
  while (existing.has(n) && n <= max) n++;
  if (n > max) throw new Error(`No available duct numbers for leg ${direction}`);
  return { id: `${prefix}${String(n).padStart(3, '0')}`, seq: n };
}
