// plantGenerator.js
// ─────────────────────────────────────────────────────────────────────────────
// DEV-ONLY TOOL. Runs inside Conductor against a live MapLibre `map`.
//
// It reads the MapTiler building + transportation vector features that are
// already rendered in the current view (source: 'maptiler_planet'), fabricates a
// plausible-looking FTTP network (poles, chambers, ducts, spans, drops, drop
// ducts, CBTs), and exports it as a single static GeoJSON file.
//
// NOTHING HERE SHIPS TO PRODUCTION. Only the output file (e.g. crieff-plant.geojson)
// is committed to the marketing site and drawn with addSource/addLayer.
//
// The fabricated network is DECORATIVE. It is not validated, routed, or spliced —
// it just has to read as competent plant to the eye. No Gigaloch design is used;
// nothing here is real. Output geometry is WGS84 (lng/lat), same as the map.
//
// USAGE (from the browser console with the map in scope, or wired to a dev button):
//   import { downloadPlant } from './plantGenerator.js';
//   // 1. Frame all of Crieff on screen at ~zoom 14–15 so building + road tiles load.
//   // 2. Let the map settle, then:
//   downloadPlant(map, { seed: 1337 });            // → crieff-plant.geojson
//
// Or generate + inspect without downloading:
//   import { generatePlant } from './plantGenerator.js';
//   const fc = generatePlant(map, { seed: 1337 });
//
// The seed makes output deterministic: same view + same seed → identical plant,
// so you can tune the rules, re-run, and only what you changed moves. Baked, not
// live — you can hand-edit the resulting GeoJSON afterwards and it stays put.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULTS = {
  seed:            1337,
  source:          'maptiler_planet',
  buildingLayer:   'building',        // source-layer
  roadLayer:       'transportation',  // source-layer

  poleSpacing:     50,    // metres between poles on aerial runs
  chamberSpacing:  120,   // metres between chambers on underground runs

  gridSize:        120,   // metres — density grid cell
  denseThreshold:  8,     // buildings/cell at/above which a cell counts as "dense"

  // Your rule: dense → underground-led, sparse → pole-led, long spine always underground.
  spineClasses:    ['motorway', 'trunk', 'primary', 'secondary'],
  longRunThreshold: 250,  // metres — any segment longer than this is treated as spine
  denseUgProb:     0.70,  // dense local road: P(underground)
  sparseUgProb:    0.30,  // sparse local road: P(underground)

  dropSampleRate:  1.0,   // fraction of buildings that get a drop (1 = all)
  maxDropDist:     180,   // metres — skip buildings with no plant within this (was 60 — too tight, left most buildings unconnected)
  cbtEveryNDrops:  12,    // place a CBT on a pole roughly every N aerial drops (0 = off)

  nodeSnapTol:     4,     // metres — merge coincident junction nodes within this
};

// ── seeded PRNG (mulberry32) ─────────────────────────────────────────────────
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── geometry helpers (WGS84, metres) ─────────────────────────────────────────
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

function interpAlong(coords, target) {
  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    const seg = haversine(coords[i - 1], coords[i]);
    if (acc + seg >= target) {
      const t = seg === 0 ? 0 : (target - acc) / seg;
      return [
        coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t,
        coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t,
      ];
    }
    acc += seg;
  }
  return coords[coords.length - 1];
}

// Evenly-spaced points along a line, endpoints included.
function pointsAlong(coords, spacing) {
  const L = lineLength(coords);
  if (L === 0) return [coords[0]];
  const n = Math.max(1, Math.round(L / spacing));
  const out = [];
  for (let i = 0; i <= n; i++) out.push(interpAlong(coords, (L * i) / n));
  return out;
}

function polyCentroid(geom) {
  // Polygon → outer ring; MultiPolygon → first polygon's outer ring. Good enough
  // for a drop anchor; buildings are small.
  const ring = geom.type === 'MultiPolygon' ? geom.coordinates[0][0] : geom.coordinates[0];
  let x = 0, y = 0;
  for (const p of ring) { x += p[0]; y += p[1]; }
  return [x / ring.length, y / ring.length];
}

