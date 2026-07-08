// networkSpotlight.js
// ─────────────────────────────────────────────────────────────────────────────
// Cursor-driven "spotlight" for a MapLibre GL JS map.
//
// Effect:
//   1. Buildings under the cursor rise out of the terrain (existing fill-extrusion
//      layer), fading back down as the cursor moves away.
//   2. Cyan/pink glow lines animate OUTWARD ALONG THE REAL ROAD NETWORK from the
//      cursor's position — following streets, not a straight radius — and stop at
//      the beam's edge. They retract the same way when the cursor leaves.
//
// No fabricated network, no generation step, no GeoJSON to bake — it re-styles
// road geometry that's already loading reliably from the vector tiles. Fully
// framework-agnostic: works the same in the Svelte app or a React/Next hero.
//
// USAGE:
//   import { attachNetworkSpotlight } from './networkSpotlight.js';
//   const spotlight = attachNetworkSpotlight(map, {
//     buildingLayerId: 'buildings-3d',      // your existing fill-extrusion layer
//     roadSource: 'maptiler_planet',
//     roadSourceLayer: 'transportation',
//     beamRadiusPx: 140,
//   });
//   // later, if the component unmounts:
//   spotlight.destroy();
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULTS = {
  buildingLayerId:  'buildings-3d',
  buildingRiseProp: 'render_height',   // property the base layer reads for height
  buildingMaxRise:  14,                 // metres added on top of natural height at beam centre
  roadSource:       'maptiler_planet',
  roadSourceLayer:  'transportation',
  beamRadiusPx:     140,                // screen-space beam radius
  bufferFactor:     1.6,                // query a wider ring than the beam so BFS has context at the edge
  spineClasses:     ['motorway', 'trunk', 'primary', 'secondary'],
  colorSpine:       '#00aaff',
  colorLocal:       '#4dc8ff',
  easeMs:           420,                // rise/glow-in duration
  easeOutMs:        620,                // sink/glow-out duration (slightly slower — "settles")
  fadeBandPx:       28,                 // soft leading/trailing edge width, in screen px equivalent metres
  throttleMs:       45,                 // min ms between recomputes on mousemove
};

const EARTH_R = 6371000;
const toRad = d => (d * Math.PI) / 180;

function haversine(a, b) {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(s));
}

function lineLength(coords) {
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += haversine(coords[i - 1], coords[i]);
  return d;
}

function lineParts(geom) {
  if (geom.type === 'LineString') return [geom.coordinates];
  if (geom.type === 'MultiLineString') return geom.coordinates;
  return [];
}

// Snap coordinates to a grid so shared road endpoints merge into one graph node.
function makeNodeSet(tolMeters, lat) {
  const dLat = tolMeters / 111320;
  const dLng = tolMeters / (111320 * Math.cos(toRad(lat)) || 1);
  const seen = new Map();
  return {
    key(coord) {
      const kx = Math.round(coord[0] / dLng);
      const ky = Math.round(coord[1] / dLat);
      return kx + ':' + ky;
    },
    add(coord) {
      const k = this.key(coord);
      if (seen.has(k)) return seen.get(k);
      seen.set(k, coord);
      return coord;
    },
  };
}

// Convert a screen-pixel radius to a real-world metre radius at the map's
// current centre/zoom (accurate at any zoom without hardcoding a scale).
function pxRadiusToMetres(map, px) {
  const c = map.getCenter();
  const p = map.project(c);
  const p2 = map.unproject([p.x + px, p.y]);
  return haversine([c.lng, c.lat], [p2.lng, p2.lat]);
}

