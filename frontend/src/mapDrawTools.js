// mapDrawTools.js
// All digitising tools: build area, cabinet, chamber, pole, CBT, aerial span/drop, CBT tail, joint, drop-duct, cable, bundle, duct — plus the span-graph routing helpers. Extracted from mapTools.js.

import { projectStore } from './projectStore.js';
import { showToast } from './toast.js';
import { compassLeg, emptyFC, haversine, haversineChain, pointFC, pointInPolygon } from './mapGeom.js';
import { CBT_TAIL_MAX_M, cbtsWithTail, nextAerialDropId, nextBundleId, nextCBTId, nextCBTTailId, nextCableId, nextChamberId, nextDropDuctId, nextDuctId, nextJointId, nextPoleId, nextPopId, nextSpanId } from './mapIds.js';
import { _snapToNode } from './mapPick.js';
import { invalidateSyncSource } from './mapSources.js';
import { clearTool, setActiveTool } from './toolSession.js';

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
      showToast('A build area needs at least 3 points. Keep clicking to add corners, then right-click to finish.');
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
    invalidateSyncSource('build-area-src');
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
  setActiveTool({ cleanup });
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
  invalidateSyncSource('addresses-src');

  projectStore._state.addressPoints = inside;
  projectStore._save();
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
  setActiveTool({ cleanup });
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
      showToast(err.message);
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
  setActiveTool({ cleanup });
  return null;
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
  setActiveTool({ cleanup });
  return null;
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
      showToast('Click on or near an existing pole. CBTs must be mounted on a pole.');
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
  setActiveTool({ cleanup });
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
      showToast('A span needs at least 2 points. Click CBTs to add vertices, then right-click to finish.');
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
  setActiveTool({ cleanup });
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
        showToast('Click on or near an existing CBT to start an aerial drop.');
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
      // RMB with nothing started — harmless no-op, same as bundle/drop-duct.
      // Used to call cleanup() here and exit the tool entirely, which meant
      // a stray idle right-click (e.g. after already saving via RMB) forced
      // a trip back to the radial wheel to reselect Aerial Drop. Escape
      // still exits the tool if that's what's wanted.
      map.getSource('rubberband-src').setData(emptyFC());
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
  setActiveTool({ cleanup });
  return null;
}

// ── CBT-TAIL AUTO-ROUTER HELPERS ─────────────────────────────────────────────
// The aerial spans already form a weighted pole graph (each span stores
// from_node/to_node + length_m). The tail tool routes along that graph so the
// engineer never has to click every pole — CBT and joint are the endpoints,
// optional pole waypoints steer the route where the network branches.

// Resolve any span-graph node id (POLE / CBT / JOINT / POP) to [lng, lat].
function _nodeCoord(id) {
  if (id == null) return null;
  for (const pl of projectStore.poles)  if (pl.properties.pole_id  === id) return pl.geometry.coordinates;
  for (const c of projectStore.cbts)    if (c.properties.cbt_id    === id) return c.geometry.coordinates;
  for (const jt of projectStore.joints) if (jt.properties.joint_id === id) return jt.geometry.coordinates;
  const cab = projectStore.cabinet;
  if (cab && cab.properties.pop_id === id) return cab.geometry.coordinates;
  return null;
}

// Undirected adjacency map from the aerial spans. id -> [{ to, weight }].
// weight = span length in metres (haversine fallback if length_m is missing).
function _buildSpanGraph() {
  const adj = new Map();
  const addEdge = (a, b, w) => {
    if (a == null || b == null || a === b) return;
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push({ to: b, weight: w });
  };
  for (const sp of projectStore.spans) {
    const a = sp.properties.from_node;
    const b = sp.properties.to_node;
    let w = parseFloat(sp.properties.length_m);
    if (!(w > 0)) {
      const ca = _nodeCoord(a), cb = _nodeCoord(b);
      w = (ca && cb) ? haversineChain([ca, cb]) : 1;
    }
    addEdge(a, b, w);
    addEdge(b, a, w);
  }
  return adj;
}

