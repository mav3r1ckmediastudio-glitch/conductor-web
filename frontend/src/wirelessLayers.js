// wirelessLayers.js
// MapLibre sources/layers for the wireless layer + the coverage image overlay.
// Owns NO project state: everything is derived from a state snapshot handed in
// by syncToMap(), so the map can never disagree with the store.

import { emptyFC } from './mapGeom.js';
import { destinationPoint } from './wirelessGeo.js';
import { globalPixelToLngLat } from './wirelessTerrain.js';
import { hashWirelessInputs } from './wirelessInputs.js';
import { num } from './wirelessAnalysis.js';

export const WL = {
  linksSrc: 'wireless-links-src', sitesSrc: 'wireless-sites-src', fansSrc: 'wireless-fans-src',
  rubberSrc: 'wireless-rubber-src', coverageSrc: 'wireless-coverage-src',
  coverageLayer: 'wireless-coverage-layer', fansFill: 'wireless-fans-fill', fansLine: 'wireless-fans-line',
  linksGlow: 'wireless-links-glow', linksLayer: 'wireless-links-layer', rubberLayer: 'wireless-rubber-layer',
  sitesLayer: 'wireless-sites-layer', sitesLabel: 'wireless-sites-label',
  // Draggable aiming handles: one per placed sector, plus a ghost for the sector
  // whose form is open (create or edit), which is drawn but not yet saved.
  towersSrc: 'wireless-towers-src', towersLayer: 'wireless-towers-3d',
  aimSrc: 'wireless-aim-src', aimLine: 'wireless-aim-line', aimHandle: 'wireless-aim-handle',
  previewSrc: 'wireless-aim-preview-src', previewFill: 'wireless-aim-preview-fill', previewLine: 'wireless-aim-preview-line',
  previewAim: 'wireless-aim-preview-aim', previewHandle: 'wireless-aim-preview-handle',
};

/** Ground footprint radius (m) drawn for a site's 3D tower extrusion. Visual only, not an engineering dimension. */
const TOWER_FOOTPRINT_M = 4;

/** A small circular ground footprint for a site's tower, extruded to its real (stored) mast_height_m. */
export function circlePolygon(center, radiusM, steps = 16) {
  const ring = [];
  for (let i = 0; i <= steps; i++) ring.push(destinationPoint(center, (360 * i) / steps, radiusM));
  return { type: 'Polygon', coordinates: [ring.map(p => [p.lng, p.lat])] };
}

/** Longest fan radius drawn on the map (m): the analysis range limit. The fan shows the sector's true range. */
export const FAN_MAX_M = 30000;
/** The aiming handle sits on the boresight at most this far (m) from the mast, so it stays reachable when zoomed in. */
export const HANDLE_MAX_M = 1200;

const COLOURS = { pass: '#3ddc97', fail: '#ff5c5c', unverified: '#4dc8ff' };

// ── Coverage colour ramp (absolute dBm, weak -> strong) ─────────────────────
export const COVERAGE_STOPS = [
  [-95, [31, 59, 115]], [-85, [31, 154, 201]], [-75, [63, 208, 165]],
  [-65, [197, 232, 108]], [-55, [255, 176, 59]], [-45, [255, 77, 77]],
];
export function colourForDbm(dbm) {
  const s = COVERAGE_STOPS;
  if (dbm <= s[0][0]) return s[0][1];
  if (dbm >= s[s.length - 1][0]) return s[s.length - 1][1];
  for (let i = 1; i < s.length; i++) {
    if (dbm <= s[i][0]) {
      const [d0, c0] = s[i - 1], [d1, c1] = s[i], t = (dbm - d0) / (d1 - d0);
      return [0, 1, 2].map(k => Math.round(c0[k] + (c1[k] - c0[k]) * t));
    }
  }
  return s[s.length - 1][1];
}

