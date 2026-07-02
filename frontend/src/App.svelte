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
  import PIADropForm from './PIADropForm.svelte';
  import ProjectSetup from './ProjectSetup.svelte';
  import AddressImporter from './AddressImporter.svelte';
  import BuildAreaForm from './BuildAreaForm.svelte';
  import { showToast, showError } from './toast.js';
  import { projectStore } from './projectStore.js';
  import {
    isSupported     as fsaaSupported,
    onStatus        as fsaaOnStatus,
    saveAs          as fsaaSaveAs,
    openFile        as fsaaOpenFile,
    saveNow         as fsaaSaveNow,
    tryResume       as fsaaTryResume,
    resumePrompt    as fsaaResumePrompt,
    resumeProjectFile as fsaaResumeProjectFile,
  } from './fsaa.js';
  import { exportSheet } from './mapExport.js';
  import { assignFibres } from './fibreAssign.js';
  import { docsUrl, toolTip } from './toolDocs.js';
  import { countFibres } from './fibreCount.js';
  import { downloadSplicePlan, generateSplicePlan, downloadAllSplicePlans, generateRouteSplicePlan } from './splicePlan.js';
  import AssetEditPanel from './AssetEditPanel.svelte';
  import AssetPickerDialog from './AssetPickerDialog.svelte';
  import FibreTracePanel from './FibreTracePanel.svelte';
  import FibreCountPanel from './FibreCountPanel.svelte';
  import SplicePlanPanel from './SplicePlanPanel.svelte';
  import BomPanel from './BomPanel.svelte';
  import { buildBom } from './bom.js';
  import SldPanel from './SldPanel.svelte';
  import ValidateRoutesPanel from './ValidateRoutesPanel.svelte';
  import DesignHealthPanel from './DesignHealthPanel.svelte';
  import CabinetCostPanel from './CabinetCostPanel.svelte';
  import {
    ensureSources, ensureTerrainLayers, syncToMap,
    activateCabinetTool, activateBuildAreaTool, activateChamberTool,
    activateDuctTool, activateJointTool, activateDropDuctTool,
    activateCableTool, activateBundleTool, activatePoleTool,
    activateCBTTool, activateAerialSpanTool, activateAerialDropTool,
    activateCBTTailTool,
    activateSelectTool, activateMovePointTool,
    activateFibreTraceTool, clearTraceHighlight,
    activateFibreCountTool, clearCountHighlight,
    applyCookieCutter, clearTool, getPoleLayer, setSearchMarker
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
  let storeVersion = 0;   // bumped on every store mutation to drive reactive stats
  projectStore.on((event) => {
    stage = projectStore.stage;
    project = projectStore.project;
    storeVersion++;
    if (statsRouteRun) statsStale = true;
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
  let pendingPIADrop         = null;
  let selectedAsset    = null;
  let assetPickerHits  = null;
  let fibreTraceResult = null;
  let fibreCountResult = null;

  // ── Stats bar ────────────────────────────────────────────────────────────
  // Cheap stats (premises, fibre, duct, materials) recompute whenever
  // projectStore.state changes (Svelte reactive statement).
  // Route stats (routed, partial, unserved) are populated by ValidateRoutesPanel
  // on each run, and marked stale on next store mutation (see store .on() above).
  let routeStats = { routed: null, partial: null, unserved: null };
  let statsRouteRun = false;
  let statsStale = false;
  let bomErrorToastShown = false;  // only toast once per session, see computeCheapStats

  // cheapStats recompute whenever the store mutates (storeVersion bumps in .on()).
  $: cheapStats = (storeVersion, computeCheapStats(projectStore.state));

  function computeCheapStats(s) {
    if (!s) return { premises: 0, fibre_km: 0, duct_km: 0, materials_cost: 0 };
    const premises = (s.addressPoints || []).length;
    let fibreM = 0;
    for (const c of [...(s.cables||[]), ...(s.spans||[]), ...(s.bundles||[]),
                     ...(s.aerialDrops||[]), ...(s.cbtTails||[])]) {
      fibreM += parseFloat(c.properties?.length_m || 0) || 0;
    }
    let ductM = 0;
    for (const d of [...(s.ducts||[]), ...(s.dropDucts||[])]) {
      ductM += parseFloat(d.properties?.length_m || 0) || 0;
    }
    let materials_cost = 0;
    try {
      const { grandTotal } = buildBom(s);
      materials_cost = grandTotal;
    } catch (e) {
      // This recomputes on every store mutation, so a toast on every edit would
      // be spammy if the BoM keeps failing — log every time for diagnosability,
      // but only surface it to the user once per session.
      console.error('[App] BoM calculation failed — Est. Materials will read as "—":', e);
      if (!bomErrorToastShown) { bomErrorToastShown = true; showError('Materials cost could not be calculated — check the console for details. Other figures are unaffected.'); }
    }
    const fibre_km = Math.round(fibreM / 100) / 10;
    const duct_km  = Math.round(ductM / 100) / 10;
    return { premises, fibre_km, duct_km, materials_cost };
  }

  function onValidateSummary(e) {
    const { routed, partial, unserved } = e.detail;
    routeStats = { routed, partial, unserved };
    statsRouteRun = true;
    statsStale = false;
  }

  function onValidateResults(e) {
  validateResults = e.detail || [];
  selectedRoute = null;

  // Build the set of ROUTED UPRNs.
  const routedUprns = new Set(
    validateResults
      .filter(r => r.status === 'ROUTED')
      .map(r => String(r.uprn))
  );

  // Seed live nodes from CBTs that have at least one ROUTED aerial drop.
  const liveNodeIds = new Set();
  for (const drop of (projectStore.state.aerialDrops || [])) {
    if (routedUprns.has(String(drop.properties.uprn || ''))) {
      if (drop.properties.from_cbt) liveNodeIds.add(drop.properties.from_cbt);
    }
  }

  // Flood fill across spans: propagate liveness through pole-to-pole connections.
  // Stops when no new nodes are added in a full pass.
  const spans = projectStore.state.spans || [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const span of spans) {
      const f = span.properties.from_node;
      const t = span.properties.to_node;
      if (liveNodeIds.has(f) && !liveNodeIds.has(t)) { liveNodeIds.add(t); changed = true; }
      if (liveNodeIds.has(t) && !liveNodeIds.has(f)) { liveNodeIds.add(f); changed = true; }
    }
  }

  getPoleLayer()?.setLiveState(routedUprns, liveNodeIds);
}

  let activeToolLabel = '';
  let activeToolId    = '';   // tracks toolId of the active tool for the ⓘ help link
  let activeCat = 'civil';

  // validateResults: populated by ValidateRoutesPanel on:results event.
  // Used by the routes drawer at the bottom of the map.
  let validateResults = [];
  let selectedRoute = null;
  let routeDrawerFilter = 'all';
  let routeDrawerSearch = '';

  $: drawerRows = validateResults.filter(r => {
    if (routeDrawerFilter !== 'all' && r.status.toLowerCase() !== routeDrawerFilter) return false;
    if (routeDrawerSearch) {
      const q = routeDrawerSearch.toLowerCase();
      return r.uprn.toLowerCase().includes(q) || r.address.toLowerCase().includes(q);
    }
    return true;
  });

  function routeStatusClass(s) { return s === 'ROUTED' ? 'routed' : s === 'PARTIAL' ? 'partial' : 'unserved'; }
  function capStyle(cap) {
    if (cap === '100%') return 'color:#4dc8ff;';
    if (cap === '0%') return 'color:#ff5555;';
    return 'color:#ffaa44;';
  }

  let searchQuery = '';

  // Postcode/asset search — the "Zoom to postcode or asset..." bar existed as
  // a bare placeholder with no handler; this wires it up. Three passes, in
  // order of cost — cheapest/most-likely first:
  //   1. Postcode match against addressPoints (spaces-insensitive — "FK20 8RU"
  //      and "fk208ru" both match). Instant, no network.
  //   2. Asset ID match across every ID-bearing collection, exact match first,
  //      then a "starts with" fallback so a partial ID still finds something.
  //      Instant, no network.
  //   3. ONLY if the query looks postcode-shaped AND nothing local matched:
  //      a live geocode via postcodes.io (free, no auth) — covers a postcode
  //      outside this project's imported premises, matching what v2's
  //      postcode_zoom.py did. Skipped entirely for non-postcode-shaped
  //      queries so a mistyped asset ID never costs a network round-trip.
  //      5s timeout; any failure (offline, timeout, genuinely not a postcode)
  //      falls through to the same "not found" toast rather than erroring.
  const UK_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/;

  async function onAssetSearch() {
    const q = searchQuery.trim();
    if (!q) return;
    const qNorm = q.toUpperCase();
    const qPostcode = qNorm.replace(/\s+/g, '');

    const postcodeMatches = (projectStore.addressPoints || []).filter(a => {
      const pc = String(a.properties?.postcode || '').replace(/\s+/g, '').toUpperCase();
      return pc && pc === qPostcode;
    });
    if (postcodeMatches.length > 0) {
      const [lng, lat] = postcodeMatches[0].geometry.coordinates;
      map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), postcodeMatches.length > 1 ? 16 : 18), duration: 600 });
      setSearchMarker(map, lng, lat);
      showToast(`Found ${postcodeMatches.length} premise(s) at ${q}.`);
      return;
    }

    const collections = [
      { arr: projectStore.chambers,      idProp: 'chamber_id', label: 'Chamber' },
      { arr: projectStore.ducts,         idProp: 'duct_id',    label: 'Duct' },
      { arr: projectStore.joints,        idProp: 'joint_id',   label: 'Joint' },
      { arr: projectStore.dropDucts,     idProp: 'ddct_id',    label: 'Drop Duct' },
      { arr: projectStore.cables,        idProp: 'cable_id',   label: 'Cable' },
      { arr: projectStore.bundles,       idProp: 'bundle_id',  label: 'Bundle' },
      { arr: projectStore.poles,         idProp: 'pole_id',    label: 'Pole' },
      { arr: projectStore.cbts,          idProp: 'cbt_id',     label: 'CBT' },
      { arr: projectStore.spans,         idProp: 'span_id',    label: 'Span' },
      { arr: projectStore.aerialDrops,   idProp: 'adrop_id',   label: 'Aerial Drop' },
      { arr: projectStore.cbtTails,      idProp: 'tail_id',    label: 'CBT Tail' },
      { arr: projectStore.addressPoints, idProp: 'uprn',       label: 'Premise' },
    ];

    let found = null;
    for (const { arr, idProp, label } of collections) {
      const exact = (arr || []).find(f => String(f.properties?.[idProp] || '').toUpperCase() === qNorm);
      if (exact) { found = { feature: exact, label }; break; }
    }
    if (!found) {
      for (const { arr, idProp, label } of collections) {
        const partial = (arr || []).find(f => String(f.properties?.[idProp] || '').toUpperCase().startsWith(qNorm));
        if (partial) { found = { feature: partial, label }; break; }
      }
    }

    if (found) {
      const geom = found.feature.geometry;
      let center = null;
      if (geom?.type === 'Point') center = geom.coordinates;
      else if (geom?.type === 'LineString' && geom.coordinates?.length) center = geom.coordinates[Math.floor(geom.coordinates.length / 2)];

      if (center) {
        map.easeTo({ center, zoom: Math.max(map.getZoom(), 18), duration: 600 });
        setSearchMarker(map, center[0], center[1]);
        showToast(`Found ${found.label} ${q}.`);
      } else {
        showToast(`Found ${found.label} ${q}, but it has no location to zoom to.`);
      }
      return;
    }

    if (UK_POSTCODE_RE.test(qPostcode)) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(qPostcode)}`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
          const data = await res.json();
          const { longitude, latitude } = data.result || {};
          if (typeof longitude === 'number' && typeof latitude === 'number') {
            map.easeTo({ center: [longitude, latitude], zoom: Math.max(map.getZoom(), 15), duration: 600 });
            setSearchMarker(map, longitude, latitude);
            showToast(`Found ${q} via postcodes.io — not in this project's imported premises.`);
            return;
          }
        }
        // 404 (not a real postcode) or an unexpected response shape — fall
        // through to the generic "not found" toast below, same as before.
      } catch (e) {
        // Offline, timed out, or postcodes.io is down — fail quietly to the
        // same "not found" toast rather than surfacing a raw network error.
        console.error('[search] postcodes.io lookup failed:', e);
      }
    }

    showToast(`No postcode or asset matching "${q}" found in this project.`);
  }

  function onDrawerRowClick(r) {
    selectedRoute = r.uprn;
    if (r.flyTo) {
      map.easeTo({ center: r.flyTo, zoom: Math.max(map.getZoom(), 17), duration: 600 });
    } else {
      const ap = (projectStore.state.addressPoints || []).find(a => String(a.properties?.uprn) === String(r.uprn));
      if (ap?.geometry?.coordinates) map.easeTo({ center: ap.geometry.coordinates, zoom: Math.max(map.getZoom(), 17), duration: 600 });
    }
  }

  function exportRoutesCsv() {
    if (!validateResults.length) return;
    const hdr = 'UPRN,Address,Status,Reason,Length(m)';
    const rows = validateResults.map(r => `"${r.uprn}","${r.address.replace(/"/g,'""')}","${r.status}","${(r.reason||'').replace(/"/g,'""')}","${r.lengthM}"`);
    const blob = new Blob([hdr + '\n' + rows.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'validate_routes.csv'; a.click();
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
      preserveDrawingBuffer: true,   // required so the map canvas can be captured for export
    });

    map.on('load', () => {
      setupMapLayers(map);
      if (projectStore.stage === 'import') rpMode = 'address-import';
      // FSAA: silently resume the last .conductor file if still permitted,
      // else surface a one-click Resume button (re-grant needs a user gesture).
      fsaaTryResume().then(r => {
        if (r.state === 'granted') {
          rpMode = projectStore.stage === 'import' ? 'address-import' : 'default';
          syncToMap(map);
        } else if (r.state === 'prompt') {
          fsaaResume = { fileName: r.fileName };
        }
      });
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

  async function onProjectCreated(e) {
    projectStore.setupProject(e.detail);
    rpMode = 'address-import';
    // Bind a real .conductor file at creation so the project is file-backed from
    // the start — no retroactive "where should this live?" moment. This runs
    // synchronously inside the Create-click gesture, so the save picker is
    // permitted to open. The filename pre-fills from the area ID (e.g.
    // SCOT-PH1.conductor). If the user cancels, the project still exists in
    // localStorage and the save-nudge remains as a fallback.
    if (fsaa.supported && !fsaa.fileName) {
      await onSaveToFile();
    }
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

  // ── Asset placement registry ───────────────────────────────────────────
  // Generic replacement for the 17 near-identical onPlaceX/onXSaved/
  // onXCancelled triads. BuildArea and Cabinet are deliberately excluded —
  // singletons (setX not addX) with extra steps (cookie-cutter, merge-into-
  // pending-geometry) that don't fit this shape; they stay hand-written
  // above. See docs/registry-handoff for the full divergence audit this
  // config is derived from.
  //
  // Config flags, and which asset(s) need them:
  //   skipForm               — dropDuct, bundle, aerialSpan, aerialDrop:
  //                            activate() callback receives a complete
  //                            feature and saves immediately, no pending/
  //                            rpMode/form step at all.
  //   transform(feature)     — piaDrop only: stamps PIA_UG/Openreach
  //                            properties onto the feature before it
  //                            becomes `pending` and is handed to the form.
  //   wholeFeatureFromEvent  — piaDrop only: PIADropForm dispatches the
  //                            complete updated feature on save (it started
  //                            from a feature, not bare attrs), so the
  //                            Saved handler must NOT reconstruct geometry
  //                            from attrs.lng/lat/coordinates like every
  //                            other form does.
  //   afterSave(attrs)       — joint only: fires updateChamberFunction()
  //                            when a SPLICE joint is saved.
  //   cleanupOnSave          — cbtTail only: activateCBTTailTool leaves its
  //                            listeners live while the form is open (one
  //                            tail per CBT, no re-arm), so the caller must
  //                            explicitly clearTool() on the Saved path too
  //                            (Cancelled always clearTool()s regardless).
  //   resetToolLabelOnCancel — piaDrop only: its Cancelled handler resets
  //                            activeToolLabel; no other asset does this.
  //   hasRubberband           — true for multi-vertex line tools, so Cancel
  //                            clears the in-progress rubberband-src layer.
  //                            False for point tools and the no-form line
  //                            tools, which never populate it.

  const ASSET_CONFIG = {
    chamber: {
      activate: activateChamberTool, geometryType: 'Point', addMethod: 'addChamber',
      toolLabel: 'Place Chamber', rpMode: 'chamber-form',
      setPending: (v) => pendingChamber = v, hasRubberband: false,
    },
    duct: {
      activate: activateDuctTool, geometryType: 'LineString', addMethod: 'addDuct',
      toolLabel: 'Digitise Duct — click vertices, right-click to finish', rpMode: 'duct-form',
      setPending: (v) => pendingDuct = v, hasRubberband: true,
    },
    joint: {
      activate: activateJointTool, geometryType: 'Point', addMethod: 'addJoint',
      toolLabel: 'Place Joint — click a chamber', rpMode: 'joint-form',
      setPending: (v) => pendingJoint = v, hasRubberband: false,
      afterSave: (attrs) => {
        if (attrs.joint_type === 'SPLICE') {
          projectStore.updateChamberFunction(attrs.chamber_id, 'JOINT');
        }
      },
    },
    cable: {
      activate: activateCableTool, geometryType: 'LineString', addMethod: 'addCable',
      toolLabel: 'Digitise Cable — click vertices, right-click to finish', rpMode: 'cable-form',
      setPending: (v) => pendingCable = v, hasRubberband: true,
    },
    pole: {
      activate: activatePoleTool, geometryType: 'Point', addMethod: 'addPole',
      toolLabel: 'Place Pole — click to place', rpMode: 'pole-form',
      setPending: (v) => pendingPole = v, hasRubberband: false,
    },
    cbt: {
      activate: activateCBTTool, geometryType: 'Point', addMethod: 'addCBT',
      toolLabel: 'Place CBT — click a pole', rpMode: 'cbt-form',
      setPending: (v) => pendingCBT = v, hasRubberband: false,
    },
    cbtTail: {
      activate: activateCBTTailTool, geometryType: 'LineString', addMethod: 'addCBTTail',
      toolLabel: 'CBT Tail — click CBT, snap through poles to the joint, RMB to finish',
      rpMode: 'cbt-tail-form',
      setPending: (v) => pendingCBTTail = v, hasRubberband: true, cleanupOnSave: true,
    },
    dropDuct: {
      activate: activateDropDuctTool, addMethod: 'addDropDuct',
      toolLabel: 'Drop Duct — click start, click end (RMB cancels line)',
      skipForm: true,
    },
    bundle: {
      activate: activateBundleTool, addMethod: 'addBundle',
      toolLabel: 'Bundle — click joint, click premise (RMB cancels line)',
      skipForm: true,
    },
    aerialSpan: {
      activate: activateAerialSpanTool, addMethod: 'addSpan',
      toolLabel: 'Aerial Span — click CBTs to add vertices, RMB to finish',
      skipForm: true,
    },
    aerialDrop: {
      activate: activateAerialDropTool, addMethod: 'addAerialDrop',
      toolLabel: 'Aerial Drop — click CBT, then premise',
      skipForm: true,
    },
    roadCrossing: {
      activate: activateDuctTool, geometryType: 'LineString', addMethod: 'addDuct',
      toolLabel: 'Road Crossing — click vertices, right-click to finish',
      rpMode: 'road-crossing-form',
      setPending: (v) => pendingRoadCrossing = v, hasRubberband: true,
    },
    streamCrossing: {
      activate: activateDuctTool, geometryType: 'LineString', addMethod: 'addDuct',
      toolLabel: 'Stream Crossing — click vertices, right-click to finish',
      rpMode: 'stream-crossing-form',
      setPending: (v) => pendingStreamCrossing = v, hasRubberband: true,
    },
    piaChamber: {
      activate: activateChamberTool, geometryType: 'Point', addMethod: 'addChamber',
      toolLabel: 'Place PIA UG Chamber — click a location',
      rpMode: 'pia-chamber-form',
      setPending: (v) => pendingPIAChamber = v, hasRubberband: false,
    },
    piaDuct: {
      activate: activateDuctTool, geometryType: 'LineString', addMethod: 'addDuct',
      toolLabel: 'PIA UG Duct — click vertices, right-click to finish',
      rpMode: 'pia-duct-form',
      setPending: (v) => pendingPIADuct = v, hasRubberband: true,
    },
    piaDrop: {
      // shares activateDropDuctTool with plain dropDuct, but diverges: has a
      // form, stamps PIA/Openreach properties via transform(), and its form
      // dispatches the whole updated feature rather than bare attrs.
      activate: activateDropDuctTool, addMethod: 'addDropDuct',
      toolLabel: 'PIA UG Drop — click start, click end (RMB cancels line)',
      rpMode: 'pia-drop-form',
      setPending: (v) => pendingPIADrop = v, hasRubberband: false,
      resetToolLabelOnCancel: true,
      transform: (feature) => {
        feature.properties.installation_method = 'PIA_UG';
        feature.properties.drop_type            = 'PIA_UG';
        feature.properties.owner                = 'Openreach';
        return feature;
      },
      wholeFeatureFromEvent: true,
    },
  };

  function buildGeometry(geometryType, attrs) {
    return geometryType === 'Point'
      ? { type: 'Point', coordinates: [attrs.lng, attrs.lat] }
      : { type: 'LineString', coordinates: attrs.coordinates };
  }

  function onPlaceAsset(key) {
    const cfg = ASSET_CONFIG[key];
    clearTool(map);
    activeToolLabel = cfg.toolLabel;

    if (cfg.skipForm) {
      const err = cfg.activate(map, (feature) => {
        projectStore[cfg.addMethod](cfg.transform ? cfg.transform(feature) : feature);
        syncToMap(map);
      });
      if (err) { showToast(err.error); activeToolLabel = ''; }
      return;
    }

    const err = cfg.activate(map, (pending) => {
      cfg.setPending(cfg.transform ? cfg.transform(pending) : pending);
      rpMode = cfg.rpMode;
      activeToolLabel = '';
    });
    if (err) { showToast(err.error); activeToolLabel = ''; }
  }

  function onAssetSaved(key, e) {
    const cfg = ASSET_CONFIG[key];
    const attrs = e.detail;
    const feature = cfg.wholeFeatureFromEvent
      ? attrs
      : { type: 'Feature', geometry: buildGeometry(cfg.geometryType, attrs), properties: attrs };

    projectStore[cfg.addMethod](feature);
    if (cfg.afterSave) cfg.afterSave(attrs, feature);
    syncToMap(map);
    if (cfg.cleanupOnSave) clearTool(map);
    rpMode = 'default';
    cfg.setPending(null);
  }

  function onAssetCancelled(key) {
    const cfg = ASSET_CONFIG[key];
    rpMode = 'default';
    cfg.setPending(null);
    clearTool(map);
    if (cfg.hasRubberband && map.getSource('rubberband-src')) {
      map.getSource('rubberband-src').setData({ type: 'FeatureCollection', features: [] });
    }
    if (cfg.resetToolLabelOnCancel) activeToolLabel = '';
  }

  function onPlaceChamber() { onPlaceAsset('chamber'); }
  function onChamberSaved(e) { onAssetSaved('chamber', e); }
  function onChamberCancelled() { onAssetCancelled('chamber'); }

  function onPlaceDuct() { onPlaceAsset('duct'); }
  function onDuctSaved(e) { onAssetSaved('duct', e); }
  function onDuctCancelled() { onAssetCancelled('duct'); }

  function onPlaceJoint() { onPlaceAsset('joint'); }
  function onJointSaved(e) { onAssetSaved('joint', e); }
  function onJointCancelled() { onAssetCancelled('joint'); }

  function onPlaceDropDuct() { onPlaceAsset('dropDuct'); }

  function onPlaceCable() { onPlaceAsset('cable'); }
  function onCableSaved(e) { onAssetSaved('cable', e); }
  function onCableCancelled() { onAssetCancelled('cable'); }

  function onPlaceBundle() { onPlaceAsset('bundle'); }

  function onPlacePole() { onPlaceAsset('pole'); }
  function onPoleSaved(e) { onAssetSaved('pole', e); }
  function onPoleCancelled() { onAssetCancelled('pole'); }

  function onPlaceCBT() { onPlaceAsset('cbt'); }
  function onCBTSaved(e) { onAssetSaved('cbt', e); }
  function onCBTCancelled() { onAssetCancelled('cbt'); }

  function onPlaceAerialSpan() { onPlaceAsset('aerialSpan'); }

  function onPlaceAerialDrop() { onPlaceAsset('aerialDrop'); }

  function onPlaceCBTTail() { onPlaceAsset('cbtTail'); }
  function onCBTTailSaved(e) { onAssetSaved('cbtTail', e); }
  function onCBTTailCancelled() { onAssetCancelled('cbtTail'); }

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
    if (!projectStore.cabinet) { showToast('No cabinet placed yet.'); return; }
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

  // ── civil-road / civil-stream / pia-* — thin wrappers onto the asset
  // placement registry defined above (ASSET_CONFIG / onPlaceAsset /
  // onAssetSaved / onAssetCancelled). ─────────────────────────────────────

  function onPlaceRoadCrossing() { onPlaceAsset('roadCrossing'); }
  function onRoadCrossingSaved(e) { onAssetSaved('roadCrossing', e); }
  function onRoadCrossingCancelled() { onAssetCancelled('roadCrossing'); }

  function onPlaceStreamCrossing() { onPlaceAsset('streamCrossing'); }
  function onStreamCrossingSaved(e) { onAssetSaved('streamCrossing', e); }
  function onStreamCrossingCancelled() { onAssetCancelled('streamCrossing'); }

  function onPlacePIAChamber() { onPlaceAsset('piaChamber'); }
  function onPIAChamberSaved(e) { onAssetSaved('piaChamber', e); }
  function onPIAChamberCancelled() { onAssetCancelled('piaChamber'); }

  function onPlacePIADuct() { onPlaceAsset('piaDuct'); }
  function onPIADuctSaved(e) { onAssetSaved('piaDuct', e); }
  function onPIADuctCancelled() { onAssetCancelled('piaDuct'); }

  function onPlacePIADrop() { onPlaceAsset('piaDrop'); }
  function onPIADropSaved(e) { onAssetSaved('piaDrop', e); }
  function onPIADropCancelled() { onAssetCancelled('piaDrop'); }

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
    if (err) { showToast(err.error); activeToolLabel = ''; }
  }

  function onFibreTraceClose() {
    fibreTraceResult = null;
    rpMode = 'default';
    clearTool(map);
    clearTraceHighlight(map);
    activeToolLabel = '';
  }

  // Route Splice Export — chains the current Fibre Trace result (same engine,
  // same click-a-premise flow) through generateRouteSplicePlan() to produce
  // one printable HTML covering every joint/CBT in the route, in path order.
  // Only reachable from a ROUTED trace (button is hidden otherwise in
  // FibreTracePanel), but defensively re-checks here too.
  function onDownloadRouteSplice() {
    if (!fibreTraceResult || fibreTraceResult.status !== 'ROUTED') return;
    const result = generateRouteSplicePlan(projectStore.state, fibreTraceResult.uprn);
    if (result.error) { showError(result.error); return; }
    downloadSplicePlan(result.html, result.filename);
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
    if (!result.ok) { showToast(result.reason); return; }
    projectStore.applyFibreAssignment(result);
    syncToMap(map);
    fibreAssignResult = result;
    rpMode = 'fibre-assign';
  }

  function onFibreAssignClose() {
    fibreAssignResult = null;
    rpMode = 'default';
  }

  // ── fibre-count (Tier 2) ─────────────────────────────────────────────────
  // Not a map-click tool — runs the utilisation calculation over all cables +
  // spans, shows a panel with per-segment stats. Clicking a segment row in the
  // panel flashes a highlight on the map. Re-runnable any time.

  function onFibreCount() {
    if (stage !== 'design') return;
    clearTool(map);
    clearCountHighlight(map);
    activeToolLabel = '';
    const result = countFibres(projectStore.state);
    if (!result.ok) { showToast(result.reason); return; }
    fibreCountResult = result;
    rpMode = 'fibre-count';
  }

  function onFibreCountClose() {
    fibreCountResult = null;
    rpMode = 'default';
    clearCountHighlight(map);
  }

  // ── Splice Plan ──────────────────────────────────────────────────────────
  function onSplicePlan() {
    if (stage !== 'design') return;
    clearTool(map);
    activeToolLabel = '';
    rpMode = 'splice-plan';
  }

  function onSplicePlanClose() {
    rpMode = 'default';
  }

  // ── Bill of Materials ────────────────────────────────────────────────────
  function onBom() {
    if (stage !== 'design') return;
    clearTool(map);
    activeToolLabel = '';
    rpMode = 'bom';
  }
  function onBomClose() { rpMode = 'default'; }

  // ── Single Line Diagram ──────────────────────────────────────────────────
  function onSld() {
    if (stage !== 'design') return;
    clearTool(map);
    activeToolLabel = '';
    rpMode = 'sld';
  }
  function onSldClose() { rpMode = 'default'; }

  // ── Validate Routes ──────────────────────────────────────────────────────
  function onValidateRoutes() {
    if (stage !== 'design') return;
    clearTool(map);
    activeToolLabel = '';
    rpMode = 'validate-routes';
  }
  function onValidateRoutesClose() { rpMode = 'default'; }

  // ── Design Health ─────────────────────────────────────────────────────────
  function onDesignHealth() {
    if (stage !== 'design') return;
    clearTool(map);
    activeToolLabel = '';
    rpMode = 'design-health';
  }
  function onDesignHealthClose() { rpMode = 'default'; }

  // ── Cabinet Cost Calculator ────────────────────────────────────────
  function onCabinetCost() {
    if (stage !== 'design') return;
    if (!projectStore.cabinet) { showToast('No cabinet placed yet.'); return; }
    clearTool(map);
    activeToolLabel = '';
    rpMode = 'cabinet-cost';
  }
  function onCabinetCostClose() { rpMode = 'default'; }

  function onFibreCountHighlight(e) {
    const seg = e.detail;
    if (!seg || !seg.feature?.geometry) return;
    activateFibreCountTool(map, seg);
  }

  function onToolSelected(e) {
    const { label, category, toolId } = e.detail;
    const catLabel = category.charAt(0).toUpperCase() + category.slice(1);
    activeToolLabel = `${catLabel} — ${label}`;
    activeToolId    = toolId;
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
    if (toolId === 'fibre-count')         onFibreCount();
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

  // ── File System Access (durable .conductor file) ──────────────────────────
  let fsaa = { status: 'no-file', lastSaved: null, fileName: null, supported: false };
  let fsaaResume = null;   // { fileName } when a saved file is waiting for a resume click
  fsaaOnStatus(s => { fsaa = s; });

  function fmtSaved(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  async function onSaveToFile() {
    try { await fsaaSaveAs(); }
    catch (e) { showError('Could not save file: ' + (e?.message || e)); }
  }
  async function onOpenFile() {
    try {
      if (await fsaaOpenFile()) {
        rpMode = 'default'; activeToolLabel = '';
        if (map) syncToMap(map);
      }
    } catch (e) { showError('Could not open file: ' + (e?.message || e)); }
  }
  async function onResumeFile() {
    if (await fsaaResumePrompt()) {
      fsaaResume = null;
      rpMode = 'default'; activeToolLabel = '';
      if (map) syncToMap(map);
    }
  }
  function onKeydown(e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      if (fsaa.supported && fsaa.fileName) { e.preventDefault(); fsaaSaveNow(); }
    }
  }

  // ── Map sheet export (PNG/SVG) — 2D only ──────────────────────────────────
  let showExport = false;
  let exporting = false;
  async function doExport(format) {
    showExport = false;
    if (is3D) { showToast('Switch to 2D view before exporting the map.'); return; }
    if (!map) return;
    exporting = true;
    try {
      await exportSheet(map, projectStore.state, { format, company: 'GIGALOCH' });
    } catch (e) {
      const msg = String(e?.message || e);
      const cors = /SecurityError|tainted/i.test(msg)
        ? '\n\nThe basemap may be blocking image capture (CORS). Try the Dark or Light basemap and export again.'
        : '';
      showError('Export failed: ' + msg + cors);
    } finally {
      exporting = false;
    }
  }

  // One-time nudge: prompt to save-to-file once real work exists (stage → 'design')
  // and no file is bound yet. Fires once per session; dismissing just hides it.
  let hasNudged = false;
  let showSaveNudge = false;
  $: if (stage === 'design' && fsaa.supported && !fsaa.fileName && !hasNudged) {
    hasNudged = true;
    showSaveNudge = true;
  }
  function dismissNudge() { showSaveNudge = false; }
  async function onNudgeSave() {
    showSaveNudge = false;
    await onSaveToFile();
  }

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
    const result = projectStore.openProject(id);

    if (result.ok) {
      rpMode = 'default';
      activeToolLabel = '';
      if (map) syncToMap(map);
      return;
    }

    if (result.needsFileResume) {
      // No cached localStorage copy — this project's data lives only in its
      // .conductor file. We're still inside the click handler (user gesture),
      // so re-request file permission directly rather than needing a second click.
      fsaaResumeProjectFile(id).then(r => {
        if (r.state === 'loaded') {
          rpMode = 'default';
          activeToolLabel = '';
          if (map) syncToMap(map);
        } else if (r.state === 'denied') {
          showError(`Permission for "${result.fileName}" wasn't granted. Use "Open File" to pick it manually.`);
        } else {
          showError(`Could not find the file handle for "${result.fileName}". Use "Open File" to pick it manually.`);
        }
      });
      return;
    }

    showError('Could not open that project.');
  }

  function onDeleteProject(id, name) {
    if (!confirm(`Delete "${name || 'this project'}"? This can't be undone.`)) return;
    const wasActive = id === projectStore.activeId();
    projectStore.deleteProject(id);
    refreshList();
    if (wasActive) {
      // The project we just deleted was the one open on screen — fall back to
      // a fresh project rather than leaving the UI pointed at a dead id.
      projectStore.newProject();
      rpMode = 'default';
      activeToolLabel = '';
      if (map) syncToMap(map);
    }
  }
</script>

<svelte:window on:click={() => { showOpen = false; showExport = false; }} on:keydown={onKeydown} />

<div class="screen">

  {#if showSaveNudge}
    <div class="save-nudge" role="alert">
      <span>Save this project to a file? Keeps your work safe on disk with autosave.</span>
      <button class="sn-save" on:click={onNudgeSave}>Save File</button>
      <button class="sn-dismiss" on:click={dismissNudge} title="Dismiss">✕</button>
    </div>
  {/if}

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
      <div class="stat"><div class="sv neu">{cheapStats.premises || '—'}</div><div class="sl">Premises</div></div>
      <div class="stat" title={statsStale ? 'Stale — re-run Validate Routes' : ''}>
        <div class="sv ok">{routeStats.routed !== null ? routeStats.routed : '—'}{statsStale ? '*' : ''}</div>
        <div class="sl">Routed</div>
      </div>
      <div class="stat" title={statsStale ? 'Stale — re-run Validate Routes' : ''}>
        <div class="sv wrn">{routeStats.partial !== null ? routeStats.partial : '—'}{statsStale ? '*' : ''}</div>
        <div class="sl">Partial</div>
      </div>
      <div class="stat" title={statsStale ? 'Stale — re-run Validate Routes' : ''}>
        <div class="sv bad">{routeStats.unserved !== null ? routeStats.unserved : '—'}{statsStale ? '*' : ''}</div>
        <div class="sl">Unserved</div>
      </div>
      <div class="stat"><div class="sv neu">{cheapStats.fibre_km != null ? cheapStats.fibre_km + 'km' : '—'}</div><div class="sl">Fibre</div></div>
      <div class="stat"><div class="sv neu">{cheapStats.duct_km != null ? cheapStats.duct_km + 'km' : '—'}</div><div class="sl">Duct</div></div>
      <div class="stat" style="border-right:none;"><div class="sv neu">{cheapStats.materials_cost ? '£' + cheapStats.materials_cost.toLocaleString('en-GB', {maximumFractionDigits:0}) : '—'}</div><div class="sl">Est. Materials</div></div>
    </div>
    <div class="tb-centre">
      <div class="tb-grp-wrap">
        <div class="tb-grp-lbl">Validation</div>
        <div class="tb-grp">
          <button class="tb-btn hi" disabled={stage !== 'design'} on:click={onValidateRoutes}>✓ Validate Routes</button>
          <button class="tb-btn hi" disabled={stage !== 'design'} on:click={onDesignHealth}>⚡ Design Health</button>
        </div>
      </div>
      <div class="tb-sep"></div>
      <div class="tb-grp-wrap">
        <div class="tb-grp-lbl">Outputs</div>
        <div class="tb-grp">
          <button class="tb-btn" disabled={stage !== 'design'} on:click={onSplicePlan}>Splice Plan</button>
          <button class="tb-btn" disabled={stage !== 'design'} on:click={onSld}>SLD</button>
          <button class="tb-btn" disabled={stage !== 'design'} on:click={onBom}>Bill of Materials</button>
        </div>
      </div>
    </div>
    <div class="tb-right">
      <div style="display:flex;align-items:center;gap:6px;">
        <input class="srch" placeholder="Zoom to postcode or asset..." bind:value={searchQuery} on:keydown={(e) => e.key === 'Enter' && onAssetSearch()} />
        <button class="go" on:click={onAssetSearch}>GO</button>
      </div>
      <div class="vtog">
        <button class="vt" class:on={is3D} on:click={() => setView(true)}>3D</button>
        <button class="vt" class:on={!is3D} on:click={() => setView(false)}>2D</button>
      </div>
      {#if fsaa.supported}
        {#if fsaaResume}
          <button class="tb-resume" on:click={onResumeFile} title="Reconnect to your last project file">↻ Resume {fsaaResume.fileName}</button>
        {/if}
        <div class="fsaa-grp">
          <button class="tb-new" on:click={onSaveToFile} title="Save project to a file on disk">⤓ Save File</button>
          <button class="tb-new" on:click={onOpenFile}  title="Open a .conductor file from disk">⤢ Open File</button>
          <span class="fsaa-ind"
                class:saved={fsaa.status === 'saved'}
                class:saving={fsaa.status === 'saving'}
                class:unsaved={fsaa.status === 'unsaved'}
                class:error={fsaa.status === 'error'}
                title={fsaa.fileName || ''}>
            {#if fsaa.status === 'saving'}Saving…
            {:else if fsaa.status === 'saved'}Saved {fmtSaved(fsaa.lastSaved)}
            {:else if fsaa.status === 'unsaved'}Unsaved…
            {:else if fsaa.status === 'error'}⚠ Not saved
            {:else}No file{/if}
          </span>
        </div>
      {/if}
      <div class="tb-open-wrap">
        <button class="tb-new" class:tb-disabled={is3D || exporting}
                on:click|stopPropagation={() => { if (!is3D && !exporting) showExport = !showExport; }}
                title={is3D ? 'Switch to 2D view to export the map' : 'Export map sheet (legend, totals, scale)'}>
          {exporting ? '⏳ Exporting…' : '⎙ Export ▾'}
        </button>
        {#if showExport && !is3D}
          <div class="tb-open-menu" on:click|stopPropagation>
            <button class="tb-open-item exp-item" on:click={() => doExport('svg')}>SVG — vector, editable</button>
            <button class="tb-open-item exp-item" on:click={() => doExport('png')}>PNG — image</button>
          </div>
        {/if}
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
                <div class="tb-open-row">
                  <button class="tb-open-item" class:active={p.id === projectStore.activeId()} on:click={() => openProject(p.id)}>
                    <span class="oi-name">{p.name}</span>
                    <span class="oi-area">{p.areaId}</span>
                  </button>
                  <button class="tb-open-del" title="Delete project" on:click|stopPropagation={() => onDeleteProject(p.id, p.name)}>🗑</button>
                </div>
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
          {#if activeToolId}
            <a
              href={docsUrl(activeToolId)}
              target="_blank"
              rel="noopener"
              class="chip-help"
              title={toolTip(activeToolId)}
              on:click|stopPropagation
            >ⓘ</a>
          {/if}
          <button class="chip-cancel" on:click={() => {
            clearTool(map);
            activeToolLabel = '';
            activeToolId    = '';
            rpMode = 'default';
            pendingBuildArea = null;
            pendingCabinet = null;
            fibreTraceResult = null;
            fibreCountResult = null;
            clearTraceHighlight(map);
            clearCountHighlight(map);
            if (map.getSource('ba-rubber-src')) map.getSource('ba-rubber-src').setData({ type: 'FeatureCollection', features: [] });
          }}>✕</button>
        </div>
      {/if}

      <div class="routes-drawer" style="height:{drawerOpen ? '220px' : '36px'};">
        <div class="routes-handle" on:click={() => drawerOpen = !drawerOpen}>
          <span class="handle-title">Routes</span>
          <span class="handle-count">{drawerRows.length}</span>
          <select class="handle-filter" bind:value={routeDrawerFilter} on:click|stopPropagation>
            <option value="all">All Routes</option>
            <option value="routed">Routed</option>
            <option value="partial">Partial</option>
            <option value="unserved">Unserved</option>
          </select>
          <input class="handle-search" placeholder="Search routes..." bind:value={routeDrawerSearch} on:click|stopPropagation />
          <button class="handle-csv" on:click|stopPropagation={exportRoutesCsv}>↓ CSV</button>
          <button class="handle-toggle">{drawerOpen ? '▼' : '▲'}</button>
        </div>
        {#if drawerOpen}
        <div class="routes-table-wrap">
          {#if validateResults.length === 0}
            <div style="padding:14px 16px;font-size:8.5px;color:#3a5a70;letter-spacing:0.04em;">Run ✓ Validate Routes to populate this table.</div>
          {:else}
          <table class="routes-table">
            <thead><tr>
              <th>Status</th><th>UPRN</th><th>Address</th><th>Length</th><th>Reason</th>
            </tr></thead>
            <tbody>
              {#each drawerRows as r}
                <tr class:sel={selectedRoute === r.uprn} on:click={() => onDrawerRowClick(r)}>
                  <td><span class="status-pill {routeStatusClass(r.status)}">{r.status}</span></td>
                  <td style="color:#4dc8ff;font-weight:600;">{r.uprn}</td>
                  <td>{r.address}</td>
                  <td>{r.lengthM ? r.lengthM + 'm' : '—'}</td>
                  <td style="color:#6a8fa8;">{r.reason || '—'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
          {/if}
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

      {:else if rpMode === 'pia-drop-form'}
        <PIADropForm pending={pendingPIADrop} on:save={onPIADropSaved} on:cancel={onPIADropCancelled} />

      {:else if rpMode === 'asset-selected'}
        <AssetEditPanel
          selected={selectedAsset}
          on:saved={onAssetPanelSaved}
          on:deleted={onAssetPanelDeleted}
          on:move={onAssetPanelMove}
          on:close={onAssetPanelClose}
        />

      {:else if rpMode === 'fibre-trace'}
        <FibreTracePanel result={fibreTraceResult} on:close={onFibreTraceClose} on:downloadRouteSplice={onDownloadRouteSplice} />

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

      {:else if rpMode === 'fibre-count'}
        <FibreCountPanel
          result={fibreCountResult}
          on:close={onFibreCountClose}
          on:highlight={onFibreCountHighlight}
        />

      {:else if rpMode === 'splice-plan'}
        <SplicePlanPanel
          on:close={onSplicePlanClose}
        />

      {:else if rpMode === 'bom'}
        <BomPanel on:close={onBomClose} />

      {:else if rpMode === 'sld'}
        <SldPanel on:close={onSldClose} />

      {:else if rpMode === 'validate-routes'}
        <ValidateRoutesPanel
          on:close={onValidateRoutesClose}
          on:summary={onValidateSummary}
          on:results={onValidateResults}
          on:highlight={(e) => {
            const { flyTo, uprn } = e.detail;
            if (flyTo) {
              map.easeTo({ center: flyTo, zoom: Math.max(map.getZoom(), 17), duration: 600 });
            } else {
              const ap = (projectStore.state.addressPoints || []).find(a => String(a.properties?.uprn) === String(uprn));
              if (ap?.geometry?.coordinates) map.easeTo({ center: ap.geometry.coordinates, zoom: Math.max(map.getZoom(), 17), duration: 600 });
            }
          }}
        />

      {:else if rpMode === 'design-health'}
        <DesignHealthPanel autoRun={true} on:close={onDesignHealthClose} />

      {:else if rpMode === 'cabinet-cost'}
        <CabinetCostPanel on:close={onCabinetCostClose} />

      {:else}
        <div class="rp-hdr">
          <span class="rp-hdr-title">Validation Summary</span>
          <span class="rp-timestamp">—</span>
          <button class="rp-refresh">↻</button>
          <button class="health-btn" disabled={stage !== 'design'} on:click={onDesignHealth}>✓ Health</button>
        </div>
        <div class="val-body">
          <div class="val-counts">
            <div class="vc"><div class="vc-val bad">0</div><div class="vc-lbl">Critical</div></div>
            <div class="vc"><div class="vc-val bad">{routeStats.partial !== null ? routeStats.partial : '—'}</div><div class="vc-lbl">Errors</div></div>
            <div class="vc"><div class="vc-val wrn">0</div><div class="vc-lbl">Warnings</div></div>
            <div class="vc"><div class="vc-val neu">{cheapStats.premises || '—'}</div><div class="vc-lbl">Total</div></div>
          </div>
          <div class="int-row"><span class="int-k">Network Integrity</span><span class="int-v">{routeStats.routed !== null ? Math.round(routeStats.routed / Math.max(routeStats.routed + routeStats.partial, 1) * 100) + '%' : '—'}</span></div>
          <div class="int-bar"><div class="int-fill" style="width:{routeStats.routed !== null ? Math.round(routeStats.routed / Math.max(routeStats.routed + routeStats.partial, 1) * 100) : 3}%"></div></div>
          <div class="checks-note">
            {#if stage === 'setup' || stage === 'import'}
              Create a project and import address data to begin.
            {:else if stage === 'build-area'}
              Draw your build area boundary to continue.
            {:else if stage === 'cabinet'}
              Place a cabinet to unlock all design tools.
            {:else if routeStats.routed !== null && statsStale}
              Results stale — re-run Validate Routes after design changes.
            {:else if routeStats.routed !== null}
              {routeStats.routed} routed · {routeStats.partial} partial · {routeStats.unserved} unserved
            {:else}
              Click ✓ Validate Routes to check fibre connectivity.
            {/if}
          </div>
        </div>

        <div class="outputs-section">
          <div class="outputs-lbl">Engineer Outputs</div>
          <button class="out-btn" disabled={stage !== 'design'} on:click={onValidateRoutes}>↗ Validate Fibre Routes</button>
          <button class="out-btn" disabled={stage !== 'design'} on:click={onSplicePlan}>↗ Splice Plan Export</button>
          <button class="out-btn" disabled={stage !== 'design'} on:click={onSld}>↗ Single Line Diagram</button>
          <button class="out-btn" disabled={stage !== 'design'} on:click={onBom}>↗ Bill of Materials</button>
          <button class="out-btn" disabled={stage !== 'design'} on:click={onCabinetCost}>↗ Cabinet Cost Calculator</button>
        </div>

          <div class="rp-splitter"></div>

          <div class="asset-section">
            <div class="asset-hdr">
              <div class="asset-hdr-lbl">Selected Asset</div>
              <div class="asset-type">—</div>
              <div class="asset-id">—</div>
            </div>
            <div class="asset-body" style="padding:12px 14px;font-size:11px;color:#6ba3c7;letter-spacing:0.03em;line-height:1.8;">
              Use Edit Asset to select and inspect an asset.
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
  .stat { display: flex; flex-direction: column; align-items: center; padding: 0 7px; border-right: 1px solid #1a2d40; flex-shrink: 1; min-width: 0; }
  .sv { font-size: 12px; font-weight: 700; line-height: 1; white-space: nowrap; }
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
  .tb-open-row { display: flex; align-items: stretch; border-bottom: 1px solid #1a2d4033; }
  .tb-open-row:last-child { border-bottom: none; }
  .tb-open-item { display: flex; align-items: center; justify-content: space-between; flex: 1; min-width: 0; box-sizing: border-box; background: transparent; border: none; padding: 8px 12px; cursor: pointer; gap: 12px; }
  .tb-open-item:hover { background: #0f1c28; }
  .tb-open-item.active .oi-name { color: #4dc8ff; }
  .tb-open-item.active::before { content: '●'; color: #4dc8ff; font-size: 6px; margin-right: 6px; }
  .tb-open-del { background: transparent; border: none; padding: 8px 10px; cursor: pointer; font-size: 11px; opacity: 0.5; }
  .tb-open-del:hover { opacity: 1; background: #2a0f0f; }
  .oi-name { font-size: 9px; color: #a0c4d8; font-family: 'Courier New', monospace; letter-spacing: 0.04em; }
  .oi-area { font-size: 8px; color: #3a5a70; font-family: 'Courier New', monospace; }

  /* ── FSAA file controls ── */
  .fsaa-grp { display: flex; align-items: center; gap: 6px; padding-left: 6px; margin-left: 2px; border-left: 1px solid #1a2d40; }
  .tb-disabled { opacity: 0.4; cursor: not-allowed; }
  .exp-item { display: block; width: 100%; box-sizing: border-box; border-bottom: 1px solid #1a2d4033; color: #a0c4d8; font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.04em; text-align: left; }
  .exp-item:last-child { border-bottom: none; }
  .exp-item:hover { color: #4dc8ff; }
  .fsaa-ind { font-family: 'Courier New', monospace; font-size: 8.5px; letter-spacing: 0.04em; color: #3a5a70; white-space: nowrap; min-width: 68px; }
  .fsaa-ind.saved   { color: #5dd6a0; }
  .fsaa-ind.saving  { color: #ffc04d; }
  .fsaa-ind.unsaved { color: #ffc04d; }
  .fsaa-ind.error   { color: #ff6b6b; }
  .tb-resume { background: #102030; border: 1px solid #00aaff55; color: #4dc8ff; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.05em; padding: 4px 10px; border-radius: 4px; cursor: pointer; white-space: nowrap; animation: fsaaPulse 2s ease-in-out infinite; }
  .tb-resume:hover { background: #15273a; border-color: #4dc8ff; }
  @keyframes fsaaPulse { 0%,100% { box-shadow: 0 0 0 0 #00aaff00; } 50% { box-shadow: 0 0 8px 0 #00aaff44; } }

  /* ── Save-to-file nudge banner ── */
  .save-nudge {
    position: fixed; top: 56px; right: 16px; z-index: 200;
    display: flex; align-items: center; gap: 10px;
    background: #0d1520; border: 1px solid #00aaff55; border-radius: 6px;
    padding: 10px 12px; box-shadow: 0 8px 24px #00000088;
    font-family: 'Courier New', monospace; font-size: 10.5px; color: #a0c4d8;
    max-width: 320px; animation: fsaaPulse 2.5s ease-in-out infinite;
  }
  .sn-save { background: #102030; border: 1px solid #4dc8ff; color: #4dc8ff; font-size: 9px; letter-spacing: 0.05em; padding: 4px 10px; border-radius: 4px; cursor: pointer; white-space: nowrap; }
  .sn-save:hover { background: #15273a; }
  .sn-dismiss { background: transparent; border: none; color: #5b7488; cursor: pointer; font-size: 11px; padding: 2px 4px; }
  .sn-dismiss:hover { color: #a0c4d8; }

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
  .chip-help { color: #4dc8ff55; font-size: 13px; text-decoration: none; padding: 0 2px; line-height: 1; transition: color 0.12s; }
  .chip-help:hover { color: #4dc8ff; }
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
  .vc-lbl { font-size: 11px; color: #6ba3c7; letter-spacing: 0.08em; text-transform: uppercase; margin-top: 4px; text-shadow: 0 0 6px #00aaff44; }
  .int-row { display: flex; justify-content: space-between; margin-bottom: 4px; }
  .int-k { font-size: 11px; color: #7ab8d4; text-transform: uppercase; letter-spacing: 0.06em; text-shadow: 0 0 6px #00aaff44; }
  .int-v { font-size: 11px; color: #7ab8d4; }
  .int-bar { height: 2px; background: #080e14; border-radius: 2px; margin-bottom: 8px; }
  .int-fill { height: 2px; background: #4dc8ff; border-radius: 2px; width: 3%; }
  .checks-note { font-size: 11px; color: #6ba3c7; letter-spacing: 0.03em; line-height: 1.5; }

  .health-banner { margin: 10px 14px; padding: 8px 10px; border-radius: 5px; font-size: 8.5px; letter-spacing: 0.04em; line-height: 1.5; }
  .health-banner.caution { background: #ffaa4414; border: 1px solid #ffaa4433; color: #ffaa44; }

  .outputs-section { padding: 10px 14px; border-bottom: 1px solid #1a2d40; }
  .outputs-lbl { font-size: 11px; color: #6ba3c7; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 8px; text-shadow: 0 0 6px #00aaff44; }
  .out-btn { display: block; width: 100%; background: #0a1018; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; padding: 7px 10px; text-align: left; cursor: pointer; margin-bottom: 4px; border-radius: 4px; transition: all 0.12s; }
  .out-btn:hover { border-color: #00aaff33; color: #4dc8ff; background: #0d1a28; }

  .rp-splitter { height: 3px; background: #1a2d40; cursor: row-resize; flex-shrink: 0; position: relative; }
  .rp-splitter::after { content: ''; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 24px; height: 1px; background: #2a4a5e; border-radius: 1px; }
  .rp-splitter:hover { background: #2a4a5e; }

  .asset-section { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }
  .asset-hdr { padding: 12px 14px 8px; border-bottom: 1px solid #1a2d40; flex-shrink: 0; }
  .asset-hdr-lbl { font-size: 11px; color: #6ba3c7; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 5px; text-shadow: 0 0 6px #00aaff44; }
  .asset-type { font-size: 11px; color: #6ba3c7; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 3px; }
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
  /* ── Topbar account avatar ── */

</style>
