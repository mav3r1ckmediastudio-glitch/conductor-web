// bom.js — Bill of Materials engine for Conductor Web.
// Ported from the v2 plugin's bom.py, adapted to the web store shape.
//
// Aggregates fibre + civil quantities into categorised material lines with unit
// costs and totals. Pure functions — no map/DOM deps. Reads projectStore.state.
//
// WEB ↔ v2 FIELD MAPPING NOTES
//   • Web keeps aerial spans in store.spans (cable_type 'AERIAL_SPAN'), UG cables
//     in store.cables, CBT tails in store.cbtTails (cable_type 'AERIAL_TAIL').
//     v2 lumped all into one cables layer keyed by cable_type. Here we read each
//     web collection and classify by its own cable_type.
//   • Web CBTs in store.cbts, aerial drops in store.aerialDrops, poles in store.poles.
//   • Costs are the Gigaloch supplier pricing from v2 DEFAULT_COSTS (current).
//
// Exports:
//   buildBom(store, costs?)        → { sections, grandTotal, costs }
//   generateBomHtml(store, costs?) → self-contained HTML string
//   generateBomCsv(store, costs?)  → CSV string
//   downloadBom(text, filename, mime?) → browser download
//   DEFAULT_COSTS

import { escapeHtml } from './htmlEscape.js';

export const DEFAULT_COSTS = {
  // Fibre cable — per metre by core count
  cable_12f_m: 0.47, cable_24f_m: 0.54, cable_48f_m: 0.62, cable_72f_m: 0.65, cable_96f_m: 0.99,
  cable_aerial_48f_m: 0.59, cable_aerial_24f_m: 0.54, cable_7mm_m: 0.11,
  // Duct — per metre
  shotgun_duct_m: 1.33, flexi_duct_m: 1.17, duct_16mm_m: 0.44,
  duct_16mm_connector: 5.66, duct_16mm_end_stop: 2.21,
  duct_7mm_m: 0.14, duct_7mm_end_stop: 0.67, drop_duct_m: 0.14,
  // Chambers
  chamber_small_each: 175.10, chamber_large_each: 301.49,
  // Joint closures
  joint_cmj_each: 66.81, joint_fdnir_each: 122.38, joint_fsttb_a_each: 49.55,
  joint_fsttb_b_each: 46.57, joint_gland_each: 10.28,
  // Splitter modules
  splitter_1x2_each: 20.00, splitter_1x4_each: 8.06, splitter_1x8_each: 8.62,
  splitter_1x16_each: 80.00, splitter_1x32_each: 120.00,
  // PIA aerial
  pole_each: 250.00, cbt_8port_each: 101.80, cbt_4port_each: 92.16,
  cbt_12port_250m_each: 219.00, cbt_12port_350m_each: 316.03,
  cbt_pole_bracket: 29.19, cbt_anti_creeper: 6.40, aerial_dead_end: 2.17,
  // Home installation
  ont_each: 33.36, ont_base_plate_each: 4.62, toby_box_each: 4.15,
  home_entry_kit_each: 27.79, router_each: 45.53,
  // Network equipment
  cabinet_each: 4039.72, aggreg_router_each: 8000.00, dux_shelf_each: 900.00,
  eaton_apr48_each: 202.00, mgmt_switch_each: 200.00, calix_shelf_each: 556.63,
  gpon_card_each: 4200.00, gpon_optic_each: 110.00, battery_each: 145.00,
  battery_shelf_each: 40.00, electrical_hookup_each: 24.96,
  patch_panel_each: 60.00,
  // Crossings
  road_crossing_each: 1500.00, stream_crossing_each: 800.00, scaffold_bar_each: 34.62,
};

function S(v) { return (v === null || v === undefined) ? '' : String(v); }
function num(v, d = 0) { const n = parseFloat(v); return isNaN(n) ? d : n; }
function int(v, d = 0) { const n = parseInt(v, 10); return isNaN(n) ? d : n; }
function r1(v) { return Math.round(num(v) * 10) / 10; }
function r2(v) { return Math.round(num(v) * 100) / 100; }
function cost(qty, unit) { return r2(num(qty) * num(unit)); }

// ── Aggregation ────────────────────────────────────────────────────────────────