// Flatten a LineString / MultiLineString feature into an array of coord arrays.
function lineParts(geom) {
  if (geom.type === 'LineString') return [geom.coordinates];
  if (geom.type === 'MultiLineString') return geom.coordinates;
  return [];
}

// ── lightweight spatial hash for nearest-node lookups ────────────────────────
function makeGridIndex(items, cellDeg) {
  const idx = new Map();
  const key = (cx, cy) => cx + ':' + cy;
  for (const it of items) {
    const cx = Math.floor(it.coord[0] / cellDeg);
    const cy = Math.floor(it.coord[1] / cellDeg);
    const k = key(cx, cy);
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k).push(it);
  }
  return {
    nearest(coord, maxDist) {
      const cx = Math.floor(coord[0] / cellDeg);
      const cy = Math.floor(coord[1] / cellDeg);
      let best = null, bestD = Infinity;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const arr = idx.get(key(cx + dx, cy + dy));
          if (!arr) continue;
          for (const it of arr) {
            const d = haversine(coord, it.coord);
            if (d < bestD) { bestD = d; best = it; }
          }
        }
      }
      return bestD <= maxDist ? { item: best, dist: bestD } : null;
    },
  };
}

// ── node de-duplication (share one node at junctions) ────────────────────────
function makeNodeSet(tolMeters, lat) {
  // Quantise coords to a grid ~tolMeters wide so coincident endpoints merge.
  const dLat = tolMeters / 111320;
  const dLng = tolMeters / (111320 * Math.cos(toRad(lat)) || 1);
  const seen = new Map();
  return {
    add(coord) {
      const kx = Math.round(coord[0] / dLng);
      const ky = Math.round(coord[1] / dLat);
      const k = kx + ':' + ky;
      if (seen.has(k)) return { coord: seen.get(k), isNew: false };
      seen.set(k, coord);
      return { coord, isNew: true };
    },
  };
}

