// cadExport.js — vector "technical HLD" sheet export for Conductor Web. (BETA)
//
// Unlike mapExport.js (which screenshots the live MapLibre canvas), this plots
// every asset as crisp SVG projected onto an A3-landscape page, in the style of
// the Gigaloch technical HLD handed to contractors: a light greyscale road/
// building wireframe underneath, the full network drawn as vector lines and
// symbols, node IDs called out, duct/span lengths annotated, PIA-vs-built
// distinguished by BOTH colour and linetype (so it still reads printed mono),
// road crossings picked out, plus title blocks, legend, scale bar, north arrow
// and the Gigaloch logo.
//
// This module is fully ADDITIVE — it touches nothing in the existing export or
// map code. Phase 1 plots the CURRENT VIEW (2D only). PON partitioning and the
// interactive per-PON HTML are later phases that reuse this same renderer.
//
// Public API:
//   exportCadSheet(map, state, opts)  → Promise<void>   (builds + downloads)
//     opts: { format:'svg'|'png', filenameBase, company, contact, office }

import { GIGALOCH_LOGO, GIGALOCH_LOGO_W, GIGALOCH_LOGO_H } from './gigalochLogo.js';

// Bump on every change to the sheet renderer. Stamped into the title block so a
// printed/exported sheet always says which version of the plotter drew it —
// otherwise "is that the new code?" costs a debugging round to answer.
const CAD_VERSION = 'v0.4';

// ── page geometry (A3 landscape) ─────────────────────────────────────────────
const PAGE_W = 1587, PAGE_H = 1123;      // A3 @ ~96dpi (SVG is resolution-independent)
const A3_MM_W = 420;                     // used for the 1:N scale-denominator maths
const MARGIN = 22;
const STRIP_H = 232;                     // bottom title/legend strip height

// ── light CAD theme ──────────────────────────────────────────────────────────
const INK   = '#1a1a1a';
const FAINT = '#666666';
const BASE_BLDG = '#e9e9e9';             // building footprints
const BASE_BLDG_EDGE = '#d3d3d3';
const BASE_ROAD = '#a8a8a8';             // road wireframe — light grey: visible on paper, quiet behind the network
const TABLE_EDGE = '#333333';

// ── network styling (print-legible on white; PIA gets colour + dash) ─────────
const PIA_COLOR = '#d07a00';             // Openreach / PIA
const XING_COLOR = '#d00000';            // road / stream crossing emphasis
const LINE_LAYERS = [
  { key: 'ducts',       label: 'Duct',        color: '#0050a0', w: 2.0, dash: null,  callout: true  },
  { key: 'dropDucts',   label: 'Drop Duct',   color: '#009488', w: 1.4, dash: null,  callout: false },
  { key: 'cables',      label: 'Cable',       color: '#c01080', w: 1.6, dash: '6,4', callout: false },
  { key: 'bundles',     label: 'Bundle',      color: '#666666', w: 1.4, dash: null,  callout: false },
  { key: 'spans',       label: 'Aerial Span', color: '#0060c0', w: 1.8, dash: null,  callout: true  },
  { key: 'aerialDrops', label: 'Aerial Drop', color: '#d07a00', w: 1.2, dash: '2,3', callout: false },
  { key: 'cbtTails',    label: 'CBT Tail',    color: '#b0006a', w: 1.6, dash: '5,3', callout: false },
];
const POINT_LAYERS = [
  { key: 'chambers',      label: 'Chamber',  shape: 'square-open',   color: '#222222', idProp: 'chamber_id' },
  { key: 'joints',        label: 'Joint',    shape: 'square-fill',   color: '#0050a0', idProp: 'joint_id'   },
  { key: 'poles',         label: 'Pole',     shape: 'circle-open',   color: '#222222', idProp: 'pole_id'    },
  { key: 'cbts',          label: 'CBT',      shape: 'star',          color: '#b0006a', idProp: 'cbt_id'     },
  { key: 'addressPoints', label: 'Premises', shape: 'dot',           color: '#3a8f8f', idProp: null         },
];

