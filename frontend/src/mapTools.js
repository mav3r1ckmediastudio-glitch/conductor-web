// mapTools.js — Map interaction layer for Conductor Web
// Works with projectStore.js for state. All geometry WGS84.

import { projectStore } from './projectStore.js';
import { createPoleLayer } from './PoleLayers.js';

// ── HELPERS ───────────────────────────────────────────────────────────────────

function emptyFC() {
  return { type: 'FeatureCollection', features: [] };
}

function pointFC(lng, lat) {
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: {} }],
  };
}

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
  addSquareIcon(map, 'icon-joint',   '#0d1520', '#4dc8ff', '#00aaff', 10);

  // ── Address points — clustered ─────────────────────────────────────────
  if (!map.getSource('addresses-src')) {
    map.addSource('addresses-src', {
      type: 'geojson',
      data: emptyFC(),
      cluster: true,
      clusterMaxZoom: 15,
      clusterRadius: 40,
    });

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
      paint: { 'fill-color': '#00aaff', 'fill-opacity': 0.06 }
    });
    map.addLayer({
      id: 'build-area-outline',
      type: 'line',
      source: 'build-area-src',
      paint: { 'line-color': '#4dc8ff', 'line-width': 2, 'line-dasharray': [4, 2], 'line-opacity': 0.8 }
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

  // ── Joints ────────────────────────────────────────────────────────────
  if (!map.getSource('joints-src')) {
    map.addSource('joints-src', { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'joints-layer',
      type: 'symbol',
      source: 'joints-src',
      layout: { 'icon-image': 'icon-joint', 'icon-size': 1, 'icon-allow-overlap': true, 'icon-ignore-placement': true },
    });
    map.addLayer({
      id: 'joints-label',
      type: 'symbol',
      source: 'joints-src',
      layout: {
        'text-field': ['get', 'joint_id'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 8,
        'text-offset': [0, 1.0],
        'text-anchor': 'top',
        'text-allow-overlap': true,
      },
      paint: { 'text-color': '#7ab8d4', 'text-halo-color': '#0a0f14', 'text-halo-width': 1.5 }
    });
  }

  // ── Poles — source + 2D marker ───────────────────────────────────────
  if (!map.getSource('poles-src')) {
    map.addSource('poles-src', { type: 'geojson', data: emptyFC() });

    map.addLayer({
      id: 'poles-layer',
      type: 'circle',
      source: 'poles-src',
      paint: {
        'circle-radius': 5,
        'circle-color': '#0a0f14',
        'circle-stroke-width': 2.5,
        'circle-stroke-color': '#4dc8ff',
      }
    });

    map.addLayer({
      id: 'poles-label',
      type: 'symbol',
      source: 'poles-src',
      layout: {
        'text-field': ['get', 'pole_id'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 9,
        'text-offset': [0, 1.2],
        'text-anchor': 'top',
        'text-allow-overlap': true,
      },
      paint: { 'text-color': '#4dc8ff', 'text-halo-color': '#0a0f14', 'text-halo-width': 1.5 }
    });
  }

  // ── Ducts — source only, layer added after terrain ────────────────────
  if (!map.getSource('ducts-src')) {
    map.addSource('ducts-src', { type: 'geojson', data: emptyFC() });
  }

  // ── Rubber-band — source only, layer added after terrain ──────────────
  if (!map.getSource('rubberband-src')) {
    map.addSource('rubberband-src', { type: 'geojson', data: emptyFC() });
  }


  // ── Drop ducts / cables / bundles — sources only ─────────────────────
  // Layers are added in ensureTerrainLayers() in correct draw order:
  // duct → cables → dropducts → bundles → (point assets already in ensureSources above)
  if (!map.getSource('dropducts-src')) {
    map.addSource('dropducts-src', { type: 'geojson', data: emptyFC() });
  }
  if (!map.getSource('cables-src')) {
    map.addSource('cables-src', { type: 'geojson', data: emptyFC() });
  }
  if (!map.getSource('bundles-src')) {
    map.addSource('bundles-src', { type: 'geojson', data: emptyFC() });
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
  // Draw order (bottom → top):
  // 1. ducts          — widest cyan pipe
  // 2. cables-glow    — soft white halo inside duct
  // 3. cables-pulse   — animated equal-dash travelling pulse
  // 4. cables-pulse   — animated travelling dash
  // 5. dropducts      — dashed lighter blue, thinner than duct
  // 6. bundles        — dashed mid-blue, thinnest
  // 7. rubberband     — digitising preview
  // Point assets (chambers, joints, cabinet) and their labels were added in
  // ensureSources() and are already above all line layers in the MapLibre stack.

  // 'chambers-layer' was added in ensureSources — use it as the ceiling
  // so all line layers render beneath point assets and labels.
  const BEFORE = map.getLayer('chambers-layer') ? 'chambers-layer' : undefined;

  if (!map.getLayer('ducts-layer')) {
    map.addLayer({
      id: 'ducts-layer',
      type: 'line',
      source: 'ducts-src',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#4dc8ff',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 7, 20, 12],
        'line-opacity': 0.9,
      }
    }, BEFORE);
  }

  if (!map.getLayer('cables-glow')) {
    map.addLayer({
      id: 'cables-glow',
      type: 'line',
      source: 'cables-src',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#ffffff',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 16, 5, 20, 8],
        'line-blur': ['interpolate', ['linear'], ['zoom'], 10, 1, 16, 3, 20, 5],
        'line-opacity': 0.2,
      }
    }, BEFORE);
  }

  // Animated pulse only — equal dash/gap [2,2], no solid core beneath
  if (!map.getLayer('cables-pulse')) {
    map.addLayer({
      id: 'cables-pulse',
      type: 'line',
      source: 'cables-src',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#ffffff',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 16, 2, 20, 3],
        'line-opacity': 1.0,
        'line-dasharray': [2, 6],
      }
    }, BEFORE);
  }


  if (!map.getLayer('dropducts-layer')) {
    map.addLayer({
      id: 'dropducts-layer',
      type: 'line',
      source: 'dropducts-src',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#7ab8d4',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 16, 2.5, 20, 3],
        'line-opacity': 0.85,
        'line-dasharray': [4, 4],
      }
    }, BEFORE);
  }

  if (!map.getLayer('bundles-layer')) {
    map.addLayer({
      id: 'bundles-layer',
      type: 'line',
      source: 'bundles-src',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#6a8fa8',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 16, 2, 20, 3],
        'line-opacity': 0.8,
        'line-dasharray': [3, 4],
      }
    }, BEFORE);
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

  // ── 3D POLE LAYER — CustomLayerInterface ───────────────────────────────
  console.log('[mapTools] ensureTerrainLayers: adding pole layer, exists?', map.getLayer('poles-3d-layer'));
  if (!map.getLayer('poles-3d-layer')) {
    const poleLayer = createPoleLayer(projectStore);
    console.log('[mapTools] poleLayer object:', poleLayer);
    map.addLayer(poleLayer);
    console.log('[mapTools] pole layer added, check:', map.getLayer('poles-3d-layer'));
  }

  // Start the cable pulse animation loop
  startCablePulse(map);
}

