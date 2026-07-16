// fibreOverlays.js
// Fibre trace + fibre count map overlays (highlight layers and their activate*/clear* tools). Extracted from mapTools.js.

import { projectStore } from './projectStore.js';
import { traceFibre, resolveNode } from './fibreTrace.js';
import { emptyFC, pointFC } from './mapGeom.js';
import { _snapToNode } from './mapPick.js';
import { clearTool, setActiveTool } from './toolSession.js';

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
  setActiveTool({ cleanup });
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