const isPIA = f => f?.properties?.installation_method === 'PIA_UG' || f?.properties?.owner === 'Openreach';
const isCrossing = f => !!f?.properties?.crossing_type;

// ── base transport network styling ───────────────────────────────────────────
// EVERY transport route is plotted regardless of size — carriageways, streets,
// service roads, tracks, paths. Weight varies by class so the hierarchy still
// reads, but nothing is filtered out. (The live map's `roads-neon` layer is
// deliberately NOT used as the source here: it filters to major classes only
// and is toggle-dependent, so the sheet would silently lose minor roads.)
const ROAD_MAJOR = new Set(['motorway', 'trunk', 'primary']);
const ROAD_MID   = new Set(['secondary', 'tertiary', 'minor', 'residential', 'unclassified', 'living_street']);
const ROAD_TRACK = new Set(['track', 'path', 'footway', 'cycleway', 'bridleway', 'steps', 'pedestrian']);
function roadStyle(cls) {
  if (ROAD_MAJOR.has(cls)) return { w: 1.8, dash: null };
  if (ROAD_MID.has(cls))   return { w: 1.2, dash: null };
  if (ROAD_TRACK.has(cls)) return { w: 0.8, dash: '5,3' };   // tracks/paths dashed, CAD convention
  if (cls === 'rail')      return { w: 1.0, dash: '8,4' };
  return { w: 1.0, dash: null };                             // service + anything unrecognised
}

// Pull every transport feature actually rendered on screen. We derive the
// basemap's own road layers from the style — any line layer bound to the
// 'transportation' source-layer ('Road network', 'Path', 'Railway', bridges,
// tunnels…) — rather than hard-coding names, so this survives a basemap switch.
// Our decorative roads-neon/roads-glow are excluded: they're filtered to major
// classes and would only double-draw what the basemap layers already give us.
// (queryRenderedFeatures is used deliberately over querySourceFeatures: the
// latter reads tile caches and under-reports badly at high zoom.)
function collectRoads(map) {
  let ids = [];
  try {
    ids = (map.getStyle().layers || [])
      .filter(l => l['source-layer'] === 'transportation'
                && l.type === 'line'
                && !/^roads-(neon|glow)$/.test(l.id))
      .map(l => l.id)
      .filter(id => { try { return !!map.getLayer(id); } catch (e) { return false; } });
  } catch (e) { return []; }
  if (!ids.length) return [];
  try { return map.queryRenderedFeatures({ layers: ids }) || []; } catch (e) { return []; }
}