// Single-source Dijkstra from startId over the span graph. Returns { dist, prev }.
// Deterministic tie-break: on equal cost the lower-id predecessor wins, so a
// tied route is stable run-to-run (small graphs → linear node pick is fine).
function _dijkstra(adj, startId) {
  const dist = new Map([[startId, 0]]);
  const prev = new Map();
  const visited = new Set();
  while (true) {
    let u = null, best = Infinity;
    for (const [node, d] of dist) {
      if (visited.has(node)) continue;
      if (d < best || (d === best && u !== null && String(node) < String(u))) { best = d; u = node; }
    }
    if (u === null) break;
    visited.add(u);
    for (const { to, weight } of (adj.get(u) || [])) {
      if (visited.has(to)) continue;
      const nd = best + weight;
      const cur = dist.has(to) ? dist.get(to) : Infinity;
      if (nd < cur) {
        dist.set(to, nd); prev.set(to, u);
      } else if (nd === cur) {
        const ep = prev.get(to);
        if (ep === undefined || String(u) < String(ep)) prev.set(to, u);
      }
    }
  }
  return { dist, prev };
}

// Reconstruct ordered node-id path [start … goal] from a prev map, or null.
function _pathTo(prev, startId, goalId) {
  if (startId === goalId) return [startId];
  if (!prev.has(goalId)) return null;
  const path = [goalId];
  let cur = goalId;
  while (cur !== startId) {
    cur = prev.get(cur);
    if (cur == null) return null;
    path.push(cur);
  }
  return path.reverse();
}

// Capacity of a joint's feeder splitter (a tail lands on a port of this). 1:4
// feeder by default; honour an explicit 1:8 if the joint is set up that way.
function _jointTailCapacity(jointId) {
  const j = projectStore.joints.find(x => x.properties.joint_id === jointId);
  const ratio = j && j.properties.split_ratio;
  const m = ratio && String(ratio).match(/1:(\d+)/);
  return m ? parseInt(m[1], 10) : 4;
}

function _tailsTerminatingAt(jointId) {
  return projectStore.cbtTails.filter(t => t.properties.to_joint === jointId).length;
}

