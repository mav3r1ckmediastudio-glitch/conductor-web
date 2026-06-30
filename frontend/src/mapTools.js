// mapTools.js — Map interaction layer for Conductor Web
// Works with projectStore.js for state. All geometry WGS84.

import { projectStore } from './projectStore.js';
import { createPoleLayer } from './PoleLayers.js';
import { traceFibre, resolveNode } from './fibreTrace.js';

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

  // ── CBTs — source + 2D ground-anchor marker ──────────────────────────
  if (!map.getSource('cbt-src')) {
    map.addSource('cbt-src', { type: 'geojson', data: emptyFC() });

    map.addLayer({
      id: 'cbt-layer',
      type: 'circle',
      source: 'cbt-src',
      paint: {
        'circle-radius': 5,
        'circle-color': '#4dc8ff',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#0a0f14',
      }
    });

    map.addLayer({
      id: 'cbt-label',
      type: 'symbol',
      source: 'cbt-src',
      layout: {
        'text-field': ['get', 'cbt_id'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 9,
        'text-offset': [0, 1.2],
        'text-anchor': 'top',
        'text-allow-overlap': true,
      },
      paint: { 'text-color': '#a0c4d8', 'text-halo-color': '#0a0f14', 'text-halo-width': 1.5 }
    });
  }

  // ── Aerial Spans — source only, layers added after terrain ───────────
  if (!map.getSource('spans-src')) {
    map.addSource('spans-src', { type: 'geojson', data: emptyFC() });
  }

  // ── Aerial Drops — source only, layer added after terrain ─────────────
  if (!map.getSource('adrops-src')) {
    map.addSource('adrops-src', { type: 'geojson', data: emptyFC() });
  }

  // ── CBT Tails — source only, layer added after terrain ────────────────
  // Fibre tail from a CBT, along the pole/span route, back to its parent
  // underground joint. Maps to the cable (fibre) family but renders as a
  // distinct thin tail line so it reads differently from distribution cable.
  if (!map.getSource('cbttails-src')) {
    map.addSource('cbttails-src', { type: 'geojson', data: emptyFC() });
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

  // CBT tail renders in 3D only (PoleLayers.js), riding the span line from the
  // CBT through its pole chain down to the parent joint. No terrain line layer —
  // a draped 2D line looks unnatural and clutters the map.

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
   _poleLayerInstance = poleLayer; 
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
let _poleLayerInstance = null;

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

export function getPoleLayer() { return _poleLayerInstance; }

// ── SYNC TO MAP ───────────────────────────────────────────────────────────────

export function syncToMap(map) {
  const s = projectStore.state;

  if (map.getSource('addresses-src')) {
    map.getSource('addresses-src').setData({
      type: 'FeatureCollection',
      features: s.addressPoints || [],
    });
  }

  if (map.getSource('build-area-src')) {
    map.getSource('build-area-src').setData(
      s.buildArea
        ? { type: 'FeatureCollection', features: [s.buildArea] }
        : emptyFC()
    );
  }

  if (map.getSource('cabinet-src')) {
    map.getSource('cabinet-src').setData(
      s.cabinet
        ? { type: 'FeatureCollection', features: [s.cabinet] }
        : emptyFC()
    );
  }

  if (map.getSource('chambers-src')) {
    map.getSource('chambers-src').setData({
      type: 'FeatureCollection',
      features: s.chambers || [],
    });
  }

  if (map.getSource('ducts-src')) {
    map.getSource('ducts-src').setData({
      type: 'FeatureCollection',
      features: s.ducts || [],
    });
  }

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

  if (map.getSource('cbt-src')) {
    map.getSource('cbt-src').setData({
      type: 'FeatureCollection',
      features: s.cbts || [],
    });
  }

  if (map.getSource('spans-src')) {
    map.getSource('spans-src').setData({
      type: 'FeatureCollection',
      features: s.spans || [],
    });
  }

  if (map.getSource('adrops-src')) {
    map.getSource('adrops-src').setData({
      type: 'FeatureCollection',
      features: s.aerialDrops || [],
    });
  }

  if (map.getSource('cbttails-src')) {
    map.getSource('cbttails-src').setData({
      type: 'FeatureCollection',
      features: s.cbtTails || [],
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

  if (types.includes('CBT')) {
    for (const cbt of projectStore.cbts) {
      const [lng, lat] = cbt.geometry.coordinates;
      const sPt = map.project({ lng, lat });
      const dist = Math.hypot(pt.x - sPt.x, pt.y - sPt.y);
      if (dist <= snapPx) candidates.push({ lngLat: { lng, lat }, id: cbt.properties.cbt_id, type: 'CBT', dist });
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

// ── CBT TOOL ────────────────────────────────────────────────────────────────
// Snaps to an existing POLE (required). The CBT shares the pole's coordinates
// and stores a parent_pole_id reference. Mirrors the JOINT tool pattern.

function nextCBTId(areaId) {
  const prefix = `${areaId}-CBT-`;
  const existing = new Set();
  for (const c of projectStore.cbts) {
    const id = c.properties.cbt_id || '';
    if (id.startsWith(prefix)) {
      const n = parseInt(id.replace(prefix, ''), 10);
      if (!isNaN(n)) existing.add(n);
    }
  }
  let n = 1;
  while (existing.has(n)) n++;
  return `${prefix}${String(n).padStart(3, '0')}`;
}

export function activateCBTTool(map, onFinish) {
  clearTool(map);

  if (!projectStore.cabinet) {
    return { error: 'No cabinet placed yet. Place a Cabinet/POP first.' };
  }
  if (!projectStore.poles.length) {
    return { error: 'No poles placed yet. Place at least one pole before adding CBTs.' };
  }

  map.getCanvas().style.cursor = 'crosshair';
  const areaId = projectStore.project?.areaId || 'XX-XX';

  function onMousemove(e) {
    const snap = _snapToNode(map, e.lngLat, 16, ['POLE']);
    if (snap) {
      map.getSource('snap-src').setData(pointFC(snap.lngLat.lng, snap.lngLat.lat));
      map.getCanvas().style.cursor = 'pointer';
    } else {
      map.getSource('snap-src').setData(emptyFC());
      map.getCanvas().style.cursor = 'crosshair';
    }
  }

  function onClick(e) {
    const snap = _snapToNode(map, e.lngLat, 16, ['POLE']);
    if (!snap) {
      alert('Click on or near an existing pole. CBTs must be mounted on a pole.');
      return;
    }

    const poleFeature = projectStore.poles.find(p => p.properties.pole_id === snap.id);
    if (!poleFeature) return;

    onFinish({
      lng:            snap.lngLat.lng,
      lat:            snap.lngLat.lat,
      cbt_id:         nextCBTId(areaId),
      parent_pole_id: snap.id,
      pop_id:         poleFeature.properties.pop_id,
      area_id:        areaId,
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

// ── AERIAL SPAN TOOL ──────────────────────────────────────────────────────────
// Multi-vertex line between aerial/UG nodes. Stores plain 2D [lng, lat] coords
// plus from_node/to_node references and their types. The 3D visual is DERIVED in
// PoleLayers.js from those references:
//   CBT  → pole-top attach height (cbtTop cache)
//   POLE → pole-top height (poleTop cache) — bare intermediate poles
//   JOINT→ ground level (terrain elevation) — UG↔aerial transition
//   POP  → cabinet pole-top height
// No altitude is baked in here.
// RMB finishes and auto-saves — no form. Tool stays active for the next span.

// ── Span fibre defaults ───────────────────────────────────────────────────
// A span carries fibre inline (it IS the aerial cable, per the v2 model). These
// defaults are applied at save time; per-span values are editable afterwards
// via the asset edit panel. AERIAL_SPAN distinguishes the fibre family in BoM
// and trace output from UG distribution cable, while still being traced as a
// cable. 96f is a sensible aerial distribution default for a rural FTTP build.
const SPAN_CABLE_TYPE  = 'AERIAL_SPAN';
const SPAN_FIBRE_COUNT = 96;

function nextSpanId(areaId) {
  const prefix = `${areaId}-SPAN-`;
  const existing = new Set();
  for (const s of projectStore.spans) {
    const id = s.properties.span_id || '';
    if (id.startsWith(prefix)) {
      const n = parseInt(id.replace(prefix, ''), 10);
      if (!isNaN(n)) existing.add(n);
    }
  }
  let n = 1;
  while (existing.has(n)) n++;
  return `${prefix}${String(n).padStart(3, '0')}`;
}

export function activateAerialSpanTool(map, onSaved) {
  clearTool(map);

  if (!projectStore.cabinet) {
    return { error: 'No cabinet placed yet.' };
  }
  if (!projectStore.poles.length && !projectStore.cbts.length && !projectStore.joints.length) {
    return { error: 'No poles, CBTs or joints placed yet. Place some network assets before digitising aerial spans.' };
  }

  map.getCanvas().style.cursor = 'crosshair';
  const areaId = projectStore.project?.areaId || 'XX-XX';

  let vertices  = [];  // [lng, lat]
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
    const snap = _snapToNode(map, e.lngLat, 16, ['CBT', 'POLE', 'JOINT', 'POP']);
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
    const snap = _snapToNode(map, e.lngLat, 16, ['CBT', 'POLE', 'JOINT', 'POP']);
    const { lng, lat } = snap ? snap.lngLat : e.lngLat;
    vertices.push([lng, lat]);
    nodeIds.push(snap ? snap.id : null);
    nodeTypes.push(snap ? snap.type : null);
  }

  function onContextmenu(e) {
    e.preventDefault();
    if (vertices.length < 2) {
      alert('A span needs at least 2 points. Click CBTs to add vertices, then right-click to finish.');
      return;
    }
    finish();
  }

  function finish() {
    map.getSource('rubberband-src').setData(emptyFC());
    map.getSource('snap-src').setData(emptyFC());

    const popId = projectStore.cabinet?.properties.pop_id || '';

    // Emit ONE span per consecutive vertex pair. A 4-pole digitise becomes
    // 3 spans (1→2, 2→3, 3→4), each with its own from/to node refs, length,
    // and BoM line — matching the real-world PIA model where a span is the
    // section between two adjacent poles. onSaved is called per segment; the
    // App handler adds + syncs each, so nextSpanId() sees prior spans and
    // increments cleanly (no ID collision).
    for (let i = 0; i < vertices.length - 1; i++) {
      const segCoords = [vertices[i], vertices[i + 1]];

      const fromNode = nodeIds[i]     || 'unknown';
      const fromType = nodeTypes[i]   || 'UNKNOWN';
      const toNode   = nodeIds[i + 1] || 'unknown';
      const toType   = nodeTypes[i + 1] || 'UNKNOWN';
      const lengthM  = Math.round(haversineChain(segCoords));
      const spanId   = nextSpanId(areaId);

      const feature = {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: segCoords }, // 2D coords
        properties: {
          span_id:   spanId,
          area_id:   areaId,
          pop_id:    popId,
          from_node: fromNode,
          from_type: fromType,
          to_node:   toNode,
          to_type:   toType,
          length_m:  lengthM,
          status:    'PROPOSED',
          span_type: null,
          notes:     null,

          // ── Fibre payload ──────────────────────────────────────────────
          // In the v2 plugin an aerial span IS the cable — the structural span
          // and the fibre it carries are one feature. We mirror that here:
          // every span carries fibre attributes inline, so the fibre trace can
          // treat spans and UG cables as one graph (UG joint → span → CBT).
          // Defaults suit typical aerial distribution; edit per-span later.
          cable_type:   SPAN_CABLE_TYPE,    // 'AERIAL_SPAN'
          fibre_count:  SPAN_FIBRE_COUNT,   // 96f aerial distribution default
          // Node-type aliases matching the UG cable's field names, so the trace
          // BFS (ported from validate_routes.py) can read from_node_type /
          // to_node_type uniformly across cables AND spans without special-casing.
          from_node_type: fromType,
          to_node_type:   toType,
        },
      };

      onSaved(feature); // adds to store + syncs before next iteration
    }

    // Reset vertices — tool stays active for next span
    vertices  = [];
    nodeIds   = [];
    nodeTypes = [];
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

// ── AERIAL DROP TOOL ──────────────────────────────────────────────────────────
// Two-click: click 1 = CBT (snap required), click 2 = premise (snap preferred).
// Auto-saves with no form, tool stays active for next drop.
// Mirrors the UG drop duct tool pattern exactly.

// ── Aerial drop fibre defaults ────────────────────────────────────────────
// The aerial drop carries fibre inline (it IS the aerial bundle, per the v2
// model). AERIAL_DROP distinguishes it in BoM/trace from UG bundles while
// still being traced as a subscriber drop. 2f matches the UG bundle default.
const ADROP_CABLE_TYPE  = 'AERIAL_DROP';
const ADROP_FIBRE_COUNT = 2;

function nextAerialDropId(areaId) {
  const prefix = `${areaId}-ADROP-`;
  const existing = new Set();
  for (const d of projectStore.aerialDrops) {
    const id = d.properties.adrop_id || '';
    if (id.startsWith(prefix)) {
      const n = parseInt(id.replace(prefix, ''), 10);
      if (!isNaN(n)) existing.add(n);
    }
  }
  let n = 1;
  while (existing.has(n)) n++;
  return `${prefix}${String(n).padStart(3, '0')}`;
}

export function activateAerialDropTool(map, onSaved) {
  clearTool(map);

  if (!projectStore.cabinet) {
    return { error: 'No cabinet placed yet.' };
  }
  if (!projectStore.cbts.length) {
    return { error: 'No CBTs placed yet. Place at least one CBT before digitising aerial drops.' };
  }

  map.getCanvas().style.cursor = 'crosshair';
  const areaId = projectStore.project?.areaId || 'XX-XX';

  let pt1   = null;  // [lng, lat] — CBT end
  let cbtId = null;  // cbt_id of the snapped CBT
  let pt2   = null;  // [lng, lat] — premise end

  let _lastMoveT = 0;
  function onMousemove(e) {
    const now = Date.now();
    if (now - _lastMoveT < 32) return; // ~30fps — snap + rubberband don't need more
    _lastMoveT = now;
    // Before first click: snap to CBT only. After first click: snap to premise.
    const types = !pt1 ? ['CBT'] : ['PREMISE'];
    const snap = _snapToNode(map, e.lngLat, 16, types);
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
    if (!pt1) {
      // First click — must snap to a CBT
      const snap = _snapToNode(map, e.lngLat, 16, ['CBT']);
      if (!snap) {
        alert('Click on or near an existing CBT to start an aerial drop.');
        return;
      }
      pt1   = [snap.lngLat.lng, snap.lngLat.lat];
      cbtId = snap.id;
    } else {
      // Second click — snap to premise if close, otherwise free click
      const snap = _snapToNode(map, e.lngLat, 16, ['PREMISE']);
      const { lng, lat } = snap ? snap.lngLat : e.lngLat;
      pt2 = [lng, lat];
      save(snap ? snap.id : null);
    }
  }

  function onContextmenu(e) {
    e.preventDefault();
    if (pt1) {
      // RMB with a drop in progress — save at the current cursor position,
      // snapping to a premise if close enough (same logic as a left click).
      const snap = _snapToNode(map, e.lngLat, 16, ['PREMISE']);
      const { lng, lat } = snap ? snap.lngLat : e.lngLat;
      pt2 = [lng, lat];
      save(snap ? snap.id : null);
    } else {
      // RMB with nothing started — exit the tool entirely.
      cleanup();
    }
  }

  function save(uprn) {
    const lengthM  = Math.round(haversine(pt1[0], pt1[1], pt2[0], pt2[1]));
    const adropId  = nextAerialDropId(areaId);
    const popId    = projectStore.cabinet?.properties.pop_id || '';

    const feature = {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [pt1, pt2] },
      properties: {
        adrop_id:   adropId,
        area_id:    areaId,
        pop_id:     popId,
        from_cbt:   cbtId,
        uprn:       uprn || null,
        length_m:   lengthM,
        status:     'PROPOSED',
        drop_type:  null,
        notes:      null,

        // ── Fibre payload ────────────────────────────────────────────────
        // An aerial drop is the aerial equivalent of a UG bundle — the
        // subscriber's fibre from the CBT to the premise. In v2 the aerial
        // drop was the UG bundle wrapped under a different name. We mirror
        // that: the drop carries fibre inline so the trace can look it up by
        // uprn (premise → aerial drop → CBT → span → UG joint → cables → POP),
        // exactly as it looks up a bundle by uprn for a UG premise.
        cable_type:  ADROP_CABLE_TYPE,    // 'AERIAL_DROP'
        fibre_count: ADROP_FIBRE_COUNT,   // 2f, same default as a UG bundle
        from_node:   cbtId,               // CBT end (trace entry hop)
        from_node_type: 'CBT',
      },
    };

    map.getSource('rubberband-src').setData(emptyFC());
    map.getSource('snap-src').setData(emptyFC());

    // Reset for next drop — tool stays active
    pt1 = null; cbtId = null; pt2 = null;

    onSaved(feature);
  }

  function onKeydown(e) {
    if (e.key === 'Escape') cleanup();
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      pt1 = null; cbtId = null; pt2 = null;
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

// ── CBT TAIL TOOL ─────────────────────────────────────────────────────────────
// A fibre tail from a CBT, along the aerial route (CBT → poles), back to its
// parent underground joint. Multi-vertex:
//   • Click 1 MUST snap to a CBT       → start of tail (CBT must not already
//                                         have a tail — one tail per CBT)
//   • Intermediate clicks snap to POLE → follow the pole/span route
//   • Final click MUST snap to a JOINT → sets the terminus vertex
//   • RMB finishes (consistent with every other line tool). The last committed
//     vertex must be a JOINT, or the finish is rejected.
// HARD-STOP at 350m: the plugin enforces a 350m ceiling on CBT tails. Adding a
// vertex that would push the running chain length over 350m is REJECTED — the
// click is ignored and the vertex is not added, so an over-length tail can never
// be saved. The true measured length is stored in length_m for the BoM.
// Esc cancels. Ctrl/⌘-Z pops the last vertex. After a save the tool returns to
// default (a CBT can only ever have one tail, so there is nothing to re-arm to).

const CBT_TAIL_MAX_M = 350;

// Set of cbt_ids that already have a tail — used to block starting a second one.
function cbtsWithTail() {
  const s = new Set();
  for (const t of projectStore.cbtTails) {
    if (t.properties.from_cbt) s.add(t.properties.from_cbt);
  }
  return s;
}

function nextCBTTailId(areaId) {
  const prefix = `${areaId}-TAIL-`;
  const existing = new Set();
  for (const t of projectStore.cbtTails) {
    const id = t.properties.tail_id || '';
    if (id.startsWith(prefix)) {
      const n = parseInt(id.replace(prefix, ''), 10);
      if (!isNaN(n)) existing.add(n);
    }
  }
  let n = 1;
  while (existing.has(n)) n++;
  return `${prefix}${String(n).padStart(3, '0')}`;
}

export function activateCBTTailTool(map, onFinish) {
  clearTool(map);

  if (!projectStore.cabinet) {
    return { error: 'No cabinet placed yet.' };
  }
  if (!projectStore.cbts.length) {
    return { error: 'No CBTs placed yet. Place at least one CBT before drawing tails.' };
  }
  if (!projectStore.joints.length) {
    return { error: 'No joints placed yet. A CBT tail must terminate at an underground joint.' };
  }
  // Every CBT already has a tail → nothing to draw.
  const tailed = cbtsWithTail();
  if (projectStore.cbts.every(c => tailed.has(c.properties.cbt_id))) {
    return { error: 'Every CBT already has a tail. A CBT can only have one tail.' };
  }

  map.getCanvas().style.cursor = 'crosshair';
  const areaId = projectStore.project?.areaId || 'XX-XX';

  let vertices  = [];   // [lng, lat]
  let nodeIds   = [];   // snapped node id at each vertex (cbt_id / pole_id / joint_id)
  let nodeTypes = [];   // 'CBT' | 'POLE' | 'JOINT'

  // Running true length of the committed chain (metres).
  function chainLength() {
    return vertices.length < 2 ? 0 : haversineChain(vertices);
  }

  // Length the chain WOULD be if we appended candidate [lng, lat].
  function lengthWith(candidate) {
    if (!vertices.length) return 0;
    return haversineChain([...vertices, candidate]);
  }

  function updateRubberband(cursorLngLat) {
    if (!vertices.length) return;
    const coords = [...vertices, [cursorLngLat.lng, cursorLngLat.lat]];
    map.getSource('rubberband-src').setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }]
    });
  }

  // What may we snap to at the current step?
  //   • no vertices yet → CBT only (must start on a CBT without an existing tail)
  //   • mid-chain       → POLE (route) or JOINT (terminus)
  function snapTypesNow() {
    if (!vertices.length) return ['CBT'];
    return ['POLE', 'JOINT'];
  }

  function onMousemove(e) {
    const snap = _snapToNode(map, e.lngLat, 16, snapTypesNow());
    // Suppress the snap halo on a CBT that already has a tail.
    const blocked = snap && snap.type === 'CBT' && tailed.has(snap.id);
    if (snap && !blocked) {
      map.getSource('snap-src').setData(pointFC(snap.lngLat.lng, snap.lngLat.lat));
      const projected = lengthWith([snap.lngLat.lng, snap.lngLat.lat]);
      map.getCanvas().style.cursor = projected > CBT_TAIL_MAX_M ? 'not-allowed' : 'pointer';
      if (vertices.length) updateRubberband(snap.lngLat);
    } else {
      map.getSource('snap-src').setData(emptyFC());
      map.getCanvas().style.cursor = 'crosshair';
      if (vertices.length) updateRubberband(e.lngLat);
    }
  }

  function commitVertex(snap) {
    const candidate = [snap.lngLat.lng, snap.lngLat.lat];
    // HARD-STOP: block any vertex that would exceed 350m.
    const projected = lengthWith(candidate);
    if (projected > CBT_TAIL_MAX_M) {
      alert(
        `CBT tail hard-stop: this segment would take the tail to ` +
        `${Math.round(projected)} m, over the ${CBT_TAIL_MAX_M} m limit. ` +
        `Vertex rejected — route via a closer joint or add an intermediate joint.`
      );
      return false;
    }
    vertices.push(candidate);
    nodeIds.push(snap.id);
    nodeTypes.push(snap.type);
    return true;
  }

  function onClick(e) {
    if (!vertices.length) {
      // First click — must be a CBT that does not already have a tail.
      const snap = _snapToNode(map, e.lngLat, 16, ['CBT']);
      if (!snap) {
        alert('Click on or near an existing CBT to start a tail.');
        return;
      }
      if (tailed.has(snap.id)) {
        alert(`${snap.id} already has a tail. A CBT can only have one tail.`);
        return;
      }
      commitVertex(snap);   // first vertex can never breach 350m (length 0)
      return;
    }

    // Mid-chain — snap to POLE (route) or JOINT (terminus). Both just add a
    // vertex; RMB is what finishes the tail (consistent with the other tools).
    const snap = _snapToNode(map, e.lngLat, 16, ['POLE', 'JOINT']);
    if (!snap) {
      alert('Snap to a pole to follow the route, or to the parent joint, then right-click to finish.');
      return;
    }
    // Only one joint may be committed, and it must be the last vertex. If a joint
    // is already the current terminus, replace it rather than chaining past it.
    if (snap.type === 'JOINT' && nodeTypes[nodeTypes.length - 1] === 'JOINT') {
      vertices.pop(); nodeIds.pop(); nodeTypes.pop();
    }
    commitVertex(snap);
  }

  function onContextmenu(e) {
    e.preventDefault();
    if (!vertices.length) { cleanup(); return; }   // RMB with nothing started → exit
    // RMB finishes — but only if the tail terminates on a joint.
    if (nodeTypes[nodeTypes.length - 1] !== 'JOINT') {
      alert('A CBT tail must end on an underground joint. Snap to the parent joint, then right-click to finish.');
      return;
    }
    if (vertices.length < 2) {
      alert('A tail needs at least a CBT and a joint.');
      return;
    }
    finish();
  }

  function finish() {
    map.getSource('rubberband-src').setData(emptyFC());
    map.getSource('snap-src').setData(emptyFC());

    const fromCbt  = nodeIds[0];
    const toJoint  = nodeIds[nodeIds.length - 1];
    const viaPoles = nodeIds.slice(1, -1);   // intermediate pole ids, in order
    const lengthM  = Math.round(chainLength());
    const tailId   = nextCBTTailId(areaId);
    const popId    = projectStore.cabinet?.properties.pop_id || '';

    const pending = {
      coordinates: [...vertices],
      tail_id:     tailId,
      area_id:     areaId,
      pop_id:      popId,
      from_cbt:    fromCbt,
      to_joint:    toJoint,
      via_poles:   viaPoles,
      // Full ordered attach chain for 3D rendering: CBT → poles… → JOINT.
      node_chain:  [...nodeIds],
      node_types:  [...nodeTypes],
      length_m:    lengthM,
    };

    // Reset; tool will be torn down by the handler (one tail per CBT — no re-arm).
    vertices = []; nodeIds = []; nodeTypes = [];

    onFinish(pending);
  }

  function onKeydown(e) {
    if (e.key === 'Escape') cleanup();
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      if (vertices.length) {
        vertices.pop(); nodeIds.pop(); nodeTypes.pop();
        if (!vertices.length) map.getSource('rubberband-src').setData(emptyFC());
      }
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

// ── ASSET PICKER ─────────────────────────────────────────────────────────────
// Hit-tests every design asset near a click point.
// Returns { collection, index, feature, assetType, assetId, label } or null.
//
// Point assets: screen-distance test (same as _snapToNode).
// Line assets: queryRenderedFeatures on the relevant layer IDs, then find the
//   matching feature in the store by id property.

// Layer IDs must match what ensureSources/ensureTerrainLayers actually registers.
// Poles, CBTs, spans, aerial drops, and CBT tails render 3D-only via PoleLayers.js
// and have no 2D map layers — they are picked by _pickPointAsset (poles/CBTs) or
// are not clickable by layer (spans/adrops/cbttails — no 2D layer exists).
const LAYER_TO_META = {
  'chambers-layer': { collection: 'chambers',  assetType: 'chamber', idProp: 'chamber_id', label: 'Chamber' },
  'joints-layer':   { collection: 'joints',    assetType: 'joint',   idProp: 'joint_id',   label: 'Joint' },
  'cbt-layer':      { collection: 'cbts',      assetType: 'cbt',     idProp: 'cbt_id',     label: 'CBT' },
  'poles-layer':    { collection: 'poles',     assetType: 'pole',    idProp: 'pole_id',    label: 'Pole' },
  'ducts-layer':    { collection: 'ducts',     assetType: 'duct',    idProp: 'duct_id',    label: 'Duct' },
  'cables-glow':    { collection: 'cables',    assetType: 'cable',   idProp: 'cable_id',   label: 'Cable' },
  'cables-pulse':   { collection: 'cables',    assetType: 'cable',   idProp: 'cable_id',   label: 'Cable' },
  'dropducts-layer':{ collection: 'dropDucts', assetType: 'dropduct',idProp: 'ddct_id',    label: 'Drop Duct' },
  'bundles-layer':  { collection: 'bundles',   assetType: 'bundle',  idProp: 'bundle_id',  label: 'Bundle' },
};

// Point asset screen-distance pick (same radius as snap, 20px).
function _pointAssetCandidates(map, lngLat, snapPx = 20) {
  const pt = map.project(lngLat);
  const candidates = [];

  const checks = [
    { collection: 'chambers',  assetType: 'chamber',  idProp: 'chamber_id', label: 'Chamber',      arr: projectStore.chambers },
    { collection: 'joints',    assetType: 'joint',    idProp: 'joint_id',   label: 'Joint',        arr: projectStore.joints },
    { collection: 'poles',     assetType: 'pole',     idProp: 'pole_id',    label: 'Pole',         arr: projectStore.poles },
    { collection: 'cbts',      assetType: 'cbt',      idProp: 'cbt_id',     label: 'CBT',          arr: projectStore.cbts },
  ];

  for (const { collection, assetType, idProp, label, arr } of checks) {
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i];
      const [lng, lat] = f.geometry.coordinates;
      const sPt = map.project({ lng, lat });
      const dist = Math.hypot(pt.x - sPt.x, pt.y - sPt.y);
      if (dist <= snapPx) {
        candidates.push({ collection, index: i, feature: f, assetType, assetId: f.properties[idProp], label, dist });
      }
    }
  }
  return candidates;
}

function _pickPointAsset(map, lngLat, snapPx = 20) {
  const candidates = _pointAssetCandidates(map, lngLat, snapPx);
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.dist - b.dist);
  return candidates[0];
}

function _pickPointAssetAll(map, lngLat, snapPx = 20) {
  return _pointAssetCandidates(map, lngLat, snapPx);
}

// Line asset pick via queryRenderedFeatures on a small bounding box.
function _pickLineAsset(map, point) {
  const BOX = 8; // px
  const bbox = [
    { x: point.x - BOX, y: point.y - BOX },
    { x: point.x + BOX, y: point.y + BOX },
  ];

  const layerIds = Object.keys(LAYER_TO_META).filter(id => {
    try { return !!map.getLayer(id); } catch { return false; }
  });
  if (!layerIds.length) return null;

  const hits = map.queryRenderedFeatures(bbox, { layers: layerIds });
  if (!hits.length) return null;

  // Use the first hit — MapLibre returns them front-to-back
  for (const hit of hits) {
    const meta = LAYER_TO_META[hit.layer.id];
    if (!meta) continue;
    const idProp = meta.idProp;
    const assetId = hit.properties?.[idProp];
    if (!assetId) continue;

    const arr = projectStore.state[meta.collection] || [];
    const index = arr.findIndex(f => f.properties[idProp] === assetId);
    if (index < 0) continue;

    return {
      collection: meta.collection,
      index,
      feature:   arr[index],
      assetType: meta.assetType,
      assetId,
      label:     meta.label,
    };
  }
  return null;
}

// Pick for 3D-only line assets (spans, aerial drops, CBT tails) that have no
// 2D MapLibre layer. Tests screen-space distance from click point to each
// segment of the feature's 2D coordinate chain (perpendicular distance to the
// whole segment, not just its midpoint).
function _distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx, projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

function _lineAssetByCoordsCandidates(map, point, snapPx = 18) {
  const checks = [
    { collection: 'spans',      assetType: 'span',    idProp: 'span_id',  label: 'Aerial Span', arr: projectStore.spans      },
    { collection: 'aerialDrops',assetType: 'adrop',   idProp: 'adrop_id', label: 'Aerial Drop', arr: projectStore.aerialDrops },
    { collection: 'cbtTails',   assetType: 'cbttail', idProp: 'tail_id',  label: 'CBT Tail',    arr: projectStore.cbtTails   },
  ];

  // ── 3D parallax compensation ────────────────────────────────────────────
  // Spans/drops/tails RENDER at pole-top height (~6m up) in THREE.js, but their
  // stored coordinates are at ground level. When the map is pitched, the
  // floating line appears shifted up-screen from where its ground coords
  // project. Approximate that shift and move our hit-test points to match.
  const POLE_TOP_M = 6;
  const pitchRad   = (map.getPitch() || 0) * Math.PI / 180;
  const lat        = map.getCenter().lat;
  const zoom       = map.getZoom();
  // metres-per-pixel at this lat/zoom (MapLibre uses 512px tiles)
  const mpp        = 40075016.686 * Math.cos(lat * Math.PI / 180) / (512 * Math.pow(2, zoom));
  // Apparent upward screen shift (px) of a point POLE_TOP_M above ground.
  const dyScreen   = (POLE_TOP_M / mpp) * Math.sin(pitchRad);

  const projShifted = (lng, ltt) => {
    const p = map.project({ lng, lat: ltt });
    return { x: p.x, y: p.y - dyScreen }; // up-screen = smaller y
  };

  const candidates = [];

  for (const { collection, assetType, idProp, label, arr } of checks) {
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i];
      const coords = f.geometry?.coordinates;
      if (!coords || coords.length < 2) continue;

      // Perpendicular screen distance to the nearest segment
      let minDist = Infinity;
      for (let s = 0; s < coords.length - 1; s++) {
        const a = projShifted(coords[s][0],     coords[s][1]);
        const b = projShifted(coords[s + 1][0], coords[s + 1][1]);
        const dist = _distToSegment(point, a, b);
        if (dist < minDist) minDist = dist;
      }

      if (minDist <= snapPx) {
        candidates.push({ collection, index: i, feature: f, assetType, assetId: f.properties[idProp], label, dist: minDist });
      }
    }
  }
  return candidates;
}

function _pickLineAssetByCoords(map, point, snapPx = 18) {
  const candidates = _lineAssetByCoordsCandidates(map, point, snapPx);
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.dist - b.dist);
  return candidates[0];
}

function _pickLineAssetAllByCoords(map, point, snapPx = 18) {
  return _lineAssetByCoordsCandidates(map, point, snapPx);
}

export function pickAsset(map, lngLat) {
  const point = map.project(lngLat);
  // Point assets (poles, CBTs, chambers, joints) and 3D line assets (spans,
  // drops, tails) can overlap — a short pole-to-pole span sits entirely within
  // its end poles' pick radius. So compare actual screen distances and let the
  // genuinely-nearest win, rather than always preferring points. Clicking a
  // pole still grabs the pole; clicking along the span between poles grabs the
  // span.
  const pointHit = _pickPointAsset(map, lngLat);        // has .dist (px) or null
  const coordHit = _pickLineAssetByCoords(map, point);  // has .dist (px) or null

  if (pointHit && coordHit) return (coordHit.dist < pointHit.dist) ? coordHit : pointHit;
  if (pointHit) return pointHit;
  if (coordHit) return coordHit;

  // Fall back to 2D layer line assets (ducts, cables, etc.)
  return _pickLineAsset(map, point);
}

// Gather ALL assets near the click, not just the nearest. Used by the select
// tool to show a disambiguation chooser when assets overlap (e.g. a CBT mounted
// on a pole share the same coordinates; a span terminates on a pole). Returns
// an array of pick descriptors sorted nearest-first. Each descriptor has the
// same shape pickAsset returns: { collection, index, feature, assetType,
// assetId, label, dist }.
//
// Clicking a pole or CBT also pulls in EVERYTHING connected to that hub — the
// pole, its CBT, and every span / drop / tail attached to either — because the
// thin aerial lines floating above a pole are hard to click individually in 3D.
// Click the big pole target, get the whole bundle in the chooser.
export function pickAllAssets(map, lngLat) {
  const point = map.project(lngLat);
  const matches = [];

  // Point assets — collect every candidate within radius (not just nearest)
  const ptPick = _pickPointAssetAll(map, lngLat);
  matches.push(...ptPick);

  // 3D-only line assets (spans, drops, tails)
  const coordPick = _pickLineAssetAllByCoords(map, point);
  matches.push(...coordPick);

  // 2D layer line assets (ducts, cables) — single nearest is fine here
  const lineHit = _pickLineAsset(map, point);
  if (lineHit) matches.push({ ...lineHit, dist: lineHit.dist ?? 999 });

  // ── Connectivity expansion ───────────────────────────────────────────────
  // If a pole or CBT is among the spatial hits, add everything attached to it.
  const expanded = _expandConnected(matches);
  matches.push(...expanded);

  // De-dupe by collection+assetId (a feature could match twice), keep nearest
  const byKey = new Map();
  for (const m of matches) {
    const key = `${m.collection}:${m.assetId}`;
    const prev = byKey.get(key);
    if (!prev || m.dist < prev.dist) byKey.set(key, m);
  }

  return [...byKey.values()].sort((a, b) => a.dist - b.dist);
}

// Build pick descriptors for assets connected to any pole/CBT in `seedHits`.
// Returns descriptors with a large dist so they sort AFTER true spatial hits
// (the thing you actually clicked stays at the top of the chooser).
function _expandConnected(seedHits) {
  const out = [];

  // Collect the pole_ids and cbt_ids the user clicked on (directly or via overlap)
  const poleIds = new Set();
  const cbtIds  = new Set();
  for (const h of seedHits) {
    if (h.assetType === 'pole') poleIds.add(h.assetId);
    if (h.assetType === 'cbt')  cbtIds.add(h.assetId);
  }
  if (!poleIds.size && !cbtIds.size) return out;

  const descriptor = (collection, assetType, idProp, label, arr, i) => ({
    collection, index: i, feature: arr[i], assetType,
    assetId: arr[i].properties[idProp], label, dist: 9000, // sort after spatial hits
  });

  // A clicked pole pulls in its CBT(s); a clicked CBT pulls in its parent pole.
  const cbts = projectStore.cbts || [];
  for (let i = 0; i < cbts.length; i++) {
    const c = cbts[i];
    if (poleIds.has(c.properties.parent_pole_id)) {
      cbtIds.add(c.properties.cbt_id);                 // pole → its CBT
      out.push(descriptor('cbts', 'cbt', 'cbt_id', 'CBT', cbts, i));
    }
    if (cbtIds.has(c.properties.cbt_id) && c.properties.parent_pole_id) {
      poleIds.add(c.properties.parent_pole_id);        // CBT → its pole
    }
  }
  const poles = projectStore.poles || [];
  for (let i = 0; i < poles.length; i++) {
    if (poleIds.has(poles[i].properties.pole_id)) {
      out.push(descriptor('poles', 'pole', 'pole_id', 'Pole', poles, i));
    }
  }

  // Any node id (pole or CBT) that the bundle now references
  const nodeIds = new Set([...poleIds, ...cbtIds]);

  // Spans attached at either end
  const spans = projectStore.spans || [];
  for (let i = 0; i < spans.length; i++) {
    const p = spans[i].properties;
    if (nodeIds.has(p.from_node) || nodeIds.has(p.to_node)) {
      out.push(descriptor('spans', 'span', 'span_id', 'Aerial Span', spans, i));
    }
  }
  // Aerial drops from a connected CBT
  const drops = projectStore.aerialDrops || [];
  for (let i = 0; i < drops.length; i++) {
    if (cbtIds.has(drops[i].properties.from_cbt)) {
      out.push(descriptor('aerialDrops', 'adrop', 'adrop_id', 'Aerial Drop', drops, i));
    }
  }
  // CBT tails from a connected CBT
  const tails = projectStore.cbtTails || [];
  for (let i = 0; i < tails.length; i++) {
    if (cbtIds.has(tails[i].properties.from_cbt)) {
      out.push(descriptor('cbtTails', 'cbttail', 'tail_id', 'CBT Tail', tails, i));
    }
  }

  return out;
}

// ── SELECT TOOL ───────────────────────────────────────────────────────────────
// Single-click to pick any asset. Calls onPick(hits[]) with a nearest-first
// array of all overlapping matches. When more than one asset is under the
// click (e.g. a CBT mounted on a pole, or a span ending on a pole), the caller
// shows a chooser dialog; with a single hit it acts on hits[0] directly.
// Hover changes cursor to pointer when over any asset.

const HOVER_LAYERS = Object.keys(LAYER_TO_META);

export function activateSelectTool(map, onPick) {
  clearTool(map);
  map.getCanvas().style.cursor = 'crosshair';

  function onMousemove(e) {
    // Check point assets first (wider radius for easier targeting)
    const ptHit = _pickPointAsset(map, e.lngLat, 24);
    if (ptHit) { map.getCanvas().style.cursor = 'pointer'; return; }
    const point = map.project(e.lngLat);
    // Check 2D line layers
    const BOX = 8;
    const bbox = [{ x: point.x - BOX, y: point.y - BOX }, { x: point.x + BOX, y: point.y + BOX }];
    const activeLayers = HOVER_LAYERS.filter(id => { try { return !!map.getLayer(id); } catch { return false; } });
    if (activeLayers.length) {
      const hits = map.queryRenderedFeatures(bbox, { layers: activeLayers });
      if (hits.length) { map.getCanvas().style.cursor = 'pointer'; return; }
    }
    // Check 3D-only assets (spans, drops, tails)
    const coordHit = _pickLineAssetByCoords(map, point, 16);
    if (coordHit) { map.getCanvas().style.cursor = 'pointer'; return; }
    map.getCanvas().style.cursor = 'crosshair';
  }

  function onClick(e) {
    try {
      const hits = pickAllAssets(map, e.lngLat);
      if (hits.length) {
        // onPick receives the full nearest-first list. The caller shows a
        // chooser when there's more than one; otherwise it acts on hits[0].
        onPick(hits);
      }
    } catch (err) {
      console.error('[select] click error:', err);
    }
  }

  function onKeydown(e) {
    if (e.key === 'Escape') cleanup();
  }

  function cleanup() {
    map.off('mousemove', onMousemove);
    map.off('click', onClick);
    document.removeEventListener('keydown', onKeydown);
    map.getCanvas().style.cursor = '';
  }

  map.on('mousemove', onMousemove);
  map.on('click', onClick);
  document.addEventListener('keydown', onKeydown);
  _activeTool = { cleanup };
  return null;
}

// ── MOVE POINT TOOL ───────────────────────────────────────────────────────────
// After a point asset is selected, activate this to let the user click a new
// location. Calls onMoved({ collection, index, lng, lat }) then self-cleans.

export function activateMovePointTool(map, selected, onMoved) {
  clearTool(map);
  map.getCanvas().style.cursor = 'crosshair';

  function onClick(e) {
    const { lng, lat } = e.lngLat;
    cleanup();
    onMoved({ collection: selected.collection, index: selected.index, lng, lat });
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

// ── FIBRE TRACE TOOL ──────────────────────────────────────────────────────────
// Click a premise → trace its route back to the cabinet through the fibre graph
// (bundles/drops → joints/CBTs → cables/spans → POP) and highlight every hop.
//
// The trace ENGINE is pure (fibreTrace.js); this tool wraps it with map I/O:
// snap-to-premise on click, then paint the returned path into dedicated glow +
// core highlight layers (cyan glow / white core, mirroring the v2 rubber-band
// style). The tool stays active so the user can click premise after premise; the
// highlight + result panel refresh on each click. Esc or the panel's Close exits.
//
// Highlighting is 2D, on terrain. Spans and aerial drops render 3D-only in
// PoleLayers, but their 2D ground coordinates live on the feature geometry, so a
// draped highlight line traces the route footprint clearly. (A transient, bright,
// purposeful highlight reads fine in 2D even though the permanent asset is 3D.)

function pointFeature(coords) {
  return { type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties: {} };
}

// Lazily create the trace highlight sources + layers. Added ON TOP of everything
// (no `before` arg) so the highlight is always visible over assets and labels.
// Re-creatable: a basemap switch wipes these, and the next trace re-adds them.
export function ensureTraceLayers(map) {
  if (!map.getSource('trace-line-src')) {
    map.addSource('trace-line-src', { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'trace-glow',
      type: 'line',
      source: 'trace-line-src',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#00c8dc',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 6, 16, 11, 20, 16],
        'line-blur': 6,
        'line-opacity': 0.55,
      },
    });
    map.addLayer({
      id: 'trace-core',
      type: 'line',
      source: 'trace-line-src',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#ffffff',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 16, 2.5, 20, 3.5],
        'line-opacity': 0.95,
      },
    });
  }

  if (!map.getSource('trace-node-src')) {
    map.addSource('trace-node-src', { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'trace-node-glow',
      type: 'circle',
      source: 'trace-node-src',
      paint: {
        'circle-radius': ['case', ['==', ['get', 'role'], 'endpoint'], 11, 8],
        'circle-color': '#00c8dc',
        'circle-blur': 1,
        'circle-opacity': 0.5,
      },
    });
    map.addLayer({
      id: 'trace-node',
      type: 'circle',
      source: 'trace-node-src',
      paint: {
        'circle-radius': ['case', ['==', ['get', 'role'], 'endpoint'], 6, 4.5],
        'circle-color': '#0a0f14',
        'circle-stroke-width': 2,
        'circle-stroke-color': ['case',
          ['==', ['get', 'role'], 'premise'], '#ffffff',
          ['==', ['get', 'role'], 'pop'],     '#4dc8ff',
          '#4dc8ff'],
      },
    });
  }
}

// Clear the highlight (called on close / new trace / exit).
export function clearTraceHighlight(map) {
  if (map?.getSource && map.getSource('trace-line-src')) map.getSource('trace-line-src').setData(emptyFC());
  if (map?.getSource && map.getSource('trace-node-src')) map.getSource('trace-node-src').setData(emptyFC());
}

// Paint a trace result into the highlight layers.
function drawTrace(map, result) {
  ensureTraceLayers(map);

  const lineFeatures = [];
  const nodeFeatures = [];

  // Entry asset (bundle / aerial drop) line.
  if (result.entry?.feature?.geometry) {
    lineFeatures.push({ type: 'Feature', geometry: result.entry.feature.geometry, properties: {} });
  }

  // Every cable / span edge along the path.
  for (const e of result.edges || []) {
    if (e.feature?.geometry) {
      lineFeatures.push({ type: 'Feature', geometry: e.feature.geometry, properties: {} });
    }
  }

  // Node markers (joints, CBTs, poles, POP). Mark the POP and the first node as
  // endpoints so they render larger.
  const nodes = result.nodes || [];
  for (let i = 0; i < nodes.length; i++) {
    const n = resolveNode(projectStore.state, nodes[i]);
    if (!n) continue;
    const role = (n.type === 'POP') ? 'pop' : (i === 0 ? 'endpoint' : 'node');
    nodeFeatures.push({ type: 'Feature', geometry: { type: 'Point', coordinates: n.coords }, properties: { role } });
  }

  // Premise marker (white) — the thing the user clicked.
  const prem = (projectStore.addressPoints || []).find(p => String(p.properties.uprn) === String(result.uprn));
  if (prem) {
    nodeFeatures.push({ type: 'Feature', geometry: { type: 'Point', coordinates: prem.geometry.coordinates }, properties: { role: 'premise' } });
  }

  map.getSource('trace-line-src').setData({ type: 'FeatureCollection', features: lineFeatures });
  map.getSource('trace-node-src').setData({ type: 'FeatureCollection', features: nodeFeatures });
}

export function activateFibreTraceTool(map, onResult) {
  clearTool(map);

  if (!projectStore.cabinet) {
    return { error: 'No cabinet placed yet.' };
  }
  if (!(projectStore.addressPoints || []).length) {
    return { error: 'No premises imported yet. Import address data before tracing.' };
  }

  ensureTraceLayers(map);
  clearTraceHighlight(map);
  map.getCanvas().style.cursor = 'crosshair';

  function onMousemove(e) {
    const snap = _snapToNode(map, e.lngLat, 18, ['PREMISE']);
    if (snap) {
      map.getSource('snap-src').setData(pointFC(snap.lngLat.lng, snap.lngLat.lat));
      map.getCanvas().style.cursor = 'pointer';
    } else {
      map.getSource('snap-src').setData(emptyFC());
      map.getCanvas().style.cursor = 'crosshair';
    }
  }

  function onClick(e) {
    const snap = _snapToNode(map, e.lngLat, 18, ['PREMISE']);
    if (!snap) return; // require a premise — ignore empty clicks, stay active
    try {
      const result = traceFibre(projectStore.state, snap.id);
      drawTrace(map, result);
      map.getSource('snap-src').setData(emptyFC());
      onResult(result);
    } catch (err) {
      console.error('[fibre-trace] error:', err);
    }
  }

  function onKeydown(e) {
    if (e.key === 'Escape') cleanup();
  }

  function cleanup() {
    map.off('mousemove', onMousemove);
    map.off('click', onClick);
    document.removeEventListener('keydown', onKeydown);
    if (map.getSource('snap-src')) map.getSource('snap-src').setData(emptyFC());
    map.getCanvas().style.cursor = '';
  }

  map.on('mousemove', onMousemove);
  map.on('click', onClick);
  document.addEventListener('keydown', onKeydown);
  _activeTool = { cleanup };
  return null;
}

// ── FIBRE COUNT HIGHLIGHT ─────────────────────────────────────────────────────
// When the user clicks a segment row in the FibreCountPanel, flash it on the map.
// Uses a dedicated source + layers (separate from trace) so both tools can
// coexist and neither wipes the other's overlay. The highlight auto-clears on
// the next click or when clearCountHighlight() is called.
//
// Source: 'count-line-src' (geojson line)
// Layers: 'count-glow' (wide blurred), 'count-core' (thin white)
//
// Colour: amber (#ffaa44) to distinguish from the cyan trace highlight.

function ensureCountLayers(map) {
  if (map.getSource('count-line-src')) return;
  map.addSource('count-line-src', { type: 'geojson', data: emptyFC() });
  map.addLayer({
    id: 'count-glow',
    type: 'line',
    source: 'count-line-src',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#ffaa44',
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 8, 16, 14, 20, 18],
      'line-blur': 7,
      'line-opacity': 0.55,
    },
  });
  map.addLayer({
    id: 'count-core',
    type: 'line',
    source: 'count-line-src',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#ffffff',
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 16, 2.5, 20, 3.5],
      'line-opacity': 0.90,
    },
  });
}

export function clearCountHighlight(map) {
  if (map?.getSource && map.getSource('count-line-src')) {
    map.getSource('count-line-src').setData(emptyFC());
  }
}

// Flash a segment highlight and fly to it.
// seg: a segment object from countFibres() — has .feature (GeoJSON LineString).
export function activateFibreCountTool(map, seg) {
  if (!map || !seg?.feature?.geometry) return;
  ensureCountLayers(map);
  map.getSource('count-line-src').setData({
    type: 'FeatureCollection',
    features: [seg.feature],
  });

  // Fly to the segment's centroid so it's in view.
  const coords = seg.feature.geometry.coordinates;
  if (coords && coords.length) {
    const mid = coords[Math.floor(coords.length / 2)];
    map.easeTo({ center: mid, duration: 600 });
  }
}
