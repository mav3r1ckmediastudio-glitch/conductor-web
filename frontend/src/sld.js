// sld.js — Single Line Diagram generator for Conductor Web.
// Ported from the v2 plugin's sld.py, adapted to the web store.
//
// Builds a full-network topology tree from the cabinet outward and renders it as
// a self-contained HTML document: cabinet → cables/spans → joints/CBTs/poles →
// bundles/aerial drops → premises. Pure functions, no map/DOM deps.
//
// WEB ↔ v2 NOTES
//   • Web cables (store.cables) + aerial spans (store.spans) + CBT tails
//     (store.cbtTails) are merged into one node→edge adjacency keyed by from_node.
//     Spans are drawn dashed (aerial); tails dashed teal.
//   • CBTs (store.cbts) and poles (store.poles) become tree nodes even though they
//     aren't in store.joints.
//   • Aerial drops (store.aerialDrops) hang off their from_cbt; bundles off from_joint.
//
// OPTICAL BUDGET
//   Per-premise loss/margin badges now match the v2 SLD. traceFibre() is called
//   once per connected premise in buildNetwork(); results are attached to each
//   bundle/drop item and rendered as .budget-pass / .budget-fail spans.
//   Figures are identical to those shown in Fibre Trace and Validate Routes.
//
// Exports:
//   generateSld(store)        → self-contained HTML string
//   downloadSld(html, name)   → browser download

import { traceFibre } from './fibreTrace.js';
import { escapeHtml } from './htmlEscape.js';

const NAVY = '#1A3A5C', TEAL = '#1D7A6E', ORANGE = '#C85A00';
const AERIAL = '#00AAFF', GREEN = '#00CC00', BROWN = '#8B4513';

const CABLE_COLOURS = {
  SPINE: NAVY, DISTRIBUTION: TEAL, FEEDER: NAVY,
  AERIAL: AERIAL, AERIAL_SPAN: AERIAL, AERIAL_TAIL: TEAL, DROP: BROWN,
};

function S(v) { return (v === null || v === undefined) ? '' : String(v); }
function num(v, d = 0) { const n = parseFloat(v); return isNaN(n) ? d : n; }
function r1(v) { return Math.round(num(v) * 10) / 10; }

// ── Build the network model ─────────────────────────────────────────────────