// ── CBT TAIL TOOL ─────────────────────────────────────────────────────────────
// Streamlined auto-routing tail: click the CBT, optionally tap poles to steer,
// then click the target joint. Poles between are auto-filled by shortest-path
// over the aerial-span graph. The final pole→joint hop is the tail's own
// underground drop (not required to be a span). Output is byte-identical to a
// hand-drawn tail, so 3D render / fibre trace / splice plan / BoM are unaffected.
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
  const tailed = cbtsWithTail();
  if (projectStore.cbts.every(c => tailed.has(c.properties.cbt_id))) {
    return { error: 'Every CBT already has a tail. A CBT can only have one tail.' };
  }

  map.getCanvas().style.cursor = 'crosshair';
  const areaId = projectStore.project?.areaId || 'XX-XX';

  // Span graph is snapshotted at tool-activation. Committed state:
  //   cbtId / cbtCoord / entryNode  — the CBT and the pole it hangs off (graph entry)
  //   waypoints                     — committed intermediate pole ids, in order
  //   committedPoles                — full pole-id chain [entryNode … last waypoint]
  //   committedCoords               — vertex coords for CBT + committedPoles.slice(1)
  //   cache                         — Dijkstra rooted at the last routing node
  const adj = _buildSpanGraph();
  let cbtId = null, cbtCoord = null, entryNode = null;
  let waypoints = [];
  let committedPoles = [];
  let committedCoords = [];
  let cache = null;          // { root, dist, prev }
  let lastRootNode = null;

  function rubber(coords) {
    map.getSource('rubberband-src').setData({
      type: 'FeatureCollection',
      features: coords.length >= 2
        ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }]
        : []
    });
  }

  // Recompute committedPoles / committedCoords / cache from cbt + waypoints.
  function recomputeCommitted() {
    const routeNodes = [entryNode, ...waypoints];   // graph nodes to chain through
    let poles = [entryNode];
    let ok = true;
    for (let k = 0; k < routeNodes.length - 1; k++) {
      const { prev } = _dijkstra(adj, routeNodes[k]);
      const seg = _pathTo(prev, routeNodes[k], routeNodes[k + 1]);
      if (!seg) { ok = false; break; }
      poles = poles.concat(seg.slice(1));           // dedup shared endpoint
    }
    committedPoles = ok ? poles : [entryNode];
    lastRootNode = committedPoles[committedPoles.length - 1];
    cache = { root: lastRootNode, ..._dijkstra(adj, lastRootNode) };
    // CBT vertex substitutes for its own pole; then any poles beyond it.
    committedCoords = [cbtCoord, ...committedPoles.slice(1).map(_nodeCoord).filter(Boolean)];
  }

  // Best exit pole for a joint: the reachable pole minimising (route to pole) +
  // (straight pole→joint drop). Returns { pole, coords } or null if unreachable.
  function bestExitToJoint(jointCoord) {
    let bestPole = null, bestTotal = Infinity;
    for (const [node, d] of cache.dist) {
      const c = _nodeCoord(node);
      if (!c) continue;                              // poles/entry only carry coords
      // Only poles (and the CBT's entry pole) are valid drop points.
      const isPole = projectStore.poles.some(pl => pl.properties.pole_id === node);
      if (!isPole) continue;
      const total = d + haversineChain([c, jointCoord]);
      if (total < bestTotal || (total === bestTotal && bestPole && String(node) < String(bestPole))) {
        bestTotal = total; bestPole = node;
      }
    }
    if (!bestPole) return null;
    const seg = _pathTo(cache.prev, cache.root, bestPole);
    return seg ? { pole: bestPole, seg } : null;
  }

  function snapTypesNow() {
    if (!cbtId) return ['CBT'];
    return ['POLE', 'JOINT'];
  }

  function onMousemove(e) {
    const snap = _snapToNode(map, e.lngLat, 16, snapTypesNow());
    const blocked = snap && snap.type === 'CBT' && tailed.has(snap.id);

    if (!cbtId) {
      // Pre-start: just show the CBT snap halo.
      if (snap && !blocked) {
        map.getSource('snap-src').setData(pointFC(snap.lngLat.lng, snap.lngLat.lat));
        map.getCanvas().style.cursor = 'pointer';
      } else {
        map.getSource('snap-src').setData(emptyFC());
        map.getCanvas().style.cursor = 'crosshair';
      }
      return;
    }

    // Started: preview the auto-routed tail to whatever we're hovering.
    if (snap && snap.type === 'POLE') {
      map.getSource('snap-src').setData(pointFC(snap.lngLat.lng, snap.lngLat.lat));
      const reachable = cache.dist.has(snap.id);
      if (reachable) {
        const seg = _pathTo(cache.prev, cache.root, snap.id) || [cache.root];
        const preview = committedCoords.concat(seg.slice(1).map(_nodeCoord).filter(Boolean));
        rubber(preview);
        const over = haversineChain(preview) > CBT_TAIL_MAX_M;
        map.getCanvas().style.cursor = over ? 'not-allowed' : 'pointer';
      } else {
        rubber(committedCoords);
        map.getCanvas().style.cursor = 'not-allowed';
      }
    } else if (snap && snap.type === 'JOINT') {
      map.getSource('snap-src').setData(pointFC(snap.lngLat.lng, snap.lngLat.lat));
      const jc = snap.lngLat ? [snap.lngLat.lng, snap.lngLat.lat] : _nodeCoord(snap.id);
      const exit = bestExitToJoint(jc);
      if (exit) {
        const preview = committedCoords
          .concat(exit.seg.slice(1).map(_nodeCoord).filter(Boolean))
          .concat([jc]);
        rubber(preview);
        const over = haversineChain(preview) > CBT_TAIL_MAX_M;
        map.getCanvas().style.cursor = over ? 'not-allowed' : 'pointer';
      } else {
        rubber(committedCoords);
        map.getCanvas().style.cursor = 'not-allowed';
      }
    } else {
      map.getSource('snap-src').setData(emptyFC());
      rubber(committedCoords.concat([[e.lngLat.lng, e.lngLat.lat]]));
      map.getCanvas().style.cursor = 'crosshair';
    }
  }

  function onClick(e) {
    // First click — a CBT without an existing tail.
    if (!cbtId) {
      const snap = _snapToNode(map, e.lngLat, 16, ['CBT']);
      if (!snap) { showToast('Click on or near an existing CBT to start a tail.'); return; }
      if (tailed.has(snap.id)) { showToast(`${snap.id} already has a tail. A CBT can only have one tail.`); return; }
      const cbt = projectStore.cbts.find(c => c.properties.cbt_id === snap.id);
      cbtId    = snap.id;
      cbtCoord = [snap.lngLat.lng, snap.lngLat.lat];
      entryNode = (cbt && cbt.properties.parent_pole_id) || snap.id;
      recomputeCommitted();
      return;
    }

    const snap = _snapToNode(map, e.lngLat, 16, ['POLE', 'JOINT']);
    if (!snap) {
      showToast('Snap to a pole to steer the route, or to the parent joint to finish.');
      return;
    }

    // Pole → waypoint (must be reachable along the span network).
    if (snap.type === 'POLE') {
      if (!cache.dist.has(snap.id)) {
        showToast(`${snap.id} isn't on the aerial route from here — pick a pole connected by spans, or draw the missing span first.`);
        return;
      }
      waypoints.push(snap.id);
      recomputeCommitted();
      return;
    }

    // Joint → terminus: validate, route, length-check, commit.
    if (snap.type === 'JOINT') {
      const cap = _jointTailCapacity(snap.id);
      if (_tailsTerminatingAt(snap.id) >= cap) {
        showToast(`${snap.id}'s 1:${cap} feeder is full (${cap} tails) — pick another joint.`);
        return;
      }
      const jc = [snap.lngLat.lng, snap.lngLat.lat];
      const exit = bestExitToJoint(jc);
      if (!exit) {
        showToast('No aerial route exists between this CBT and that joint yet — draw the spans first, or add a waypoint.');
        return;
      }

      // Full ordered chain: CBT → poles… → JOINT.
      const fullPoles = committedPoles.concat(exit.seg.slice(1));   // ends at exit pole
      const vertices  = [cbtCoord, ...fullPoles.slice(1).map(_nodeCoord).filter(Boolean), jc];
      const nodeIds   = [cbtId,    ...fullPoles.slice(1),                                 snap.id];
      const nodeTypes = ['CBT',    ...fullPoles.slice(1).map(() => 'POLE'),               'JOINT'];

      const lengthM = Math.round(haversineChain(vertices));
      if (lengthM > CBT_TAIL_MAX_M) {
        showToast(
          `CBT tail hard-stop: the routed tail is ${lengthM} m, over the ${CBT_TAIL_MAX_M} m limit. ` +
          `Route via a closer joint or add an intermediate joint.`
        );
        return;
      }

      map.getSource('rubberband-src').setData(emptyFC());
      map.getSource('snap-src').setData(emptyFC());

      onFinish({
        coordinates: vertices,
        tail_id:     nextCBTTailId(areaId),
        area_id:     areaId,
        pop_id:      projectStore.cabinet?.properties.pop_id || '',
        from_cbt:    cbtId,
        to_joint:    snap.id,
        via_poles:   nodeIds.slice(1, -1),
        node_chain:  nodeIds,
        node_types:  nodeTypes,
        length_m:    lengthM,
      });
      // One tail per CBT — handler tears the tool down on form save.
    }
  }

  function onContextmenu(e) {
    e.preventDefault();
    cleanup();   // RMB = cancel (finishing is a joint click now)
  }

  function onKeydown(e) {
    if (e.key === 'Escape') { cleanup(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      if (waypoints.length) {
        waypoints.pop();
        recomputeCommitted();
        rubber(committedCoords);
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
  setActiveTool({ cleanup });
  return null;
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
      showToast('Click on or near an existing chamber. Joints must be placed inside a chamber.');
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
  setActiveTool({ cleanup });
  return null;
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
  setActiveTool({ cleanup });
  return null;
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
    const snap = _snapToNode(map, e.lngLat, 16, ['POP', 'JOINT', 'DUCT_VERTEX']);
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
    const snap = _snapToNode(map, e.lngLat, 16, ['POP', 'JOINT', 'DUCT_VERTEX']);
    const { lng, lat } = snap ? snap.lngLat : e.lngLat;
    vertices.push([lng, lat]);
    nodeIds.push(snap ? snap.id : null);
    nodeTypes.push(snap ? snap.type : null);
  }

  function onContextmenu(e) {
    e.preventDefault();
    if (vertices.length < 2) {
      showToast('A cable needs at least 2 points. Keep clicking to add vertices, then right-click to finish.');
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
  setActiveTool({ cleanup });
  return null;
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
  setActiveTool({ cleanup });
  return null;
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
      showToast('A duct needs at least 2 points. Keep clicking to add vertices, then right-click to finish.');
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
      showToast(err.message);
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
  setActiveTool({ cleanup });
  return null;
}
