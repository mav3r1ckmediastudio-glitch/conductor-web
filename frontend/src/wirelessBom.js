// wirelessBom.js — Bill of quantities for the wireless layer.
//
// Quantities only. Unit costs are NOT invented here: pass `costs` (a map of
// line key -> unit cost) to price lines; unpriced lines show no cost. Every
// output is stamped with the wireless plan state so a draft can never be
// mistaken for a validated design.

import { escapeHtml } from './htmlEscape.js';
import { wirelessPlanState } from './wirelessAnalysis.js';

const P = (f) => (f && f.properties) || {};

export function buildWirelessBom(state, costs = {}) {
  const sites = state.wirelessSites || [], links = state.wirelessLinks || [], sectors = state.wirelessSectors || [];
  const lines = [];
  const add = (key, item, qty, unit = 'each', note = '') => {
    if (qty <= 0) return;
    const unitCost = Number.isFinite(costs[key]) ? costs[key] : null;
    lines.push({ key, item, qty, unit, unitCost, total: unitCost == null ? null : unitCost * qty, note });
  };

  add('site', 'Wireless site (mast / tower / mounting point)', sites.length);
  add('ptp_radio', 'PtP link radio + antenna (2 per link)', links.length * 2);
  add('sector_radio', 'Sector radio + antenna', sectors.length);

  // Group PtP radios by band so procurement can see what mix is needed.
  const byBand = new Map();
  for (const l of links) { const f = P(l).freq_ghz; if (f != null && f !== '') byBand.set(String(f), (byBand.get(String(f)) || 0) + 2); }
  for (const [f, n] of [...byBand].sort((a, b) => Number(a[0]) - Number(b[0]))) add(`ptp_radio_${f}ghz`, `  of which ${f} GHz PtP radios`, n, 'each', 'informational subset');

  const mastHeights = new Map();
  for (const s of sites) { const h = P(s).mast_height_m; if (h != null && h !== '') mastHeights.set(String(h), (mastHeights.get(String(h)) || 0) + 1); }
  for (const [h, n] of [...mastHeights].sort((a, b) => Number(a[0]) - Number(b[0]))) add(`mast_${h}m`, `  of which ${h} m mast`, n, 'each', 'informational subset');

  const priced = lines.filter(l => l.total != null && !l.note.startsWith('informational'));
  return { lines, total: priced.length ? priced.reduce((s, l) => s + l.total, 0) : null, planState: wirelessPlanState(state) };
}

export function generateWirelessBomCsv(state, costs = {}) {
  const bom = buildWirelessBom(state, costs);
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [
    ['WIRELESS PLAN STATE', bom.planState],
    ['NOTE', bom.planState === 'VALIDATED' ? 'Automated checks passed; requires engineering review.' : 'NOT VALIDATED - draft quantities only.'],
    [],
    ['Item', 'Qty', 'Unit', 'Unit cost', 'Line total', 'Note'],
    ...bom.lines.map(l => [l.item.trim(), l.qty, l.unit, l.unitCost ?? '', l.total ?? '', l.note]),
  ];
  return rows.map(r => r.map(q).join(',')).join('\r\n');
}

export function generateWirelessBomHtml(state, costs = {}) {
  const bom = buildWirelessBom(state, costs);
  const banner = bom.planState === 'VALIDATED'
    ? 'Automated wireless checks passed. Requires engineering review.'
    : `Wireless plan state: ${escapeHtml(bom.planState)} - draft quantities only.`;
  const rows = bom.lines.map(l => `<tr><td>${escapeHtml(l.item)}</td><td>${l.qty}</td><td>${escapeHtml(l.unit)}</td><td>${l.unitCost ?? ''}</td><td>${l.total ?? ''}</td></tr>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>Wireless BoM</title><body style="font-family:sans-serif"><h1>Wireless bill of quantities</h1><p>${banner}</p><table border="1" cellpadding="4" cellspacing="0"><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Unit cost</th><th>Total</th></tr>${rows}</table></body>`;
}
