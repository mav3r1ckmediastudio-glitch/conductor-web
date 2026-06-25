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

  // ── Ducts ─────────────────────────────────────────────────────────────
  if (!map.getSource('ducts-src')) {
    map.addSource('ducts-src', { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'ducts-layer',
      type: 'line',
      source: 'ducts-src',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#4dc8ff',
        'line-width': 2.5,
        'line-opacity': 0.9,
        'line-elevation-reference': 'sea',
      }
    });
  }

  // ── Rubber-band (duct digitising) ─────────────────────────────────────
  if (!map.getSource('rubberband-src')) {
    map.addSource('rubberband-src', { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'rubberband-layer',
      type: 'line',
      source: 'rubberband-src',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#4dc8ff',
        'line-width': 1.5,
        'line-opacity': 0.45,
        'line-dasharray': [4, 3],
        'line-elevation-reference': 'sea',
      }
    });
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
  if (!map.getLayer('addresses-points')) return;

  // MapLibre can't do point-in-polygon natively in expressions,
  // so we filter by tagging features as inside/outside and filtering by that.
  // For large datasets we do this in JS and re-set the source data.
  const ring = buildAreaFeature.geometry.coordinates[0];
  const current = map.getSource('addresses-src')._data;
  if (!current?.features) return;

  const inside = current.features.filter(f => {
    const [lng, lat] = f.geometry.coordinates;
    return pointInPolygon(lng, lat, ring);
  });

  map.getSource('addresses-src').setData({
    type: 'FeatureCollection',
    features: inside,
  });

  // Update the store too
  projectStore._state.addressPoints = inside;
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

// ── SNAP HELPER ───────────────────────────────────────────────────────────────

export function snapToNode(map, lngLat, snapPx = 16) {
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
