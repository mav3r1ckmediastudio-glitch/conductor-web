// mapExport.js — cartographic export for Conductor Web.
//
// Produces a print-style sheet (map + legend + asset totals + scale bar + title
// block) as a single SVG, with a PNG derivative for convenience. The map raster
// is captured from the live MapLibre canvas; everything else is vector, so text
// and legend stay crisp at any size.
//
// Hard rule (per design): the map may only be captured in 2D (top-down) view.
// On a pitched 3D view a single scale bar is invalid — ground metres-per-pixel
// varies across the image — so the caller must ensure 2D before calling.
//
// Asset lengths come from each feature's stored `length_m` property (the same
// authoritative value the digitiser computes and the forms display, mirroring
// v2), NOT a re-derived geometry length. Point assets are counted.
//
// Public API:
//   computeTotals(state)                 → { lines:[...], points:[...] }
//   captureSheetSVG(map, state, opts)    → Promise<string>  (SVG markup)
//   exportSheet(map, state, opts)        → Promise<void>     (captures + downloads)
//     opts: { format: 'svg'|'png', filenameBase, company }

// ── geodesic helper (used ONLY for the scale bar, not asset lengths) ─────────
function haversineM(a, b) {
  const R = 6371008.8;                       // mean Earth radius, metres
  const r = d => (d * Math.PI) / 180;
  const dLat = r(b[1] - a[1]);
  const dLng = r(b[0] - a[0]);
  const la1 = r(a[1]), la2 = r(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ── asset totals from stored length_m / counts ───────────────────────────────
// Colours mirror the live map layers in mapTools.js so the legend matches.
const LINE_DEFS = [
  { key: 'ducts',       label: 'Duct',        color: '#4dc8ff', dash: null   },
  { key: 'dropDucts',   label: 'Drop Duct',   color: '#7ab8d4', dash: null   },
  { key: 'cables',      label: 'Cable',       color: '#ffffff', dash: '5,3'  },
  { key: 'bundles',     label: 'Bundle',      color: '#6a8fa8', dash: null   },
  { key: 'spans',       label: 'Aerial Span', color: '#00aaff', dash: null   },
  { key: 'aerialDrops', label: 'Aerial Drop', color: '#ffaa44', dash: null   },
  { key: 'cbtTails',    label: 'CBT Tail',    color: '#ffaa44', dash: '3,3'  },
];
const POINT_DEFS = [
  { key: 'chambers',      label: 'Chamber',  color: '#ffffff', shape: 'square' },
  { key: 'joints',        label: 'Joint',    color: '#4dc8ff', shape: 'square' },
  { key: 'poles',         label: 'Pole',     color: '#4dc8ff', shape: 'circle' },
  { key: 'cbts',          label: 'CBT',      color: '#4dc8ff', shape: 'circle' },
  { key: 'addressPoints', label: 'Premises', color: '#ffffff', shape: 'circle' },
];

function sumLengthM(arr) {
  return (arr || []).reduce((t, f) => t + (parseFloat(f?.properties?.length_m) || 0), 0);
}

export function computeTotals(state) {
  const s = state || {};
  const lines = LINE_DEFS
    .map(d => ({ ...d, m: Math.round(sumLengthM(s[d.key])) }))
    .filter(d => d.m > 0);
  const points = POINT_DEFS
    .map(d => ({ ...d, n: (s[d.key] || []).length }))
    .filter(d => d.n > 0);
  return { lines, points };
}

function fmtLen(m) {
  return m >= 1000 ? (m / 1000).toFixed(2) + ' km' : m + ' m';
}

// ── scale bar maths (valid because caller guarantees 2D / pitch 0) ───────────
function scaleBar(map, canvasW) {
  const b = map.getBounds();
  const latC = map.getCenter().lat;
  const groundW = haversineM([b.getWest(), latC], [b.getEast(), latC]); // metres across image
  const mPerPx = groundW / canvasW;                                     // per capture pixel
  const targetPx = canvasW * 0.18;                                      // aim ~18% of width
  const rawM = mPerPx * targetPx;
  const pow = Math.pow(10, Math.floor(Math.log10(rawM)));
  let meters = pow;
  for (const mult of [1, 2, 5, 10]) if (mult * pow <= rawM) meters = mult * pow;
  return { meters, px: meters / mPerPx };
}

// ── capture the MapLibre canvas as a PNG data URL ────────────────────────────
// Requires preserveDrawingBuffer:true on the map, OR capturing within a render.
// We force a synchronous repaint then read the buffer.
function captureMapPng(map) {
  return new Promise((resolve, reject) => {
    try {
      map.once('render', () => {
        try { resolve(map.getCanvas().toDataURL('image/png')); }
        catch (e) { reject(e); }       // tainted canvas → basemap tiles lack CORS
      });
      map.triggerRepaint();
    } catch (e) { reject(e); }
  });
}

// ── SVG builder ──────────────────────────────────────────────────────────────
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── column-flow helper: lays items top-to-bottom, wrapping into columns ──────
function flowList(items, { x, y, rowH, colW, maxRows, render }) {
  const n = items.length;
  const nCols = Math.max(1, Math.ceil(n / maxRows));
  const rowsPerCol = Math.ceil(n / nCols);
  const out = [];
  items.forEach((it, i) => {
    const c = Math.floor(i / rowsPerCol);
    const r = i % rowsPerCol;
    out.push(render(it, x + c * colW, y + r * rowH));
  });
  return { svg: out.join('\n'), width: nCols * colW, height: rowsPerCol * rowH };
}

function buildSVG({ mapPng, mapW, mapH, totals, bar, meta, company }) {
  const M = 16;                       // outer margin
  const PAD = 16;                     // panel inner padding
  const rowH = 15;
  const maxRows = 7;                  // rows before a section wraps to a new column
  const W = mapW + M * 2;
  const ink = '#cfe6f2', dim = '#7ab8d4', faint = '#3a5a70';
  const bg = '#0a0f14', card = '#0d1520', edge = '#1a2d40';

  const header = (x, y, t) =>
    `<text x="${x}" y="${y}" fill="${dim}" font-size="10" letter-spacing="1.5">${esc(t)}</text>`;

  // ── unified item lists ──
  const totalsItems = [
    ...totals.lines.map(l => ({ label: l.label, val: fmtLen(l.m) })),
    ...totals.points.map(p => ({ label: p.label, val: String(p.n) })),
  ];
  const legendItems = [
    ...totals.lines.map(l => ({ kind: 'line', label: l.label, color: l.color, dash: l.dash })),
    ...totals.points.map(p => ({ kind: p.shape, label: p.label, color: p.color })),
  ];

  // ── ZONE 1 (fixed, left): PROJECT + PREPARED BY + SCALE, stacked ──
  const z1x = M + PAD;
  const z1w = 196;
  const z1 = [];
  let z1y = 0;
  z1y += 16; z1.push(header(z1x, z1y, 'PROJECT')); z1y += 18;
  for (const [k, v] of [['REF', meta.ref], ['AREA', meta.area], ['STAGE', meta.stage], ['HP', meta.hp], ['DATE', meta.date]]) {
    z1.push(`<text x="${z1x}" y="${z1y}" fill="${faint}" font-size="10">${esc(k)}</text>`);
    z1.push(`<text x="${z1x + 58}" y="${z1y}" fill="${ink}" font-size="10">${esc(v)}</text>`);
    z1y += rowH;
  }
  z1y += 14; z1.push(header(z1x, z1y, 'PREPARED BY')); z1y += 19;
  z1.push(`<text x="${z1x}" y="${z1y}" fill="${ink}" font-size="14" letter-spacing="0.5">${esc(company || 'GIGALOCH')}</text>`); z1y += 15;
  z1.push(`<text x="${z1x}" y="${z1y}" fill="${faint}" font-size="9">Conductor Web — FTTP design</text>`); z1y += 22;
  // scale bar
  z1.push(header(z1x, z1y, 'SCALE')); z1y += 14;
  const bw = Math.min(bar.px, z1w - 50);
  z1.push(`<line x1="${z1x}" y1="${z1y}" x2="${z1x + bw}" y2="${z1y}" stroke="${ink}" stroke-width="2"/>`);
  z1.push(`<line x1="${z1x}" y1="${z1y - 4}" x2="${z1x}" y2="${z1y + 4}" stroke="${ink}" stroke-width="2"/>`);
  z1.push(`<line x1="${z1x + bw}" y1="${z1y - 4}" x2="${z1x + bw}" y2="${z1y + 4}" stroke="${ink}" stroke-width="2"/>`);
  const barLabel = bar.meters >= 1000 ? (bar.meters / 1000) + ' km' : bar.meters + ' m';
  z1.push(`<text x="${z1x + bw + 8}" y="${z1y + 4}" fill="${ink}" font-size="10">${esc(barLabel)}</text>`);
  const z1h = z1y + 8;

  // ── ZONE 2 (TOTALS) ──
  const z2x = M + PAD + z1w + 24;
  let z2y = 16;
  const z2head = header(z2x, z2y, 'TOTALS'); z2y += 18;
  const totalsColW = 168;
  const totalsFlow = flowList(totalsItems, {
    x: z2x, y: z2y, rowH, colW: totalsColW, maxRows,
    render: (it, x, y) =>
      `<text x="${x}" y="${y}" fill="${faint}" font-size="10">${esc(it.label)}</text>` +
      `<text x="${x + totalsColW - 18}" y="${y}" fill="${ink}" font-size="10" text-anchor="end">${esc(it.val)}</text>`,
  });
  const z2h = z2y + totalsFlow.height;

  // ── ZONE 3 (LEGEND) ──
  const z3x = z2x + totalsFlow.width + 28;
  let z3y = 16;
  const z3head = header(z3x, z3y, 'LEGEND'); z3y += 18;
  const legendColW = 150;
  const legendFlow = flowList(legendItems, {
    x: z3x, y: z3y, rowH, colW: legendColW, maxRows,
    render: (it, x, y) => {
      let sw;
      if (it.kind === 'line') {
        const dash = it.dash ? ` stroke-dasharray="${it.dash}"` : '';
        sw = `<line x1="${x}" y1="${y - 4}" x2="${x + 26}" y2="${y - 4}" stroke="${it.color}" stroke-width="2.5"${dash}/>`;
      } else if (it.kind === 'square') {
        sw = `<rect x="${x + 8}" y="${y - 11}" width="9" height="9" fill="${it.color}" stroke="#0a0f14"/>`;
      } else {
        sw = `<circle cx="${x + 13}" cy="${y - 6}" r="5" fill="none" stroke="${it.color}" stroke-width="2"/>`;
      }
      return sw + `<text x="${x + 36}" y="${y}" fill="${ink}" font-size="10">${esc(it.label)}</text>`;
    },
  });
  const z3h = z3y + legendFlow.height;

  // ── panel + sheet dimensions (dynamic height) ──
  const panelContentH = Math.max(z1h, z2h, z3h);
  const panelH = PAD + panelContentH + PAD;
  const panelY = M + mapH + 10;
  const H = panelY + panelH + M;

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="'Courier New', ui-monospace, monospace">`);
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);

  // map
  parts.push(`<rect x="${M - 1}" y="${M - 1}" width="${mapW + 2}" height="${mapH + 2}" fill="none" stroke="${edge}"/>`);
  parts.push(`<image x="${M}" y="${M}" width="${mapW}" height="${mapH}" href="${mapPng}" preserveAspectRatio="xMidYMid slice"/>`);
  const nax = M + mapW - 34, nay = M + 14;
  parts.push(`<g transform="translate(${nax},${nay})"><polygon points="0,-10 5,8 0,3 -5,8" fill="${ink}"/><text x="0" y="22" fill="${ink}" font-size="11" text-anchor="middle">N</text></g>`);

  // panel
  parts.push(`<rect x="${M}" y="${panelY}" width="${W - M * 2}" height="${panelH}" fill="${card}" stroke="${edge}"/>`);
  parts.push(`<g transform="translate(0,${panelY + PAD})">`);
  parts.push(z1.join('\n'));
  parts.push(z2head); parts.push(totalsFlow.svg);
  parts.push(z3head); parts.push(legendFlow.svg);
  parts.push(`</g>`);

  parts.push(`</svg>`);
  return parts.join('\n');
}

// ── metadata from project state ──────────────────────────────────────────────
function metaFromState(state) {
  const p = state?.project || {};
  const ref = p.areaId
    || [p.countryCode, p.buildCode].filter(Boolean).join('-')
    || '—';
  return {
    ref,
    area: p.name || p.areaId || '—',
    stage: (state?.stage || '—').toString().toUpperCase(),
    hp: String((state?.addressPoints || []).length),
    date: new Date().toLocaleDateString('en-GB'),
  };
}

// ── orchestration ────────────────────────────────────────────────────────────
export async function captureSheetSVG(map, state, opts = {}) {
  const canvas = map.getCanvas();
  const mapW = canvas.width;
  const mapH = canvas.height;
  const mapPng = await captureMapPng(map);
  const totals = computeTotals(state);
  const bar = scaleBar(map, mapW);
  const meta = metaFromState(state);
  return buildSVG({ mapPng, mapW, mapH, totals, bar, meta, company: opts.company });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function svgToPngBlob(svg, w, h) {
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise(res => c.toBlob(res, 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function exportSheet(map, state, opts = {}) {
  const format = opts.format === 'png' ? 'png' : 'svg';
  const base = (opts.filenameBase || state?.project?.areaId || 'conductor-map')
    .toString().replace(/[^\w.-]+/g, '_');
  const svg = await captureSheetSVG(map, state, opts);

  if (format === 'svg') {
    downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), base + '.svg');
    return;
  }
  // png: derive sheet dimensions from the SVG header
  const wm = svg.match(/width="(\d+)"/);
  const hm = svg.match(/height="(\d+)"/);
  const w = wm ? parseInt(wm[1], 10) : map.getCanvas().width;
  const h = hm ? parseInt(hm[1], 10) : map.getCanvas().height;
  const blob = await svgToPngBlob(svg, w, h);
  downloadBlob(blob, base + '.png');
}