/** Sector wedge polygon (display only). Radius is capped so wedges stay readable at map scale. */
export function sectorFanPolygon(center, azimuthDeg, beamwidthDeg, radiusM) {
  const half = beamwidthDeg / 2, steps = Math.max(2, Math.ceil(beamwidthDeg / 6));
  const ring = [[center.lng, center.lat]];
  for (let i = 0; i <= steps; i++) {
    const p = destinationPoint(center, azimuthDeg - half + (beamwidthDeg * i) / steps, radiusM);
    ring.push([p.lng, p.lat]);
  }
  ring.push([center.lng, center.lat]);
  return { type: 'Polygon', coordinates: [ring] };
}

/**
 * The aiming line (site -> handle on the boresight) and its drag handle for one
 * sector. `props` ride on both so a drag knows which sector, site and beam it is.
 */
export function sectorAimFeatures(center, azimuthDeg, beamwidthDeg, rangeM, props = {}) {
  const r = Math.min(rangeM, FAN_MAX_M), tip = destinationPoint(center, azimuthDeg, Math.min(r, HANDLE_MAX_M));
  const meta = { ...props, lng: center.lng, lat: center.lat, bw: beamwidthDeg, r };   // r = the sector's range, for redrawing the fan
  return [
    { type: 'Feature', properties: meta, geometry: { type: 'LineString', coordinates: [[center.lng, center.lat], [tip.lng, tip.lat]] } },
    { type: 'Feature', properties: meta, geometry: { type: 'Point', coordinates: [tip.lng, tip.lat] } },
  ];
}

/** Per-link display state from the stored analysis, only if it is fresh. */
export function linkDisplayStates(state) {
  const a = state.wirelessAnalysis;
  const fresh = !!a && a.inputHash === hashWirelessInputs(state);
  const byId = new Map(fresh ? a.links.map(l => [l.link_id, l.verdict]) : []);
  return (id) => (byId.get(id) === 'PASS' ? 'pass' : byId.get(id) === 'FAIL' ? 'fail' : 'unverified');
}

export function buildDisplayCollections(state) {
  const stateOf = linkDisplayStates(state);
  const sitesByIdForLinks = new Map((state.wirelessSites || []).map(s => [s.properties?.site_id, s]));
  const hasRealTower = (siteId) => {
    const h = num(sitesByIdForLinks.get(siteId)?.properties?.mast_height_m);
    return h != null && h > 0;
  };
  const links = (state.wirelessLinks || []).map(f => ({ ...f, properties: { ...f.properties,
    _state: stateOf(f.properties?.link_id),
    _hasTower3D: hasRealTower(f.properties?.site_a) && hasRealTower(f.properties?.site_b) } }));
  const fans = [], aim = [];
  const sitesById = new Map((state.wirelessSites || []).map(s => [s.properties?.site_id, s]));
  for (const sec of state.wirelessSectors || []) {
    const p = sec.properties || {}, site = sitesById.get(p.site_id), c = (site || sec).geometry?.coordinates;
    // num() maps '' / null / junk to null — never to 0 — so an incomplete sector is not drawn pointing north.
    const az = num(p.azimuth_deg), bw = num(p.beamwidth_deg);
    if (!c || az == null || bw == null || bw <= 0) continue;
    const r = Math.min(num(p.range_m) ?? 1000, FAN_MAX_M);
    fans.push({ type: 'Feature', properties: { sector_id: p.sector_id }, geometry: sectorFanPolygon({ lng: c[0], lat: c[1] }, az, Math.min(bw, 359), r) });
    aim.push(...sectorAimFeatures({ lng: c[0], lat: c[1] }, az, Math.min(bw, 359), r, { sector_id: p.sector_id }));
  }
  const towers = [];
  for (const site of state.wirelessSites || []) {
    const c = site.geometry?.coordinates, h = num(site.properties?.mast_height_m);
    if (!c || h == null || h <= 0) continue;    // real, stored height only — never a guessed one
    towers.push({ type: 'Feature', properties: { site_id: site.properties?.site_id, mast_height_m: h },
      geometry: circlePolygon({ lng: c[0], lat: c[1] }, TOWER_FOOTPRINT_M) });
  }
  return { sites: state.wirelessSites || [], links, fans, aim, towers };
}

