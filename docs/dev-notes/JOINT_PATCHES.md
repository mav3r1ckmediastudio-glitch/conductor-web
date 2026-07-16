# Conductor Web — Place Joint patches
# Apply these changes to the three existing files.
# Each section shows the OLD text to find (unique in file) and the NEW replacement.

═══════════════════════════════════════════════════════
FILE: frontend/src/mapTools.js
═══════════════════════════════════════════════════════

──────────────────────────────────────────────────────
CHANGE 1 of 4 — add icon + source for joints in ensureSources()
Find (after the rubberband-src block, before snap-src block):
──────────────────────────────────────────────────────
  // ── Snap indicator ────────────────────────────────────────────────────
  if (!map.getSource('snap-src')) {

Replace with:
──────────────────────────────────────────────────────
  // ── Joints ───────────────────────────────────────────────────────────
  addSquareIcon(map, 'icon-joint', '#0d1520', '#4dc8ff', '#00aaff', 10);

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

  // ── Snap indicator ────────────────────────────────────────────────────
  if (!map.getSource('snap-src')) {

──────────────────────────────────────────────────────
CHANGE 2 of 4 — sync joints in syncToMap()
Find (the closing brace after the ducts block):
──────────────────────────────────────────────────────
  // Ducts
  map.getSource('ducts-src').setData({
    type: 'FeatureCollection',
    features: s.ducts || [],
  });
}

Replace with:
──────────────────────────────────────────────────────
  // Ducts
  map.getSource('ducts-src').setData({
    type: 'FeatureCollection',
    features: s.ducts || [],
  });

  // Joints
  if (map.getSource('joints-src')) {
    map.getSource('joints-src').setData({
      type: 'FeatureCollection',
      features: s.joints || [],
    });
  }
}

──────────────────────────────────────────────────────
CHANGE 3 of 4 — add nextJointId() helper (before activateDuctTool)
Find:
──────────────────────────────────────────────────────
// ── DUCT TOOL ─────────────────────────────────────────────────────────────────

Replace with:
──────────────────────────────────────────────────────
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
    const snap = _snapToNode(map, e.lngLat);
    if (snap && snap.type === 'CHAMBER') {
      map.getSource('snap-src').setData(pointFC(snap.lngLat.lng, snap.lngLat.lat));
      map.getCanvas().style.cursor = 'pointer';
    } else {
      map.getSource('snap-src').setData(emptyFC());
      map.getCanvas().style.cursor = 'crosshair';
    }
  }

  function onClick(e) {
    // Find nearest chamber
    const snap = _snapToNode(map, e.lngLat);
    if (!snap || snap.type !== 'CHAMBER') {
      alert('Click on or near an existing chamber. Joints must be placed inside a chamber.');
      return;
    }

    // Find the full chamber feature for pop_id
    const chamberFeature = projectStore.chambers.find(
      ch => ch.properties.chamber_id === snap.id
    );
    if (!chamberFeature) return;

    const jointId = nextJointId(areaId);

    onFinish({
      lng:        snap.lngLat.lng,
      lat:        snap.lngLat.lat,
      joint_id:   jointId,
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

// ── DUCT TOOL ─────────────────────────────────────────────────────────────────

──────────────────────────────────────────────────────
CHANGE 4 of 4 — export activateJointTool in the pointFC helper block
Find (the exports near the bottom of the file):
──────────────────────────────────────────────────────
export { _snapToNode as snapToNode };

Replace with:
──────────────────────────────────────────────────────
export { _snapToNode as snapToNode };

function pointFC(lng, lat) {
  return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: {} }] };
}

NOTE: Check if pointFC already exists in your file (it should — used by chamber tool).
If it does, skip the function definition above — the export line is the only new thing needed,
and activateJointTool is already exported via the `export function` keyword above.


═══════════════════════════════════════════════════════
FILE: frontend/src/projectStore.js
═══════════════════════════════════════════════════════

──────────────────────────────────────────────────────
CHANGE 1 of 3 — add joints to DEFAULT_STATE
Find:
──────────────────────────────────────────────────────
  chambers: [],
  ducts: [],

Replace with:
──────────────────────────────────────────────────────
  chambers: [],
  ducts: [],
  joints: [],

──────────────────────────────────────────────────────
CHANGE 2 of 3 — add joints getter
Find:
──────────────────────────────────────────────────────
  get ducts() { return this._state.ducts; }

Replace with:
──────────────────────────────────────────────────────
  get ducts() { return this._state.ducts; }
  get joints() { return this._state.joints; }

──────────────────────────────────────────────────────
CHANGE 3 of 3 — add addJoint() and updateChamberFunction()
Find:
──────────────────────────────────────────────────────
  addDuct(feature) {
    this._update({ ducts: [...this._state.ducts, feature] });
  }

