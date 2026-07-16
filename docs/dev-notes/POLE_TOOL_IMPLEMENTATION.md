# Conductor Web — Pole Tool Implementation (5 Steps)

**Date:** 26 June 2026  
**Completed:** All 5 steps ✅

---

## Summary

Integrated **Place Pole** tool (`civil-pole` toolId) into Conductor Web with full state management, UI forms, snap system, and 3D CustomLayerInterface architecture. Tool follows existing chamber/duct patterns and maintains colour/ID conventions from QGIS plugin.

**New tool properties:**
- ID: `{areaId}-POL-001` (sequential)
- Snap radius: 16px (uses standard _snapToNode system)
- Form: Openreach ref, pole type (SOFTWOOD_7M/9M/11M, CONCRETE_7M/9M, STEEL, OTHER), status (PROPOSED/SURVEY/INSTALLED), notes
- Geometry: Point, WGS84
- 3D rendering: 9m cylinder, 0.15m radius, #4dc8ff, opacity 0.7 (requires THREE.js)

---

## Step 1: projectStore.js — State Management

### Changes:
- Added `poles: []` and `cbts: []` arrays to `DEFAULT_STATE`
- Added getter methods: `get poles()` and `get cbts()`
- Added methods: `addPole(feature)` and `addCBT(feature)`

### State shape for poles:
```js
{
  pole_id: "SCOT-TTY-POL-001",
  area_id: "SCOT-TTY",
  pop_id: "SCOT-TTY-POP",
  openreach_ref: "ER12345",
  pole_type: "SOFTWOOD_9M",
  status: "PROPOSED",
  notes: "Located near junction",
  lng: -3.77123,
  lat: 56.71456
}
```

---

## Step 2: mapTools.js — Map Infrastructure

### Changes:

1. **Import PoleLayers.js** for 3D rendering
   ```js
   import { createPoleLayer } from './PoleLayers.js';
   ```

2. **Added poles-src GeoJSON source** in `ensureSources()`
   - Handles pole geometry, no visible layer (3D CustomLayerInterface renders instead)

3. **Extended snap system** `_snapToNode()` to include POLE type
   - Checks `projectStore.poles` array
   - Radius: 16px (standard)
   - Returns `{ lngLat, id: pole_id, type: 'POLE', dist }`

4. **Added `nextPoleId(areaId)` helper**
   - Generates sequential pole IDs: POL-001, POL-002, etc.
   - Avoids conflicts with existing poles

5. **Added `activatePoleTool(map, onFinish)` export**
   - Single-click tool (no multi-vertex input needed)
   - Requires cabinet to be placed first
   - Returns pending object with auto-generated pole_id, area_id, pop_id, lng, lat
   - Callback triggers form display in App.svelte

6. **Updated `syncToMap()`** to push poles data to `poles-src`
   - Mirrors pattern for chambers, cables, etc.

7. **Updated `ensureTerrainLayers()`** to add 3D pole layer
   - Creates CustomLayerInterface via `createPoleLayer(projectStore)`
   - Adds to map after terrain setup, before cable pulse animation
   - Fallback: stub layer if THREE.js unavailable

---

## Step 3: App.svelte — Tool Orchestration

### Changes:

1. **Added imports**
   - `import PlacePoleForm from './PlacePoleForm.svelte'`
   - Added `activatePoleTool` to mapTools.js imports

2. **Added state variable**
   - `let pendingPole = null` (holds form-pending data during placement)

3. **Added three handler functions**
   - `onPlacePole()` — activates tool, sets pendingPole, switches rpMode to 'pole-form'
   - `onPoleSaved(e)` — receives form data, creates Feature, adds to store, syncs map
   - `onPoleCancelled()` — clears pending, resets rpMode, clears tool

4. **Wired tool in `onToolSelected()`**
   - Added: `if (toolId === 'civil-pole') onPlacePole();`

5. **Added right-panel form section**
   - `{:else if rpMode === 'pole-form'}` block renders PlacePoleForm
   - Passes `pending={pendingPole}` and event handlers

---

## Step 4: PlacePoleForm.svelte — User Interface

### New Component

Svelte form component with sections:

**IDENTITY section:**
- Openreach Ref (optional text input)
- Pole Type (dropdown: SOFTWOOD_7M/9M/11M, CONCRETE_7M/9M, STEEL, OTHER, or "— not set —")
- Status (dropdown: PROPOSED, SURVEY, INSTALLED)

**NOTES section:**
- Free text notes (optional)

**Actions:**
- Cancel button (resets form, emits cancel event)
- Place Pole button (validates, emits save event with all attributes)