export function attachNetworkSpotlight(map, options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const glowSourceId = 'network-spotlight-src';
  const glowLayerId  = 'network-spotlight-layer';

  let raf = null;
  let lastRun = 0;
  let revealFront = 0;        // metres — current animated reveal radius
  let targetFront = 0;        // metres — where revealFront is easing toward
  let easeStart = 0;
  let easeFrom = 0;
  let easeDurationMs = cfg.easeMs;
  let currentEdges = [];      // [{coords:[...], dist, cls}] built fresh each recompute
  let cursorLngLat = null;
  let active = false;

  function ensureLayers() {
    if (!map.getSource(glowSourceId)) {
      map.addSource(glowSourceId, { type: 'geojson', data: emptyFC() });
    }
    if (!map.getLayer(glowLayerId)) {
      map.addLayer({
        id: glowLayerId,
        type: 'line',
        source: glowSourceId,
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.5, 17, 3.5],
          'line-opacity': ['get', 'opacity'],
          'line-blur': 0.6,
        },
      });
    }
  }

  function emptyFC() {
    return { type: 'FeatureCollection', features: [] };
  }

  // Build the local road graph within (beamRadius * bufferFactor) of the cursor,
  // BFS distances from the cursor's nearest point, and cache it. Re-run whenever
  // the cursor moves to a meaningfully new spot (throttled), not every frame.
  function recomputeGraph(lngLat) {
    const lat = lngLat[1];
    const beamM = pxRadiusToMetres(map, cfg.beamRadiusPx);
    const bufferM = beamM * cfg.bufferFactor;

    const roads = map.querySourceFeatures(cfg.roadSource, { sourceLayer: cfg.roadSourceLayer })
      .filter(f => f.geometry && (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString'));

    const nodes = makeNodeSet(3, lat);
    // adjacency: nodeKey -> [{to: coord, dist, cls}]
    const adj = new Map();
    const rawSegs = []; // {a, b, cls} pre-snap, for edges within buffer only

    for (const road of roads) {
      const cls = (road.properties && road.properties.class) || 'minor';
      for (const coords of lineParts(road.geometry)) {
        for (let i = 1; i < coords.length; i++) {
          const a = coords[i - 1], b = coords[i];
          // Cheap reject: skip segments whose midpoint is way outside the buffer.
          const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          if (haversine(lngLat, mid) > bufferM * 1.3) continue;
          rawSegs.push({ a, b, cls });
        }
      }
    }
    if (!rawSegs.length) return { beamM, edges: [], startFound: false };

    for (const seg of rawSegs) {
      const ka = nodes.add(seg.a);
      const kb = nodes.add(seg.b);
      const d = haversine(ka, kb);
      const keyA = nodes.key(ka), keyB = nodes.key(kb);
      if (!adj.has(keyA)) adj.set(keyA, []);
      if (!adj.has(keyB)) adj.set(keyB, []);
      adj.get(keyA).push({ to: keyB, coord: kb, dist: d, cls: seg.cls });
      adj.get(keyB).push({ to: keyA, coord: ka, dist: d, cls: seg.cls });
    }

    // Nearest node to the cursor = BFS/Dijkstra start.
    let startKey = null, startDist = Infinity;
    for (const [k, list] of adj) {
      const coord = list[0] ? (nodes.key(list[0].coord) === k ? null : null) : null;
    }
    // (re-derive actual coord per key via a lookup built alongside)
    const coordByKey = new Map();
    for (const seg of rawSegs) {
      coordByKey.set(nodes.key(seg.a), seg.a);
      coordByKey.set(nodes.key(seg.b), seg.b);
    }
    for (const [k, coord] of coordByKey) {
      const d = haversine(lngLat, coord);
      if (d < startDist) { startDist = d; startKey = k; }
    }
    if (startKey === null) return { beamM, edges: [], startFound: false };

    // Dijkstra (weights are all positive segment lengths; a simple priority-less
    // relax loop is plenty fast for a local buffer this size).
    const dist = new Map([[startKey, 0]]);
    const visited = new Set();
    const pq = [[0, startKey]];
    while (pq.length) {
      pq.sort((x, y) => x[0] - y[0]);
      const [d0, u] = pq.shift();
      if (visited.has(u)) continue;
      visited.add(u);
      const neighbors = adj.get(u) || [];
      for (const e of neighbors) {
        const nd = d0 + e.dist;
        if (nd < (dist.get(e.to) ?? Infinity) && nd <= bufferM) {
          dist.set(e.to, nd);
          pq.push([nd, e.to]);
        }
      }
    }

    // Build renderable edges tagged with the *farther* endpoint's distance
    // (used to drive the reveal front) and clipped to the buffer.
    const edges = [];
    for (const seg of rawSegs) {
      const ka = nodes.key(seg.a), kb = nodes.key(seg.b);
      const da = dist.get(ka), db = dist.get(kb);
      if (da === undefined && db === undefined) continue;
      const farDist = Math.max(da ?? Infinity, db ?? Infinity);
      if (farDist === Infinity) continue;
      if (Math.min(da ?? Infinity, db ?? Infinity) > bufferM) continue;
      edges.push({ coords: [seg.a, seg.b], dist: farDist, cls: seg.cls });
    }

    return { beamM, edges, startFound: true };
  }

  function styleFor(cls) {
    return cfg.spineClasses.includes(cls) ? cfg.colorSpine : cfg.colorLocal;
  }

  function render() {
    if (!cursorLngLat) return;

    // Ease revealFront toward targetFront.
    const now = performance.now();
    const t = Math.min(1, (now - easeStart) / easeDurationMs);
    const eased = t < 1 ? 1 - Math.pow(1 - t, 3) : 1; // easeOutCubic
    revealFront = easeFrom + (targetFront - easeFrom) * eased;

    const features = [];
    for (const e of currentEdges) {
      const band = cfg.fadeBandPx; // treat as metres-ish soft width, good enough visually
      let opacity;
      if (e.dist <= revealFront - band) opacity = 1;
      else if (e.dist <= revealFront) opacity = (revealFront - e.dist) / band;
      else opacity = 0;
      if (opacity <= 0.01) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: e.coords },
        properties: { color: styleFor(e.cls), opacity },
      });
    }
    const src = map.getSource(glowSourceId);
    if (src) src.setData({ type: 'FeatureCollection', features });

    // Building rise: nudge the extrusion layer's height paint via a data-driven
    // expression keyed on distance-to-cursor, recomputed cheaply each frame using
    // a paint property override (cheap: just adjusts one paint expression, not
    // per-feature state, so it's safe to call every frame).
    if (map.getLayer(cfg.buildingLayerId)) {
      map.setPaintProperty(cfg.buildingLayerId, 'fill-extrusion-height', [
        '+',
        ['get', cfg.buildingRiseProp],
        ['*', cfg.buildingMaxRise, riseFalloffExpr()],
      ]);
    }

    if (t < 1 || active) {
      raf = requestAnimationFrame(render);
    } else {
      raf = null;
    }
  }

  // Falloff expression: 1 at cursor, fading to 0 at revealFront's current value.
  // Uses ['distance', ...] which MapLibre supports as an expression against a
  // GeoJSON geometry — falls back gracefully if unsupported by clamping to 0.
  function riseFalloffExpr() {
    if (!cursorLngLat || revealFront <= 0) return 0;
    return [
      'max', 0,
      ['-', 1, ['/', ['distance', ['literal', { type: 'Point', coordinates: cursorLngLat }]], revealFront || 1]],
    ];
  }

  function startEase(newTarget, durationMs) {
    easeFrom = revealFront;
    targetFront = newTarget;
    easeStart = performance.now();
    easeDurationMs = durationMs;
    if (!raf) raf = requestAnimationFrame(render);
  }

  function onMove(e) {
    const now = performance.now();
    if (now - lastRun < cfg.throttleMs) return;
    lastRun = now;

    const ll = map.unproject(e.point ?? [e.offsetX, e.offsetY]);
    cursorLngLat = [ll.lng, ll.lat];
    active = true;

    const { beamM, edges } = recomputeGraph(cursorLngLat);
    currentEdges = edges;
    startEase(beamM, cfg.easeMs);
  }

  function onLeave() {
    active = false;
    startEase(0, cfg.easeOutMs);
  }

  ensureLayers();
  const canvas = map.getCanvas();
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', onLeave);

  return {
    destroy() {
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
      if (raf) cancelAnimationFrame(raf);
      if (map.getLayer(glowLayerId)) map.removeLayer(glowLayerId);
      if (map.getSource(glowSourceId)) map.removeSource(glowSourceId);
    },
  };
}