export function buildBom(store, costs = DEFAULT_COSTS) {
  const C = (k, d) => (costs[k] !== undefined ? costs[k] : (d !== undefined ? d : DEFAULT_COSTS[k] || 0));

  const bom = {
    'Fibre Cable': [], 'Drop & Bundle': [], 'Joints': [],
    'Duct': [], 'PIA': [], 'Home Install': [], 'Network Equip': [],
  };

  const CABLE_COST = { 12: C('cable_12f_m'), 24: C('cable_24f_m'), 48: C('cable_48f_m'), 72: C('cable_72f_m'), 96: C('cable_96f_m') };
  const cableUnit = (fc) => CABLE_COST[fc] || C('cable_48f_m');

  const JOINT_COST = {
    'Prysmian CMJ': C('joint_cmj_each'), 'FDNIR-AXBCWX': C('joint_fdnir_each'),
    'FSTTB-AXBTA11': C('joint_fsttb_a_each'), 'FSTTB-AXXTA31': C('joint_fsttb_b_each'),
  };

  // ── UG / feeder cables (store.cables) ────────────────────────────────────────
  {
    const groups = {};
    for (const f of store.cables || []) {
      const p = f.properties;
      const ct = S(p.cable_type) || 'FEEDER';
      const fc = int(p.fibre_count, 48);
      const ft = S(p.fibre_type) || 'G.652D';
      const len = r1(p.length_m);
      const key = `${fc}|${ft}|${ct}`;
      (groups[key] = groups[key] || { fc, ft, ct, count: 0, len: 0 });
      groups[key].count++; groups[key].len += len;
    }
    for (const g of Object.values(groups).sort((a, b) => a.fc - b.fc)) {
      const qty = r1(g.len);
      const uc = cableUnit(g.fc);
      bom['Fibre Cable'].push({
        description: `${g.fc}F ${g.ft} Cable (${g.ct})`, unit: 'm', qty,
        unit_cost: uc, total: cost(qty, uc), notes: `${g.count} cable(s)`,
      });
    }
  }

  // ── Aerial spans (store.spans) → PIA ─────────────────────────────────────────
  let aerialSpanCount = 0;
  {
    const groups = {};
    for (const f of store.spans || []) {
      const p = f.properties;
      const fc = int(p.fibre_count, 96);
      const len = r1(p.length_m);
      aerialSpanCount++;
      const key = `${fc}`;
      (groups[key] = groups[key] || { fc, count: 0, len: 0 });
      groups[key].count++; groups[key].len += len;
    }
    for (const g of Object.values(groups).sort((a, b) => a.fc - b.fc)) {
      const qty = r1(g.len);
      const uc = g.fc >= 48 ? C('cable_aerial_48f_m') : C('cable_aerial_24f_m');
      bom['PIA'].push({
        description: `${g.fc}F Aerial Cable G657A1 (span)`, unit: 'm', qty,
        unit_cost: uc, total: cost(qty, uc), notes: `${g.count} span(s)`,
      });
    }
  }

  // ── CBT tails (store.cbtTails) → PIA ─────────────────────────────────────────
  {
    let count = 0, len = 0;
    for (const f of store.cbtTails || []) { count++; len += r1(f.properties.length_m); }
    if (count) {
      const uc = C('cable_48f_m');
      const qty = r1(len);
      bom['PIA'].push({
        description: `CBT Tail Cable`, unit: 'm', qty,
        unit_cost: uc, total: cost(qty, uc), notes: `${count} tail(s)`,
      });
    }
  }

  // ── Bundles (store.bundles) → Drop & Bundle ─────────────────────────────────
  {
    const groups = {};
    for (const f of store.bundles || []) {
      const fc = int(f.properties.fibre_count, 1);
      const len = r1(f.properties.length_m);
      (groups[fc] = groups[fc] || { count: 0, len: 0 });
      groups[fc].count++; groups[fc].len += len;
    }
    for (const fc of Object.keys(groups).sort((a, b) => a - b)) {
      const g = groups[fc];
      const uc = C('cable_7mm_m');
      const qty = r1(g.len);
      bom['Drop & Bundle'].push({
        description: `${fc}F Fibre Bundle (drop)`, unit: 'm', qty,
        unit_cost: uc, total: cost(qty, uc), notes: `${g.count} bundle(s)`,
      });
    }
  }

  // ── Drop ducts (store.dropDucts) → Drop & Bundle ────────────────────────────
  {
    let ddctCount = 0, total = 0;
    for (const f of store.dropDucts || []) {
      const dt = S(f.properties.drop_type).toUpperCase();
      if (dt === 'PIA_AERIAL_DROP') continue;   // aerial drops costed below
      total += r1(f.properties.length_m); ddctCount++;
    }
    if (ddctCount) {
      const uc = C('drop_duct_m');
      const qty = r1(total);
      bom['Drop & Bundle'].push({
        description: '7mm Speedpipe Drop Duct', unit: 'm', qty,
        unit_cost: uc, total: cost(qty, uc), notes: `${ddctCount} drop(s)`,
      });
      const ucEs = C('duct_7mm_end_stop');
      bom['Drop & Bundle'].push({
        description: '7mm Duct End Stop', unit: 'each', qty: ddctCount,
        unit_cost: ucEs, total: cost(ddctCount, ucEs), notes: '1 per drop',
      });
    }
  }

  // ── Aerial drops (store.aerialDrops) → PIA ───────────────────────────────────
  {
    let count = 0, len = 0;
    for (const f of store.aerialDrops || []) { count++; len += r1(f.properties.length_m); }
    if (count) {
      const uc = C('cable_aerial_24f_m');
      const qty = r1(len);
      bom['PIA'].push({
        description: 'Aerial Drop Cable', unit: 'm', qty,
        unit_cost: uc, total: cost(qty, uc), notes: `${count} drop(s)`,
      });
    }
  }

  // ── Joints + splitters (store.joints) ────────────────────────────────────────
  {
    const jointGroups = {};
    const splitterGroups = {};
    let jointCount = 0;
    for (const f of store.joints || []) {
      const p = f.properties;
      const jt = S(p.joint_type) || 'SPLICE';
      const ct = S(p.closure_type) || 'Prysmian CMJ';
      const key = `${jt}|${ct}`;
      (jointGroups[key] = jointGroups[key] || { jt, ct, count: 0 });
      jointGroups[key].count++; jointCount++;
      const hasSp = p.has_splitter === true || p.has_splitter === 1 || p.has_splitter === 'true';
      if (hasSp) {
        const sr = S(p.split_ratio) || 'Unknown';
        splitterGroups[sr] = (splitterGroups[sr] || 0) + 1;
      }
    }
    for (const g of Object.values(jointGroups).sort((a, b) => a.ct.localeCompare(b.ct))) {
      const uc = JOINT_COST[g.ct] || C('joint_cmj_each');
      bom['Joints'].push({
        description: `Joint Closure — ${g.ct}`, unit: 'each', qty: g.count,
        unit_cost: uc, total: cost(g.count, uc),
        notes: g.jt.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      });
    }
    if (jointCount) {
      const uc = C('joint_gland_each');
      bom['Joints'].push({
        description: 'Prysmian Port Entry Gland', unit: 'each', qty: jointCount,
        unit_cost: uc, total: cost(jointCount, uc), notes: '1 per joint closure',
      });
    }
    const ratioKey = { '1:2': 'splitter_1x2_each', '1:4': 'splitter_1x4_each', '1:8': 'splitter_1x8_each', '1:16': 'splitter_1x16_each', '1:32': 'splitter_1x32_each' };
    for (const sr of Object.keys(splitterGroups).sort()) {
      const uc = C(ratioKey[sr] || 'splitter_1x8_each');
      const count = splitterGroups[sr];
      bom['Joints'].push({
        description: `Splitter Module ${sr}`, unit: 'each', qty: count,
        unit_cost: uc, total: cost(count, uc), notes: 'Passive optical splitter, fitted into joint',
      });
    }
  }

  // ── Ducts (store.ducts) → Duct ───────────────────────────────────────────────
  {
    const groups = {};
    let roadX = 0, streamX = 0;
    for (const f of store.ducts || []) {
      const p = f.properties;
      const dt = S(p.duct_type) || 'STANDARD';
      const st = S(p.surface_type) || 'Unknown';
      const len = r1(p.length_m);
      const key = `${dt}|${st}`;
      (groups[key] = groups[key] || { dt, st, count: 0, len: 0 });
      groups[key].count++; groups[key].len += len;
      if (st.toUpperCase() === 'ROAD') roadX++;
      else if (st.toUpperCase() === 'WATERCOURSE' || st.toUpperCase() === 'STREAM') streamX++;
    }
    for (const g of Object.values(groups).sort((a, b) => a.dt.localeCompare(b.dt))) {
      let uc;
      const U = g.dt.toUpperCase();
      if (U.includes('SHOTGUN')) uc = C('shotgun_duct_m');
      else if (U.includes('FLEXI')) uc = C('flexi_duct_m');
      else if (U.includes('7MM')) uc = C('duct_7mm_m');
      else uc = C('duct_16mm_m');
      const qty = r1(g.len);
      const title = (s) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      bom['Duct'].push({
        description: `${title(g.dt)} Duct (${title(g.st)})`, unit: 'm', qty,
        unit_cost: uc, total: cost(qty, uc), notes: `${g.count} run(s)`,
      });
    }
    if (roadX) {
      const uc = C('road_crossing_each');
      bom['Duct'].push({ description: 'Road Crossing (works/permit allowance)', unit: 'each', qty: roadX, unit_cost: uc, total: cost(roadX, uc), notes: '' });
    }
    if (streamX) {
      const uc = C('stream_crossing_each');
      bom['Duct'].push({ description: 'Stream Crossing (consent allowance)', unit: 'each', qty: streamX, unit_cost: uc, total: cost(streamX, uc), notes: '' });
    }
  }

  // ── Chambers (store.chambers) → Duct + poles to PIA ──────────────────────────
  {
    let small = 0, large = 0, pole = 0;
    for (const f of store.chambers || []) {
      const ct = S(f.properties.chamber_type);
      if (ct === 'PIA_POLE') { pole++; continue; }
      if (ct === 'PIA_UG_CHAMBER') continue;  // PIA — not costed
      const size = S(f.properties.chamber_size) || 'SMALL';
      if (size === 'LARGE') large++; else small++;
    }
    if (small) { const uc = C('chamber_small_each'); bom['Duct'].push({ description: 'Chamber — Small (inc. lid)', unit: 'each', qty: small, unit_cost: uc, total: cost(small, uc), notes: '' }); }
    if (large) { const uc = C('chamber_large_each'); bom['Duct'].push({ description: 'Chamber — Large (inc. lid)', unit: 'each', qty: large, unit_cost: uc, total: cost(large, uc), notes: '' }); }
    if (pole)  { const uc = C('pole_each'); bom['PIA'].push({ description: 'PIA Pole Attachment', unit: 'each', qty: pole, unit_cost: uc, total: cost(pole, uc), notes: 'Openreach PIA pole' }); }
  }

  // ── Standalone poles (store.poles) → PIA ─────────────────────────────────────
  {
    const poleCount = (store.poles || []).length;
    if (poleCount) {
      const uc = C('pole_each');
      bom['PIA'].push({ description: 'PIA Pole Attachment', unit: 'each', qty: poleCount, unit_cost: uc, total: cost(poleCount, uc), notes: 'Openreach PIA pole' });
    }
  }

  // ── CBTs (store.cbts) → PIA ──────────────────────────────────────────────────
  {
    const cbtCount = (store.cbts || []).length;
    if (cbtCount) {
      const uc = C('cbt_8port_each');
      bom['PIA'].push({ description: 'CBT — 8-port Evolv Multiport 300m', unit: 'each', qty: cbtCount, unit_cost: uc, total: cost(cbtCount, uc), notes: 'Pole-mounted terminal' });
      const ucB = C('cbt_pole_bracket');
      bom['PIA'].push({ description: 'CBT Pole Bracket Hinge (2-way ROC)', unit: 'each', qty: cbtCount, unit_cost: ucB, total: cost(cbtCount, ucB), notes: '1 per CBT' });
      const ucAc = C('cbt_anti_creeper');
      bom['PIA'].push({ description: 'Anti-Creeper (Mills external locking)', unit: 'each', qty: cbtCount, unit_cost: ucAc, total: cost(cbtCount, ucAc), notes: '1 per CBT' });
    }
    if (aerialSpanCount) {
      const deadEnds = aerialSpanCount * 2;
      const uc = C('aerial_dead_end');
      bom['PIA'].push({ description: 'PLP Dead End (aerial cable)', unit: 'each', qty: deadEnds, unit_cost: uc, total: cost(deadEnds, uc), notes: `2 per span × ${aerialSpanCount} span(s)` });
    }
  }

  // ── Home install — per premise with a bundle/drop ───────────────────────────
  {
    const served = new Set();
    for (const f of store.bundles || []) { const u = S(f.properties.uprn); if (u) served.add(u); }
    for (const f of store.aerialDrops || []) { const u = S(f.properties.uprn); if (u) served.add(u); }
    const routed = served.size;
    if (routed) {
      for (const [desc, key] of [
        ['ONT', 'ont_each'], ['ONT Base Plate', 'ont_base_plate_each'],
        ['Toby Box', 'toby_box_each'], ['Home Entry Kit', 'home_entry_kit_each'],
      ]) {
        const uc = C(key);
        bom['Home Install'].push({ description: desc, unit: 'each', qty: routed, unit_cost: uc, total: cost(routed, uc), notes: `${routed} served premises` });
      }
    }
  }

  // ── Network equipment — reads actual equipment fields from the cabinet ───────
  // Quantities come from the fields set in CabinetForm.svelte (dux_shelves,
  // calix_shelves, gpon_cards, gpon_optics, battery_sets, patch_panels,
  // has_aggreg_router) so the BoM reflects the real configuration, not a
  // fixed placeholder. Site build-out (enclosure + electrical) is included
  // only for pop_type === 'CABINET' (a new street cabinet vs an existing
  // exchange, datacentre, or rooftop site).
  if (store.cabinet) {
    const cp      = store.cabinet.properties || {};
    const cabId   = S(cp.pop_id);
    const isCab   = String(cp.pop_type || '').toUpperCase() === 'CABINET';
    const dux     = Math.max(0, int(cp.dux_shelves,   0));
    const calix   = Math.max(0, int(cp.calix_shelves, 0));
    const cards   = Math.max(0, int(cp.gpon_cards,    0));
    const optics  = Math.max(0, int(cp.gpon_optics,   0));
    const batts   = Math.max(0, int(cp.battery_sets,  0));
    const patches = Math.max(0, int(cp.patch_panels,  0));
    const hasRtr  = !!(cp.has_aggreg_router);

    const equip = (desc, qty, key) => {
      if (qty <= 0) return;
      const uc = C(key);
      bom['Network Equip'].push({ description: desc, unit: 'each', qty, unit_cost: uc, total: cost(qty, uc), notes: cabId });
    };

    // Site build-out (new street cabinet only)
    if (isCab) {
      equip('Cabinet Enclosure + Groundworks', 1, 'cabinet_each');
      equip('Electrical Hookup',               1, 'electrical_hookup_each');
    }
    // Active electronics — quantities from cabinet form fields
    equip('Eaton DU-X Rectifier Shelf',  dux,           'dux_shelf_each');
    equip('Eaton APR48-ES Inverter',     dux,           'eaton_apr48_each');
    equip('Calix E7-2 Shelf',            calix,         'calix_shelf_each');
    equip('Calix E7-2 GPON-8 Card',     cards,         'gpon_card_each');
    equip('Calix GPON SFP',              optics,        'gpon_optic_each');
    equip('Yuasa Battery Set',           batts,         'battery_each');
    equip('19in Battery Shelf',          batts > 0 ? 1 : 0, 'battery_shelf_each');
    equip('19in Patch Panel',            patches,       'patch_panel_each');
    if (hasRtr) equip('Aggregation Router', 1,          'aggreg_router_each');
    equip('Management Switch',           1,             'mgmt_switch_each');
  }

  // ── Sections + totals ───────────────────────────────────────────────────────
  const order = ['Fibre Cable', 'Drop & Bundle', 'Joints', 'Duct', 'PIA', 'Home Install', 'Network Equip'];
  const sections = order.map(name => {
    const rows = bom[name];
    const subtotal = r2(rows.reduce((s, r) => s + num(r.total), 0));
    return { name, rows, subtotal };
  });
  const grandTotal = r2(sections.reduce((s, sec) => s + sec.subtotal, 0));

  return { sections, grandTotal, costs };
}