function buildNetwork(store) {
  const cables = {};         // id -> { id, cable_type, fibre_count, length_m, from_node, to_node, is_aerial, is_tail }
  const joints = {};         // id -> { id, joint_type, has_splitter, split_ratio, chamber_id }
  const bundlesByJoint = {}; // jointId -> [ { bundle_id, uprn, address, fibre_count, length_m, loss_db, margin_db, link_pass } ]
  const dropsByCbt = {};     // cbtId   -> [ { adrop_id,  uprn, address, length_m,              loss_db, margin_db, link_pass } ]
  const fromNode = {};       // nodeId -> [cableId, …]
  let cabinet = null;

  // Address lookup
  const addr = {};
  for (const ap of store.addressPoints || []) {
    const u = S(ap.properties?.uprn);
    if (u) addr[u] = S(ap.properties?.address || ap.properties?.postcode || u);
  }

  // Cabinet
  if (store.cabinet) cabinet = S(store.cabinet.properties.pop_id);

  function addCable(f, kind) {
    const p = f.properties;
    const id = S(p.cable_id || p.span_id || p.tail_id);
    if (!id) return;
    const ct = S(p.cable_type) || (kind === 'span' ? 'AERIAL_SPAN' : kind === 'tail' ? 'AERIAL_TAIL' : 'FEEDER');
    const fn = S(p.from_node ?? p.from_cbt ?? '');
    const tn = S(p.to_node ?? p.to_joint ?? '');
    cables[id] = {
      id, cable_type: ct,
      fibre_count: parseInt(p.fibre_count, 10) || (kind === 'tail' ? 1 : 48),
      length_m: r1(p.length_m),
      from_node: fn, to_node: tn,
      is_aerial: kind === 'span' || ct.toUpperCase().includes('AERIAL_SPAN') || ct.toUpperCase() === 'AERIAL',
      is_tail: kind === 'tail',
    };
    if (fn) (fromNode[fn] = fromNode[fn] || []).push(id);
    // Cabinet detection — a cable whose from_node is the POP
    if (store.cabinet && fn === S(store.cabinet.properties.pop_id)) cabinet = fn;
  }

  for (const f of store.cables || []) addCable(f, 'cable');
  for (const f of store.spans || [])  addCable(f, 'span');
  for (const f of store.cbtTails || []) addCable(f, 'tail');

  // Joints
  for (const f of store.joints || []) {
    const p = f.properties;
    const id = S(p.joint_id);
    joints[id] = {
      id, joint_type: S(p.joint_type) || 'SPLICE',
      has_splitter: !!(p.has_splitter === true || p.has_splitter === 1 || p.has_splitter === 'true'),
      split_ratio: S(p.split_ratio), chamber_id: S(p.chamber_id),
    };
  }
  // CBTs become joint-like nodes
  const cbtByPole = {};   // poleId -> [cbtId]
  for (const f of store.cbts || []) {
    const p = f.properties;
    const id = S(p.cbt_id);
    const parentPole = S(p.parent_pole_id);
    joints[id] = {
      id, joint_type: 'CBT',
      has_splitter: true, split_ratio: S(p.split_ratio) || '1:8',
      chamber_id: parentPole,
    };
    if (parentPole) (cbtByPole[parentPole] = cbtByPole[parentPole] || []).push(id);
  }

  // A CBT physically sits on a pole and is fed by its tail (CBT→joint). In the
  // cable graph the tail points back toward the joint, so a downstream tree walk
  // would never reach the CBT from the pole. Bridge it: register each CBT as a
  // virtual onward "edge" from its parent pole, so the tree shows pole → CBT.
  // We use a synthetic riser edge (zero-length, no cable label).
  for (const [poleId, cbtIds] of Object.entries(cbtByPole)) {
    for (const cbtId of cbtIds) {
      const riserId = `__riser__${poleId}__${cbtId}`;
      cables[riserId] = {
        id: riserId, cable_type: 'AERIAL_TAIL', fibre_count: 1, length_m: 0,
        from_node: poleId, to_node: cbtId, is_aerial: false, is_tail: true,
        is_riser: true,
      };
      (fromNode[poleId] = fromNode[poleId] || []).push(riserId);
    }
  }

  // Bundles by joint
  for (const f of store.bundles || []) {
    const p = f.properties;
    const fj = S(p.from_joint);
    const u = S(p.uprn);
    (bundlesByJoint[fj] = bundlesByJoint[fj] || []).push({
      bundle_id: S(p.bundle_id), uprn: u, address: addr[u] || u || 'Unknown',
      fibre_count: parseInt(p.fibre_count, 10) || 2, length_m: r1(p.length_m),
      loss_db: null, margin_db: null, link_pass: null,
    });
  }

  // Aerial drops by CBT
  for (const f of store.aerialDrops || []) {
    const p = f.properties;
    const fc = S(p.from_cbt);
    const u = S(p.uprn);
    (dropsByCbt[fc] = dropsByCbt[fc] || []).push({
      adrop_id: S(p.adrop_id), uprn: u, address: addr[u] || u || 'Unknown',
      length_m: r1(p.length_m),
      loss_db: null, margin_db: null, link_pass: null,
    });
  }

  // ── Per-premise optical budget ───────────────────────────────────────────
  // Call traceFibre() for every connected premise. This gives identical figures
  // to Fibre Trace and Validate Routes (same engine, same optical constants).
  // Only ROUTED premises get a budget (traceFibre returns optical: null for
  // PARTIAL/UNSERVED, so those premises silently show no badge).
  for (const blist of Object.values(bundlesByJoint)) {
    for (const b of blist) {
      if (!b.uprn) continue;
      try {
        const r = traceFibre(store, b.uprn);
        if (r.optical) {
          b.loss_db   = r.optical.loss_db;
          b.margin_db = r.optical.margin_db;
          b.link_pass = r.optical.link_pass;
        }
      } catch (_) { /* leave null — don't block SLD generation */ }
    }
  }
  for (const dlist of Object.values(dropsByCbt)) {
    for (const d of dlist) {
      if (!d.uprn) continue;
      try {
        const r = traceFibre(store, d.uprn);
        if (r.optical) {
          d.loss_db   = r.optical.loss_db;
          d.margin_db = r.optical.margin_db;
          d.link_pass = r.optical.link_pass;
        }
      } catch (_) { /* leave null */ }
    }
  }

  return { cables, joints, bundlesByJoint, dropsByCbt, fromNode, cabinet };
}

