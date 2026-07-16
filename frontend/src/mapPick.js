// mapPick.js
// Snap-to-node + asset picking (point & line hit-testing, connected-set expansion) and the select / move-point tools. Extracted from mapTools.js.

import { projectStore } from './projectStore.js';
import { _distToSegment } from './mapGeom.js';
import { clearTool, setActiveTool } from './toolSession.js';

// ── SNAP HELPER ───────────────────────────────────────────────────────────────
// Snaps to: POP (cabinet), chambers, joints, address points
// Each tool passes a filter to restrict which types are valid snaps.

export function _snapToNode(map, lngLat, snapPx = 16, types = ['POP','CHAMBER','JOINT','PREMISE']) {
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

  // Every vertex of every duct — not just its endpoints — so a cable being
  // rubberbanded can snap to a bend part-way along a duct's route, not only
  // to the chamber/joint at either end. id is the duct's own id (a vertex
  // isn't its own asset); dist competes with every other candidate type on
  // equal footing, so the nearest snap wins regardless of what it is.
  if (types.includes('DUCT_VERTEX')) {
    for (const d of projectStore.ducts) {
      const ductId = d.properties.duct_id;
      const geom = d.geometry;
      const lines = geom?.type === 'MultiLineString' ? geom.coordinates
                  : geom?.type === 'LineString'      ? [geom.coordinates]
                  : [];
      for (const line of lines) {
        for (const [lng, lat] of line) {
          const sPt = map.project({ lng, lat });
          const dist = Math.hypot(pt.x - sPt.x, pt.y - sPt.y);
          if (dist <= snapPx) candidates.push({ lngLat: { lng, lat }, id: ductId, type: 'DUCT_VERTEX', dist });
        }
      }
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => a.dist - b.dist);
  return candidates[0];
}

export { _snapToNode as snapToNode };

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
  setActiveTool({ cleanup });
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
  setActiveTool({ cleanup });
  return null;
}
