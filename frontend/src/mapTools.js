// mapTools.js — Map interaction layer for Conductor Web
// Works with projectStore.js for state. All geometry WGS84.

import { projectStore } from './projectStore.js';

// ── SOURCE / LAYER SETUP ─────────────────────────────────────────────────────

function addSquareIcon(map, name, fillColor, strokeColor, glowColor, size) {
  if (map.hasImage(name)) return;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const pad = 3;
  ctx.shadowColor = glowColor || strokeColor;
  ctx.shadowBlur = 8;
  ctx.fillStyle = fillColor;
  ctx.fillRect(pad, pad, size - pad * 2, size - pad * 2);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2;
  ctx.strokeRect(pad, pad, size - pad * 2, size - pad * 2);
  map.addImage(name, { width: size, height: size, data: ctx.getImageData(0, 0, size, size).data });
}

export function ensureSources(map) {
  addSquareIcon(map, 'icon-cabinet', '#4dc8ff', '#00aaff', '#00aaff', 22);
  addSquareIcon(map, 'icon-chamber', '#0d1520', '#ffffff', '#aaddff', 14);

  // ── Address points — clustered ─────────────────────────────────────────
  if (!map.getSource('addresses-src')) {
    map.addSource('addresses-src', {
      type: 'geojson',
      data: emptyFC(),
      cluster: true,
      clusterMaxZoom: 15,
      clusterRadius: 40,
    });

    // Cluster circles
    map.addLayer({
      id: 'addresses-clusters',
      type: 'circle',
      source: 'addresses-src',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': '#1a2d40',
        'circle-radius': ['step', ['get', 'point_count'], 10, 100, 14, 500, 18, 1000, 22],
        'circle-stroke-width': 1,
        'circle-stroke-color': '#2a4a5e',
        'circle-opacity': 0.85,
      }
    });

    // Cluster count labels
    map.addLayer({
      id: 'addresses-cluster-count',
      type: 'symbol',
      source: 'addresses-src',
      filter: ['has', 'point_count'],
      layout: {
        'text-field': '{point_count_abbreviated}',
        'text-font': ['Noto Sans Regular'],
        'text-size': 9,
      },
      paint: { 'text-color': '#7ab8d4' }
    });

    // Individual address points
    map.addLayer({
      id: 'addresses-points',
      type: 'circle',
      source: 'addresses-src',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': 2.5,
        'circle-color': '#2a4a5e',
        'circle-stroke-width': 0.5,
        'circle-stroke-color': '#3a6a80',
        'circle-opacity': 0.7,
      }
    });
  }

  // ── Build area polygon ────────────────────────────────────────────────
  if (!map.getSource('build-area-src')) {
    map.addSource('build-area-src', { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'build-area-fill',
      type: 'fill',
      source: 'build-area-src',
      paint: {
        'fill-color': '#00aaff',
        'fill-opacity': 0.06,
      }
    });
    map.addLayer({
      id: 'build-area-outline',
      type: 'line',
      source: 'build-area-src',
      paint: {
        'line-color': '#4dc8ff',
        'line-width': 2,
        'line-dasharray': [4, 2],
        'line-opacity': 0.8,
      }
    });
  }

  // ── Build area rubber-band ────────────────────────────────────────────
  if (!map.getSource('ba-rubber-src')) {
    map.addSource('ba-rubber-src', { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'ba-rubber-fill',
      type: 'fill',
      source: 'ba-rubber-src',
      paint: { 'fill-color': '#00aaff', 'fill-opacity': 0.05 }
    });
    map.addLayer({
      id: 'ba-rubber-outline',
      type: 'line',
      source: 'ba-rubber-src',
      paint: { 'line-color': '#4dc8ff', 'line-width': 1.5, 'line-dasharray': [3, 2], 'line-opacity': 0.6 }
    });
  }

  // ── Cabinet ───────────────────────────────────────────────────────────
  if (!map.getSource('cabinet-src')) {
    map.addSource('cabinet-src', { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'cabinet-layer',
      type: 'symbol',
      source: 'cabinet-src',
      layout: { 'icon-image': 'icon-cabinet', 'icon-size': 1, 'icon-allow-overlap': true, 'icon-ignore-placement': true },
    });
    map.addLayer({
      id: 'cabinet-label',
      type: 'symbol',
      source: 'cabinet-src',
      layout: {
        'text-field': ['get', 'pop_id'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 10,
        'text-offset': [0, 1.2],
        'text-anchor': 'top',
        'text-allow-overlap': true,
      },
      paint: { 'text-color': '#4dc8ff', 'text-halo-color': '#0a0f14', 'text-halo-width': 1.5 }
    });
  }

  // ── Chambers ──────────────────────────────────────────────────────────
  if (!map.getSource('chambers-src')) {
    map.addSource('chambers-src', { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'chambers-layer',
      type: 'symbol',
      source: 'chambers-src',
      layout: { 'icon-image': 'icon-chamber', 'icon-size': 1, 'icon-allow-overlap': true, 'icon-ignore-placement': true },
    });
    map.addLayer({
      id: 'chambers-label',
      type: 'symbol',
      source: 'chambers-src',
      layout: {
        'text-field': ['get', 'chamber_id'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 9,
        'text-offset': [0, 1.0],
        'text-anchor': 'top',
        'text-allow-overlap': true,
      },
      paint: { 'text-color': '#a0c4d8', 'text-halo-color': '#0a0f14', 'text-halo-width': 1.5 }
    });
  }

  // ── Ducts — source only, layer added after terrain in ensureTerrainLayers() ──
  if (!map.getSource('ducts-src')) {
    map.addSource('ducts-src', { type: 'geojson', data: emptyFC() });
  }

  // ── Rubber-band — source only, layer added after terrain ─────────────
  if (!map.getSource('rubberband-src')) {
    map.addSource('rubberband-src', { type: 'geojson', data: emptyFC() });
  }

  // ── Snap indicator ────────────────────────────────────────────────────
  if (!map.getSource('snap-src')) {
    map.addSource('snap-src', { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'snap-layer',
      type: 'circle',
      source: 'snap-src',
      paint: {
        'circle-radius': 10,
        'circle-color': 'transparent',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffaa44',
      }
    });
  }
}

// ── TERRAIN-DEPENDENT LAYERS ─────────────────────────────────────────────────
// Lines drape on terrain automatically when terrain is enabled.

export function ensureTerrainLayers(map) {
  if (!map.getLayer('ducts-layer')) {
    map.addLayer({
      id: 'ducts-layer',
      type: 'line',
      source: 'ducts-src',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#4dc8ff',
        'line-width': 2.5,
        'line-opacity': 0.9,
      }
    });
  }

  if (!map.getLayer('rubberband-layer')) {
    map.addLayer({
      id: 'rubberband-layer',
      type: 'line',
      source: 'rubberband-src',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#4dc8ff',
        'line-width': 1.5,
        'line-opacity': 0.5,
        'line-dasharray': [3, 2],
      }
    });
  }
}

