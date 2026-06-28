<script>
  import { onMount } from 'svelte';
  import maplibregl from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import RadialWheel from './RadialWheel.svelte';
  import CabinetForm from './CabinetForm.svelte';
  import ChamberForm from './ChamberForm.svelte';
  import DuctForm from './DuctForm.svelte';
  import JointForm from './JointForm.svelte';
  import CableForm from './CableForm.svelte';
  import PlacePoleForm from './PlacePoleForm.svelte';
  import CBTForm from './CBTForm.svelte';
  import CBTTailForm from './CBTTailForm.svelte';
  import EditCabinetForm from './EditCabinetForm.svelte';
  import RoadCrossingForm from './RoadCrossingForm.svelte';
  import StreamCrossingForm from './StreamCrossingForm.svelte';
  import PIAChamberForm from './PIAChamberForm.svelte';
  import PIADuctForm from './PIADuctForm.svelte';
  import ProjectSetup from './ProjectSetup.svelte';
  import AddressImporter from './AddressImporter.svelte';
  import BuildAreaForm from './BuildAreaForm.svelte';
  import { projectStore } from './projectStore.js';
  import { assignFibres } from './fibreAssign.js';
  import AssetEditPanel from './AssetEditPanel.svelte';
  import AssetPickerDialog from './AssetPickerDialog.svelte';
  import FibreTracePanel from './FibreTracePanel.svelte';
  import {
    ensureSources, ensureTerrainLayers, syncToMap,
    activateCabinetTool, activateBuildAreaTool, activateChamberTool,
    activateDuctTool, activateJointTool, activateDropDuctTool,
    activateCableTool, activateBundleTool, activatePoleTool,
    activateCBTTool, activateAerialSpanTool, activateAerialDropTool,
    activateCBTTailTool,
    activateSelectTool, activateMovePointTool,
    activateFibreTraceTool, clearTraceHighlight,
    applyCookieCutter, clearTool
  } from './mapTools.js';

  const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY;

  // ── Basemap definitions ──────────────────────────────────────────────────────
  const BASEMAPS = [
    { id: 'dark',      label: '⬛  Dark',       style: `https://api.maptiler.com/maps/dataviz-dark/style.json?key=${MAPTILER_KEY}` },
    { id: 'light',     label: '⬜  Light',      style: `https://api.maptiler.com/maps/dataviz/style.json?key=${MAPTILER_KEY}` },
    { id: 'streets',   label: '⊞  Streets',    style: `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}` },
    { id: 'satellite', label: '⊙  Satellite',  style: `https://api.maptiler.com/maps/hybrid/style.json?key=${MAPTILER_KEY}` },
  ];
  const BASEMAP_STYLE = Object.fromEntries(BASEMAPS.map(b => [b.id, b.style]));

  let map;
  let is3D = true;
  let drawerOpen = false;
  let showBuildings = true;
  let currentBasemap = 'dark';
  let basemapSwitching = false; // prevents double-clicks during style reload

  let stage = projectStore.stage;
  let project = projectStore.project;
  projectStore.on((event) => {
    stage = projectStore.stage;
    project = projectStore.project;
    if (map) syncToMap(map);
    if (event === 'reset') {
      if (stage === 'import')      rpMode = 'address-import';
      else if (stage === 'setup')  rpMode = 'default';
      else                          rpMode = 'default';
    }
  });

  let rpMode = 'default';
  let pendingCabinet   = null;
  let pendingChamber   = null;
  let pendingDuct      = null;
  let pendingJoint     = null;
  let pendingCable     = null;
  let pendingBuildArea = null;
  let pendingPole      = null;
  let pendingCBT       = null;
  let pendingCBTTail   = null;
  let pendingRoadCrossing    = null;
  let pendingStreamCrossing  = null;
  let pendingPIAChamber      = null;
  let pendingPIADuct         = null;
  let selectedAsset    = null;
  let assetPickerHits  = null;
  let fibreTraceResult = null;

  let activeToolLabel = '';
  let activeCat = 'civil';

  const ROUTES = [
    {id:'ENG-CH3-TAIL-002',status:'Routed',  from:'ENG-CH3-CBT-002',to:'ENG-CH3-JNT-005',len:'0.20 km',assets:'1',fibres:'1',cap:'100%',updated:'12/05/2024',eng:'—'},
    {id:'ENG-CH3-RTE-001', status:'Unserved',from:'ENG-CH3-JNT-001',to:'ENG-CH3-PRE-012',len:'73 m',   assets:'—',fibres:'—',cap:'0%',  updated:'—',       eng:'—'},
    {id:'ENG-CH3-RTE-002', status:'Unserved',from:'ENG-CH3-JNT-001',to:'ENG-CH3-PRE-034',len:'57 m',   assets:'—',fibres:'—',cap:'0%',  updated:'—',       eng:'—'},
    {id:'ENG-CH3-RTE-003', status:'Unserved',from:'ENG-CH3-JNT-002',to:'ENG-CH3-PRE-056',len:'46 m',   assets:'—',fibres:'—',cap:'0%',  updated:'—',       eng:'—'},
    {id:'ENG-CH3-RTE-004', status:'Unserved',from:'ENG-CH3-JNT-002',to:'ENG-CH3-PRE-078',len:'78 m',   assets:'—',fibres:'—',cap:'0%',  updated:'—',       eng:'—'},
    {id:'ENG-CH3-RTE-005', status:'Partial', from:'ENG-CH3-JNT-003',to:'ENG-CH3-PRE-090',len:'112 m',  assets:'2',fibres:'1',cap:'50%', updated:'12/05/2024',eng:'PW'},
  ];
  let selectedRoute = 'ENG-CH3-TAIL-002';

  const ASSET_ROWS = [
    ['ID','ENG-CH3-JNT-004',''],['Type','Splice',''],['Closure','Prysmian CMJ',''],
    ['Has Splitter','True','ok'],['Split Ratio','1:8',''],['Cascade Lvl','2',''],
    ['Status','In Service','ok'],['Notes','—',''],
  ];

  function statusClass(s) { return s === 'Routed' ? 'routed' : s === 'Partial' ? 'partial' : 'unserved'; }
  function capStyle(cap) {
    if (cap === '100%') return 'color:#4dc8ff;';
    if (cap === '0%') return 'color:#ff5555;';
    return 'color:#ffaa44;';
  }

  // ── Map layer setup (called on first load AND after every basemap switch) ────
  // All our custom sources, layers, terrain, 3D poles, and data go through here.
  // Defensive throughout — every addLayer/addSource is guarded so re-calling on
  // an already-set-up map is a no-op.
  function setupMapLayers(map) {
    // 1. GeoJSON sources + non-terrain symbol layers (chambers, joints, labels etc.)
    ensureSources(map);

    // 2. Terrain DEM source + elevation
    if (!map.getSource('terrain')) {
      map.addSource('terrain', {
        type: 'raster-dem',
        url: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${MAPTILER_KEY}`,
        tileSize: 256,
      });
    }
    map.setTerrain({ source: 'terrain', exaggeration: 1.5 });

    // 3. Terrain-dependent line layers + 3D pole CustomLayerInterface
    ensureTerrainLayers(map);

    // 4. Decorative vector overlay layers (buildings + neon roads).
    //    Guarded behind a source check — satellite/hybrid raster styles may not
    //    expose `maptiler_planet` vector tiles, or the transportation source-layer
    //    may not exist; defensive try/catch prevents a hard crash.
    if (map.getSource('maptiler_planet')) {
      if (!map.getLayer('buildings-3d')) {
        try {
          map.addLayer({
            id: 'buildings-3d',
            source: 'maptiler_planet',
            'source-layer': 'building',
            type: 'fill-extrusion',
            minzoom: 14,
            paint: {
              'fill-extrusion-color': '#ffffff',
              'fill-extrusion-height': ['get', 'render_height'],
              'fill-extrusion-base': ['get', 'render_min_height'],
              'fill-extrusion-opacity': 0.3,
            },
          });
        } catch (e) {
          console.warn('[basemap] buildings-3d not available in this style:', e.message);
        }
      }

      if (!map.getLayer('roads-glow')) {
        try {
          map.addLayer({
            id: 'roads-glow',
            source: 'maptiler_planet',
            'source-layer': 'transportation',
            type: 'line',
            filter: ['in', 'class', 'motorway', 'primary', 'secondary', 'tertiary', 'residential'],
            paint: {
              'line-color': '#ff00aa',
              'line-width': ['interpolate', ['linear'], ['zoom'], 12, 6, 16, 16],
              'line-blur': 10,
              'line-opacity': 0.6,
            },
          });
        } catch (e) {
          console.warn('[basemap] roads-glow not available in this style:', e.message);
        }
      }

      if (!map.getLayer('roads-neon')) {
        try {
          map.addLayer({
            id: 'roads-neon',
            source: 'maptiler_planet',
            'source-layer': 'transportation',
            type: 'line',
            filter: ['in', 'class', 'motorway', 'primary', 'secondary', 'tertiary', 'residential'],
            paint: {
              'line-color': '#ff44cc',
              'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 16, 2],
              'line-opacity': 0.9,
            },
          });
        } catch (e) {
          console.warn('[basemap] roads-neon not available in this style:', e.message);
        }
      }
    }

    // 5. Restore building visibility from current toggle state
    if (map.getLayer('buildings-3d')) {
      map.setLayoutProperty('buildings-3d', 'visibility', showBuildings ? 'visible' : 'none');
    }

    // 6. Push all stored GeoJSON data into sources
    syncToMap(map);
  }

  onMount(() => {
    map = new maplibregl.Map({
      container: 'map',
      style: BASEMAP_STYLE[currentBasemap],
      center: [-3.77, 56.71],
      zoom: 15,
      pitch: 60,
      bearing: -30,
    });

    map.on('load', () => {
      setupMapLayers(map);
      if (projectStore.stage === 'import') rpMode = 'address-import';
    });
  });

  // ── Basemap switcher ──────────────────────────────────────────────────────────
  // setStyle() destroys every source and layer MapLibre knows about, including
  // our GeoJSON sources, terrain, 3D pole layer, symbol layers — everything.
  // We re-add the lot in the style.load handler via setupMapLayers().
  //
  // Camera state (center/zoom/pitch/bearing) is saved before setStyle() and
  // restored immediately in the handler via jumpTo() (no animation — the style
  // reload is jarring enough already; a smooth fly-to on top looks odd).
  //
  // The ThreeJS CustomLayerInterface (poles-3d-layer) is re-registered by
  // ensureTerrainLayers() → createPoleLayer() inside setupMapLayers(). All pole,
  // span, and drop geometry rebuilds happen automatically on the first render().
  function changeBasemap(id) {
    if (!map || !BASEMAP_STYLE[id] || id === currentBasemap || basemapSwitching) return;
    basemapSwitching = true;

    // Cancel any active digitising tool BEFORE setStyle() wipes all sources.
    // clearTool() guards each setData call with getSource() checks, so it's
    // safe even if called at this exact moment.
    clearTool(map);
    activeToolLabel = '';

    // Snapshot camera before the style wipe
    const center  = map.getCenter();
    const zoom    = map.getZoom();
    const pitch   = map.getPitch();
    const bearing = map.getBearing();

    map.once('style.load', () => {
      // Restore camera instantly — jumpTo not flyTo (avoids disorienting animation
      // on top of an already-abrupt style change)
      map.jumpTo({ center, zoom, pitch, bearing });

      // Rebuild every custom layer and repopulate data
      setupMapLayers(map);

      basemapSwitching = false;
    });

    currentBasemap = id;
    map.setStyle(BASEMAP_STYLE[id]);
  }

  // ── Workflow handlers ────────────────────────────────────────────────────────

  function onProjectCreated(e) {
    projectStore.setupProject(e.detail);
    rpMode = 'address-import';
  }

  function onAddressImported(e) {
    projectStore.setAddressPoints(e.detail);
    syncToMap(map);
    rpMode = 'default';
    if (e.detail.length > 0) {
      const lngs = e.detail.map(f => f.geometry.coordinates[0]);
      const lats = e.detail.map(f => f.geometry.coordinates[1]);
      map.fitBounds([
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ], { padding: 60, duration: 1200 });
    }
  }

  function onAddressSkipped() {
    projectStore.setAddressPoints([]);
    rpMode = 'default';
  }

  function onDrawBuildArea() {
    clearTool(map);
    activeToolLabel = 'Draw Build Area';
    activateBuildAreaTool(map, (feature) => {
      pendingBuildArea = feature;
      rpMode = 'build-area-form';
      activeToolLabel = '';
    });
  }

  function onBuildAreaSaved(e) {
    const attrs = e.detail;
    const feature = { ...pendingBuildArea, properties: attrs };
    applyCookieCutter(map, feature);
    projectStore.setBuildArea(feature);
    rpMode = 'default';
    pendingBuildArea = null;
  }

  function onBuildAreaCancelled() {
    pendingBuildArea = null;
    rpMode = 'default';
    clearTool(map);
    if (map && map.getSource('build-area-src')) {
      map.getSource('build-area-src').setData({ type: 'FeatureCollection', features: [] });
    }
  }

  function onPlaceCabinet() {
    clearTool(map);
    activeToolLabel = 'Place Cabinet / POP';
    activateCabinetTool(map, (pending) => {
      pendingCabinet = pending;
      rpMode = 'cabinet-form';
      activeToolLabel = '';
    });
  }

  function onCabinetSaved(e) {
    const attrs = e.detail;
    projectStore.setCabinet({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [attrs.lng, attrs.lat] },
      properties: attrs,
    });
    syncToMap(map);
    rpMode = 'default';
    pendingCabinet = null;
  }

  function onCabinetCancelled() {
    rpMode = 'default';
    pendingCabinet = null;
    clearTool(map);
  }

  function onPlaceChamber() {
    clearTool(map);
    activeToolLabel = 'Place Chamber';
    const err = activateChamberTool(map, (pending) => {
      pendingChamber = pending;
      rpMode = 'chamber-form';
      activeToolLabel = '';
    });
    if (err) alert(err.error);
  }

  function onChamberSaved(e) {
    const attrs = e.detail;
    projectStore.addChamber({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [attrs.lng, attrs.lat] },
      properties: attrs,
    });
    syncToMap(map);
    rpMode = 'default';
    pendingChamber = null;
  }

  function onChamberCancelled() {
    rpMode = 'default';
    pendingChamber = null;
    clearTool(map);
  }

  function onPlaceDuct() {
    clearTool(map);
    activeToolLabel = 'Digitise Duct — click vertices, right-click to finish';
    const err = activateDuctTool(map, (pending) => {
      pendingDuct = pending;
      rpMode = 'duct-form';
      activeToolLabel = '';
    });
    if (err) alert(err.error);
  }

  function onDuctSaved(e) {
    const attrs = e.detail;
    projectStore.addDuct({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: attrs.coordinates },
      properties: attrs,
    });
    syncToMap(map);
    rpMode = 'default';
    pendingDuct = null;
  }

  function onDuctCancelled() {
    rpMode = 'default';
    pendingDuct = null;
    clearTool(map);
    if (map.getSource('rubberband-src')) map.getSource('rubberband-src').setData({ type: 'FeatureCollection', features: [] });
  }

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
    projectStore.addJoint({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [attrs.lng, attrs.lat] },
      properties: attrs,
    });
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

  function onPlaceDropDuct() {
    clearTool(map);
    activeToolLabel = 'Drop Duct — click start, click end (RMB cancels line)';
    const err = activateDropDuctTool(map, (feature) => {
      projectStore.addDropDuct(feature);
      syncToMap(map);
    });
    if (err) { alert(err.error); activeToolLabel = ''; }
  }

  function onPlaceCable() {
    clearTool(map);
    activeToolLabel = 'Digitise Cable — click vertices, right-click to finish';
    const err = activateCableTool(map, (pending) => {
      pendingCable = pending;
      rpMode = 'cable-form';
      activeToolLabel = '';
    });
    if (err) alert(err.error);
  }

  function onCableSaved(e) {
    const attrs = e.detail;
    projectStore.addCable({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: attrs.coordinates },
      properties: attrs,
    });
    syncToMap(map);
    rpMode = 'default';
    pendingCable = null;
  }

  function onCableCancelled() {
    rpMode = 'default';
    pendingCable = null;
    clearTool(map);
    if (map.getSource('rubberband-src')) map.getSource('rubberband-src').setData({ type: 'FeatureCollection', features: [] });
  }

  function onPlaceBundle() {
    clearTool(map);
    activeToolLabel = 'Bundle — click joint, click premise (RMB cancels line)';
    const err = activateBundleTool(map, (feature) => {
      projectStore.addBundle(feature);
      syncToMap(map);
    });
    if (err) { alert(err.error); activeToolLabel = ''; }
  }

  function onPlacePole() {
    clearTool(map);
    activeToolLabel = 'Place Pole — click to place';
    const err = activatePoleTool(map, (pending) => {
      pendingPole = pending;
      rpMode = 'pole-form';
      activeToolLabel = '';
    });
    if (err) { alert(err.error); activeToolLabel = ''; }
  }

  function onPoleSaved(e) {
    const attrs = e.detail;
    projectStore.addPole({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [attrs.lng, attrs.lat] },
      properties: attrs,
    });
    syncToMap(map);
    rpMode = 'default';
    pendingPole = null;
  }

  function onPoleCancelled() {
    rpMode = 'default';
    pendingPole = null;
    clearTool(map);
  }

  function onPlaceCBT() {
    clearTool(map);
    activeToolLabel = 'Place CBT — click a pole';
    const err = activateCBTTool(map, (pending) => {
      pendingCBT = pending;
      rpMode = 'cbt-form';
      activeToolLabel = '';
    });
    if (err) { alert(err.error); activeToolLabel = ''; }
  }

  function onCBTSaved(e) {
    const attrs = e.detail;
    projectStore.addCBT({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [attrs.lng, attrs.lat] },
      properties: attrs,
    });
    syncToMap(map);
    rpMode = 'default';
    pendingCBT = null;
  }

  function onCBTCancelled() {
    rpMode = 'default';
    pendingCBT = null;
    clearTool(map);
  }

  function onPlaceAerialSpan() {
    clearTool(map);
    activeToolLabel = 'Aerial Span — click CBTs to add vertices, RMB to finish';
    const err = activateAerialSpanTool(map, (feature) => {
      projectStore.addSpan(feature);
      syncToMap(map);
    });
    if (err) { alert(err.error); activeToolLabel = ''; }
  }

  function onPlaceAerialDrop() {
    clearTool(map);
    activeToolLabel = 'Aerial Drop — click CBT, then premise';
    const err = activateAerialDropTool(map, (feature) => {
      projectStore.addAerialDrop(feature);
      syncToMap(map);
    });
    if (err) { alert(err.error); activeToolLabel = ''; }
  }

  function onPlaceCBTTail() {
    clearTool(map);
    activeToolLabel = 'CBT Tail — click CBT, snap through poles to the joint, RMB to finish';
    const err = activateCBTTailTool(map, (pending) => {
      pendingCBTTail = pending;
      rpMode = 'cbt-tail-form';
      activeToolLabel = '';
    });
    if (err) { alert(err.error); activeToolLabel = ''; }
  }

  function onCBTTailSaved(e) {
    const attrs = e.detail;
    projectStore.addCBTTail({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: attrs.coordinates },
      properties: attrs,
    });
    syncToMap(map);
    rpMode = 'default';
    pendingCBTTail = null;
    clearTool(map);
  }

  function onCBTTailCancelled() {
    rpMode = 'default';
    pendingCBTTail = null;
    clearTool(map);
    if (map.getSource('rubberband-src')) map.getSource('rubberband-src').setData({ type: 'FeatureCollection', features: [] });
  }

  // ── Asset Edit / Delete / Move ────────────────────────────────────────────

  function handleSelectHits(hits) {
    activeToolLabel = '';
    if (!hits || !hits.length) return;
    if (hits.length === 1) {
      selectAsset(hits[0]);
    } else {
      assetPickerHits = hits;
    }
  }

  function selectAsset(hit) {
    selectedAsset = hit;
    rpMode = 'asset-selected';
  }

  function onAssetPickerChoose(e) {
    assetPickerHits = null;
    selectAsset(e.detail);
  }

  function onAssetPickerCancel() {
    assetPickerHits = null;
    clearTool(map);
    rpMode = 'default';
    activeToolLabel = '';
  }

  function onEditAsset() {
    if (stage !== 'design') return;
    clearTool(map);
    activeToolLabel = 'Click an asset to select it';
    activateSelectTool(map, handleSelectHits);
  }

  function onDeleteAsset() {
    if (stage !== 'design') return;
    clearTool(map);
    activeToolLabel = 'Click an asset to delete it';
    activateSelectTool(map, handleSelectHits);
  }

  function onMoveAsset() {
    if (stage !== 'design') return;
    clearTool(map);
    activeToolLabel = 'Click an asset to move it';
    activateSelectTool(map, handleSelectHits);
  }

  function onAssetPanelSaved(e) {
    const { collection, index, props } = e.detail;
    projectStore.updateAsset(collection, index, props);
    syncToMap(map);
    const arr = projectStore.state[collection];
    if (arr && arr[index]) {
      selectedAsset = { ...selectedAsset, feature: arr[index] };
    }
  }

  function onAssetPanelDeleted(e) {
    const { collection, index } = e.detail;
    projectStore.deleteAsset(collection, index);
    syncToMap(map);
    selectedAsset = null;
    rpMode = 'default';
    clearTool(map);
    activeToolLabel = '';
  }

  function onAssetPanelMove(e) {
    const { collection, index, feature } = e.detail;
    activeToolLabel = `Move ${selectedAsset.assetId} — click new location (Esc to cancel)`;
    rpMode = 'default';
    activateMovePointTool(map, { collection, index }, ({ lng, lat }) => {
      projectStore.updateAssetGeometry(collection, index, [lng, lat]);
      syncToMap(map);
      const arr = projectStore.state[collection];
      if (arr && arr[index]) {
        selectedAsset = { ...selectedAsset, feature: arr[index] };
        rpMode = 'asset-selected';
      }
      activeToolLabel = '';
    });
  }

  function onAssetPanelClose() {
    selectedAsset = null;
    rpMode = 'default';
    clearTool(map);
    activeToolLabel = '';
  }

  // ── civil-edit-cabinet ───────────────────────────────────────────────────────

  function onEditCabinet() {
    if (!projectStore.cabinet) { alert('No cabinet placed yet.'); return; }
    clearTool(map);
    rpMode = 'edit-cabinet-form';
  }

  function onEditCabinetSaved(e) {
    const attrs = e.detail;
    const cab = projectStore.cabinet;
    projectStore.setCabinet({
      ...cab,
      properties: { ...cab.properties, ...attrs },
    });
    syncToMap(map);
    rpMode = 'default';
  }

  function onEditCabinetCancelled() {
    rpMode = 'default';
  }

  // ── civil-road (Road Crossing) ────────────────────────────────────────────

  function onPlaceRoadCrossing() {
    clearTool(map);
    activeToolLabel = 'Road Crossing — click vertices, right-click to finish';
    const err = activateDuctTool(map, (pending) => {
      pendingRoadCrossing = pending;
      rpMode = 'road-crossing-form';
      activeToolLabel = '';
    });
    if (err) alert(err.error);
  }

  function onRoadCrossingSaved(e) {
    const attrs = e.detail;
    projectStore.addDuct({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: attrs.coordinates },
      properties: attrs,
    });
    syncToMap(map);
    rpMode = 'default';
    pendingRoadCrossing = null;
  }

  function onRoadCrossingCancelled() {
    rpMode = 'default';
    pendingRoadCrossing = null;
    clearTool(map);
    if (map.getSource('rubberband-src')) map.getSource('rubberband-src').setData({ type: 'FeatureCollection', features: [] });
  }

  // ── civil-stream (Stream Crossing) ───────────────────────────────────────

  function onPlaceStreamCrossing() {
    clearTool(map);
    activeToolLabel = 'Stream Crossing — click vertices, right-click to finish';
    const err = activateDuctTool(map, (pending) => {
      pendingStreamCrossing = pending;
      rpMode = 'stream-crossing-form';
      activeToolLabel = '';
    });
    if (err) alert(err.error);
  }

  function onStreamCrossingSaved(e) {
    const attrs = e.detail;
    projectStore.addDuct({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: attrs.coordinates },
      properties: attrs,
    });
    syncToMap(map);
    rpMode = 'default';
    pendingStreamCrossing = null;
  }

  function onStreamCrossingCancelled() {
    rpMode = 'default';
    pendingStreamCrossing = null;
    clearTool(map);
    if (map.getSource('rubberband-src')) map.getSource('rubberband-src').setData({ type: 'FeatureCollection', features: [] });
  }

  // ── pia-chamber (Place PIA UG Chamber) ───────────────────────────────────

  function onPlacePIAChamber() {
    clearTool(map);
    activeToolLabel = 'Place PIA UG Chamber — click a location';
    const err = activateChamberTool(map, (pending) => {
      pendingPIAChamber = pending;
      rpMode = 'pia-chamber-form';
      activeToolLabel = '';
    });
    if (err) alert(err.error);
  }

  function onPIAChamberSaved(e) {
    const attrs = e.detail;
    projectStore.addChamber({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [attrs.lng, attrs.lat] },
      properties: attrs,
    });
    syncToMap(map);
    rpMode = 'default';
    pendingPIAChamber = null;
  }

  function onPIAChamberCancelled() {
    rpMode = 'default';
    pendingPIAChamber = null;
    clearTool(map);
  }

  // ── pia-duct (Digitise PIA UG Duct) ──────────────────────────────────────

  function onPlacePIADuct() {
    clearTool(map);
    activeToolLabel = 'PIA UG Duct — click vertices, right-click to finish';
    const err = activateDuctTool(map, (pending) => {
      pendingPIADuct = pending;
      rpMode = 'pia-duct-form';
      activeToolLabel = '';
    });
    if (err) alert(err.error);
  }

  function onPIADuctSaved(e) {
    const attrs = e.detail;
    projectStore.addDuct({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: attrs.coordinates },
      properties: attrs,
    });
    syncToMap(map);
    rpMode = 'default';
    pendingPIADuct = null;
  }

  function onPIADuctCancelled() {
    rpMode = 'default';
    pendingPIADuct = null;
    clearTool(map);
    if (map.getSource('rubberband-src')) map.getSource('rubberband-src').setData({ type: 'FeatureCollection', features: [] });
  }

  // ── pia-drop (Digitise PIA UG Drop) ──────────────────────────────────────

  function onPlacePIADrop() {
    clearTool(map);
    activeToolLabel = 'PIA UG Drop — click start, click end (RMB cancels line)';
    const err = activateDropDuctTool(map, (feature) => {
      feature.properties.installation_method = 'PIA_UG';
      feature.properties.drop_type           = 'PIA_UG';
      feature.properties.owner               = 'Openreach';
      projectStore.addDropDuct(feature);
      syncToMap(map);
    });
    if (err) { alert(err.error); activeToolLabel = ''; }
  }

  // ── fibre-trace (Tier 2) ─────────────────────────────────────────────────
  // Click a premise → trace its route to the cabinet. Tool stays active so the
  // user can click premise after premise; the panel + highlight refresh each
  // click. Close exits the tool and clears the highlight.

  function onFibreTrace() {
    clearTool(map);
    clearTraceHighlight(map);
    fibreTraceResult = null;
    activeToolLabel = 'Fibre Trace — click a premise to trace its route';
    const err = activateFibreTraceTool(map, (result) => {
      fibreTraceResult = result;
      rpMode = 'fibre-trace';
    });
    if (err) { alert(err.error); activeToolLabel = ''; }
  }

  function onFibreTraceClose() {
    fibreTraceResult = null;
    rpMode = 'default';
    clearTool(map);
    clearTraceHighlight(map);
    activeToolLabel = '';
  }

  // ── fibre-assign (Tier 2) ────────────────────────────────────────────────
  // Not a map-click tool — runs the cascade over the whole network, writes
  // splitter_port onto consumers + splitter summaries onto CBTs/joints, then
  // shows a summary. Re-runnable any time; sticky allocation preserves
  // installed/frozen ports.
  let fibreAssignResult = null;

  function onFibreAssign() {
    if (stage !== 'design') return;
    clearTool(map);
    activeToolLabel = '';
    const result = assignFibres(projectStore.state);
    if (!result.ok) { alert(result.reason); return; }
    projectStore.applyFibreAssignment(result);
    syncToMap(map);
    fibreAssignResult = result;
    rpMode = 'fibre-assign';
  }

  function onFibreAssignClose() {
    fibreAssignResult = null;
    rpMode = 'default';
  }

  function onToolSelected(e) {
    const { label, category, toolId } = e.detail;
    const catLabel = category.charAt(0).toUpperCase() + category.slice(1);
    activeToolLabel = `${catLabel} — ${label}`;
    if (toolId === 'civil-chamber')       onPlaceChamber();
    if (toolId === 'civil-duct')          onPlaceDuct();
    if (toolId === 'civil-drop-duct')     onPlaceDropDuct();
    if (toolId === 'aerial-pole')         onPlacePole();
    if (toolId === 'aerial-cbt')          onPlaceCBT();
    if (toolId === 'aerial-span')         onPlaceAerialSpan();
    if (toolId === 'aerial-drop')         onPlaceAerialDrop();
    if (toolId === 'aerial-cbt-tail')     onPlaceCBTTail();
    if (toolId === 'fibre-joint')         onPlaceJoint();
    if (toolId === 'fibre-cable')         onPlaceCable();
    if (toolId === 'fibre-bundle')        onPlaceBundle();
    if (toolId === 'civil-edit-cabinet')  onEditCabinet();
    if (toolId === 'civil-road')          onPlaceRoadCrossing();
    if (toolId === 'civil-stream')        onPlaceStreamCrossing();
    if (toolId === 'pia-chamber')         onPlacePIAChamber();
    if (toolId === 'pia-duct')            onPlacePIADuct();
    if (toolId === 'pia-drop')            onPlacePIADrop();
    // Tier 2
    if (toolId === 'fibre-trace')         onFibreTrace();
    if (toolId === 'fibre-assign')        onFibreAssign();
    // if (toolId === 'fibre-count')      onFibreCount();
  }

  function setView(threeD) {
    is3D = threeD;
    if (!map) return;
    map.easeTo({ pitch: threeD ? 60 : 0, bearing: threeD ? -30 : 0, duration: 1200 });
  }

  function toggleBuildings() {
    showBuildings = !showBuildings;
    if (map && map.getLayer('buildings-3d')) {
      map.setLayoutProperty('buildings-3d', 'visibility', showBuildings ? 'visible' : 'none');
    }
  }

  let showOpen = false;
  let projectList = [];

  function refreshList() { projectList = projectStore.listProjects(); }

  function newProject() {
    if (!confirm('Start a new project? Your current project stays saved and can be re-opened.')) return;
    showOpen = false;
    projectStore.newProject();
    rpMode = 'default';
    activeToolLabel = '';
    if (map) syncToMap(map);
  }

  function openProject(id) {
    showOpen = false;
    if (!projectStore.openProject(id)) { alert('Could not open that project.'); return; }
    rpMode = 'default';
    activeToolLabel = '';
    if (map) syncToMap(map);
  }
</script>

<svelte:window on:click={() => showOpen = false} />

<div class="screen">

  {#if stage === 'setup'}
    <ProjectSetup on:create={onProjectCreated} />
  {/if}

  <div class="topbar">
    <div class="tb-logo">
      <div class="logo-main">CONDUCTOR</div>
      <div class="logo-sub">FTTP DESIGN</div>
    </div>
    <div class="tb-stats">
      {#if project}
        <div class="stat"><div class="sv neu" style="font-size:11px;">{project.name}</div><div class="sl">{project.areaId}</div></div>
      {:else}
        <div class="stat"><div class="sv neu" style="font-size:11px;">No Project</div><div class="sl">—</div></div>
      {/if}
      <div class="stat"><div class="sv neu">—</div><div class="sl">Premises</div></div>
      <div class="stat"><div class="sv ok">—</div><div class="sl">Routed</div></div>
      <div class="stat"><div class="sv wrn">—</div><div class="sl">Partial</div></div>
      <div class="stat"><div class="sv bad">—</div><div class="sl">Unserved</div></div>
      <div class="stat"><div class="sv neu">—</div><div class="sl">Fibre</div></div>
      <div class="stat"><div class="sv neu">—</div><div class="sl">Duct</div></div>
      <div class="stat" style="border-right:none;"><div class="sv neu">—</div><div class="sl">Est. Materials</div></div>
    </div>
    <div class="tb-centre">
      <div class="tb-grp-wrap">
        <div class="tb-grp-lbl">Validation</div>
        <div class="tb-grp">
          <button class="tb-btn hi" disabled={stage !== 'design'}>✓ Validate Routes</button>
          <button class="tb-btn hi" disabled={stage !== 'design'}>⚡ Design Health</button>
        </div>
      </div>
      <div class="tb-sep"></div>
      <div class="tb-grp-wrap">
        <div class="tb-grp-lbl">Outputs</div>
        <div class="tb-grp">
          <button class="tb-btn" disabled={stage !== 'design'}>Splice Plan</button>
          <button class="tb-btn" disabled={stage !== 'design'}>SLD</button>
          <button class="tb-btn" disabled={stage !== 'design'}>Bill of Materials</button>
        </div>
      </div>
    </div>
    <div class="tb-right">
      <div style="display:flex;align-items:center;gap:6px;">
        <input class="srch" placeholder="Zoom to postcode or asset..." />
        <button class="go">GO</button>
      </div>
      <div class="vtog">
        <button class="vt" class:on={is3D} on:click={() => setView(true)}>3D</button>
        <button class="vt" class:on={!is3D} on:click={() => setView(false)}>2D</button>
      </div>
      <button class="tb-new" on:click={newProject} title="New Project">+ New</button>
      <div class="tb-open-wrap">
        <button class="tb-new" on:click|stopPropagation={() => { refreshList(); showOpen = !showOpen; }} title="Open Project">Open ▾</button>
        {#if showOpen}
          <div class="tb-open-menu" on:click|stopPropagation role="menu" tabindex="-1">
            {#if projectList.length === 0}
              <div class="tb-open-empty">No saved projects</div>
            {:else}
              {#each projectList as p}
                <button class="tb-open-item" class:active={p.id === projectStore.activeId()} on:click={() => openProject(p.id)}>
                  <span class="oi-name">{p.name}</span>
                  <span class="oi-area">{p.areaId}</span>
                </button>
              {/each}
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>

  <div class="body">

    <div class="sidebar">
      {#if stage === 'import'}
        <div class="sid-lbl">Step 1</div>
        <button class="cat-pill on" on:click={() => rpMode = 'address-import'}>⬆ Import Address Data</button>
        <div class="sid-hint">Import a CSV or SHP of address data to inform your build area boundary.</div>
      {:else if stage === 'build-area'}
        <div class="sid-lbl">Step 2</div>
        <button class="cat-pill on" on:click={onDrawBuildArea}>⬡ Draw Build Area</button>
        <div class="sid-hint">Click corners on the map to define your build area polygon. Right-click to finish.</div>
      {:else if stage === 'cabinet'}
        <div class="sid-lbl">Step 3</div>
        <button class="cat-pill on" on:click={onPlaceCabinet}>■ Place Cabinet / POP</button>
        <div class="sid-hint">Place your cabinet or POP. All design tools unlock after this step.</div>
      {:else if stage === 'design'}
        <div class="sid-lbl">Build Tools</div>
        <button class="cat-pill" class:on={activeCat==='civil'}  on:click={() => activeCat='civil'}>⬡ Civil</button>
        <button class="cat-pill" class:on={activeCat==='fibre'}  on:click={() => activeCat='fibre'}>⌁ Fibre</button>
        <button class="cat-pill" class:on={activeCat==='aerial'} on:click={() => activeCat='aerial'}>⌒ Aerial &amp; Poles</button>
        <button class="cat-pill" class:on={activeCat==='pia'}    on:click={() => activeCat='pia'}>⬛ PIA Underground</button>
        <div class="sid-div"></div>
        <div class="sid-lbl">Asset Tools</div>
        <button class="asset-btn" on:click={onEditAsset}>✎ Edit Asset</button>
        <button class="asset-btn" on:click={onDeleteAsset}>✕ Delete Asset</button>
        <button class="asset-btn" on:click={onMoveAsset}>⇄ Move Asset</button>
        <button class="asset-btn" class:on={showBuildings} on:click={toggleBuildings}>⌂ Buildings</button>
        <div class="sid-basemap-dock">
          <div class="sid-div"></div>
          <div class="sid-lbl">Basemap</div>
          <div class="basemap-wrap">
            {#each BASEMAPS as bm}
              <button
                class="basemap-btn"
                class:on={currentBasemap === bm.id}
                disabled={basemapSwitching}
                on:click={() => changeBasemap(bm.id)}
              >{bm.label}</button>
            {/each}
          </div>
        </div>
      {/if}
    </div>

    <div class="map-wrap">
      <div id="map"></div>

      {#if stage === 'design'}
        <RadialWheel {activeCat} on:tool-selected={onToolSelected} />
      {/if}

      {#if basemapSwitching}
        <div class="basemap-loading">
          <div class="bl-dot"></div>
          <span>Switching basemap…</span>
        </div>
      {/if}

      {#if activeToolLabel}
        <div class="active-chip">
          <div class="chip-dot"></div>
          <span>{activeToolLabel}</span>
          <button class="chip-cancel" on:click={() => {
            clearTool(map);
            activeToolLabel = '';
            rpMode = 'default';
            pendingBuildArea = null;
            pendingCabinet = null;
            fibreTraceResult = null;
            clearTraceHighlight(map);
            if (map.getSource('ba-rubber-src')) map.getSource('ba-rubber-src').setData({ type: 'FeatureCollection', features: [] });
          }}>✕</button>
        </div>
      {/if}

      <div class="routes-drawer" style="height:{drawerOpen ? '220px' : '36px'};">
        <div class="routes-handle" on:click={() => drawerOpen = !drawerOpen}>
          <span class="handle-title">Routes</span>
          <span class="handle-count">{ROUTES.length}</span>
          <select class="handle-filter" on:click|stopPropagation>
            <option>All Routes</option><option>Routed</option><option>Partial</option><option>Unserved</option>
          </select>
          <input class="handle-search" placeholder="Search routes..." on:click|stopPropagation />
          <button class="handle-csv" on:click|stopPropagation>↓ CSV</button>
          <button class="handle-toggle">{drawerOpen ? '▼' : '▲'}</button>
        </div>
        {#if drawerOpen}
        <div class="routes-table-wrap">
          <table class="routes-table">
            <thead><tr>
              <th>Route ID</th><th>Status</th><th>From</th><th>To</th>
              <th>Length</th><th>Assets</th><th>Fibres</th><th>Capacity</th>
              <th>Updated</th><th>Engineer</th>
            </tr></thead>
            <tbody>
              {#each ROUTES as r}
                <tr class:sel={selectedRoute === r.id} on:click={() => selectedRoute = r.id}>
                  <td style="color:#4dc8ff;font-weight:600;">{r.id}</td>
                  <td><span class="status-pill {statusClass(r.status)}">{r.status}</span></td>
                  <td>{r.from}</td><td>{r.to}</td>
                  <td>{r.len}</td><td>{r.assets}</td><td>{r.fibres}</td>
                  <td style={capStyle(r.cap)}>{r.cap}</td>
                  <td>{r.updated}</td><td>{r.eng}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        {/if}
      </div>
    </div>

    <div class="rpanel">

      {#if rpMode === 'address-import'}
        <AddressImporter on:imported={onAddressImported} on:skip={onAddressSkipped} />

      {:else if rpMode === 'build-area-form'}
        <BuildAreaForm areaId={project?.areaId || ''} on:save={onBuildAreaSaved} on:cancel={onBuildAreaCancelled} />

      {:else if rpMode === 'cabinet-form'}
        <CabinetForm pending={pendingCabinet} on:save={onCabinetSaved} on:cancel={onCabinetCancelled} />

      {:else if rpMode === 'chamber-form'}
        <ChamberForm pending={pendingChamber} on:save={onChamberSaved} on:cancel={onChamberCancelled} />

      {:else if rpMode === 'duct-form'}
        <DuctForm pending={pendingDuct} on:save={onDuctSaved} on:cancel={onDuctCancelled} />

      {:else if rpMode === 'joint-form'}
        <JointForm pending={pendingJoint} on:save={onJointSaved} on:cancel={onJointCancelled} />

      {:else if rpMode === 'cable-form'}
        <CableForm pending={pendingCable} on:save={onCableSaved} on:cancel={onCableCancelled} />

      {:else if rpMode === 'pole-form'}
        <PlacePoleForm pending={pendingPole} on:save={onPoleSaved} on:cancel={onPoleCancelled} />

      {:else if rpMode === 'cbt-form'}
        <CBTForm pending={pendingCBT} on:save={onCBTSaved} on:cancel={onCBTCancelled} />

      {:else if rpMode === 'cbt-tail-form'}
        <CBTTailForm pending={pendingCBTTail} on:save={onCBTTailSaved} on:cancel={onCBTTailCancelled} />

      {:else if rpMode === 'edit-cabinet-form'}
        <EditCabinetForm
          existing={projectStore.cabinet?.properties}
          on:save={onEditCabinetSaved}
          on:cancel={onEditCabinetCancelled}
        />

      {:else if rpMode === 'road-crossing-form'}
        <RoadCrossingForm pending={pendingRoadCrossing} on:save={onRoadCrossingSaved} on:cancel={onRoadCrossingCancelled} />

      {:else if rpMode === 'stream-crossing-form'}
        <StreamCrossingForm pending={pendingStreamCrossing} on:save={onStreamCrossingSaved} on:cancel={onStreamCrossingCancelled} />

      {:else if rpMode === 'pia-chamber-form'}
        <PIAChamberForm pending={pendingPIAChamber} on:save={onPIAChamberSaved} on:cancel={onPIAChamberCancelled} />

      {:else if rpMode === 'pia-duct-form'}
        <PIADuctForm pending={pendingPIADuct} on:save={onPIADuctSaved} on:cancel={onPIADuctCancelled} />

      {:else if rpMode === 'asset-selected'}
        <AssetEditPanel
          selected={selectedAsset}
          on:saved={onAssetPanelSaved}
          on:deleted={onAssetPanelDeleted}
          on:move={onAssetPanelMove}
          on:close={onAssetPanelClose}
        />

      {:else if rpMode === 'fibre-trace'}
        <FibreTracePanel result={fibreTraceResult} on:close={onFibreTraceClose} />

      {:else if rpMode === 'fibre-assign'}
        <div class="fa-panel">
          <div class="fa-hdr">
            <span class="fa-title">Auto-Assign Fibres</span>
            <button class="fa-close" on:click={onFibreAssignClose} title="Dismiss">✕</button>
          </div>
          {#if fibreAssignResult}
            <div class="fa-stats">
              <div class="fa-stat"><div class="fa-sv ok">{fibreAssignResult.stats.assigned}</div><div class="fa-sl">Assigned</div></div>
              <div class="fa-stat"><div class="fa-sv">{fibreAssignResult.stats.splitters}</div><div class="fa-sl">Splitters</div></div>
              <div class="fa-stat"><div class="fa-sv">{fibreAssignResult.stats.spare}</div><div class="fa-sl">Spare</div></div>
              <div class="fa-stat"><div class="fa-sv {fibreAssignResult.stats.overcap ? 'bad' : ''}">{fibreAssignResult.stats.overcap}</div><div class="fa-sl">Over-cap</div></div>
            </div>
            <div class="fa-sub">
              {fibreAssignResult.stats.feeders} feeder (1:4) · {fibreAssignResult.stats.terminals} terminal splitter{fibreAssignResult.stats.terminals === 1 ? '' : 's'}
            </div>

            {#if fibreAssignResult.flags.length}
              <div class="fa-flags">
                <div class="fa-flags-lbl">⚠ {fibreAssignResult.flags.length} warning{fibreAssignResult.flags.length === 1 ? '' : 's'}</div>
                {#each fibreAssignResult.flags as fl}
                  <div class="fa-flag">{fl}</div>
                {/each}
              </div>
            {/if}

            <div class="fa-log-lbl">Log</div>
            <div class="fa-log">
              {#each fibreAssignResult.log as line}
                <div class="fa-log-line">{line}</div>
              {/each}
            </div>

            <div class="fa-note">Click a CBT with “Edit Asset” to see its splitter port grid.</div>
          {/if}
          <div class="fa-actions">
            <button class="fa-done" on:click={onFibreAssignClose}>Done</button>
          </div>
        </div>

      {:else}
        <div class="rp-hdr">
          <span class="rp-hdr-title">Validation Summary</span>
          <span class="rp-timestamp">—</span>
          <button class="rp-refresh">↻</button>
          <button class="health-btn" disabled={stage !== 'design'}>✓ Health</button>
        </div>
        <div class="val-body">
          <div class="val-counts">
            <div class="vc"><div class="vc-val bad">0</div><div class="vc-lbl">Critical</div></div>
            <div class="vc"><div class="vc-val bad">0</div><div class="vc-lbl">Errors</div></div>
            <div class="vc"><div class="vc-val wrn">0</div><div class="vc-lbl">Warnings</div></div>
            <div class="vc"><div class="vc-val neu">—</div><div class="vc-lbl">Total</div></div>
          </div>
          <div class="int-row"><span class="int-k">Network Integrity</span><span class="int-v">—</span></div>
          <div class="int-bar"><div class="int-fill"></div></div>
          <div class="checks-note">
            {#if stage === 'setup' || stage === 'import'}
              Create a project and import address data to begin.
            {:else if stage === 'build-area'}
              Draw your build area boundary to continue.
            {:else if stage === 'cabinet'}
              Place a cabinet to unlock all design tools.
            {:else}
              Run validation to see results.
            {/if}
          </div>
        </div>

        <div class="outputs-section">
          <div class="outputs-lbl">Engineer Outputs</div>
          <button class="out-btn" disabled={stage !== 'design'}>↗ Splice Plan Export</button>
          <button class="out-btn" disabled={stage !== 'design'}>↗ Single Line Diagram</button>
          <button class="out-btn" disabled={stage !== 'design'}>↗ Bill of Materials</button>
          <button class="out-btn" disabled={stage !== 'design'}>↗ Cabinet Cost Calculator</button>
        </div>

        <div class="rp-splitter"></div>

        <div class="asset-section">
          <div class="asset-hdr">
            <div class="asset-hdr-lbl">Selected Asset</div>
            <div class="asset-type">—</div>
            <div class="asset-id">—</div>
          </div>
          <div class="asset-body">
            {#each ASSET_ROWS as [k, v, cls]}
              <div class="arow"><span class="ak">{k}</span><span class="av {cls}">{v}</span></div>
            {/each}
          </div>
          <div class="asset-actions">
            <button class="act-btn" disabled={stage !== 'design'}>✎ Edit</button>
            <button class="act-btn" disabled={stage !== 'design'}>⇄ Move</button>
            <button class="act-btn" disabled={stage !== 'design'}>✕ Delete</button>
            <button class="act-btn" disabled={stage !== 'design'}>◎ Trace</button>
          </div>

          <div class="ri-section">
            <div class="ri-hdr">
              <span class="ri-lbl">Route Info</span>
              <span class="ri-id">{selectedRoute || '—'}</span>
              {#if selectedRoute}
                <span class="ri-badge">{ROUTES.find(r => r.id === selectedRoute)?.status || ''}</span>
              {/if}
            </div>
            {#if selectedRoute}
              {@const r = ROUTES.find(rt => rt.id === selectedRoute)}
              {#if r}
                <div class="ri-from">{r.from} → {r.to}</div>
                <div class="ri-stats">
                  <div class="ri-stat"><div class="ri-sv {r.cap === '100%' ? 'ok' : ''}">{r.cap}</div><div class="ri-sl">Capacity</div></div>
                  <div class="ri-stat"><div class="ri-sv">{r.len}</div><div class="ri-sl">Length</div></div>
                  <div class="ri-stat"><div class="ri-sv">{r.fibres}</div><div class="ri-sl">Fibres</div></div>
                  <div class="ri-stat"><div class="ri-sv">{r.assets}</div><div class="ri-sl">Assets</div></div>
                </div>
              {/if}
            {/if}
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

{#if assetPickerHits}
  <AssetPickerDialog
    hits={assetPickerHits}
    on:choose={onAssetPickerChoose}
    on:cancel={onAssetPickerCancel}
  />
{/if}

<style>
  :global(*) { box-sizing: border-box; margin: 0; padding: 0; }
  :global(body) { background: #080e14; color: #a0c4d8; font-family: 'Courier New', monospace; overflow: hidden; }

  .screen { display: flex; flex-direction: column; height: 100vh; width: 100vw; overflow: hidden; }

  /* ── Topbar ── */
  .topbar { height: 44px; background: #0d1520; border-bottom: 1px solid #1a2d40; display: flex; align-items: center; padding: 0 12px; gap: 12px; flex-shrink: 0; z-index: 30; }
  .tb-logo { display: flex; flex-direction: column; gap: 1px; }
  .logo-main { font-size: 12px; font-weight: 700; letter-spacing: 0.18em; color: #4dc8ff; text-shadow: 0 0 8px #00aaff66; }
  .logo-sub { font-size: 7px; color: #3a5a70; letter-spacing: 0.14em; }
  .tb-stats { display: flex; gap: 0; border-left: 1px solid #1a2d40; padding-left: 12px; }
  .stat { display: flex; flex-direction: column; align-items: center; padding: 0 10px; border-right: 1px solid #1a2d40; }
  .sv { font-size: 14px; font-weight: 700; line-height: 1; }
  .sv.ok { color: #4dc8ff; }
  .sv.bad { color: #ff5555; }
  .sv.wrn { color: #ffaa44; }
  .sv.neu { color: #7ab8d4; }
  .sl { font-size: 7px; color: #3a5a70; letter-spacing: 0.08em; text-transform: uppercase; margin-top: 2px; }
  .tb-centre { display: flex; align-items: center; gap: 8px; flex: 1; justify-content: center; }
  .tb-grp-wrap { display: flex; flex-direction: column; align-items: center; gap: 2px; }
  .tb-grp-lbl { font-size: 7px; color: #3a5a70; letter-spacing: 0.12em; text-transform: uppercase; }
  .tb-grp { display: flex; gap: 4px; }
  .tb-btn { background: #0a1018; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 8.5px; letter-spacing: 0.06em; text-transform: uppercase; padding: 4px 10px; border-radius: 4px; cursor: pointer; white-space: nowrap; transition: all 0.12s; }
  .tb-btn:hover:not(:disabled) { border-color: #00aaff33; color: #4dc8ff; }
  .tb-btn:disabled { opacity: 0.35; cursor: not-allowed; }
  .tb-btn.hi { border-color: #00aaff22; color: #4dc8ff99; }
  .tb-sep { width: 1px; height: 28px; background: #1a2d40; }
  .tb-right { display: flex; align-items: center; gap: 8px; }
  .srch { background: #080e14; border: 1px solid #1a2d40; color: #7ab8d4; font-family: 'Courier New', monospace; font-size: 9px; padding: 4px 10px; border-radius: 4px; width: 200px; outline: none; }
  .srch::placeholder { color: #2a4050; }
  .go { background: #0a1018; border: 1px solid #1a2d40; color: #4dc8ff; font-family: 'Courier New', monospace; font-size: 9px; padding: 4px 10px; border-radius: 4px; cursor: pointer; }
  .vtog { display: flex; border: 1px solid #1a2d40; border-radius: 4px; overflow: hidden; }
  .vt { background: #0a1018; border: none; color: #3a5a70; font-family: 'Courier New', monospace; font-size: 9px; padding: 4px 10px; cursor: pointer; }
  .vt.on { background: #00aaff14; color: #4dc8ff; }
  .tb-new { background: #0a1018; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.06em; padding: 4px 10px; border-radius: 4px; cursor: pointer; white-space: nowrap; }
  .tb-new:hover { border-color: #00aaff33; color: #4dc8ff; }
  .tb-open-wrap { position: relative; }
  .tb-open-menu { position: absolute; top: calc(100% + 4px); right: 0; background: #0d1520; border: 1px solid #1a2d40; border-radius: 5px; min-width: 200px; z-index: 100; box-shadow: 0 8px 24px #00000088; }
  .tb-open-empty { font-size: 9px; color: #3a5a70; padding: 10px 12px; }
  .tb-open-item { display: flex; align-items: center; justify-content: space-between; width: 100%; background: transparent; border: none; border-bottom: 1px solid #1a2d4033; padding: 8px 12px; cursor: pointer; gap: 12px; }
  .tb-open-item:last-child { border-bottom: none; }
  .tb-open-item:hover { background: #0f1c28; }
  .tb-open-item.active .oi-name { color: #4dc8ff; }
  .tb-open-item.active::before { content: '●'; color: #4dc8ff; font-size: 6px; margin-right: 6px; }
  .oi-name { font-size: 9px; color: #a0c4d8; font-family: 'Courier New', monospace; letter-spacing: 0.04em; }
  .oi-area { font-size: 8px; color: #3a5a70; font-family: 'Courier New', monospace; }

  /* ── Body ── */
  .body { display: flex; flex: 1; overflow: hidden; }

  /* ── Sidebar ── */
  .sidebar { width: 140px; background: #0d1520; border-right: 1px solid #1a2d40; display: flex; flex-direction: column; justify-content: center; flex-shrink: 0; z-index: 10; position: relative; }
  .sid-lbl { font-size: 7.5px; color: #3a5a70; letter-spacing: 0.12em; text-transform: uppercase; padding: 6px 12px 3px; }
  .sid-div { height: 1px; background: #1a2d40; margin: 8px 12px; }
  .sid-hint { font-size: 8px; color: #2a4050; letter-spacing: 0.08em; text-transform: uppercase; padding: 4px 12px; line-height: 1.6; }
  .cat-pill { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-left: 2px solid transparent; color: #6a8fa8; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; transition: all 0.15s; background: transparent; border-top: none; border-right: none; border-bottom: none; width: 100%; text-align: left; font-family: 'Courier New', monospace; }
  .cat-pill:hover { background: #0f1c28; color: #a0c4d8; border-left-color: #2a4a5e; }
  .cat-pill.on { background: #00aaff0a; border-left-color: #4dc8ff; color: #4dc8ff; }
  .asset-btn { display: flex; align-items: center; gap: 8px; padding: 9px 12px; border-left: 2px solid transparent; color: #6a8fa8; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; transition: all 0.15s; background: transparent; border-top: none; border-right: none; border-bottom: none; width: 100%; text-align: left; font-family: 'Courier New', monospace; }
  .asset-btn:hover { background: #0f1c28; color: #a0c4d8; border-left-color: #2a4a5e; }
  .asset-btn.on { background: #00aaff0a; border-left-color: #4dc8ff; color: #4dc8ff; }

  /* ── Basemap switcher ── */
  .sid-basemap-dock { position: absolute; left: 0; right: 0; bottom: 8px; background: #0d1520; }
  .basemap-wrap { display: flex; flex-direction: column; gap: 2px; padding: 2px 10px 6px; }
  .basemap-btn {
    display: block; width: 100%;
    background: #080e14;
    border: 1px solid #1a2d40;
    color: #5a7a90;
    font-family: 'Courier New', monospace;
    font-size: 9px;
    letter-spacing: 0.05em;
    padding: 6px 8px;
    border-radius: 4px;
    cursor: pointer;
    text-align: left;
    transition: all 0.12s;
  }
  .basemap-btn:hover:not(:disabled) { background: #0f1c28; color: #a0c4d8; border-color: #2a4a5e; }
  .basemap-btn.on { background: #00aaff0d; border-color: #00aaff44; color: #4dc8ff; }
  .basemap-btn:disabled { opacity: 0.45; cursor: not-allowed; }

  /* ── Basemap switching overlay ── */
  .basemap-loading {
    position: absolute;
    bottom: 60px;
    left: 50%;
    transform: translateX(-50%);
    background: #0d1520ee;
    border: 1px solid #1a2d40;
    border-radius: 20px;
    padding: 7px 16px 7px 12px;
    font-size: 10px;
    letter-spacing: 0.08em;
    color: #6a8fa8;
    display: flex;
    align-items: center;
    gap: 8px;
    white-space: nowrap;
    z-index: 5;
  }
  .bl-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: #4dc8ff;
    animation: pulse 1s ease-in-out infinite;
  }

  /* ── Map ── */
  .map-wrap { flex: 1; position: relative; overflow: hidden; }
  #map { width: 100%; height: 100%; }
  .active-chip { position: absolute; bottom: 60px; left: 50%; transform: translateX(-50%); background: #0d1520ee; border: 1px solid #00aaff44; border-radius: 20px; padding: 7px 18px 7px 12px; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: #4dc8ff; display: flex; align-items: center; gap: 8px; white-space: nowrap; z-index: 5; }
  .chip-dot { width: 6px; height: 6px; border-radius: 50%; background: #4dc8ff; box-shadow: 0 0 6px #00aaff; animation: pulse 1.5s ease-in-out infinite; }
  .chip-cancel { background: transparent; border: none; color: #3a5a70; font-size: 11px; cursor: pointer; padding: 0 0 0 8px; line-height: 1; }
  .chip-cancel:hover { color: #ff5555; }
  @keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: .3 } }

  .routes-drawer { position: absolute; bottom: 0; left: 0; right: 0; z-index: 20; display: flex; flex-direction: column; transition: height 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
  .routes-handle { height: 36px; background: #0d1520; border-top: 1px solid #1a2d40; display: flex; align-items: center; padding: 0 16px; gap: 12px; cursor: pointer; flex-shrink: 0; user-select: none; }
  .routes-handle:hover { background: #111c28; }
  .handle-title { font-size: 9px; color: #6a8fa8; letter-spacing: 0.12em; text-transform: uppercase; }
  .handle-count { background: #1a2d40; border-radius: 10px; padding: 2px 8px; font-size: 8px; color: #7ab8d4; letter-spacing: 0.06em; }
  .handle-search { background: #080e14; border: 1px solid #1a2d40; color: #7ab8d4; font-family: 'Courier New', monospace; font-size: 9px; padding: 4px 10px; border-radius: 4px; width: 160px; outline: none; margin-left: auto; }
  .handle-search::placeholder { color: #2a4050; }
  .handle-filter { background: #080e14; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 9px; padding: 4px 8px; border-radius: 4px; outline: none; margin-left: 6px; }
  .handle-csv { background: transparent; border: 1px solid #1a2d40; color: #3a5a70; font-family: 'Courier New', monospace; font-size: 8px; letter-spacing: 0.06em; text-transform: uppercase; padding: 3px 8px; border-radius: 4px; cursor: pointer; margin-left: 6px; }
  .handle-csv:hover { border-color: #00aaff44; color: #4dc8ff; }
  .handle-toggle { background: transparent; border: none; color: #3a5a70; font-size: 12px; cursor: pointer; padding: 0 0 0 8px; line-height: 1; }
  .handle-toggle:hover { color: #4dc8ff; }
  .routes-table-wrap { background: #0d1520; border-top: 1px solid #1a2d4044; overflow: auto; flex: 1; }
  .routes-table { width: 100%; border-collapse: collapse; }
  .routes-table th { background: #0a1018; color: #3a5a70; font-size: 8px; letter-spacing: 0.1em; text-transform: uppercase; padding: 7px 12px; text-align: left; border-bottom: 1px solid #1a2d40; border-right: 1px solid #1a2d4033; font-weight: 600; white-space: nowrap; position: sticky; top: 0; }
  .routes-table td { font-size: 9px; color: #7ab8d4; padding: 6px 12px; border-bottom: 1px solid #0f1a24; border-right: 1px solid #0f1a2466; white-space: nowrap; }
  .routes-table tr { cursor: pointer; }
  .routes-table tr:hover td { background: #0f1c2a; color: #a0c4d8; }
  .routes-table tr.sel td { background: #0d2038; }
  .status-pill { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 8px; font-weight: 700; letter-spacing: 0.06em; }
  .status-pill.routed { background: #00aaff14; color: #4dc8ff; border: 1px solid #00aaff33; }
  .status-pill.partial { background: #ffaa4414; color: #ffaa44; border: 1px solid #ffaa4433; }
  .status-pill.unserved { background: #ff555514; color: #ff5555; border: 1px solid #ff555533; }

  /* ── Right panel ── */
  .rpanel { width: 300px; background: #0d1520; border-left: 1px solid #1a2d40; display: flex; flex-direction: column; flex-shrink: 0; overflow: hidden; z-index: 10; }
  .rp-hdr { height: 44px; background: #0d1520; border-bottom: 1px solid #1a2d40; display: flex; align-items: center; padding: 0 14px; gap: 8px; flex-shrink: 0; }
  .rp-hdr-title { font-size: 9px; color: #a0c4d8; letter-spacing: 0.14em; text-transform: uppercase; flex: 1; font-weight: 600; }
  .rp-timestamp { font-size: 8px; color: #3a5a70; }
  .rp-refresh { background: #0f1c28; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 11px; width: 24px; height: 24px; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
  .rp-refresh:hover { border-color: #00aaff44; color: #4dc8ff; }
  .health-btn { background: #00aaff14; border: 1px solid #00aaff44; color: #4dc8ff; font-family: 'Courier New', monospace; font-size: 8px; letter-spacing: 0.08em; text-transform: uppercase; padding: 4px 10px; border-radius: 4px; cursor: pointer; white-space: nowrap; }
  .health-btn:hover { background: #00aaff22; }

  .val-body { padding: 12px 14px; border-bottom: 1px solid #1a2d40; }
  .val-counts { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 10px; }
  .vc { background: #080e14; border-radius: 5px; padding: 8px 10px; }
  .vc-val { font-size: 20px; font-weight: 700; line-height: 1; }
  .vc-val.ok { color: #4dc8ff; }
  .vc-val.bad { color: #ff5555; }
  .vc-val.wrn { color: #ffaa44; }
  .vc-val.neu { color: #7ab8d4; }
  .vc-lbl { font-size: 7.5px; color: #3a5a70; letter-spacing: 0.08em; text-transform: uppercase; margin-top: 2px; }
  .int-row { display: flex; justify-content: space-between; margin-bottom: 4px; }
  .int-k { font-size: 8px; color: #6a8fa8; text-transform: uppercase; letter-spacing: 0.06em; }
  .int-v { font-size: 8px; color: #7ab8d4; }
  .int-bar { height: 2px; background: #080e14; border-radius: 2px; margin-bottom: 8px; }
  .int-fill { height: 2px; background: #4dc8ff; border-radius: 2px; width: 3%; }
  .checks-note { font-size: 7.5px; color: #3a5a70; letter-spacing: 0.05em; }

  .health-banner { margin: 10px 14px; padding: 8px 10px; border-radius: 5px; font-size: 8.5px; letter-spacing: 0.04em; line-height: 1.5; }
  .health-banner.caution { background: #ffaa4414; border: 1px solid #ffaa4433; color: #ffaa44; }

  .outputs-section { padding: 10px 14px; border-bottom: 1px solid #1a2d40; }
  .outputs-lbl { font-size: 7.5px; color: #3a5a70; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 7px; }
  .out-btn { display: block; width: 100%; background: #0a1018; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; padding: 7px 10px; text-align: left; cursor: pointer; margin-bottom: 4px; border-radius: 4px; transition: all 0.12s; }
  .out-btn:hover { border-color: #00aaff33; color: #4dc8ff; background: #0d1a28; }

  .rp-splitter { height: 3px; background: #1a2d40; cursor: row-resize; flex-shrink: 0; position: relative; }
  .rp-splitter::after { content: ''; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 24px; height: 1px; background: #2a4a5e; border-radius: 1px; }
  .rp-splitter:hover { background: #2a4a5e; }

  .asset-section { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }
  .asset-hdr { padding: 12px 14px 8px; border-bottom: 1px solid #1a2d40; flex-shrink: 0; }
  .asset-hdr-lbl { font-size: 7.5px; color: #3a5a70; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 4px; }
  .asset-type { font-size: 8px; color: #3a5a70; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 3px; }
  .asset-id { font-size: 14px; font-weight: 700; letter-spacing: 0.08em; color: #4dc8ff; text-shadow: 0 0 8px #00aaff44; }
  .asset-body { padding: 0 14px; flex: 1; }
  .arow { display: flex; justify-content: space-between; align-items: center; padding: 5px 0; border-bottom: 1px solid #080e14; }
  .ak { font-size: 8.5px; color: #6a8fa8; text-transform: uppercase; letter-spacing: 0.05em; }
  .av { font-size: 8.5px; color: #a0c4d8; text-align: right; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .av.ok { color: #4dc8ff; }
  .av.hi { color: #ffaa44; }
  .asset-actions { padding: 10px 14px; display: flex; gap: 5px; border-top: 1px solid #1a2d40; flex-shrink: 0; }
  .act-btn { flex: 1; background: #0a1018; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 8px; letter-spacing: 0.06em; text-transform: uppercase; padding: 6px 4px; border-radius: 4px; cursor: pointer; text-align: center; transition: all 0.12s; }
  .act-btn:hover { border-color: #00aaff33; color: #4dc8ff; }

  .ri-section { border-top: 1px solid #1a2d40; padding: 12px 14px; flex-shrink: 0; }
  .ri-hdr { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .ri-lbl { font-size: 7.5px; color: #3a5a70; letter-spacing: 0.12em; text-transform: uppercase; }
  .ri-id { font-size: 11px; color: #4dc8ff; font-weight: 700; letter-spacing: 0.06em; }
  .ri-badge { font-size: 7px; background: #00aaff14; border: 1px solid #00aaff33; color: #4dc8ff; padding: 2px 7px; border-radius: 10px; }
  .ri-from { font-size: 7.5px; color: #3a5a70; margin-bottom: 8px; letter-spacing: 0.04em; }
  .ri-stats { display: flex; gap: 0; border: 1px solid #1a2d40; border-radius: 5px; overflow: hidden; }
  .ri-stat { flex: 1; padding: 8px 10px; text-align: center; border-right: 1px solid #1a2d40; }
  .ri-stat:last-child { border-right: none; }
  .ri-sv { font-size: 14px; font-weight: 700; color: #7ab8d4; line-height: 1; }
  .ri-sv.ok { color: #4dc8ff; text-shadow: 0 0 6px #00aaff33; }
  .ri-sl { font-size: 7px; color: #3a5a70; letter-spacing: 0.08em; text-transform: uppercase; margin-top: 3px; }

  /* ── Fibre-assign result panel ── */
  .fa-panel { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
  .fa-hdr { height: 44px; background: #0d1520; border-bottom: 1px solid #1a2d40; display: flex; align-items: center; padding: 0 14px; gap: 8px; flex-shrink: 0; }
  .fa-title { font-size: 9px; color: #a0c4d8; letter-spacing: 0.14em; text-transform: uppercase; flex: 1; font-weight: 600; }
  .fa-close { background: #0f1c28; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 11px; width: 24px; height: 24px; border-radius: 4px; cursor: pointer; }
  .fa-close:hover { border-color: #ff555544; color: #ff5555; }
  .fa-stats { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 5px; padding: 12px 14px 6px; }
  .fa-stat { background: #080e14; border-radius: 5px; padding: 8px 4px; text-align: center; }
  .fa-sv { font-size: 17px; font-weight: 700; line-height: 1; color: #7ab8d4; }
  .fa-sv.ok { color: #4dc8ff; }
  .fa-sv.bad { color: #ff5555; }
  .fa-sl { font-size: 6.5px; color: #3a5a70; letter-spacing: 0.06em; text-transform: uppercase; margin-top: 3px; }
  .fa-sub { font-size: 8px; color: #6a8fa8; letter-spacing: 0.04em; padding: 2px 14px 8px; }
  .fa-flags { margin: 0 14px 8px; padding: 8px 10px; background: #ffaa440a; border: 1px solid #ffaa4433; border-radius: 5px; }
  .fa-flags-lbl { font-size: 8px; color: #ffaa44; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 5px; }
  .fa-flag { font-size: 8px; color: #c79552; line-height: 1.5; padding: 1px 0; }
  .fa-log-lbl { font-size: 7.5px; color: #3a5a70; letter-spacing: 0.12em; text-transform: uppercase; padding: 4px 14px 4px; }
  .fa-log { flex: 1; overflow-y: auto; padding: 0 14px; }
  .fa-log-line { font-size: 8px; color: #6a8fa8; line-height: 1.6; padding: 1px 0; border-bottom: 1px solid #0c141c; }
  .fa-note { font-size: 8px; color: #3a5a70; letter-spacing: 0.03em; padding: 8px 14px; line-height: 1.6; }
  .fa-actions { padding: 10px 14px; border-top: 1px solid #1a2d40; flex-shrink: 0; }
  .fa-done { width: 100%; background: #00aaff14; border: 1px solid #00aaff44; color: #4dc8ff; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; padding: 8px; border-radius: 4px; cursor: pointer; }
  .fa-done:hover { background: #00aaff22; }
</style>