// ── main generator ───────────────────────────────────────────────────────────
export function generatePlant(map, options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const rand = makeRng(cfg.seed);
  const lat = map.getCenter().lat;

  // Degree sizes for the density grid at this latitude.
  const cellLat = cfg.gridSize / 111320;
  const cellLng = cfg.gridSize / (111320 * Math.cos(toRad(lat)) || 1);

  // 1. Pull rendered vector features from the loaded viewport tiles.
  const buildings = map.querySourceFeatures(cfg.source, { sourceLayer: cfg.buildingLayer })
    .filter(f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'));
  const roads = map.querySourceFeatures(cfg.source, { sourceLayer: cfg.roadLayer })
    .filter(f => f.geometry && (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString'));

  if (!buildings.length || !roads.length) {
    console.warn('[plantGen] No building or road features in view. Frame the town at ~z14–15, let tiles load, then retry.');
    return { type: 'FeatureCollection', features: [] };
  }

  // 2. Density grid from building centroids.
  const density = new Map();
  const bcentroids = [];
  for (const b of buildings) {
    const c = polyCentroid(b.geometry);
    bcentroids.push(c);
    const kx = Math.floor(c[0] / cellLng);
    const ky = Math.floor(c[1] / cellLat);
    const k = kx + ':' + ky;
    density.set(k, (density.get(k) || 0) + 1);
  }
  const densityAt = (coord) => {
    const kx = Math.floor(coord[0] / cellLng);
    const ky = Math.floor(coord[1] / cellLat);
    return density.get(kx + ':' + ky) || 0;
  };

  // 3. Walk roads → lay plant.
  const features = [];
  const poleNodes = [];     // { coord } — aerial attach points
  const ugNodes = [];       // { coord } — chamber attach points
  const poles = makeNodeSet(cfg.nodeSnapTol, lat);
  const chambers = makeNodeSet(cfg.nodeSnapTol, lat);

  const ids = {};
  const nextId = (prefix) => {
    ids[prefix] = (ids[prefix] || 0) + 1;
    return prefix + String(ids[prefix]).padStart(4, '0');
  };

  for (const road of roads) {
    const cls = (road.properties && road.properties.class) || 'minor';
    for (const coords of lineParts(road.geometry)) {
      if (coords.length < 2) continue;
      const L = lineLength(coords);
      const mid = interpAlong(coords, L / 2);
      const dens = densityAt(mid);

      const isSpine = cfg.spineClasses.includes(cls) || L > cfg.longRunThreshold;
      let underground;
      if (isSpine) {
        underground = true;
      } else {
        const p = dens >= cfg.denseThreshold ? cfg.denseUgProb : cfg.sparseUgProb;
        underground = rand() < p;
      }

      if (underground) {
        // Duct along the centreline + chambers at intervals and at junctions.
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: coords },
          properties: { plant_type: 'duct', duct_id: nextId('DU'), road_class: cls, spine: isSpine },
        });
        for (const pt of pointsAlong(coords, cfg.chamberSpacing)) {
          const node = chambers.add(pt);
          if (!node.isNew) continue;
          ugNodes.push({ coord: node.coord });
          features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: node.coord },
            properties: { plant_type: 'chamber', chamber_id: nextId('CH') },
          });
        }
      } else {
        // Poles at spacing + a span between each consecutive pair.
        const linePoles = pointsAlong(coords, cfg.poleSpacing).map(pt => {
          const node = poles.add(pt);
          if (node.isNew) {
            poleNodes.push({ coord: node.coord });
            features.push({
              type: 'Feature',
              geometry: { type: 'Point', coordinates: node.coord },
              properties: { plant_type: 'pole', pole_id: nextId('PL'), has_cbt: false },
            });
          }
          return node.coord;
        });
        for (let i = 1; i < linePoles.length; i++) {
          features.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [linePoles[i - 1], linePoles[i]] },
            properties: { plant_type: 'span', span_id: nextId('SP') },
          });
        }
      }
    }
  }

  // 4. Drops — connect each (sampled) building to its nearest plant.
  const poleIndex = makeGridIndex(poleNodes, Math.max(cellLng, cellLat));
  const ugIndex   = makeGridIndex(ugNodes,   Math.max(cellLng, cellLat));
  const cbtCounters = new Map(); // poleKey → running aerial-drop count, for CBT placement
  let aerialDropTally = 0;

  for (const c of bcentroids) {
    if (cfg.dropSampleRate < 1 && rand() > cfg.dropSampleRate) continue;
    const np = poleIndex.nearest(c, cfg.maxDropDist);
    const nu = ugIndex.nearest(c, cfg.maxDropDist);
    if (!np && !nu) continue;

    const useAerial = np && (!nu || np.dist <= nu.dist);
    if (useAerial) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [np.item.coord, c] },
        properties: { plant_type: 'aerial_drop', adrop_id: nextId('AD') },
      });
      // CBT placement: every Nth aerial drop, promote the serving pole to a CBT.
      if (cfg.cbtEveryNDrops > 0) {
        aerialDropTally++;
        if (aerialDropTally % cfg.cbtEveryNDrops === 0) {
          features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: np.item.coord },
            properties: { plant_type: 'cbt', cbt_id: nextId('CB') },
          });
        }
      }
    } else {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [nu.item.coord, c] },
        properties: { plant_type: 'drop_duct', ddct_id: nextId('DD') },
      });
    }
  }

  const counts = features.reduce((m, f) => {
    m[f.properties.plant_type] = (m[f.properties.plant_type] || 0) + 1;
    return m;
  }, {});
  console.log('[plantGen] generated:', counts, '| buildings seen:', buildings.length, '| roads seen:', roads.length);

  return { type: 'FeatureCollection', features, metadata: { seed: cfg.seed, counts } };
}

// ── download helper ──────────────────────────────────────────────────────────
export function downloadPlant(map, options = {}) {
  const fc = generatePlant(map, options);
  const name = options.filename || 'crieff-plant.geojson';
  const blob = new Blob([JSON.stringify(fc)], { type: 'application/geo+json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
  return fc;
}

// ── optional: fit to bounds, wait for tiles, then generate ───────────────────
// Frames a bounding box, waits for the map to go idle (tiles loaded), and runs.
// bounds = [[west, south], [east, north]] in lng/lat.
export function generateForBounds(map, bounds, options = {}) {
  return new Promise((resolve) => {
    map.once('idle', () => resolve(
      options.download === false ? generatePlant(map, options) : downloadPlant(map, options)
    ));
    map.fitBounds(bounds, { padding: 40, duration: 0 });
  });
}