// ── SYNC TO MAP ───────────────────────────────────────────────────────────────

export function syncToMap(map) {
  const s = projectStore.state;
  if (!map.getSource('addresses-src')) return;

  // Address points
  map.getSource('addresses-src').setData({
    type: 'FeatureCollection',
    features: s.addressPoints || [],
  });

  // Build area
  map.getSource('build-area-src').setData(
    s.buildArea
      ? { type: 'FeatureCollection', features: [s.buildArea] }
      : emptyFC()
  );

  // Cabinet
  map.getSource('cabinet-src').setData(
    s.cabinet
      ? { type: 'FeatureCollection', features: [s.cabinet] }
      : emptyFC()
  );

  // Chambers
  map.getSource('chambers-src').setData({
    type: 'FeatureCollection',
    features: s.chambers || [],
  });

  // Ducts
  map.getSource('ducts-src').setData({
    type: 'FeatureCollection',
    features: s.ducts || [],
  });
}

// ── TOOL MANAGEMENT ───────────────────────────────────────────────────────────

let _activeTool = null;

export function clearTool(map) {
  if (_activeTool?.cleanup) _activeTool.cleanup();
  _activeTool = null;
  if (map) {
    map.getCanvas().style.cursor = '';
    if (map.getSource('rubberband-src')) map.getSource('rubberband-src').setData(emptyFC());
    if (map.getSource('snap-src')) map.getSource('snap-src').setData(emptyFC());
    if (map.getSource('ba-rubber-src')) map.getSource('ba-rubber-src').setData(emptyFC());
  }
}

