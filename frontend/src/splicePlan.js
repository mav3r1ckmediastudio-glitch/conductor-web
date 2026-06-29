// splicePlan.js — Self-contained HTML splice plan generator for Conductor Web.
// Produces per-joint HTML documents matching the v2 plugin's splice plan export.
// Pure function — no map / DOM dependencies. Takes the projectStore.state object.
//
// Exports:
//   generateSplicePlan(store, jointId)   → HTML string for one joint/CBT
//   generateAllSplicePlans(store)        → [{ filename, html, jointId, label }]
//   downloadSplicePlan(html, filename)   → triggers browser download
//   downloadAllSplicePlans(store)        → downloads all plans sequentially

// ── IEC 60794 colour tables ───────────────────────────────────────────────────
const IEC_NAMES  = ['Blue','Orange','Green','Brown','Slate','White','Red','Black','Yellow','Violet','Rose','Aqua'];
const IEC_HEX    = ['#3B82F6','#F97316','#22C55E','#92400E','#94A3B8','#FFFFFF','#EF4444','#1C1C1C','#EAB308','#8B5CF6','#F9A8D4','#06B6D4'];
const IEC_BORDER = [null,null,null,null,null,'#999',null,'#555',null,null,'#e879a0',null];

const TUBE_CSS = [
  { bg:'#E3EEFA', txt:'#0D3D6E' },
  { bg:'#FEF0DC', txt:'#7A3D04' },
  { bg:'#DFF5E8', txt:'#0B4A26' },
  { bg:'#F5E6D8', txt:'#4A2009' },
];

function fibIdx(absF)  { return (absF - 1) % 12; }
function tubeOf(absF)  { return Math.floor((absF - 1) / 12) + 1; }
function posOf(absF)   { return fibIdx(absF) + 1; }
function fibColour(absF) { return IEC_NAMES[fibIdx(absF)]; }
function fibHex(absF)    { return IEC_HEX[fibIdx(absF)]; }
function fibBorder(absF) { return IEC_BORDER[fibIdx(absF)]; }
function tubeCss(t)      { return TUBE_CSS[Math.min(t - 1, TUBE_CSS.length - 1)]; }

function S(v) { return (v === null || v === undefined) ? '' : String(v); }

// Inline colour dot + "F3 · Green"
function fibreDot(absF) {
  const h = fibHex(absF), b = fibBorder(absF);
  const bs = b ? `border:1px solid ${b};` : '';
  return `<span style="display:inline-flex;align-items:center;gap:5px;">` +
    `<span style="width:11px;height:11px;border-radius:50%;flex-shrink:0;background:${h};${bs}"></span>` +
    `<span style="font-size:11px;">F${posOf(absF)} &middot; ${fibColour(absF)}</span></span>`;
}

// Tube pill: T1, T2 …
function tubePill(t) {
  const { bg, txt } = tubeCss(t);
  return `<span style="display:inline-block;border-radius:3px;font-size:10px;font-weight:bold;` +
    `padding:1px 6px;white-space:nowrap;background:${bg};color:${txt};">T${t}</span>`;
}

// Splice link graphic (●—●)
function spliceLink(t) {
  const { bg: _, txt } = tubeCss(t);
  // Use the tube's colour swatch colour for the dots
  const TUBE_DOTS = ['#1A6FBF','#E6760A','#1D8C4A','#8B4513'];
  const c = TUBE_DOTS[Math.min(t - 1, TUBE_DOTS.length - 1)];
  return `<div style="display:flex;align-items:center;justify-content:center;gap:0;">` +
    `<div style="width:7px;height:7px;border-radius:50%;background:${c};"></div>` +
    `<div style="flex:1;height:2px;min-width:20px;background:${c};"></div>` +
    `<div style="width:7px;height:7px;border-radius:50%;background:${c};"></div></div>` +
    `<div style="font-size:8px;color:#5F5E5A;text-align:center;">SPLICE</div>`;
}

// Short cable label: last segment after '-' e.g. "ENG-CH3-CBL-001" → "001"
function shortCable(id) {
  if (!id) return '—';
  const parts = S(id).split('-');
  return parts.length >= 2 ? parts.slice(-2).join('-') : S(id);
}

// ── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `
:root{--navy:#1A3A5C;--mid:#CBD5E1;--bg:#F4F6F9;--gray:#5F5E5A;--gray-light:#F1EFE8;}
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Courier New',Courier,monospace;background:var(--bg);color:#1A1A1A;font-size:13px;line-height:1.5;}
.page{max-width:960px;margin:0 auto;padding:20px;}
.header{background:var(--navy);color:white;border-radius:10px;padding:16px 20px;margin-bottom:14px;}
.header-top{display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;}
.header-title{font-size:20px;font-weight:bold;letter-spacing:0.5px;}
.header-sub{font-size:11px;color:#9FB4CC;margin-top:3px;}
.header-loc{font-size:11px;color:#9FB4CC;text-align:right;}
.meta-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px;}
.meta-card{background:rgba(255,255,255,0.09);border-radius:6px;padding:7px 10px;}
.meta-label{font-size:9px;color:#9FB4CC;text-transform:uppercase;letter-spacing:0.8px;}
.meta-value{font-size:16px;font-weight:bold;color:white;margin-top:1px;}
.legends{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;}
.legend-box{background:white;border:0.5px solid var(--mid);border-radius:6px;padding:7px 12px;flex:1;min-width:200px;}
.legend-title{font-size:9px;font-weight:bold;color:var(--gray);text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;}
.legend-items{display:flex;flex-wrap:wrap;gap:5px;}
.legend-item{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--gray);}
.section-wrap{background:white;border-radius:8px;border:0.5px solid var(--mid);margin-bottom:10px;overflow:hidden;}
.section-head{padding:7px 12px;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:0.8px;border-bottom:1px solid var(--mid);display:flex;align-items:center;gap:8px;}
.splice-table{width:100%;border-collapse:collapse;}
.splice-table th{font-size:9px;text-transform:uppercase;letter-spacing:0.6px;color:var(--gray);padding:4px 8px;border-bottom:1px solid var(--mid);text-align:left;background:#FAFBFC;}
.splice-table td{padding:4px 8px;vertical-align:middle;border-bottom:0.5px solid #EEF0F3;}
.splice-table tr:last-child td{border-bottom:none;}
.splitter-section{background:#FAECE7;border:1.5px solid #C03A1A;border-radius:8px;padding:14px 16px;margin-bottom:10px;}
.splitter-head{font-size:11px;font-weight:bold;color:#6B1D0A;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;}
.sp-outputs{margin-left:10px;flex:1;display:flex;flex-direction:column;gap:3px;}
.sp-out-row{display:flex;align-items:center;gap:6px;}
.po-pill{font-size:10px;font-weight:bold;padding:1px 6px;border-radius:3px;background:white;border:1px solid #C03A1A;color:#6B1D0A;flex-shrink:0;min-width:30px;text-align:center;}
.po-yes{color:#0F6E56;}
.po-no{color:#B4B2A9;font-style:italic;}
.spare-block{background:var(--gray-light);border-radius:8px;padding:12px 14px;margin-bottom:10px;}
.spare-title{font-size:10px;font-weight:bold;color:var(--gray);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;}
.spare-bar-bg{height:10px;background:#D3D1C7;border-radius:5px;overflow:hidden;}
.spare-bar-fill{height:10px;background:#888;border-radius:5px;}
.spare-stats{display:flex;justify-content:space-between;font-size:10px;color:var(--gray);margin-top:4px;}
.footer{margin-top:16px;padding-top:10px;border-top:1px solid var(--mid);display:flex;justify-content:space-between;font-size:10px;color:var(--gray);}
@media print{body{background:white;}.page{padding:8px;}.section-wrap{break-inside:avoid;}.splitter-section{break-inside:avoid;}*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}}
`;

// ── Core generator ────────────────────────────────────────────────────────────

export function generateSplicePlan(store, jointId) {
  const jid = S(jointId);

  // Find the joint or CBT record
  const jointFeat = (store.joints  || []).find(j => S(j.properties.joint_id) === jid)
                 || (store.cbts    || []).find(c => S(c.properties.cbt_id)   === jid);
  const isCbt = !!(store.cbts || []).find(c => S(c.properties.cbt_id) === jid);

  const p = jointFeat?.properties || {};
  const closureType  = S(p.closure_type  || p.notes || '');
  const jointType    = S(p.joint_type    || (isCbt ? 'CBT' : 'SPLICE'));
  const chamberId    = S(p.chamber_id    || '');
  const popId        = S(p.pop_id        || store.cabinet?.properties?.pop_id || '');
  const hasSplitter  = !!(p.has_splitter === true || p.has_splitter === 1 || p.has_splitter === 'true');
  const splitRatio   = S(p.split_ratio   || (hasSplitter || isCbt ? '1:8' : ''));
  const splitterCap  = splitRatio ? parseInt((splitRatio.match(/:(\d+)/) || [])[1] || '8', 10) : 0;

  // Pull assignment records for this joint
  const allRecs = store.fibreAssignments || [];
  const recs = allRecs.filter(r => S(r.joint_id) === jid);

  // Build address lookup from addressPoints
  const addrOf = {};
  for (const ap of store.addressPoints || []) {
    const u = S(ap.properties?.uprn);
    if (u) addrOf[u] = S(ap.properties?.address || ap.properties?.postcode || u);
  }

  // Build UPRN lookup from drops/bundles
  const uprnOf = {};
  for (const d of store.aerialDrops || []) {
    const id = S(d.properties.adrop_id), u = S(d.properties.uprn);
    if (id && u) uprnOf[id] = u;
  }
  for (const b of store.bundles || []) {
    const id = S(b.properties.bundle_id), u = S(b.properties.uprn);
    if (id && u) uprnOf[id] = u;
  }

  // Partition records by role
  const spliceRecs   = recs.filter(r => r.fibre_role === 'THROUGH_SPLICE');
  const spInputRecs  = recs.filter(r => r.fibre_role === 'SPLITTER_INPUT');
  const spOutputRecs = recs.filter(r => r.fibre_role === 'SPLITTER_OUTPUT');
  const spSpareRecs  = recs.filter(r => r.fibre_role === 'SPLITTER_OUTPUT_SPARE');
  const darkRecs     = recs.filter(r => r.fibre_role === 'DARK_STORAGE');

  // Through-splices are already deduplicated by the assignment engine (one record
  // per fibre pair). Use them as-is — no second dedup (a naive sorted-key dedup
  // collapses distinct tube/fibre pairs and undercounts).
  const uniqueSplices = spliceRecs;

  // Find cable fibre counts for stats
  const cableFC = {};
  for (const c of store.cables || []) {
    const id = S(c.properties.cable_id);
    if (id) cableFC[id] = parseInt(c.properties.fibre_count, 10) || 0;
  }
  for (const s of store.spans || []) {
    const id = S(s.properties.span_id);
    if (id) cableFC[id] = parseInt(s.properties.fibre_count, 10) || 0;
  }

  // Determine cable(s) at this joint for stats
  const cablesAtJoint = new Set([
    ...recs.filter(r => r.cable_id).map(r => S(r.cable_id)),
  ]);
  const maxFibres = Math.max(0, ...[...cablesAtJoint].map(id => cableFC[id] || 0));

  // Stats
  const nSplices     = uniqueSplices.length;
  const nSplitters   = (hasSplitter || isCbt) ? 1 : 0;
  const nActivePorts = spOutputRecs.length;
  const nSparePorts  = spSpareRecs.length;
  const nDark        = darkRecs.reduce((s, r) => s + (r.dark_count || 1), 0);

  // The "Spare fibres" tile means different things by joint kind:
  //   • Splitter (CBT or splitter joint): spare PORTS / total ports (cap).
  //   • Pure splice joint: spare FIBRES / total fibres on the cable.
  const isSplitterNode = hasSplitter || isCbt;
  let spareTileLabel, spareTileValue;
  if (isSplitterNode) {
    spareTileLabel = 'Spare ports';
    spareTileValue = `${nSparePorts} / ${splitterCap || '—'}`;
  } else {
    const nSpareFibres = Math.max(0, maxFibres - nSplices - (spInputRecs.length > 0 ? 1 : 0) - nDark);
    spareTileLabel = 'Spare fibres';
    spareTileValue = `${nSpareFibres} / ${maxFibres || '—'}`;
  }

  // Group through-splices by tube
  const splicesByTube = {};
  for (const r of uniqueSplices) {
    const t = r.tube_number || 1;
    (splicesByTube[t] = splicesByTube[t] || []).push(r);
  }

  // Dark tubes — which tubes are entirely spare
  const darkTubes = new Set();
  for (const r of darkRecs) darkTubes.add(r.tube_number || 1);

  const H = [];
  H.push(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">`);
  H.push(`<title>${jid} &middot; Splice Plan</title>`);
  H.push(`<style>${CSS}</style>`);
  H.push(`</head><body><div class="page">`);

  // ── Header ────────────────────────────────────────────────────────────────
  H.push(`<div class="header">`);
  H.push(`<div class="header-top"><div>`);
  H.push(`<div class="header-title">${jid}</div>`);
  const subParts = ['Splice Plan'];
  if (closureType) subParts.push(`Closure: ${closureType}`);
  subParts.push(`Type: ${jointType}`, 'Owner: Gigaloch');
  H.push(`<div class="header-sub">${subParts.join(' &middot; ')}</div>`);
  const locLines = [popId, chamberId].filter(Boolean);
  H.push(`</div><div class="header-loc">${locLines.join('<br>')}</div></div>`);
  H.push(`<div class="meta-grid">`);
  H.push(`<div class="meta-card"><div class="meta-label">Splices</div><div class="meta-value">${nSplices}</div></div>`);
  H.push(`<div class="meta-card"><div class="meta-label">Splitters</div><div class="meta-value">${nSplitters}</div></div>`);
  H.push(`<div class="meta-card"><div class="meta-label">Active ports</div><div class="meta-value">${nActivePorts}</div></div>`);
  H.push(`<div class="meta-card"><div class="meta-label">${spareTileLabel}</div><div class="meta-value">${spareTileValue}</div></div>`);
  H.push(`</div></div>`);

  // ── Legends ───────────────────────────────────────────────────────────────
  H.push(`<div class="legends"><div class="legend-box">`);
  H.push(`<div class="legend-title">Tube colour coding</div><div class="legend-items">`);
  for (let t = 1; t <= 4; t++) {
    const { bg, txt } = tubeCss(t);
    const names = ['Blue','Orange','Green','Brown'];
    H.push(`<div class="legend-item">${tubePill(t)}${names[t-1]}</div>`);
  }
  H.push(`</div></div><div class="legend-box">`);
  H.push(`<div class="legend-title">Fibre colours &mdash; IEC 60794</div><div class="legend-items">`);
  for (let f = 1; f <= 12; f++) {
    const h = IEC_HEX[f-1], b = IEC_BORDER[f-1];
    const bs = b ? `border:1px solid ${b};` : '';
    H.push(`<div class="legend-item"><span style="width:11px;height:11px;border-radius:50%;display:inline-block;background:${h};${bs}"></span>${f} ${IEC_NAMES[f-1].slice(0,3)}</div>`);
  }
  H.push(`</div></div></div>`);

  // ── Per-tube splice sections ───────────────────────────────────────────────
  const allTubes = new Set([
    ...Object.keys(splicesByTube).map(Number),
    ...darkRecs.map(r => r.tube_number || 1),
  ]);
  const maxTube = maxFibres ? Math.ceil(maxFibres / 12) : Math.max(0, ...allTubes);

  for (let t = 1; t <= maxTube; t++) {
    const tubeSplices = (splicesByTube[t] || []).sort((a, b) => (a.fibre_number||0) - (b.fibre_number||0));
    if (tubeSplices.length === 0 && !darkTubes.has(t)) continue;
    if (darkTubes.has(t) && tubeSplices.length === 0) continue; // shown in spare block below

    const { bg, txt } = tubeCss(t);
    H.push(`<div class="section-wrap">`);
    H.push(`<div class="section-head" style="background:${bg};color:${txt};">`);
    H.push(`${tubePill(t)} Tube ${t} &mdash; Through splices (${tubeSplices.length})</div>`);
    H.push(`<table class="splice-table"><thead><tr>`);
    H.push(`<th style="width:120px;">From cable</th><th style="width:50px;">Tube</th><th style="width:90px;">Fibre</th>`);
    H.push(`<th style="width:110px;text-align:center;">Link</th>`);
    H.push(`<th style="width:50px;">Tube</th><th style="width:90px;">Fibre</th><th>To cable</th>`);
    H.push(`</tr></thead><tbody>`);

    for (const r of tubeSplices) {
      const absFrom = (r.tube_number - 1) * 12 + (r.fibre_number || 1);
      const absTo   = (r.splice_to_tube - 1) * 12 + (r.splice_to_fibre || 1);
      H.push(`<tr>`);
      H.push(`<td>${shortCable(r.cable_id)}</td>`);
      H.push(`<td>${tubePill(r.tube_number)}</td>`);
      H.push(`<td>${fibreDot(absFrom)}</td>`);
      H.push(`<td>${spliceLink(t)}</td>`);
      H.push(`<td>${tubePill(r.splice_to_tube || t)}</td>`);
      H.push(`<td>${fibreDot(absTo)}</td>`);
      H.push(`<td>${shortCable(r.splice_to_cable)}</td>`);
      H.push(`</tr>`);

      // Also emit the reverse row (to_cable → from_cable) matching v2 behaviour
      H.push(`<tr>`);
      H.push(`<td>${shortCable(r.splice_to_cable)}</td>`);
      H.push(`<td>${tubePill(r.splice_to_tube || t)}</td>`);
      H.push(`<td>${fibreDot(absTo)}</td>`);
      H.push(`<td>${spliceLink(t)}</td>`);
      H.push(`<td>${tubePill(r.tube_number)}</td>`);
      H.push(`<td>${fibreDot(absFrom)}</td>`);
      H.push(`<td>${shortCable(r.cable_id)}</td>`);
      H.push(`</tr>`);
    }

    H.push(`</tbody></table></div>`);
  }

  // ── Splitter section ──────────────────────────────────────────────────────
  if (hasSplitter || isCbt) {
    H.push(`<div class="splitter-section">`);
    H.push(`<div class="splitter-head">&#9670; ${splitRatio} Splitter &mdash; Port Assignments</div>`);

    // Splitter input fibre — for a CBT this arrives via its tail; show the tail
    // (or feed cable) and the parent joint it traces back to. Prefer the record
    // that carries a cable_id (the actual feed segment) over the bare port-1 stub.
    const inpRec = spInputRecs.find(r => r.cable_id) || spInputRecs[0];
    if (inpRec) {
      const absIn = ((inpRec.tube_number||1)-1)*12 + (inpRec.fibre_number||1);
      const feedId = S(inpRec.cable_id);
      const feedLabel = feedId
        ? (feedId.includes('TAIL') ? 'CBT tail' : shortCable(feedId))
        : '(unfed — run Auto-Assign)';
      H.push(`<div style="font-size:10px;color:#6B1D0A;margin-bottom:8px;">` +
        `Input fibre: ${tubePill(inpRec.tube_number||1)} ${fibreDot(absIn)} on ${feedLabel}</div>`);
    }

    // Build a lookup of downstream splitter ids → ratio (for feeder port labels)
    const childRatio = {};
    for (const j of store.joints || []) {
      const id = S(j.properties.joint_id);
      if (id) childRatio[id] = S(j.properties.split_ratio || '1:8');
    }
    for (const c of store.cbts || []) {
      const id = S(c.properties.cbt_id);
      if (id) childRatio[id] = S(c.properties.split_ratio || '1:8');
    }
    const isFeeder = splitterCap === 4;

    // Build port→consumer map
    const portMap = {};
    for (const r of spOutputRecs) {
      if (r.port) portMap[r.port] = r;
    }

    H.push(`<div class="sp-outputs">`);
    for (let po = 1; po <= splitterCap; po++) {
      const r = portMap[po];
      H.push(`<div class="sp-out-row"><span class="po-pill">PO${po}</span>`);
      if (r && r.bundle_id) {
        const childId = S(r.bundle_id);
        if (isFeeder && childRatio[childId]) {
          // Feeder output → downstream splitter (joint or CBT). Show id + its ratio.
          const isCbtChild = (store.cbts || []).some(c => S(c.properties.cbt_id) === childId)
            || (store.joints || []).some(j => S(j.properties.joint_id) === childId && S(j.properties.joint_type) === 'CBT');
          H.push(`<span class="po-yes">&#10003; ${childId} ` +
            `<span style="font-size:9px;color:#6B1D0A;opacity:0.7;">` +
            `(${isCbtChild ? 'CBT' : 'Joint'} ${childRatio[childId]})</span></span>`);
        } else {
          // Terminal output → premises. Look up UPRN → address.
          const uprn = uprnOf[childId] || '';
          const addr = addrOf[uprn] || uprn || childId;
          H.push(`<span class="po-yes">&#10003; ${addr}</span>`);
        }
      } else {
        H.push(`<span class="po-no">Spare / unassigned</span>`);
      }
      H.push(`</div>`);
    }
    H.push(`</div></div>`);
  }

  // ── Spare / dark block ────────────────────────────────────────────────────
  // Only meaningful for splice joints carrying through-fibres with dark storage.
  // Splitter nodes (CBT/splitter joint) report spare via the port grid + tile.
  if (!isSplitterNode && (darkTubes.size > 0 || nDark > 0)) {
    const spareFibres = Math.max(0, maxFibres - nSplices - (spInputRecs.length > 0 ? 1 : 0) - nDark);
    H.push(`<div class="spare-block">`);
    H.push(`<div class="spare-title">Spare / dark storage &mdash; do not disturb</div>`);

    for (const r of darkRecs) {
      const t = r.tube_number || 1;
      const count = r.dark_count || 1;
      const { bg, txt } = tubeCss(t);
      H.push(`<span style="font-size:10px;padding:2px 8px;border-radius:3px;` +
        `background:${bg};color:${txt};margin-right:4px;">` +
        `T${t} &middot; F${r.fibre_number}-${r.fibre_number + count - 1} (${count} fibre${count===1?'':'s'} spare)</span>`);
    }

    if (maxFibres) {
      const activePct = Math.round((nSplices + nActivePorts) / maxFibres * 100);
      H.push(`<div style="margin-top:8px;"><div class="spare-bar-bg">` +
        `<div class="spare-bar-fill" style="width:${activePct}%;"></div></div>`);
      H.push(`<div class="spare-stats">` +
        `<span>${nSplices + nActivePorts} fibres active</span>` +
        `<span>${nActivePorts} assigned &middot; ${spareFibres} spare &middot; ${maxFibres} total</span>` +
        `</div></div>`);
    }
    H.push(`</div>`);
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  H.push(`<div class="footer">`);
  H.push(`<span>${jid} &middot; Splice Plan &middot; Gigaloch</span>`);
  H.push(`<span>Print: Ctrl+P &middot; Works offline &middot; ${jid}.html</span>`);
  H.push(`</div>`);
  H.push(`</div></body></html>`);

  return H.join('\n');
}

// ── Batch generator ───────────────────────────────────────────────────────────

export function generateAllSplicePlans(store) {
  const results = [];

  for (const j of store.joints || []) {
    const id = S(j.properties.joint_id);
    if (!id) continue;
    const html = generateSplicePlan(store, id);
    results.push({ jointId: id, filename: `${id}.html`, html, label: id });
  }

  for (const c of store.cbts || []) {
    const id = S(c.properties.cbt_id);
    if (!id) continue;
    const html = generateSplicePlan(store, id);
    results.push({ jointId: id, filename: `${id}.html`, html, label: id });
  }

  return results;
}

// ── Download helpers ──────────────────────────────────────────────────────────

export function downloadSplicePlan(html, filename) {
  const blob = new Blob([html], { type: 'text/html' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadAllSplicePlans(store) {
  const plans = generateAllSplicePlans(store);
  // Stagger downloads so the browser doesn't block them
  plans.forEach((plan, i) => {
    setTimeout(() => downloadSplicePlan(plan.html, plan.filename), i * 200);
  });
  return plans.length;
}