// ── CABLE PULSE ANIMATION ─────────────────────────────────────────────────────
// Pattern: [2 dash, 6 gap] = 8 unit total cycle.
// 8 distinct asymmetric states march the dash cleanly forward with no jitter.
// The gap (6) is longer than the dash (2) so each state looks clearly different
// from its neighbours — no symmetry to cause the oscillation illusion.
// One full cycle at 10fps = 800ms, readable as smooth directional flow.

let _pulseAnimFrame = null;

function startCablePulse(map) {
  if (_pulseAnimFrame) cancelAnimationFrame(_pulseAnimFrame);

  // Pre-build 8 states manually. Each shifts the 2-unit dash 1 unit forward
  // through the 8-unit pattern. Gap=6 ensures no two adjacent states look alike.
  // Format: [leadingGap, dash, trailingGap] or [leadingGap, dashTail, midGap, dashHead]
  // when the dash wraps around the end of the cycle.
  const states = [
    [0, 2, 6],   // dash at position 0-1
    [1, 2, 5],   // dash at position 1-2
    [2, 2, 4],   // dash at position 2-3
    [3, 2, 3],   // dash at position 3-4
    [4, 2, 2],   // dash at position 4-5
    [5, 2, 1],   // dash at position 5-6
    [6, 2],      // dash at position 6-7
    [1, 1, 5, 1], // dash wraps: 1 tail at end, 1 head at start
  ];

  const FPS      = 10;
  const INTERVAL = 1000 / FPS;

  let step = 0;
  let lastTime = 0;

  function animate(timestamp) {
    _pulseAnimFrame = requestAnimationFrame(animate);
    if (timestamp - lastTime < INTERVAL) return;
    lastTime = timestamp;
    if (!map.getLayer('cables-pulse')) return;
    try {
      map.setPaintProperty('cables-pulse', 'line-dasharray', states[step]);
    } catch (e) {
      // Map may be mid-style-reload — skip this frame
    }
    step = (step + 1) % states.length;
  }

  _pulseAnimFrame = requestAnimationFrame(animate);
}