// ── BUILD AREA TOOL ───────────────────────────────────────────────────────────

export function activateBuildAreaTool(map, onFinish) {
  clearTool(map);
  map.getCanvas().style.cursor = 'crosshair';

  let vertices = []; // [[lng,lat],...]

  function updateRubber() {
    if (vertices.length < 2) return;
    const coords = [...vertices, vertices[0]]; // close the ring
    map.getSource('ba-rubber-src').setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} }]
    });
  }

  function onMousemove(e) {
    if (!vertices.length) return;
    const preview = [...vertices, [e.lngLat.lng, e.lngLat.lat], vertices[0]];
    map.getSource('ba-rubber-src').setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [preview] }, properties: {} }]
    });
  }

  function onClick(e) {
    vertices.push([e.lngLat.lng, e.lngLat.lat]);
    updateRubber();
  }

  function onContextmenu(e) {
    e.preventDefault();
    if (vertices.length < 3) {
      alert('A build area needs at least 3 points. Keep clicking to add corners, then right-click to finish.');
      return;
    }
    finish();
  }

  function finish() {
    const coords = [...vertices, vertices[0]];
    const feature = {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [coords] },
      properties: {},
    };
    // Clear rubber-band and show the finished polygon immediately
    map.getSource('ba-rubber-src').setData(emptyFC());
    map.getSource('build-area-src').setData({
      type: 'FeatureCollection',
      features: [feature],
    });
    cleanup();
    onFinish(feature);
  }

  function onKeydown(e) {
    if (e.key === 'Escape') { cleanup(); map.getCanvas().style.cursor = ''; }
    if (e.key === 'Enter' && vertices.length >= 3) finish();
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      vertices.pop();
      updateRubber();
    }
  }

  function cleanup() {
    map.off('click', onClick);
    map.off('mousemove', onMousemove);
    map.off('contextmenu', onContextmenu);
    document.removeEventListener('keydown', onKeydown);
    map.getCanvas().style.cursor = '';
  }

  map.on('click', onClick);
  map.on('mousemove', onMousemove);
  map.on('contextmenu', onContextmenu);
  document.addEventListener('keydown', onKeydown);
  _activeTool = { cleanup };
}

// ── COOKIE CUTTER ─────────────────────────────────────────────────────────────
// Hide address points outside the build area polygon using MapLibre filter.
// Uses a simple point-in-polygon test via a GeoJSON filter expression.

export function applyCookieCutter(map, buildAreaFeature) {
  if (!map.getSource('addresses-src')) return;

  const ring = buildAreaFeature.geometry.coordinates[0];

  // Filter from the store's full address list — don't read from map source internals
  const all = projectStore.state.addressPoints || [];
  if (!all.length) return;

  const inside = all.filter(f => {
    const [lng, lat] = f.geometry.coordinates;
    return pointInPolygon(lng, lat, ring);
  });

  // Update the map source directly
  map.getSource('addresses-src').setData({
    type: 'FeatureCollection',
    features: inside,
  });

  // Persist the clipped set so it survives syncToMap calls
  projectStore._state.addressPoints = inside;
  projectStore._save();
}