**Styling:**
- Dark theme (#0d1520 panels, #1a2d40 inputs, #4dc8ff accents)
- Matches existing chamber/joint/cable form aesthetics
- Auto-focus on Openreach Ref field when form loads

**Data flow:**
- Receives `pending` object (auto-populated pole_id, area_id, pop_id, lng, lat)
- Dispatches `save` event with full attributes dict
- Dispatches `cancel` event

---

## Step 5: PoleLayers.js — 3D Pole Rendering

### Architecture

**CustomLayerInterface** for THREE.js pole rendering (requires npm install three).

#### When THREE.js IS installed:
- Creates scene, camera, renderer on map canvas
- Renders each pole as CylinderGeometry(r=0.15m, h=9m, segments=8)
- Material: MeshPhongMaterial, colour #4dc8ff, opacity 0.7
- Positioned in mercator space + terrain elevation offset
- Updates every frame from projectStore.poles array
- Includes ambient + directional lighting

#### When THREE.js is NOT installed:
- Stub layer provides no-op interface
- Logs warning: "THREE.js not available. Pole rendering is stub."
- Poles still exist in data (localStorage + map GeoJSON), just no 3D visualization
- Can be enabled later via `npm install three` + import uncomment

### Key Details:

**Geometry:**
- `CylinderGeometry(radius=0.15, height=9, segments=8)`
- Positioned with +4.5m offset (half height) to sit on ground
- Scaled by zoom level to maintain visibility across zoom ranges

**Material:**
- Phong shading: color #4dc8ff, emissive #1a5f7f, opacity 0.7
- Transparent, casts no shadow (cosmetic only)

**Terrain Elevation:**
- Placeholder: returns 0 (sea level fallback)
- TODO: Implement proper DEM tile decoding for terrain-rgb-v2
- Architecture: `_sampleTerrainElevation(lng, lat)` with cache

**Rendering Loop:**
- `onAdd(map, gl)` — initializes scene and THREE objects
- `render(gl, matrix)` — updates poles, renders each frame, schedules repaint
- `onRemove()` — cleanup

---

## Integration Checklist

- [x] projectStore: poles array + getters/setters
- [x] mapTools: poles-src + snap extension + nextPoleId() + activatePoleTool()
- [x] mapTools: syncToMap + ensureTerrainLayers integration
- [x] App.svelte: imports, handlers, rpMode routing
- [x] PlacePoleForm.svelte: form component
- [x] PoleLayers.js: CustomLayerInterface (with fallback)
- [x] RadialWheel: assumes 'civil-pole' toolId is wired (already in place via onToolSelected)

---

## Next Steps (Deferred)

1. **CBT tool** — mirrors Place Pole but:
   - Snaps required to POLE (14px radius, from QGIS plugin)
   - Shares pole coordinates (placed at parent pole location)
   - Writes to joints layer as `joint_type = "CBT"`
   - Form: CBT model, splitter checkbox + cascade fields, status, notes

2. **Aerial Span** — line between CBTs or CBT→POP
   - Multi-vertex digitiser (pattern: duct tool)
   - Snaps to POLE and JOINT types

3. **Aerial Drop** — line from CBT to premise
   - Two-click tool (pattern: drop duct tool)
   - Auto-saves, snaps to CBT + PREMISE types

4. **Terrain elevation sampling** — implement proper DEM decoding
   - Use mapTiler terrain-rgb-v2 tile data
   - Decode elevation from RGB values
   - Cache results

5. **THREE.js packaging** — add to frontend/package.json
   - `npm install three` in frontend/ when ready to enable 3D poles
   - Remove try/catch fallback once confirmed in place

---

## File Locations (frontend/src/)

```
projectStore.js         [EDITED] — state + getters/setters
mapTools.js             [EDITED] — sources, snap, tool activation, sync
App.svelte              [EDITED] — orchestration + form routing
PlacePoleForm.svelte    [NEW]    — form component
PoleLayers.js           [NEW]    — 3D CustomLayerInterface
```

All files are ready to commit to master branch. No breaking changes to existing tools.

---

## Testing Notes

**Functional test:**
1. Create project → import addresses → draw build area → place cabinet
2. RadialWheel: tap "Place Pole" (civil-pole)
3. Click map → form appears with auto-populated pole_id
4. Fill form (openreach_ref, type, status) → Place Pole
5. Pole appears in poles-src GeoJSON
6. If THREE.js installed: pole renders as cyan cylinder at click location (9m tall)

**Snap test:**
1. Place two poles
2. Activate CBT tool (later): move cursor near pole → orange snap indicator
3. Click on snap → CBT placed at pole location

**localStorage test:**
1. Place pole → refresh page
2. Pole should persist in projectStore.state and poles-src

**THREE.js availability:**
- Console: `[PoleLayers] stub layer active...` → THREE not installed
- Console: `[PoleLayers] THREE.js layer initialized.` → THREE available

---

## Commit Message

```
feat: Add Place Pole tool (civil-pole) with state + forms + 3D CustomLayerInterface

- Step 1: projectStore poles/cbts arrays + getters/setters
- Step 2: mapTools poles-src + snap extension + activatePoleTool()
- Step 3: App orchestration + form routing
- Step 4: PlacePoleForm.svelte component (openreach_ref, pole_type, status, notes)
- Step 5: PoleLayers.js THREE.js CustomLayerInterface (9m cylinder, #4dc8ff)
          with fallback stub when THREE.js unavailable

Tool ready for CBT snapping + aerial span/drop tools.
Terrain elevation TODO: implement DEM tile decoding.
```