// ── Recursive node renderer ──────────────────────────────────────────────────

function renderNode(nodeId, net, visited, depth = 0) {
  if (visited.has(nodeId)) return '';
  visited.add(nodeId);
  const { cables, joints, bundlesByJoint, dropsByCbt, fromNode } = net;
  const H = [];

  const outbound = fromNode[nodeId] || [];
  const joint = joints[nodeId];
  const jbundles = bundlesByJoint[nodeId] || [];
  const jdrops = dropsByCbt[nodeId] || [];

  const renderChildren = () => {
    if (!outbound.length) return;
    H.push(`<div class="children">`);
    for (const cid of outbound) {
      const c = cables[cid];
      if (!c) continue;
      if (c.is_riser) {
        // Synthetic pole→CBT riser: no cable label, just descend to the CBT.
        H.push(renderNode(c.to_node, net, visited, depth + 1));
        continue;
      }
      const col = CABLE_COLOURS[c.cable_type] || NAVY;
      const dashed = c.is_aerial || c.is_tail;
      const ls = `border-left:3px ${dashed ? 'dashed' : 'solid'} ${col};`;
      const tag = c.is_tail ? ' &#x26D3;' : (c.is_aerial ? ' &#x1F4F6;' : '');
      H.push(`<div class="cable-branch">`);
      H.push(`<div class="cable-line" style="${ls}"></div>`);
      H.push(`<div class="cable-label" style="color:${col};">${escapeHtml(cid)} &middot; ${c.fibre_count}F &middot; ${c.length_m}m${tag}</div>`);
      H.push(renderNode(c.to_node, net, visited, depth + 1));
      H.push(`</div>`);
    }
    H.push(`</div>`);
  };

  // Pole / pass-through node (no joint record but has onward cables)
  if (!joint && outbound.length) {
    const isPole = nodeId.toUpperCase().includes('POL');
    const boxCls = isPole ? 'node-joint node-pole' : 'node-joint';
    const icon = isPole ? '&#x1F4F6; ' : '';
    H.push(`<div class="tree-node"><div class="${boxCls}">`);
    H.push(`<div class="node-id">${icon}${escapeHtml(nodeId)}</div>`);
    H.push(`<div class="node-meta">${isPole ? 'Pole — aerial span' : 'Pass-through'}</div></div>`);
    renderChildren();
    H.push(`</div>`);
    return H.join('\n');
  }

  if (joint) {
    const isCbt = joint.joint_type === 'CBT';
    let spLabel, boxCls;
    if (isCbt) { spLabel = 'CBT' + (joint.chamber_id ? ' — Pole: ' + escapeHtml(joint.chamber_id) : ''); boxCls = 'node-joint node-cbt'; }
    else if (joint.has_splitter) { spLabel = escapeHtml(joint.split_ratio || '') + ' splitter'; boxCls = 'node-joint node-splitter'; }
    else if (joint.joint_type === 'END_OF_LINE') { spLabel = 'End of line'; boxCls = 'node-joint node-eol'; }
    else { spLabel = 'Pass-through'; boxCls = 'node-joint'; }

    H.push(`<div class="tree-node"><div class="${boxCls}">`);
    H.push(`<div class="node-id">${escapeHtml(joint.id)}</div>`);
    H.push(`<div class="node-meta">${spLabel}</div>`);
    if (joint.chamber_id && !isCbt) H.push(`<div class="node-chamber">${escapeHtml(joint.chamber_id)}</div>`);
    H.push(`</div>`);

    // UG bundles
    if (jbundles.length) {
      H.push(`<div class="bundle-list">`);
      for (const b of jbundles) {
        H.push(`<div class="bundle-row"><div class="bundle-line"></div><div class="bundle-box">`);
        H.push(`<span class="bundle-id">${escapeHtml(b.bundle_id)}</span>`);
        H.push(`<span class="bundle-addr">${escapeHtml(b.address)}</span>`);
        H.push(`<span class="bundle-meta">${b.fibre_count}F &middot; ${b.length_m}m</span>`);
        if (b.loss_db != null) {
          const cls = b.link_pass ? 'budget-pass' : 'budget-fail';
          const sign = b.margin_db >= 0 ? '+' : '';
          H.push(`<span class="budget ${cls}">${b.loss_db.toFixed(1)}dB &middot; ${sign}${b.margin_db.toFixed(1)}dB margin</span>`);
        }
        H.push(`</div></div>`);
      }
      H.push(`</div>`);
    }

    // Aerial drops
    if (jdrops.length) {
      H.push(`<div class="aerial-list">`);
      for (const d of jdrops) {
        H.push(`<div class="aerial-row"><div class="aerial-line"></div><div class="aerial-box">`);
        H.push(`<span class="aerial-id">&#x1F4F6; ${escapeHtml(d.adrop_id)}</span>`);
        H.push(`<span class="aerial-addr">${escapeHtml(d.address)}</span>`);
        H.push(`<span class="aerial-meta">${d.length_m}m &middot; Aerial drop</span>`);
        if (d.loss_db != null) {
          const cls = d.link_pass ? 'budget-pass' : 'budget-fail';
          const sign = d.margin_db >= 0 ? '+' : '';
          H.push(`<span class="budget ${cls}">${d.loss_db.toFixed(1)}dB &middot; ${sign}${d.margin_db.toFixed(1)}dB margin</span>`);
        }
        H.push(`</div></div>`);
      }
      H.push(`</div>`);
    }

    if (outbound.length) renderChildren();
    else if (!jbundles.length && !jdrops.length) H.push(`<div class="dark-storage">&#x1F4E6; Dark storage &mdash; do not disturb</div>`);
    H.push(`</div>`);
  }

  return H.join('\n');
}