function pointInPolygon(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (((yi > lat) !== (yj > lat)) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// ── CABINET TOOL ──────────────────────────────────────────────────────────────

function nextPopId(areaId) {
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

export function activateCabinetTool(map, onFinish) {
  clearTool(map);
  map.getCanvas().style.cursor = 'crosshair';

  const areaId = projectStore.project?.areaId || 'XX-XX';

  function onClick(e) {
    const { lng, lat } = e.lngLat;
    onFinish({ lng, lat, pop_id: nextPopId(areaId), area_id: areaId });
    cleanup();
  }

  function onKeydown(e) {
    if (e.key === 'Escape') { cleanup(); }
  }

  function cleanup() {
    map.off('click', onClick);
    document.removeEventListener('keydown', onKeydown);
    map.getCanvas().style.cursor = '';
  }

  map.on('click', onClick);
  document.addEventListener('keydown', onKeydown);
  _activeTool = { cleanup };
}

// ── CHAMBER TOOL ─────────────────────────────────────────────────────────────

const CHAMBER_BASE = { N: 1,    S: 1001, W: 2001, E: 3001 };
const CHAMBER_MAX  = { N: 999,  S: 1999, W: 2999, E: 3999 };

function nextChamberId(areaId, direction) {
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
  return { id: `${prefix}${String(n).padStart(4,'0')}`, seq: n };
}

export function activateChamberTool(map, onFinish) {
  clearTool(map);

  if (!projectStore.cabinet) {
    return { error: 'No cabinet placed yet. Place a Cabinet/POP first.' };
  }

  map.getCanvas().style.cursor = 'crosshair';
  const [cabLng, cabLat] = projectStore.cabinet.geometry.coordinates;
  const areaId = projectStore.project?.areaId || 'XX-XX';

  function onMousemove(e) {
    const snap = _snapToNode(map, e.lngLat);
    if (snap) {
      map.getSource('snap-src').setData(pointFC(snap.lngLat.lng, snap.lngLat.lat));
      map.getCanvas().style.cursor = 'pointer';
    } else {
      map.getSource('snap-src').setData(emptyFC());
      map.getCanvas().style.cursor = 'crosshair';
    }
  }

  function onClick(e) {
    const snap = _snapToNode(map, e.lngLat);
    const { lng, lat } = snap ? snap.lngLat : e.lngLat;
    const direction = compassLeg(cabLng, cabLat, lng, lat);

    let chamberId, chamberSeq;
    try {
      const result = nextChamberId(areaId, direction);
      chamberId = result.id;
      chamberSeq = result.seq;
    } catch (err) {
      alert(err.message);
      return;
    }

    onFinish({
      lng, lat,
      chamber_id:  chamberId,
      chamber_seq: chamberSeq,
      compass_dir: direction,
      area_id:     areaId,
      pop_id:      projectStore.cabinet.properties.pop_id,
    });
    cleanup();
  }

  function onKeydown(e) {
    if (e.key === 'Escape') { cleanup(); }
  }

  function cleanup() {
    map.off('click', onClick);
    map.off('mousemove', onMousemove);
    document.removeEventListener('keydown', onKeydown);
    map.getSource('snap-src').setData(emptyFC());
    map.getCanvas().style.cursor = '';
  }

  map.on('mousemove', onMousemove);
  map.on('click', onClick);
  document.addEventListener('keydown', onKeydown);
  _activeTool = { cleanup };
  return null;
}

// ── SNAP HELPER ───────────────────────────────────────────────────────────────

function _snapToNode(map, lngLat, snapPx = 16) {
  const pt = map.project(lngLat);
  const candidates = [];
  const cab = projectStore.cabinet;

  if (cab) {
    const [lng, lat] = cab.geometry.coordinates;
    const sPt = map.project({ lng, lat });
    const dist = Math.hypot(pt.x - sPt.x, pt.y - sPt.y);
    if (dist <= snapPx) candidates.push({ lngLat: { lng, lat }, id: cab.properties.pop_id, type: 'POP', dist });
  }

  for (const ch of projectStore.chambers) {
    const [lng, lat] = ch.geometry.coordinates;
    const sPt = map.project({ lng, lat });
    const dist = Math.hypot(pt.x - sPt.x, pt.y - sPt.y);
    if (dist <= snapPx) candidates.push({ lngLat: { lng, lat }, id: ch.properties.chamber_id, type: 'CHAMBER', dist });
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => a.dist - b.dist);
  return candidates[0];
}

export { _snapToNode as snapToNode };

// ── DUCT TOOL ─────────────────────────────────────────────────────────────────

const DUCT_BASE = { N: 1,   S: 100, E: 200, W: 300 };
const DUCT_MAX  = { N: 99,  S: 199, E: 299, W: 399 };

function nextDuctId(areaId, direction) {
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
  return { id: `${prefix}${String(n).padStart(3,'0')}`, seq: n };
}

function haversine(lng1, lat1, lng2, lat2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function haversineChain(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversine(coords[i-1][0], coords[i-1][1], coords[i][0], coords[i][1]);
  }
  return total;
}

export function activateDuctTool(map, onFinish) {
  clearTool(map);

  if (!projectStore.cabinet) {
    return { error: 'No cabinet placed yet. Place a Cabinet/POP first.' };
  }

  map.getCanvas().style.cursor = 'crosshair';
  const [cabLng, cabLat] = projectStore.cabinet.geometry.coordinates;
  const areaId = projectStore.project?.areaId || 'XX-XX';

  let vertices    = [];
  let nodeIds     = [];
  let nodeTypes   = [];

  function updateRubberband(cursorLngLat) {
    if (!vertices.length) return;
    const coords = [...vertices, [cursorLngLat.lng, cursorLngLat.lat]];
    map.getSource('rubberband-src').setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }]
    });
  }

  function onMousemove(e) {
    const snap = _snapToNode(map, e.lngLat);
    if (snap) {
      map.getSource('snap-src').setData(pointFC(snap.lngLat.lng, snap.lngLat.lat));
      map.getCanvas().style.cursor = 'pointer';
      if (vertices.length) updateRubberband(snap.lngLat);
    } else {
      map.getSource('snap-src').setData(emptyFC());
      map.getCanvas().style.cursor = 'crosshair';
      if (vertices.length) updateRubberband(e.lngLat);
    }
  }

  function onClick(e) {
    const snap = _snapToNode(map, e.lngLat);
    const { lng, lat } = snap ? snap.lngLat : e.lngLat;
    vertices.push([lng, lat]);
    nodeIds.push(snap ? snap.id : null);
    nodeTypes.push(snap ? snap.type : null);
  }

  function onContextmenu(e) {
    e.preventDefault();
    if (vertices.length < 2) {
      alert('A duct needs at least 2 points. Keep clicking to add vertices, then right-click to finish.');
      return;
    }
    finish();
  }

  function finish() {
    map.getSource('rubberband-src').setData(emptyFC());
    map.getSource('snap-src').setData(emptyFC());

    // Compass leg from midpoint to cabinet
    const midLng = vertices.reduce((s, v) => s + v[0], 0) / vertices.length;
    const midLat = vertices.reduce((s, v) => s + v[1], 0) / vertices.length;
    const direction = compassLeg(cabLng, cabLat, midLng, midLat);

    let ductId, ductSeq;
    try {
      const result = nextDuctId(areaId, direction);
      ductId = result.id;
      ductSeq = result.seq;
    } catch (err) {
      alert(err.message);
      cleanup();
      return;
    }

    const lengthM = Math.round(haversineChain(vertices));

    onFinish({
      coordinates:    vertices,
      duct_id:        ductId,
      duct_seq:       ductSeq,
      compass_leg:    direction,
      area_id:        areaId,
      pop_id:         projectStore.cabinet.properties.pop_id,
      from_node:      nodeIds[0] || 'unknown',
      from_node_type: nodeTypes[0] || 'UNKNOWN',
      to_node:        nodeIds[nodeIds.length-1] || 'unknown',
      to_node_type:   nodeTypes[nodeTypes.length-1] || 'UNKNOWN',
      length_m:       lengthM,
    });

    cleanup();
  }

  function onKeydown(e) {
    if (e.key === 'Escape') { cleanup(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      if (vertices.length) { vertices.pop(); nodeIds.pop(); nodeTypes.pop(); }
    }
  }

  function cleanup() {
    map.off('mousemove', onMousemove);
    map.off('click', onClick);
    map.off('contextmenu', onContextmenu);
    document.removeEventListener('keydown', onKeydown);
    map.getCanvas().style.cursor = '';
  }

  map.on('mousemove', onMousemove);
  map.on('click', onClick);
  map.on('contextmenu', onContextmenu);
  document.addEventListener('keydown', onKeydown);
  _activeTool = { cleanup };
  return null;
}

// ── COMPASS LEG ───────────────────────────────────────────────────────────────

export function compassLeg(fromLng, fromLat, toLng, toLat) {
  const dLng = toLng - fromLng;
  const dLat = toLat - fromLat;
  const bearing = Math.atan2(dLng, dLat) * 180 / Math.PI;
  const b = ((bearing % 360) + 360) % 360;
  if (b >= 315 || b < 45)  return 'N';
  if (b >= 45  && b < 135) return 'E';
  if (b >= 135 && b < 225) return 'S';
  return 'W';
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function emptyFC() {
  return { type: 'FeatureCollection', features: [] };
}