export function stopCablePulse() {
  if (_pulseAnimFrame) {
    cancelAnimationFrame(_pulseAnimFrame);
    _pulseAnimFrame = null;
  }
}

// ── SYNC TO MAP ───────────────────────────────────────────────────────────────

export function syncToMap(map) {
  const s = projectStore.state;
  if (!map.getSource('addresses-src')) return;

  map.getSource('addresses-src').setData({
    type: 'FeatureCollection',
    features: s.addressPoints || [],
  });

  map.getSource('build-area-src').setData(
    s.buildArea
      ? { type: 'FeatureCollection', features: [s.buildArea] }
      : emptyFC()
  );

  map.getSource('cabinet-src').setData(
    s.cabinet
      ? { type: 'FeatureCollection', features: [s.cabinet] }
      : emptyFC()
  );

  map.getSource('chambers-src').setData({
    type: 'FeatureCollection',
    features: s.chambers || [],
  });

  map.getSource('ducts-src').setData({
    type: 'FeatureCollection',
    features: s.ducts || [],
  });

  if (map.getSource('joints-src')) {
    map.getSource('joints-src').setData({
      type: 'FeatureCollection',
      features: s.joints || [],
    });
  }

  if (map.getSource('dropducts-src')) {
    map.getSource('dropducts-src').setData({
      type: 'FeatureCollection',
      features: s.dropDucts || [],
    });
  }

  if (map.getSource('cables-src')) {
    map.getSource('cables-src').setData({
      type: 'FeatureCollection',
      features: s.cables || [],
    });
  }

  if (map.getSource('bundles-src')) {
    map.getSource('bundles-src').setData({
      type: 'FeatureCollection',
      features: s.bundles || [],
    });
  }

  if (map.getSource('poles-src')) {
    map.getSource('poles-src').setData({
      type: 'FeatureCollection',
      features: s.poles || [],
    });
  }
}

// ── TOOL MANAGEMENT ───────────────────────────────────────────────────────────

let _activeTool = null;

export function clearTool(map) {
  if (_activeTool?.cleanup) _activeTool.cleanup();
  _activeTool = null;
  if (map) {
    map.getCanvas().style.cursor = '';
    if (map.getSource('rubberband-src')) map.getSource('rubberband-src').setData(emptyFC());
    if (map.getSource('snap-src'))       map.getSource('snap-src').setData(emptyFC());
    if (map.getSource('ba-rubber-src'))  map.getSource('ba-rubber-src').setData(emptyFC());
  }
}

// ── BUILD AREA TOOL ───────────────────────────────────────────────────────────