// ── Top-level generator ──────────────────────────────────────────────────────

export function generateSld(store) {
  const net = buildNetwork(store);
  if (!net.cabinet) throw new Error('No cabinet placed — cannot generate SLD.');

  const { cables, joints, bundlesByJoint, dropsByCbt, fromNode, cabinet } = net;
  const areaId = S(store.project?.areaId || cabinet || '');

  const realCables = Object.values(cables).filter(c => !c.is_riser);
  const totalCables = realCables.length;
  const totalJoints = Object.values(joints).filter(j => j.joint_type !== 'CBT').length;
  const totalCbts = Object.values(joints).filter(j => j.joint_type === 'CBT').length;
  const totalBundles = Object.values(bundlesByJoint).reduce((s, a) => s + a.length, 0);
  const totalDrops = Object.values(dropsByCbt).reduce((s, a) => s + a.length, 0);
  const totalLength = r1(realCables.reduce((s, c) => s + c.length_m, 0));
  const splitters = Object.values(joints).filter(j => j.has_splitter).length;

  // Optical summary across all premises
  const allPremises = [
    ...Object.values(bundlesByJoint).flat(),
    ...Object.values(dropsByCbt).flat(),
  ];
  const budgetedCount = allPremises.filter(p => p.loss_db != null).length;
  const failCount     = allPremises.filter(p => p.link_pass === false).length;

  const visited = new Set();
  let tree = '';
  for (const cid of (fromNode[cabinet] || [])) {
    const c = cables[cid];
    if (!c) continue;
    const col = CABLE_COLOURS[c.cable_type] || NAVY;
    tree += `<div class="cable-branch"><div class="cable-line" style="border-color:${col};"></div>`;
    tree += `<div class="cable-label" style="color:${col};">${escapeHtml(cid)} &middot; ${c.fibre_count}F &middot; ${c.length_m}m</div>`;
    tree += renderNode(c.to_node, net, visited);
    tree += `</div>`;
  }

  const CSS = [
    ':root{--navy:#1A3A5C;--teal:#1D7A6E;--orange:#C85A00;--aerial:#00AAFF;--mid:#CBD5E1;--bg:#F4F6F9;}',
    '*{box-sizing:border-box;margin:0;padding:0;}',
    "body{font-family:Consolas,'Courier New',monospace;background:var(--bg);color:#1A1A1A;font-size:12px;line-height:1.5;}",
    '.page{max-width:1100px;margin:0 auto;padding:20px;}',
    '.header{background:var(--navy);color:white;border-radius:8px;padding:16px 20px;margin-bottom:16px;}',
    '.header-title{font-size:20px;font-weight:bold;letter-spacing:1px;}',
    '.header-sub{font-size:11px;color:#9FB4CC;margin-top:3px;}',
    '.stat-row{display:flex;gap:16px;margin-top:12px;flex-wrap:wrap;}',
    '.stat{background:rgba(255,255,255,0.1);border-radius:5px;padding:6px 12px;}',
    '.stat-val{font-size:18px;font-weight:bold;color:white;}',
    '.stat-lbl{font-size:9px;color:#9FB4CC;text-transform:uppercase;letter-spacing:0.8px;}',
    '.stat.fail .stat-val{color:#FCA5A5;}',
    '.cabinet{display:inline-flex;align-items:center;gap:10px;background:var(--orange);color:white;border-radius:6px;padding:10px 16px;font-weight:bold;font-size:13px;margin-bottom:8px;}',
    '.cab-icon{font-size:18px;}',
    '.children{margin-left:32px;border-left:2px solid var(--mid);}',
    '.cable-branch{position:relative;}',
    '.cable-line{border-left:3px solid var(--navy);height:24px;margin-left:15px;}',
    '.cable-label{font-size:11px;font-weight:600;padding:2px 0 2px 20px;margin-left:15px;border-left:3px solid;border-bottom:3px solid;border-color:inherit;display:inline-block;margin-bottom:4px;}',
    '.node-joint{background:white;border:2px solid var(--mid);border-radius:6px;padding:8px 12px;display:inline-block;min-width:220px;margin:4px 0;}',
    '.node-splitter{border-color:var(--teal);}',
    '.node-eol{border-color:#888;background:#f5f5f5;}',
    '.node-cbt{border-color:var(--aerial);background:#F0F8FF;}',
    '.node-pole{border-color:var(--aerial);background:#F5FBFF;}',
    '.node-id{font-size:12px;font-weight:bold;color:var(--navy);}',
    '.node-meta{font-size:10px;color:var(--teal);font-weight:600;margin-top:2px;}',
    '.node-cbt .node-meta{color:var(--aerial);}',
    '.node-chamber{font-size:10px;color:#888;margin-top:1px;}',
    '.bundle-list{margin:6px 0 6px 24px;border-left:2px dashed #00CC00;padding-left:8px;}',
    '.bundle-row{display:flex;align-items:flex-start;gap:6px;margin:3px 0;}',
    '.bundle-line{width:14px;height:2px;background:#00CC00;margin-top:10px;flex-shrink:0;}',
    '.bundle-box{background:#F0FFF0;border:1px solid #00CC00;border-radius:4px;padding:4px 8px;font-size:11px;}',
    '.bundle-id{color:#006600;font-weight:600;display:block;}',
    '.bundle-addr{color:#1A1A1A;display:block;margin-top:1px;}',
    '.bundle-meta{color:#888;font-size:10px;display:block;margin-top:1px;}',
    '.aerial-list{margin:6px 0 6px 24px;border-left:2px dashed #00AAFF;padding-left:8px;}',
    '.aerial-row{display:flex;align-items:flex-start;gap:6px;margin:3px 0;}',
    '.aerial-line{width:14px;height:2px;background:#00AAFF;margin-top:10px;flex-shrink:0;}',
    '.aerial-box{background:#F0F8FF;border:1px solid #00AAFF;border-radius:4px;padding:4px 8px;font-size:11px;}',
    '.aerial-id{color:#005E8B;font-weight:600;display:block;}',
    '.aerial-addr{color:#1A1A1A;display:block;margin-top:1px;}',
    '.aerial-meta{color:#888;font-size:10px;display:block;margin-top:1px;}',
    // Optical budget badges — matching v2 colour scheme exactly
    '.budget{font-size:10px;font-weight:600;display:inline-block;margin-top:3px;padding:1px 6px;border-radius:3px;}',
    '.budget-pass{color:#0A6B2D;background:#E6F7EA;}',
    '.budget-fail{color:#A32D2D;background:#FCEBEB;}',
    '.dark-storage{font-size:11px;color:#888;margin:6px 0 6px 16px;font-style:italic;}',
    '.legend{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px;background:white;border:1px solid var(--mid);border-radius:6px;padding:10px 14px;}',
    '.leg-item{display:flex;align-items:center;gap:6px;font-size:11px;color:#444;}',
    '.footer{margin-top:20px;padding-top:10px;border-top:1px solid var(--mid);font-size:10px;color:#888;display:flex;justify-content:space-between;}',
    '@media print{body{background:white;font-size:10px;}.page{padding:8px;max-width:100%;}.header{border-radius:0;margin-bottom:10px;}.node-joint{break-inside:avoid;}.children{break-inside:avoid;}*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}}',
  ].join('');

  const H = [];
  H.push(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">`);
  H.push(`<title>${escapeHtml(areaId)} &middot; Single Line Diagram</title><style>${CSS}</style></head><body><div class="page">`);
  H.push(`<div class="header"><div class="header-title">${escapeHtml(areaId)} &middot; Single Line Diagram</div>`);
  H.push(`<div class="header-sub">Full network topology &middot; Cabinet to customer &middot; Gigaloch</div>`);
  H.push(`<div class="stat-row">`);
  for (const [lbl, v, extra] of [
    ['Cables', totalCables, ''],
    ['Joints', totalJoints, ''],
    ['CBTs', totalCbts, ''],
    ['UG customers', totalBundles, ''],
    ['Aerial drops', totalDrops, ''],
    ['Splitters', splitters, ''],
    ['Total cable (m)', totalLength, ''],
    ...(budgetedCount > 0 ? [['Budget fails', failCount, failCount > 0 ? ' class="stat fail"' : '']] : []),
  ]) {
    H.push(`<div class="stat"${extra}><div class="stat-val">${v}</div><div class="stat-lbl">${lbl}</div></div>`);
  }
  H.push(`</div></div>`);

  H.push(`<div class="legend">`);
  for (const [lbl, col, dashed] of [
    ['Spine/Feeder cable', NAVY, false], ['Aerial span cable', AERIAL, true],
    ['CBT tail', TEAL, true], ['UG bundle', GREEN, false], ['Aerial drop', AERIAL, false],
    ['Budget pass', '#0A6B2D', false], ['Budget fail', '#A32D2D', false],
  ]) {
    const style = dashed
      ? `height:0;width:24px;border-top:3px dashed ${col};`
      : `height:4px;width:24px;border-radius:2px;background:${col};`;
    H.push(`<div class="leg-item"><div style="${style}"></div>${lbl}</div>`);
  }
  H.push(`</div>`);

  H.push(`<div class="cabinet"><span class="cab-icon">&#x1F4E6;</span>${escapeHtml(cabinet)} &middot; Cabinet</div>`);
  H.push(`<div class="tree">${tree}</div>`);

  H.push(`<div class="footer"><span>${escapeHtml(areaId)} &middot; Single Line Diagram &middot; Gigaloch</span>`);
  H.push(`<span>Print: Ctrl+P &middot; Save as PDF from print dialog</span></div>`);
  H.push(`</div></body></html>`);

  return H.join('\n');
}

export function downloadSld(html, filename) {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
