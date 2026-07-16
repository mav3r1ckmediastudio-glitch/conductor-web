// mapSources.js
// MapLibre source/layer setup, icon rasters, the store→map sync (with the immutable-reference skip cache) and the cable-pulse animation. Extracted from mapTools.js.

import { projectStore } from './projectStore.js';
import { emptyFC } from './mapGeom.js';

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

// Classic map-pin/teardrop for the search-result marker: a domed head
// tapering to a point at the bottom, which is the anchor (the point sits
// exactly on the found coordinate — see icon-anchor: 'bottom' on the layer
// below). Styled in the same neon pink used for the basemap's road glow
// (roads-glow #ff00aa / roads-neon #ff44cc, see App.svelte) so a search
// result reads as part of the same "neon" visual language as the roads,
// not a mismatched marker style.
function addPinIcon(map, name, fillColor, glowColor, size) {
  if (map.hasImage(name)) return;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');

  const cx     = size / 2;
  const headR  = size * 0.28;
  const headCy = size * 0.32;
  const tipY   = size * 0.96;

  ctx.shadowColor = glowColor;
  ctx.shadowBlur = size * 0.35;

  ctx.beginPath();
  ctx.moveTo(cx - headR, headCy);
  ctx.arc(cx, headCy, headR, Math.PI, 2 * Math.PI, false);   // dome over the top
  ctx.lineTo(cx, tipY);                                       // right side down to the point
  ctx.closePath();                                            // point back up to the left side
  ctx.fillStyle = fillColor;
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.lineWidth = size * 0.05;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  // Hollow centre punched through the head — a stylised look, and it lets
  // the map show through rather than a solid disc.
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(cx, headCy, headR * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  map.addImage(name, { width: size, height: size, data: ctx.getImageData(0, 0, size, size).data });
}

// syncToMap() performance guard. Maps sourceId -> the exact state array/feature
// reference last pushed into that MapLibre source. Because projectStore uses
// immutable updates (only the mutated collection gets a new array reference;
// the other ~13 keep the same reference), we can skip re-uploading any source
// whose data object is identical to what it already holds. Without this, every
// single asset placement re-ingested ALL features of ALL layers into MapLibre's
// worker -- O(n) per placement, O(n^2) to build a network of n assets, which is
// the main cause of lag on large designs. Reset in ensureSources() below,
// because setStyle() (basemap switch) destroys and recreates every source, so
// the cache must be invalidated whenever sources are (re)built.
let _lastSynced = {};

// Call this after writing directly to one of the synced data sources outside
// syncToMap() (e.g. live drawing previews, cookie-cutter). It forces the next
// syncToMap() to re-push that source from store state, so the map can never be
// left showing something the store doesn't agree with. Pass no id to reset all.
export function invalidateSyncSource(srcId) {
  if (srcId) delete _lastSynced[srcId];
  else _lastSynced = {};
}

export function ensureSources(map) {
  // Sources are being (re)created -- invalidate the sync cache so the next
  // syncToMap() does a full repopulate (initial load AND after a basemap
  // setStyle() wipe both land here).
  _lastSynced = {};

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
        'text-max-width': 20,
        'text-offset': [0, 1.2],
        'text-anchor': 'top',
        'text-allow-overlap': true,
      },
      paint: { 'text-color': '#4dc8ff', 'text-halo-color': '#0a0f14', 'text-halo-width': 0.4 }
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
        'text-max-width': 20,
        'text-offset': [0, 1.0],
        'text-anchor': 'top',
        'text-allow-overlap': true,
      },
      paint: { 'text-color': '#a0c4d8', 'text-halo-color': '#0a0f14', 'text-halo-width': 0.4 }
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
        'text-max-width': 20,
        'text-offset': [0, 2.6],
        'text-anchor': 'top',
        'text-allow-overlap': true,
      },
      paint: { 'text-color': '#7ab8d4', 'text-halo-color': '#0a0f14', 'text-halo-width': 0.4 }
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
        'text-max-width': 20,
        'text-offset': [0, 1.2],
        'text-anchor': 'top',
        'text-allow-overlap': true,
      },
      paint: { 'text-color': '#4dc8ff', 'text-halo-color': '#0a0f14', 'text-halo-width': 0.4 }
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
        'text-max-width': 20,
        'text-offset': [0, 2.6],
        'text-anchor': 'top',
        'text-allow-overlap': true,
      },
      paint: { 'text-color': '#a0c4d8', 'text-halo-color': '#0a0f14', 'text-halo-width': 0.4 }
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

  // ── Search result marker ──────────────────────────────────────────────
  // Set by App.svelte's onAssetSearch() whenever a postcode or asset search
  // finds a location — a scratch layer like snap-src/rubberband-src above,
  // cleared by clearTool() so it doesn't linger once you start digitising.
  addPinIcon(map, 'icon-search-pin', '#ff44cc', '#ff00aa', 40);
  if (!map.getSource('search-marker-src')) {
    map.addSource('search-marker-src', { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'search-marker-layer',
      type: 'symbol',
      source: 'search-marker-src',
      layout: {
        'icon-image': 'icon-search-pin',
        'icon-size': 0.9,
        'icon-anchor': 'bottom',
        'icon-allow-overlap': true,
      },
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
  // Lazy-load: PoleLayers pulls in three.js, so it lives in its own async
  // chunk. _poleLayerLoading guards against a double addLayer if
  // ensureTerrainLayers fires again before the first import resolves.
  if (!map.getLayer('poles-3d-layer') && !_poleLayerLoading) {
    _poleLayerLoading = true;
    import('./PoleLayers.js')
      .then(({ createPoleLayer }) => {
        if (!map.getLayer('poles-3d-layer')) {
          const poleLayer = createPoleLayer(projectStore);
          map.addLayer(poleLayer);
          _poleLayerInstance = poleLayer;
        }
      })
      .catch((err) => console.error('[mapTools] failed to load 3D pole layer:', err))
      .finally(() => { _poleLayerLoading = false; });
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
let _poleLayerLoading = false;

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

// sourceId -> state key holding that layer's feature array. Table-driven so the
// sync stays a single loop instead of ~14 copy-pasted blocks.
const ARRAY_SOURCES = [
  ['addresses-src', 'addressPoints'],
  ['chambers-src',  'chambers'],
  ['ducts-src',     'ducts'],
  ['joints-src',    'joints'],
  ['dropducts-src', 'dropDucts'],
  ['cables-src',    'cables'],
  ['bundles-src',   'bundles'],
  ['poles-src',     'poles'],
  ['cbt-src',       'cbts'],
  ['spans-src',     'spans'],
  ['adrops-src',    'aerialDrops'],
  ['cbttails-src',  'cbtTails'],
];
// Single-feature sources: sourceId -> state key holding one feature (or null).
const SINGLE_SOURCES = [
  ['build-area-src', 'buildArea'],
  ['cabinet-src',    'cabinet'],
];

export function syncToMap(map) {
  const s = projectStore.state;

  // Array-backed layers. Skip any whose feature array is the *same reference*
  // as last synced -- projectStore's immutable updates mean only the collection
  // that actually changed gets a fresh reference, so a single placement now
  // touches one source instead of all of them. (See _lastSynced note above.)
  for (const [srcId, key] of ARRAY_SOURCES) {
    const arr = s[key];
    if (_lastSynced[srcId] === arr) continue;
    const src = map.getSource(srcId);
    if (!src) continue;
    src.setData({ type: 'FeatureCollection', features: arr || [] });
    _lastSynced[srcId] = arr;
  }

  // Single-feature layers (build area, cabinet).
  for (const [srcId, key] of SINGLE_SOURCES) {
    const feat = s[key];
    if (_lastSynced[srcId] === feat) continue;
    const src = map.getSource(srcId);
    if (!src) continue;
    src.setData(feat ? { type: 'FeatureCollection', features: [feat] } : emptyFC());
    _lastSynced[srcId] = feat;
  }
}