// ── Coverage overlay state (survives basemap switches) ──────────────────────
let _coverage = null;   // { url, coordinates }
let _last = {};
let _aim = [];          // stored-sector handles, kept so they can be hidden/shown
let _aimHidden = false;
let _preview = null;    // ghost fan + handle for the open sector form / a drag in progress

export function ensureWirelessLayers(map) {
  _last = {};
  const add = (id, spec) => { if (!map.getSource(id)) map.addSource(id, spec); };
  add(WL.fansSrc,   { type: 'geojson', data: emptyFC() });
  add(WL.linksSrc,  { type: 'geojson', data: emptyFC() });
  add(WL.sitesSrc,  { type: 'geojson', data: emptyFC() });
  add(WL.rubberSrc, { type: 'geojson', data: emptyFC() });
  add(WL.towersSrc,  { type: 'geojson', data: emptyFC() });
  add(WL.aimSrc,     { type: 'geojson', data: emptyFC() });
  add(WL.previewSrc, { type: 'geojson', data: emptyFC() });

  if (_coverage && !map.getSource(WL.coverageSrc)) {
    map.addSource(WL.coverageSrc, { type: 'image', url: _coverage.url, coordinates: _coverage.coordinates });
  }
  const anchor = map.getLayer('addresses-clusters') ? 'addresses-clusters' : undefined;
  if (map.getSource(WL.coverageSrc) && !map.getLayer(WL.coverageLayer)) {
    map.addLayer({ id: WL.coverageLayer, type: 'raster', source: WL.coverageSrc, paint: { 'raster-opacity': 0.75, 'raster-fade-duration': 0 } }, anchor);
  }
  if (!map.getLayer(WL.fansFill)) {
    map.addLayer({ id: WL.fansFill, type: 'fill', source: WL.fansSrc, paint: { 'fill-color': '#4dc8ff', 'fill-opacity': 0.10 } });
    map.addLayer({ id: WL.fansLine, type: 'line', source: WL.fansSrc, paint: { 'line-color': '#4dc8ff', 'line-width': 1, 'line-opacity': 0.6 } });
  }
  if (!map.getLayer(WL.linksLayer)) {
    const linkOpacity = ['case', ['get', '_hasTower3D'], 0, 1];
    map.addLayer({ id: WL.linksGlow, type: 'line', source: WL.linksSrc, layout: { 'line-cap': 'round' },
      paint: { 'line-color': ['match', ['get', '_state'], 'pass', COLOURS.pass, 'fail', COLOURS.fail, COLOURS.unverified], 'line-width': 8, 'line-opacity': ['*', 0.18, linkOpacity], 'line-blur': 4 } });
    map.addLayer({ id: WL.linksLayer, type: 'line', source: WL.linksSrc, layout: { 'line-cap': 'round' },
      paint: { 'line-color': ['match', ['get', '_state'], 'pass', COLOURS.pass, 'fail', COLOURS.fail, COLOURS.unverified],
               'line-width': 2.5, 'line-opacity': linkOpacity,
               'line-dasharray': ['match', ['get', '_state'], 'unverified', ['literal', [3, 2]], ['literal', [1, 0]]] } });
    map.addLayer({ id: WL.rubberLayer, type: 'line', source: WL.rubberSrc, paint: { 'line-color': '#ffffff', 'line-width': 1.5, 'line-dasharray': [2, 2], 'line-opacity': 0.8 } });
  }
  // Real, measured mast height (mast_height_m) — solid and fully opaque,
  // deliberately more confident-looking than forestry's dashed/translucent
  // "typical, not measured" style (see mapSources.js).
  if (!map.getLayer(WL.towersLayer)) {
    map.addLayer({ id: WL.towersLayer, type: 'fill-extrusion', source: WL.towersSrc,
      paint: { 'fill-extrusion-color': '#4dc8ff', 'fill-extrusion-height': ['get', 'mast_height_m'], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.75 } });
  }
  if (!map.getLayer(WL.sitesLayer)) {
    // Sites with a real 3D tower (PoleLayers.js, mast_height_m > 0) show their
    // marker up there instead — this flat 2D marker+label fades out for those,
    // staying solid only for a site with no height set yet (so there's still
    // something to see/click for it). Opacity, not a filter: pickWirelessSite
    // (wirelessTools.js) hit-tests this exact layer via queryRenderedFeatures,
    // which needs every site still present in it, tower or not, to keep
    // "click a site to attach a sector/link" working for every site.
    const noTower = ['<=', ['coalesce', ['get', 'mast_height_m'], 0], 0];
    const opacityFor = ['case', noTower, 1, 0];
    map.addLayer({ id: WL.sitesLayer, type: 'circle', source: WL.sitesSrc,
      paint: { 'circle-radius': 7, 'circle-color': '#0d1520', 'circle-stroke-color': '#4dc8ff', 'circle-stroke-width': 2.5,
               'circle-opacity': opacityFor, 'circle-stroke-opacity': opacityFor } });
    map.addLayer({ id: WL.sitesLabel, type: 'symbol', source: WL.sitesSrc,
      layout: { 'text-field': ['get', 'site_id'], 'text-font': ['Noto Sans Regular'], 'text-size': 9, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-allow-overlap': true },
      paint: { 'text-color': '#a0c4d8', 'text-halo-color': '#0a0f14', 'text-halo-width': 0.4, 'text-opacity': opacityFor } });
  }
  // Aiming handles sit above everything else so they are always grabbable.
  const isLine = ['==', ['geometry-type'], 'LineString'], isPoint = ['==', ['geometry-type'], 'Point'], isPoly = ['==', ['geometry-type'], 'Polygon'];
  if (!map.getLayer(WL.aimHandle)) {
    map.addLayer({ id: WL.aimLine, type: 'line', source: WL.aimSrc, filter: isLine,
      paint: { 'line-color': '#4dc8ff', 'line-width': 1.2, 'line-dasharray': [2, 2], 'line-opacity': 0.7 } });
    map.addLayer({ id: WL.aimHandle, type: 'circle', source: WL.aimSrc, filter: isPoint,
      paint: { 'circle-radius': 6, 'circle-color': '#4dc8ff', 'circle-stroke-color': '#0a0f14', 'circle-stroke-width': 2 } });
    map.addLayer({ id: WL.previewFill, type: 'fill', source: WL.previewSrc, filter: isPoly,
      paint: { 'fill-color': '#ffcf80', 'fill-opacity': 0.16 } });
    map.addLayer({ id: WL.previewLine, type: 'line', source: WL.previewSrc, filter: isPoly,
      paint: { 'line-color': '#ffcf80', 'line-width': 1.4, 'line-dasharray': [3, 2] } });
    map.addLayer({ id: WL.previewAim, type: 'line', source: WL.previewSrc, filter: isLine,
      paint: { 'line-color': '#ffcf80', 'line-width': 1.6, 'line-dasharray': [2, 2] } });
    map.addLayer({ id: WL.previewHandle, type: 'circle', source: WL.previewSrc, filter: isPoint,
      paint: { 'circle-radius': 8, 'circle-color': '#ffcf80', 'circle-stroke-color': '#0a0f14', 'circle-stroke-width': 2 } });
  }
  putAim(map); putPreview(map);
}

function putAim(map) {
  const src = map.getSource(WL.aimSrc);
  if (src) src.setData({ type: 'FeatureCollection', features: _aimHidden ? [] : _aim });
}
function previewFeatures(pv) {
  if (!pv) return [];
  const center = { lng: pv.lng, lat: pv.lat }, out = [];
  // No azimuth yet (e.g. no premises in range): show only a handle to drag out from.
  if (pv.azimuthDeg != null) out.push({ type: 'Feature', properties: {}, geometry: sectorFanPolygon(center, pv.azimuthDeg, Math.min(pv.beamwidthDeg, 359), Math.min(pv.rangeM, FAN_MAX_M)) });
  out.push(...sectorAimFeatures(center, pv.azimuthDeg ?? 0, pv.beamwidthDeg, pv.rangeM, { sector_id: '' }));
  return out;
}
function putPreview(map) {
  const src = map.getSource(WL.previewSrc);
  if (src) src.setData({ type: 'FeatureCollection', features: previewFeatures(_preview) });
}

/**
 * Ghost fan + drag handle for the sector being created/edited or dragged.
 * pv = { lng, lat, azimuthDeg|null, beamwidthDeg, rangeM } or null to clear.
 */
export function setSectorPreview(map, pv) {
  _preview = pv;
  putPreview(map);
}

/** Hide the stored sectors' handles while a form is open (only the ghost is draggable then). */
export function setAimHandlesHidden(map, hidden) {
  if (_aimHidden === !!hidden) return;
  _aimHidden = !!hidden;
  putAim(map);
}

/** Push wireless state to the map. Skips work when nothing relevant changed by reference. */
export function syncWireless(map, state) {
  const key = [state.wirelessSites, state.wirelessLinks, state.wirelessSectors, state.wirelessSettings, state.wirelessAnalysis];
  if (_last.key && key.every((v, i) => v === _last.key[i])) return;
  const c = buildDisplayCollections(state);
  const put = (id, features) => { const src = map.getSource(id); if (src) src.setData({ type: 'FeatureCollection', features }); };
  put(WL.sitesSrc, c.sites); put(WL.linksSrc, c.links); put(WL.fansSrc, c.fans); put(WL.towersSrc, c.towers);
  _aim = c.aim; putAim(map);
  _last.key = key;
}

/** Draws a rubber-band segment while the link tool is choosing its second site. */
export function setWirelessRubber(map, coords) {
  const src = map.getSource(WL.rubberSrc);
  if (!src) return;
  src.setData(coords ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }] } : emptyFC());
}