Replace with:
──────────────────────────────────────────────────────
  addDuct(feature) {
    this._update({ ducts: [...this._state.ducts, feature] });
  }

  addJoint(feature) {
    this._update({ joints: [...this._state.joints, feature] });
  }

  updateChamberFunction(chamberId, newFunction) {
    const updated = this._state.chambers.map(ch => {
      if (ch.properties.chamber_id === chamberId) {
        return { ...ch, properties: { ...ch.properties, chamber_type: newFunction } };
      }
      return ch;
    });
    this._update({ chambers: updated });
  }


═══════════════════════════════════════════════════════
FILE: frontend/src/App.svelte
═══════════════════════════════════════════════════════

──────────────────────────────────────────────────────
CHANGE 1 of 4 — import JointForm and activateJointTool
Find:
──────────────────────────────────────────────────────
  import DuctForm from './DuctForm.svelte';

Replace with:
──────────────────────────────────────────────────────
  import DuctForm from './DuctForm.svelte';
  import JointForm from './JointForm.svelte';

──────────────────────────────────────────────────────
CHANGE 2 of 4 — import activateJointTool from mapTools
Find:
──────────────────────────────────────────────────────
  import { ensureSources, ensureTerrainLayers, syncToMap, activateCabinetTool, activateBuildAreaTool, activateChamberTool, activateDuctTool, applyCookieCutter, clearTool } from './mapTools.js';

Replace with:
──────────────────────────────────────────────────────
  import { ensureSources, ensureTerrainLayers, syncToMap, activateCabinetTool, activateBuildAreaTool, activateChamberTool, activateDuctTool, activateJointTool, applyCookieCutter, clearTool } from './mapTools.js';

──────────────────────────────────────────────────────
CHANGE 3 of 4 — add pendingJoint variable alongside existing pending vars
Find:
──────────────────────────────────────────────────────
  let pendingDuct = null;

Replace with:
──────────────────────────────────────────────────────
  let pendingDuct = null;
  let pendingJoint = null;

──────────────────────────────────────────────────────
CHANGE 4 of 4 — add onPlaceJoint / onJointSaved / onJointCancelled handlers
  and wire fibre-joint in onToolSelected
Find:
──────────────────────────────────────────────────────
  function onToolSelected(e) {
    const { label, category, toolId } = e.detail;
    const catLabel = category.charAt(0).toUpperCase() + category.slice(1);
    activeToolLabel = `${catLabel} — ${label}`;
    if (toolId === 'civil-chamber') onPlaceChamber();
    if (toolId === 'civil-duct') onPlaceDuct();
    // Additional tool wiring goes here in the next iteration
  }

Replace with:
──────────────────────────────────────────────────────
  function onPlaceJoint() {
    clearTool(map);
    activeToolLabel = 'Place Joint — click a chamber';
    const err = activateJointTool(map, (pending) => {
      pendingJoint = pending;
      rpMode = 'joint-form';
      activeToolLabel = '';
    });
    if (err) alert(err.error);
  }

  function onJointSaved(e) {
    const attrs = e.detail;
    // Add joint to store
    projectStore.addJoint({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [attrs.lng, attrs.lat] },
      properties: attrs,
    });
    // Update parent chamber function if it's a splice joint
    if (attrs.joint_type === 'SPLICE') {
      projectStore.updateChamberFunction(attrs.chamber_id, 'JOINT');
    }
    syncToMap(map);
    rpMode = 'default';
    pendingJoint = null;
  }

  function onJointCancelled() {
    rpMode = 'default';
    pendingJoint = null;
    clearTool(map);
  }

  function onToolSelected(e) {
    const { label, category, toolId } = e.detail;
    const catLabel = category.charAt(0).toUpperCase() + category.slice(1);
    activeToolLabel = `${catLabel} — ${label}`;
    if (toolId === 'civil-chamber') onPlaceChamber();
    if (toolId === 'civil-duct')    onPlaceDuct();
    if (toolId === 'fibre-joint')   onPlaceJoint();
    // Additional tool wiring goes here in the next iteration
  }

──────────────────────────────────────────────────────
CHANGE 5 of 4 — add JointForm to the right-panel template
Find (the DuctForm block in the template):
──────────────────────────────────────────────────────
      {:else if rpMode === 'duct-form'}
        <DuctForm pending={pendingDuct} on:save={onDuctSaved} on:cancel={onDuctCancelled} />

Replace with:
──────────────────────────────────────────────────────
      {:else if rpMode === 'duct-form'}
        <DuctForm pending={pendingDuct} on:save={onDuctSaved} on:cancel={onDuctCancelled} />
      {:else if rpMode === 'joint-form'}
        <JointForm pending={pendingJoint} on:save={onJointSaved} on:cancel={onJointCancelled} />