// ── small helpers (self-contained; not shared with mapExport.js) ─────────────
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function haversineM(a, b) {
  const R = 6371008.8, r = d => (d * Math.PI) / 180;
  const dLat = r(b[1] - a[1]), dLng = r(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a[1])) * Math.cos(r(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function svgToPngBlob(svg, w, h) {
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return await new Promise(res => c.toBlob(res, 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}

// ── geometry iteration helpers ───────────────────────────────────────────────
function eachLineString(geom, cb) {
  if (!geom) return;
  if (geom.type === 'LineString') cb(geom.coordinates);
  else if (geom.type === 'MultiLineString') geom.coordinates.forEach(cb);
}
function eachRing(geom, cb) {
  if (!geom) return;
  if (geom.type === 'Polygon') geom.coordinates.forEach(cb);
  else if (geom.type === 'MultiPolygon') geom.coordinates.forEach(poly => poly.forEach(cb));
}

// ── main sheet builder ───────────────────────────────────────────────────────
function buildCadSVG(map, state, opts) {
  const cont = map.getContainer();
  const vw = cont.clientWidth || 1200;
  const vh = cont.clientHeight || 800;

  // map frame = page minus margins and the bottom strip; fit viewport into it.
  const frame = { x: MARGIN, y: MARGIN, w: PAGE_W - MARGIN * 2, h: PAGE_H - MARGIN * 2 - STRIP_H };
  const k = Math.min(frame.w / vw, frame.h / vh);
  const offX = frame.x + (frame.w - vw * k) / 2;
  const offY = frame.y + (frame.h - vh * k) / 2;
  const P = lngLat => { const p = map.project(lngLat); return [offX + p.x * k, offY + p.y * k]; };
  const pathD = coords => coords.map((c, i) => (i ? 'L' : 'M') + P(c)[0].toFixed(1) + ' ' + P(c)[1].toFixed(1)).join(' ');

  const s = state || {};
  const out = [];

  // ── 0. paper + frame ──
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}" height="${PAGE_H}" viewBox="0 0 ${PAGE_W} ${PAGE_H}" font-family="Arial, Helvetica, sans-serif">`);
  out.push(`<rect x="0" y="0" width="${PAGE_W}" height="${PAGE_H}" fill="#ffffff"/>`);
  out.push(`<clipPath id="mapclip"><rect x="${frame.x}" y="${frame.y}" width="${frame.w}" height="${frame.h}"/></clipPath>`);
  out.push(`<g clip-path="url(#mapclip)">`);

  // ── 1. wireframe base (rendered building + road features in view) ──
  let bldgs = [];
  try { bldgs = map.queryRenderedFeatures({ layers: ['buildings-3d'] }); } catch (e) {}
  const seenB = new Set();
  for (const f of bldgs) {
    const id = f.id ?? JSON.stringify(f.geometry?.coordinates?.[0]?.[0]);
    if (seenB.has(id)) continue; seenB.add(id);
    eachRing(f.geometry, ring => out.push(`<path d="${pathD(ring)} Z" fill="${BASE_BLDG}" stroke="${BASE_BLDG_EDGE}" stroke-width="0.6"/>`));
  }

  // Roads: full transport network from the basemap's own layers. No viewport
  // culling — the clip path already bounds the frame, and culling here was one
  // more way for roads to silently vanish.
  const seenR = new Set();
  for (const f of collectRoads(map)) {
    // The same road comes back from several style layers (casing + fill +
    // bridge/tunnel variants) — draw each real feature once.
    const rid = (f.id != null ? 'i' + f.id : '') + '|' + (f.properties?.class || '') + '|' +
                (f.properties?.name || '') + '|' + JSON.stringify(f.geometry?.coordinates?.[0] || '');
    if (seenR.has(rid)) continue;
    seenR.add(rid);
    const st = roadStyle(f.properties?.class);
    eachLineString(f.geometry, ls => {
      if (ls.length < 2) return;
      const da = st.dash ? ` stroke-dasharray="${st.dash}"` : '';
      out.push(`<path d="${pathD(ls)}" fill="none" stroke="${BASE_ROAD}" stroke-width="${st.w}" stroke-linecap="round" stroke-linejoin="round"${da}/>`);
    });
  }

  // ── 2. build-area boundary ──
  if (s.buildArea?.geometry) eachRing(s.buildArea.geometry, ring => out.push(`<path d="${pathD(ring)} Z" fill="none" stroke="#0050a0" stroke-width="1.4" stroke-dasharray="10,6"/>`));

  // ── 3. network lines (+ length call-outs) ──
  const calloutSvg = [];
  for (const L of LINE_LAYERS) {
    for (const f of (s[L.key] || [])) {
      let color = L.color, w = L.w, dash = L.dash;
      if (isPIA(f))      { color = PIA_COLOR; dash = '7,4'; }
      if (isCrossing(f)) { color = XING_COLOR; w = 4; dash = null; }
      const da = dash ? ` stroke-dasharray="${dash}"` : '';
      eachLineString(f.geometry, ls => {
        out.push(`<path d="${pathD(ls)}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"${da}/>`);
        if (L.callout && f.properties?.length_m != null) {
          // annotate at the longest on-page segment midpoint, rotated to it
          let best = -1, bx = 0, by = 0, ang = 0;
          for (let i = 0; i < ls.length - 1; i++) {
            const a = P(ls[i]), b = P(ls[i + 1]);
            const dpx = Math.hypot(b[0] - a[0], b[1] - a[1]);
            if (dpx > best) { best = dpx; bx = (a[0] + b[0]) / 2; by = (a[1] + b[1]) / 2; ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI; }
          }
          if (best > 28) {
            if (ang > 90 || ang < -90) ang += 180;   // keep text upright
            const len = Number(f.properties.length_m).toFixed(2);
            calloutSvg.push(`<text x="${bx.toFixed(1)}" y="${(by - 3).toFixed(1)}" transform="rotate(${ang.toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)})" fill="${INK}" font-size="8.5" text-anchor="middle">${esc(len)}</text>`);
          }
        }
      });
    }
  }
  out.push(calloutSvg.join(''));

  // ── 4. point symbols + ID labels ──
  const drawPoint = (shape, x, y, color) => {
    x = x.toFixed(1); y = y.toFixed(1);
    if (shape === 'square-open')  return `<rect x="${x - 3.5}" y="${y - 3.5}" width="7" height="7" fill="#fff" stroke="${color}" stroke-width="1.3"/>`;
    if (shape === 'square-fill')  return `<rect x="${x - 3}" y="${y - 3}" width="6" height="6" fill="${color}"/>`;
    if (shape === 'circle-open')  return `<circle cx="${x}" cy="${y}" r="3.2" fill="#fff" stroke="${color}" stroke-width="1.3"/>`;
    if (shape === 'star')         return `<circle cx="${x}" cy="${y}" r="4.5" fill="${color}"/><circle cx="${x}" cy="${y}" r="1.6" fill="#fff"/>`;
    return `<circle cx="${x}" cy="${y}" r="1.8" fill="${color}"/>`;  // dot
  };
  const labelSvg = [];
  for (const PL of POINT_LAYERS) {
    for (const f of (s[PL.key] || [])) {
      if (!f.geometry?.coordinates) continue;
      const [x, y] = P(f.geometry.coordinates);
      const color = (PL.key === 'chambers' && isPIA(f)) ? PIA_COLOR : PL.color;
      out.push(drawPoint(PL.shape, x, y, color));
      if (PL.idProp && f.properties?.[PL.idProp]) {
        const shortId = String(f.properties[PL.idProp]).split('-').slice(-2).join('-');
        labelSvg.push(`<text x="${(x + 6).toFixed(1)}" y="${(y + 3).toFixed(1)}" fill="${INK}" font-size="8">${esc(shortId)}</text>`);
      }
    }
  }
  // cabinet / POP
  if (s.cabinet?.geometry) {
    const [x, y] = P(s.cabinet.geometry.coordinates);
    out.push(`<rect x="${(x - 5).toFixed(1)}" y="${(y - 5).toFixed(1)}" width="10" height="10" fill="#d00000" stroke="#000" stroke-width="1"/>`);
    if (s.cabinet.properties?.pop_id) labelSvg.push(`<text x="${(x + 8).toFixed(1)}" y="${(y + 3).toFixed(1)}" fill="${INK}" font-size="9" font-weight="bold">${esc(s.cabinet.properties.pop_id)}</text>`);
  }
  out.push(labelSvg.join(''));
  out.push(`</g>`);   // end map clip

  // ── 5. map frame border + north arrow + scale bar ──
  out.push(`<rect x="${frame.x}" y="${frame.y}" width="${frame.w}" height="${frame.h}" fill="none" stroke="${TABLE_EDGE}" stroke-width="1"/>`);
  const nx = frame.x + frame.w - 30, ny = frame.y + 34;
  out.push(`<g transform="translate(${nx},${ny})"><polygon points="0,-12 6,10 0,4 -6,10" fill="${INK}"/><text x="0" y="26" fill="${INK}" font-size="12" text-anchor="middle" font-weight="bold">N</text></g>`);

  // scale bar (bottom-right of the map frame). Valid because export is 2D-only.
  const b = map.getBounds(), latC = map.getCenter().lat;
  const groundW = haversineM([b.getWest(), latC], [b.getEast(), latC]);
  const mapPxW = vw * k;                          // on-page width of the viewport
  const mPerPx = groundW / mapPxW;
  const targetPx = frame.w * 0.16;
  const raw = mPerPx * targetPx;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  let step = pow; for (const m of [1, 2, 5, 10]) if (m * pow <= raw) step = m * pow;
  const barPx = step / mPerPx;
  const sbx = frame.x + frame.w - barPx - 24, sby = frame.y + frame.h - 24;
  const seg = barPx / 4;
  const sb = [`<rect x="${sbx - 6}" y="${sby - 24}" width="${barPx + 60}" height="34" fill="#ffffffcc"/>`];
  for (let i = 0; i < 4; i++) sb.push(`<rect x="${(sbx + i * seg).toFixed(1)}" y="${sby - 4}" width="${seg.toFixed(1)}" height="6" fill="${i % 2 ? '#fff' : INK}" stroke="${INK}" stroke-width="0.8"/>`);
  for (let i = 0; i <= 4; i++) sb.push(`<text x="${(sbx + i * seg).toFixed(1)}" y="${sby - 8}" fill="${INK}" font-size="8" text-anchor="middle">${Math.round((step / 4) * i)}</text>`);
  sb.push(`<text x="${(sbx + barPx + 8).toFixed(1)}" y="${sby + 2}" fill="${INK}" font-size="9">m</text>`);
  out.push(sb.join(''));

  // 1:N scale denominator (ground mm / page mm across the frame)
  const frameMmW = (mapPxW / PAGE_W) * A3_MM_W;
  const scaleDenom = Math.round((groundW * 1000) / frameMmW);

  // ── 6. bottom strip: project table | legend | company table + logo ──
  const stripY = PAGE_H - MARGIN - STRIP_H;
  out.push(`<line x1="${MARGIN}" y1="${stripY - 6}" x2="${PAGE_W - MARGIN}" y2="${stripY - 6}" stroke="${TABLE_EDGE}" stroke-width="0.8"/>`);

  const p = s.project || {};
  const ref = p.areaId || [p.countryCode, p.buildCode].filter(Boolean).join('-') || '—';
  const meta = {
    ref, hp: String((s.addressPoints || []).length),
    area: p.name || p.areaId || '—',
    stage: (s.stage || '—').toString().toUpperCase(),
    date: new Date().toLocaleDateString('en-GB'),
  };

  // project table (left)
  const tbl = (x, y, w, rows, rowH = 22, labelW = 120) => {
    const g = [`<rect x="${x}" y="${y}" width="${w}" height="${rows.length * rowH}" fill="none" stroke="${TABLE_EDGE}" stroke-width="1"/>`];
    rows.forEach(([kk, vv], i) => {
      const ry = y + i * rowH;
      if (i) g.push(`<line x1="${x}" y1="${ry}" x2="${x + w}" y2="${ry}" stroke="${TABLE_EDGE}" stroke-width="0.6"/>`);
      g.push(`<line x1="${x + labelW}" y1="${ry}" x2="${x + labelW}" y2="${ry + rowH}" stroke="${TABLE_EDGE}" stroke-width="0.6"/>`);
      g.push(`<text x="${x + 6}" y="${ry + rowH - 7}" fill="${FAINT}" font-size="9">${esc(kk)}</text>`);
      g.push(`<text x="${x + labelW + 6}" y="${ry + rowH - 7}" fill="${INK}" font-size="9.5" font-weight="bold">${esc(vv)}</text>`);
    });
    return g.join('');
  };
  out.push(tbl(MARGIN, stripY + STRIP_H - 4 - 5 * 22, 300, [
    ['PROJECT REFERENCE', meta.ref], ['HP TOTAL', meta.hp], ['AREA', meta.area], ['STAGE', meta.stage],
    ['SHEET', 'CAD ' + CAD_VERSION + ' (beta)'],
  ]));

  // company table (right) + logo
  const compW = 300, compX = PAGE_W - MARGIN - compW;
  out.push(tbl(compX, stripY + STRIP_H - 4 - 5 * 22, compW, [
    ['COMPANY', opts.company || 'GIGALOCH'],
    ['CONTACT', opts.contact || '0800 046 7996'],
    ['DATE', meta.date],
    ['OFFICE', opts.office || '—'],
    ['SCALE', '1:' + scaleDenom],
  ], 22, 90));
  const logoW = 150, logoH = logoW * (GIGALOCH_LOGO_H / GIGALOCH_LOGO_W);
  out.push(`<image x="${compX + compW - logoW}" y="${stripY + 6}" width="${logoW}" height="${logoH}" href="${GIGALOCH_LOGO}"/>`);

  // legend (centre): only entries actually present, grouped
  const present = k2 => (s[k2] || []).length > 0;
  const anyPIA = LINE_LAYERS.concat(POINT_LAYERS).some(L => (s[L.key] || []).some(isPIA));
  const anyXing = (s.ducts || []).some(isCrossing) || (s.dropDucts || []).some(isCrossing);
  const legItems = [];
  for (const L of LINE_LAYERS) if (present(L.key)) legItems.push({ kind: 'line', label: L.label, color: L.color, dash: L.dash });
  if (anyPIA)  legItems.push({ kind: 'line', label: 'PIA / Openreach', color: PIA_COLOR, dash: '7,4' });
  if (anyXing) legItems.push({ kind: 'line', label: 'Road/Stream Crossing', color: XING_COLOR, dash: null, w: 4 });
  for (const PL of POINT_LAYERS) if (present(PL.key)) legItems.push({ kind: PL.shape, label: PL.label, color: PL.color });
  if (s.cabinet) legItems.push({ kind: 'square-fill', label: 'Cabinet / POP', color: '#d00000' });

  const legX = MARGIN + 320, legTop = stripY + 8, legColW = 190, legRowH = 20, legMaxRows = 9;
  out.push(`<text x="${legX}" y="${legTop + 4}" fill="${FAINT}" font-size="10" letter-spacing="1.2">LEGEND</text>`);
  legItems.forEach((it, i) => {
    const col = Math.floor(i / legMaxRows), row = i % legMaxRows;
    const x = legX + col * legColW, y = legTop + 22 + row * legRowH;
    if (it.kind === 'line') {
      const da = it.dash ? ` stroke-dasharray="${it.dash}"` : '';
      out.push(`<line x1="${x}" y1="${y - 4}" x2="${x + 28}" y2="${y - 4}" stroke="${it.color}" stroke-width="${it.w || 2.5}"${da}/>`);
    } else if (it.kind === 'square-open') { out.push(`<rect x="${x + 9}" y="${y - 11}" width="8" height="8" fill="#fff" stroke="${it.color}" stroke-width="1.3"/>`); }
    else if (it.kind === 'square-fill')   { out.push(`<rect x="${x + 9}" y="${y - 11}" width="8" height="8" fill="${it.color}"/>`); }
    else if (it.kind === 'star')          { out.push(`<circle cx="${x + 13}" cy="${y - 7}" r="5" fill="${it.color}"/><circle cx="${x + 13}" cy="${y - 7}" r="1.8" fill="#fff"/>`); }
    else if (it.kind === 'dot')           { out.push(`<circle cx="${x + 13}" cy="${y - 7}" r="2.2" fill="${it.color}"/>`); }
    else                                  { out.push(`<circle cx="${x + 13}" cy="${y - 7}" r="4" fill="#fff" stroke="${it.color}" stroke-width="1.3"/>`); }
    out.push(`<text x="${x + 40}" y="${y}" fill="${INK}" font-size="9.5">${esc(it.label)}</text>`);
  });

  out.push(`</svg>`);
  return out.join('\n');
}

// ── public entry ─────────────────────────────────────────────────────────────
export async function exportCadSheet(map, state, opts = {}) {
  const format = opts.format === 'png' ? 'png' : 'svg';
  const base = (opts.filenameBase || state?.project?.areaId || 'conductor-cad')
    .toString().replace(/[^\w.-]+/g, '_') + '_CAD';
  const svg = buildCadSVG(map, state, opts);
  if (format === 'svg') {
    downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), base + '.svg');
    return;
  }
  const blob = await svgToPngBlob(svg, PAGE_W, PAGE_H);
  downloadBlob(blob, base + '.png');
}