export function activateBuildAreaTool(map, onFinish) {
  clearTool(map);
  map.getCanvas().style.cursor = 'crosshair';

  let vertices = [];

  function updateRubber() {
    if (vertices.length < 2) return;
    const coords = [...vertices, vertices[0]];
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
    map.getSource('ba-rubber-src').setData(emptyFC());
    map.getSource('build-area-src').setData({ type: 'FeatureCollection', features: [feature] });
    cleanup();
    onFinish(feature);
  }

  function onKeydown(e) {
    if (e.key === 'Escape') { cleanup(); map.getCanvas().style.cursor = ''; }
    if (e.key === 'Enter' && vertices.length >= 3) finish();
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { vertices.pop(); updateRubber(); }
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

export function applyCookieCutter(map, buildAreaFeature) {
  if (!map.getSource('addresses-src')) return;

  const ring = buildAreaFeature.geometry.coordinates[0];
  const all  = projectStore.state.addressPoints || [];
  if (!all.length) return;

  const inside = all.filter(f => {
    const [lng, lat] = f.geometry.coordinates;
    return pointInPolygon(lng, lat, ring);
  });

  map.getSource('addresses-src').setData({ type: 'FeatureCollection', features: inside });

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
    if (e.key === 'Escape') cleanup();
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
  return { id: `${prefix}${String(n).padStart(4, '0')}`, seq: n };
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
    if (e.key === 'Escape') cleanup();
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
// Snaps to: POP (cabinet), chambers, joints, address points
// Each tool passes a filter to restrict which types are valid snaps.

function _snapToNode(map, lngLat, snapPx = 16, types = ['POP','CHAMBER','JOINT','PREMISE']) {
  const pt = map.project(lngLat);
  const candidates = [];

  if (types.includes('POP') && projectStore.cabinet) {
    const [lng, lat] = projectStore.cabinet.geometry.coordinates;
    const sPt = map.project({ lng, lat });
    const dist = Math.hypot(pt.x - sPt.x, pt.y - sPt.y);
    if (dist <= snapPx) candidates.push({ lngLat: { lng, lat }, id: projectStore.cabinet.properties.pop_id, type: 'POP', dist });
  }

  if (types.includes('CHAMBER')) {
    for (const ch of projectStore.chambers) {
      const [lng, lat] = ch.geometry.coordinates;
      const sPt = map.project({ lng, lat });
      const dist = Math.hypot(pt.x - sPt.x, pt.y - sPt.y);
      if (dist <= snapPx) candidates.push({ lngLat: { lng, lat }, id: ch.properties.chamber_id, type: 'CHAMBER', dist });
    }
  }

  if (types.includes('POLE')) {
    for (const pole of projectStore.poles) {
      const [lng, lat] = pole.geometry.coordinates;
      const sPt = map.project({ lng, lat });
      const dist = Math.hypot(pt.x - sPt.x, pt.y - sPt.y);
      if (dist <= snapPx) candidates.push({ lngLat: { lng, lat }, id: pole.properties.pole_id, type: 'POLE', dist });
    }
  }

  if (types.includes('JOINT')) {
    for (const j of projectStore.joints) {
      const [lng, lat] = j.geometry.coordinates;
      const sPt = map.project({ lng, lat });
      const dist = Math.hypot(pt.x - sPt.x, pt.y - sPt.y);
      if (dist <= snapPx) candidates.push({ lngLat: { lng, lat }, id: j.properties.joint_id, type: 'JOINT', dist });
    }
  }

  if (types.includes('PREMISE')) {
    for (const p of projectStore.addressPoints) {
      const [lng, lat] = p.geometry.coordinates;
      const sPt = map.project({ lng, lat });
      const dist = Math.hypot(pt.x - sPt.x, pt.y - sPt.y);
      if (dist <= snapPx) candidates.push({ lngLat: { lng, lat }, id: p.properties.uprn, type: 'PREMISE', dist });
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => a.dist - b.dist);
  return candidates[0];
}

export { _snapToNode as snapToNode };

// ── POLE TOOL ──────────────────────────────────────────────────────────────

function nextPoleId(areaId) {
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

export function activatePoleTool(map, onFinish) {
  clearTool(map);

  if (!projectStore.cabinet) {
    return { error: 'No cabinet placed yet. Place a Cabinet/POP first.' };
  }

  map.getCanvas().style.cursor = 'crosshair';
  const areaId = projectStore.project?.areaId || 'XX-XX';
  const cabPopId = projectStore.cabinet.properties.pop_id;

  function onClick(e) {
    const pole_id = nextPoleId(areaId);
    onFinish({
      lng:      e.lngLat.lng,
      lat:      e.lngLat.lat,
      pole_id:  pole_id,
      area_id:  areaId,
      pop_id:   cabPopId,
    });
    cleanup();
  }

  function onKeydown(e) {
    if (e.key === 'Escape') cleanup();
  }

  function cleanup() {
    map.off('click', onClick);
    document.removeEventListener('keydown', onKeydown);
    map.getCanvas().style.cursor = '';
  }

  map.on('click', onClick);
  document.addEventListener('keydown', onKeydown);
  _activeTool = { cleanup };
  return null;
}

// ── JOINT TOOL ────────────────────────────────────────────────────────────────

function nextJointId(areaId) {
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

export function activateJointTool(map, onFinish) {
  clearTool(map);

  if (!projectStore.cabinet) {
    return { error: 'No cabinet placed yet. Place a Cabinet/POP first.' };
  }
  if (!projectStore.chambers.length) {
    return { error: 'No chambers placed yet. Place at least one chamber before adding joints.' };
  }

  map.getCanvas().style.cursor = 'crosshair';
  const areaId = projectStore.project?.areaId || 'XX-XX';

  function onMousemove(e) {
    const snap = _snapToNode(map, e.lngLat, 16, ['CHAMBER']);
    if (snap) {
      map.getSource('snap-src').setData(pointFC(snap.lngLat.lng, snap.lngLat.lat));
      map.getCanvas().style.cursor = 'pointer';
    } else {
      map.getSource('snap-src').setData(emptyFC());
      map.getCanvas().style.cursor = 'crosshair';
    }
  }

  function onClick(e) {
    const snap = _snapToNode(map, e.lngLat, 16, ['CHAMBER']);
    if (!snap) {
      alert('Click on or near an existing chamber. Joints must be placed inside a chamber.');
      return;
    }

    const chamberFeature = projectStore.chambers.find(ch => ch.properties.chamber_id === snap.id);
    if (!chamberFeature) return;

    onFinish({
      lng:        snap.lngLat.lng,
      lat:        snap.lngLat.lat,
      joint_id:   nextJointId(areaId),
      chamber_id: snap.id,
      pop_id:     chamberFeature.properties.pop_id,
      area_id:    areaId,
    });
    cleanup();
  }

  function onKeydown(e) {
    if (e.key === 'Escape') cleanup();
  }

  function cleanup() {
    map.off('mousemove', onMousemove);
    map.off('click', onClick);
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

// ── DROP DUCT TOOL ────────────────────────────────────────────────────────────
// Two-click: click 1 = start (joint/chamber), click 2 = end (premise/free).
// RMB saves immediately with no form. Auto-saves with PROPOSED status.

function nextDropDuctId(areaId) {
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

export function activateDropDuctTool(map, onSaved) {
  clearTool(map);

  if (!projectStore.cabinet) {
    return { error: 'No cabinet placed yet.' };
  }

  map.getCanvas().style.cursor = 'crosshair';
  const areaId = projectStore.project?.areaId || 'XX-XX';

  let pt1 = null; // [lng, lat]
  let id1 = null;
  let pt2 = null;

  function onMousemove(e) {
    const snap = _snapToNode(map, e.lngLat, 16, ['JOINT', 'CHAMBER', 'PREMISE']);
    if (snap) {
      map.getSource('snap-src').setData(pointFC(snap.lngLat.lng, snap.lngLat.lat));
      map.getCanvas().style.cursor = 'pointer';
    } else {
      map.getSource('snap-src').setData(emptyFC());
      map.getCanvas().style.cursor = 'crosshair';
    }

    // Update rubber-band after first click
    if (pt1) {
      const end = snap ? [snap.lngLat.lng, snap.lngLat.lat] : [e.lngLat.lng, e.lngLat.lat];
      map.getSource('rubberband-src').setData({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [pt1, end] }, properties: {} }]
      });
    }
  }

  function onClick(e) {
    const snap = _snapToNode(map, e.lngLat, 16, ['JOINT', 'CHAMBER', 'PREMISE']);
    const { lng, lat } = snap ? snap.lngLat : e.lngLat;

    if (!pt1) {
      pt1 = [lng, lat];
      id1 = snap ? snap.id : null;
    } else {
      pt2 = [lng, lat];
      const uprn = (snap && snap.type === 'PREMISE') ? snap.id : null;
      save(uprn);
    }
  }

  function onContextmenu(e) {
    e.preventDefault();
    if (pt1 && pt2) {
      const snap = _snapToNode(map, e.lngLat, 16, ['PREMISE']);
      const uprn = snap ? snap.id : null;
      save(uprn);
    } else {
      // Cancel current line
      pt1 = null; pt2 = null; id1 = null;
      map.getSource('rubberband-src').setData(emptyFC());
    }
  }

  function save(uprn) {
    const lengthM = Math.round(haversine(pt1[0], pt1[1], pt2[0], pt2[1]));
    const ddctId  = nextDropDuctId(areaId);

    const feature = {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [pt1, pt2] },
      properties: {
        ddct_id:      ddctId,
        area_id:      areaId,
        from_chamber: id1 || 'unknown',
        uprn:         uprn || null,
        length_m:     lengthM,
        status:       'PROPOSED',
        drop_type:    null,
      },
    };

    map.getSource('rubberband-src').setData(emptyFC());
    map.getSource('snap-src').setData(emptyFC());

    // Reset for next drop duct — tool stays active
    pt1 = null; pt2 = null; id1 = null;

    onSaved(feature);
  }

  function onKeydown(e) {
    if (e.key === 'Escape') cleanup();
    if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
      // Undo: cancel current line in progress
      pt1 = null; pt2 = null; id1 = null;
      map.getSource('rubberband-src').setData(emptyFC());
    }
  }

  function cleanup() {
    map.off('mousemove', onMousemove);
    map.off('click', onClick);
    map.off('contextmenu', onContextmenu);
    document.removeEventListener('keydown', onKeydown);
    map.getSource('rubberband-src').setData(emptyFC());
    map.getSource('snap-src').setData(emptyFC());
    map.getCanvas().style.cursor = '';
  }

  map.on('mousemove', onMousemove);
  map.on('click', onClick);
  map.on('contextmenu', onContextmenu);
  document.addEventListener('keydown', onKeydown);
  _activeTool = { cleanup };
  return null;
}

// ── CABLE TOOL ────────────────────────────────────────────────────────────────
// Multi-vertex line, snaps to joints and POP only.
// RMB finishes and opens CableForm in right panel.

function nextCableId(areaId) {
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

// Try to find a duct whose from_node/to_node chambers match the joints being connected
function _findMatchingDuct(fromJointId, toJointId) {
  // Get chamber IDs for both joints
  const fromJoint = projectStore.joints.find(j => j.properties.joint_id === fromJointId);
  const toJoint   = projectStore.joints.find(j => j.properties.joint_id === toJointId);
  if (!fromJoint || !toJoint) return null;

  const fromCh = fromJoint.properties.chamber_id;
  const toCh   = toJoint.properties.chamber_id;
  if (!fromCh || !toCh) return null;

  return projectStore.ducts.find(d => {
    const fn = d.properties.from_node;
    const tn = d.properties.to_node;
    return (fn === fromCh && tn === toCh) || (fn === toCh && tn === fromCh);
  }) || null;
}

export function activateCableTool(map, onFinish) {
  clearTool(map);

  if (!projectStore.cabinet) {
    return { error: 'No cabinet placed yet.' };
  }

  map.getCanvas().style.cursor = 'crosshair';
  const areaId = projectStore.project?.areaId || 'XX-XX';

  let vertices  = [];
  let nodeIds   = [];
  let nodeTypes = [];

  function updateRubberband(cursorLngLat) {
    if (!vertices.length) return;
    const coords = [...vertices, [cursorLngLat.lng, cursorLngLat.lat]];
    map.getSource('rubberband-src').setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }]
    });
  }

  function onMousemove(e) {
    const snap = _snapToNode(map, e.lngLat, 16, ['POP', 'JOINT']);
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
    const snap = _snapToNode(map, e.lngLat, 16, ['POP', 'JOINT']);
    const { lng, lat } = snap ? snap.lngLat : e.lngLat;
    vertices.push([lng, lat]);
    nodeIds.push(snap ? snap.id : null);
    nodeTypes.push(snap ? snap.type : null);
  }

  function onContextmenu(e) {
    e.preventDefault();
    if (vertices.length < 2) {
      alert('A cable needs at least 2 points. Keep clicking to add vertices, then right-click to finish.');
      return;
    }
    finish();
  }

  function finish() {
    map.getSource('rubberband-src').setData(emptyFC());
    map.getSource('snap-src').setData(emptyFC());

    const fromNode = nodeIds[0]   || 'unknown';
    const fromType = nodeTypes[0] || 'UNKNOWN';
    const toNode   = nodeIds[nodeIds.length - 1]   || 'unknown';
    const toType   = nodeTypes[nodeTypes.length - 1] || 'UNKNOWN';
    const lengthM  = Math.round(haversineChain(vertices));
    const cableId  = nextCableId(areaId);
    const popId    = projectStore.cabinet?.properties.pop_id || '';

    // Try to find matching duct
    let ductId = null;
    if (fromNode !== 'unknown' && toNode !== 'unknown' &&
        fromType === 'JOINT' && toType === 'JOINT') {
      const duct = _findMatchingDuct(fromNode, toNode);
      if (duct) ductId = duct.properties.duct_id;
    }

    onFinish({
      coordinates:    vertices,
      cable_id:       cableId,
      area_id:        areaId,
      pop_id:         popId,
      duct_id:        ductId,
      from_node:      fromNode,
      from_node_type: fromType,
      to_node:        toNode,
      to_node_type:   toType,
      length_m:       lengthM,
    });

    cleanup();
  }

  function onKeydown(e) {
    if (e.key === 'Escape') cleanup();
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

// ── BUNDLE TOOL ───────────────────────────────────────────────────────────────
// Two-click: click 1 = joint, click 2 = premise. Auto-saves, no form.
// Tool stays active after each save for rapid placement.

function nextBundleId(areaId) {
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

export function activateBundleTool(map, onSaved) {
  clearTool(map);

  if (!projectStore.cabinet) {
    return { error: 'No cabinet placed yet.' };
  }

  map.getCanvas().style.cursor = 'crosshair';
  const areaId = projectStore.project?.areaId || 'XX-XX';

  let pt1 = null;
  let id1 = null;

  function onMousemove(e) {
    const snap = _snapToNode(map, e.lngLat, 16, ['JOINT', 'PREMISE']);
    if (snap) {
      map.getSource('snap-src').setData(pointFC(snap.lngLat.lng, snap.lngLat.lat));
      map.getCanvas().style.cursor = 'pointer';
    } else {
      map.getSource('snap-src').setData(emptyFC());
      map.getCanvas().style.cursor = 'crosshair';
    }

    if (pt1) {
      const end = snap ? [snap.lngLat.lng, snap.lngLat.lat] : [e.lngLat.lng, e.lngLat.lat];
      map.getSource('rubberband-src').setData({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [pt1, end] }, properties: {} }]
      });
    }
  }

  function onClick(e) {
    const snap = _snapToNode(map, e.lngLat, 16, ['JOINT', 'PREMISE']);
    const { lng, lat } = snap ? snap.lngLat : e.lngLat;

    if (!pt1) {
      pt1 = [lng, lat];
      id1 = (snap && snap.type === 'JOINT') ? snap.id : null;
    } else {
      const pt2  = [lng, lat];
      const uprn = (snap && snap.type === 'PREMISE') ? snap.id : null;
      save(pt2, uprn);
    }
  }

  function onContextmenu(e) {
    e.preventDefault();
    // Cancel current line
    pt1 = null; id1 = null;
    map.getSource('rubberband-src').setData(emptyFC());
  }

  function save(pt2, uprn) {
    const lengthM  = Math.round(haversine(pt1[0], pt1[1], pt2[0], pt2[1]));
    const bundleId = nextBundleId(areaId);

    const feature = {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [pt1, pt2] },
      properties: {
        bundle_id:   bundleId,
        area_id:     areaId,
        from_joint:  id1 || null,
        uprn:        uprn || null,
        fibre_count: 2,
        length_m:    lengthM,
        status:      'PROPOSED',
      },
    };

    map.getSource('rubberband-src').setData(emptyFC());
    map.getSource('snap-src').setData(emptyFC());

    // Reset for next bundle — tool stays active
    pt1 = null; id1 = null;

    onSaved(feature);
  }

  function onKeydown(e) {
    if (e.key === 'Escape') cleanup();
    if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
      pt1 = null; id1 = null;
      map.getSource('rubberband-src').setData(emptyFC());
    }
  }

  function cleanup() {
    map.off('mousemove', onMousemove);
    map.off('click', onClick);
    map.off('contextmenu', onContextmenu);
    document.removeEventListener('keydown', onKeydown);
    map.getSource('rubberband-src').setData(emptyFC());
    map.getSource('snap-src').setData(emptyFC());
    map.getCanvas().style.cursor = '';
  }

  map.on('mousemove', onMousemove);
  map.on('click', onClick);
  map.on('contextmenu', onContextmenu);
  document.addEventListener('keydown', onKeydown);
  _activeTool = { cleanup };
  return null;
}

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
  return { id: `${prefix}${String(n).padStart(3, '0')}`, seq: n };
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

  let vertices  = [];
  let nodeIds   = [];
  let nodeTypes = [];

  function updateRubberband(cursorLngLat) {
    if (!vertices.length) return;
    const coords = [...vertices, [cursorLngLat.lng, cursorLngLat.lat]];
    map.getSource('rubberband-src').setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }]
    });
  }

  function onMousemove(e) {
    const snap = _snapToNode(map, e.lngLat, 16, ['POP', 'CHAMBER']);
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
    const snap = _snapToNode(map, e.lngLat, 16, ['POP', 'CHAMBER']);
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
    if (e.key === 'Escape') cleanup();
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