// ── HTML export ────────────────────────────────────────────────────────────────

function gbp(v) {
  return '£' + num(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function generateBomHtml(store, costs = DEFAULT_COSTS) {
  const { sections, grandTotal } = buildBom(store, costs);
  const areaId = S(store.project?.areaId || store.cabinet?.properties?.pop_id || '');
  const projName = S(store.project?.name || 'Conductor Project');

  const CSS = `
:root{--navy:#1A3A5C;--mid:#CBD5E1;--bg:#F4F6F9;--gray:#5F5E5A;}
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Courier New',Courier,monospace;background:var(--bg);color:#1A1A1A;font-size:12px;line-height:1.45;}
.page{max-width:980px;margin:0 auto;padding:20px;}
.header{background:var(--navy);color:white;border-radius:10px;padding:16px 20px;margin-bottom:14px;}
.header-title{font-size:20px;font-weight:bold;letter-spacing:0.5px;}
.header-sub{font-size:11px;color:#9FB4CC;margin-top:3px;}
.grand{display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.15);}
.grand-lbl{font-size:11px;color:#9FB4CC;text-transform:uppercase;letter-spacing:0.8px;}
.grand-val{font-size:24px;font-weight:bold;color:white;}
.section{background:white;border-radius:8px;border:0.5px solid var(--mid);margin-bottom:10px;overflow:hidden;}
.section-head{padding:8px 12px;font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:0.6px;background:#EEF2F7;color:var(--navy);display:flex;justify-content:space-between;border-bottom:1px solid var(--mid);}
.section-sub{color:var(--navy);}
table{width:100%;border-collapse:collapse;}
th{font-size:9px;text-transform:uppercase;letter-spacing:0.5px;color:var(--gray);padding:5px 10px;text-align:left;background:#FAFBFC;border-bottom:1px solid var(--mid);}
td{padding:5px 10px;font-size:11px;border-bottom:0.5px solid #EEF0F3;}
tr:last-child td{border-bottom:none;}
.r{text-align:right;}
.desc{font-weight:600;color:#1A1A1A;}
.notes{color:#888;font-size:10px;}
.footer{margin-top:16px;padding-top:10px;border-top:1px solid var(--mid);display:flex;justify-content:space-between;font-size:10px;color:var(--gray);}
@media print{body{background:white;}.page{padding:8px;}.section{break-inside:avoid;}*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}}
`;

  const H = [];
  H.push(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">`);
  H.push(`<title>${escapeHtml(areaId)} · Bill of Materials</title><style>${CSS}</style></head><body><div class="page">`);
  H.push(`<div class="header"><div class="header-title">Bill of Materials</div>`);
  H.push(`<div class="header-sub">${escapeHtml(projName)}${areaId ? ' · ' + escapeHtml(areaId) : ''} · Gigaloch · Exported from Conductor · prices ex. VAT</div>`);
  H.push(`<div class="grand"><span class="grand-lbl">Estimated Total (ex. VAT)</span><span class="grand-val">${gbp(grandTotal)}</span></div></div>`);

  for (const sec of sections) {
    if (!sec.rows.length) continue;
    H.push(`<div class="section"><div class="section-head"><span>${sec.name}</span><span class="section-sub">${gbp(sec.subtotal)}</span></div>`);
    H.push(`<table><thead><tr><th>Description</th><th class="r">Qty</th><th>Unit</th><th class="r">Unit £</th><th class="r">Total £</th><th>Notes</th></tr></thead><tbody>`);
    for (const row of sec.rows) {
      H.push(`<tr><td class="desc">${escapeHtml(row.description)}</td>` +
        `<td class="r">${escapeHtml(row.qty)}</td><td>${escapeHtml(row.unit)}</td>` +
        `<td class="r">${gbp(row.unit_cost)}</td><td class="r">${gbp(row.total)}</td>` +
        `<td class="notes">${escapeHtml(row.notes)}</td></tr>`);
    }
    H.push(`</tbody></table></div>`);
  }

  H.push(`<div class="footer"><span>${escapeHtml(projName)} · Bill of Materials · Gigaloch</span>`);
  H.push(`<span>Print: Ctrl+P · ${gbp(grandTotal)} ex. VAT</span></div>`);
  H.push(`</div></body></html>`);
  return H.join('\n');
}

// ── CSV export ───────────────────────────────────────────────────────────────

export function generateBomCsv(store, costs = DEFAULT_COSTS) {
  const { sections, grandTotal } = buildBom(store, costs);
  const esc = (v) => {
    const s = S(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [['Category', 'Description', 'Qty', 'Unit', 'Unit Cost', 'Total', 'Notes'].join(',')];
  for (const sec of sections) {
    for (const row of sec.rows) {
      lines.push([sec.name, row.description, row.qty, row.unit, row.unit_cost, row.total, row.notes].map(esc).join(','));
    }
    if (sec.rows.length) lines.push([esc(sec.name + ' subtotal'), '', '', '', '', sec.subtotal, ''].join(','));
  }
  lines.push(['TOTAL (ex. VAT)', '', '', '', '', grandTotal, ''].join(','));
  return lines.join('\n');
}

// ── Download helper ─────────────────────────────────────────────────────────

export function downloadBom(text, filename, mime = 'text/html') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