// ── Coverage overlay ────────────────────────────────────────────────────────

/** Corner coordinates [TL, TR, BR, BL] of a grid, for a MapLibre image source. */
export function gridCorners(grid) {
  const p = (gx, gy) => { const { lng, lat } = globalPixelToLngLat(gx, gy, grid.z); return [lng, lat]; };
  return [p(grid.gxMin, grid.gyMin), p(grid.gxMin + grid.w, grid.gyMin), p(grid.gxMin + grid.w, grid.gyMin + grid.h), p(grid.gxMin, grid.gyMin + grid.h)];
}

/**
 * RGBA pixel buffer for a coverage grid whose values are best-server MARGIN (dB
 * above the sector's CPE minimum Rx). Transparent where there is no data or the
 * margin is below `thresholdDb`; otherwise coloured on the 50 dB ramp
 * (threshold = weakest colour, threshold + 50 dB = strongest).
 */
export function coverageRgba(grid, thresholdDb) {
  const out = new Uint8ClampedArray(grid.w * grid.h * 4);
  const span = COVERAGE_STOPS[COVERAGE_STOPS.length - 1][0] - COVERAGE_STOPS[0][0];
  for (let i = 0; i < grid.rxDbm.length; i++) {
    const v = grid.rxDbm[i];
    if (Number.isNaN(v) || v < thresholdDb) continue;
    const [r, g, b] = colourForDbm(COVERAGE_STOPS[0][0] + Math.min(v - thresholdDb, span));
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = 255;
  }
  return out;
}

export function setCoverageOverlay(map, grid, thresholdDb) {
  if (!grid) {
    _coverage = null;
    if (map.getLayer(WL.coverageLayer)) map.removeLayer(WL.coverageLayer);
    if (map.getSource(WL.coverageSrc)) map.removeSource(WL.coverageSrc);
    return;
  }
  const cv = document.createElement('canvas');
  cv.width = grid.w; cv.height = grid.h;
  const ctx = cv.getContext('2d');
  ctx.putImageData(new ImageData(coverageRgba(grid, thresholdDb), grid.w, grid.h), 0, 0);
  _coverage = { url: cv.toDataURL('image/png'), coordinates: gridCorners(grid) };
  const src = map.getSource(WL.coverageSrc);
  if (src) src.updateImage(_coverage);
  else ensureWirelessLayers(map);
}
