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
  import SaveNudge from './SaveNudge.svelte';
  import ActiveToolChip from './ActiveToolChip.svelte';
  import RoutesDrawer from './RoutesDrawer.svelte';
  import FibreAssignPanel from './FibreAssignPanel.svelte';
  import BranchClassificationPanel from './BranchClassificationPanel.svelte';
  import Sidebar from './Sidebar.svelte';
  import ValidationSummaryPanel from './ValidationSummaryPanel.svelte';
  import TopBar from './TopBar.svelte';
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
  import { setupMapLayers } from './mapLayers.js';
  import { searchAndZoom, fitToProject as fitToProjectExtent } from './mapSearch.js';
  import { exportCadSheet } from './cadExport.js';
  import { assignFibres } from './fibreAssign.js';
  import { countFibres } from './fibreCount.js';
  import { downloadSplicePlan, generateSplicePlan, downloadAllSplicePlans, generateRouteSplicePlan, physicalPlanReady } from './splicePlan.js';
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
    ensureSources, ensureTerrainLayers, syncToMap, invalidateSyncSource,
    activateCabinetTool, activateBuildAreaTool, activateChamberTool,
    activateDuctTool, activateJointTool, activateDropDuctTool,
    activateCableTool, activateBundleTool, activatePoleTool,
    activateCBTTool, activateAerialSpanTool, activateAerialDropTool,
    activateCBTTailTool,
    activateSelectTool, activateMovePointTool,
    startToolSession,
    activateFibreTraceTool, clearTraceHighlight,
    activateFibreCountTool, clearCountHighlight,
    applyCookieCutter, clearTool, getPoleLayer, setSearchMarker
  } from './mapTools.js';

  const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY;

  // Playwright/E2E only: swaps every basemap for a local, source-less style
  // spec instead of a live MapTiler URL. MapLibre still fires 'load' and
  // exposes a real canvas/GL context against `{version:8, sources:{},
  // layers:[]}` — no network call, no API key needed — so map-tool tests
  // (click-to-place, drag, etc.) can run in CI without a real MapTiler key
  // or external network access. Gated on an explicit env var so normal
  // dev/production builds are byte-for-byte unaffected; see
  // frontend/tests/e2e/README.md and playwright.config.js.
  const E2E_TEST_MODE = import.meta.env.VITE_TEST_MODE === '1';
  const BLANK_STYLE = { version: 8, sources: {}, layers: [] };

  // ── Basemap definitions ──────────────────────────────────────────────────────
  const BASEMAPS = [
    { id: 'dark',      label: '⬛  Dark',       style: `https://api.maptiler.com/maps/dataviz-dark/style.json?key=${MAPTILER_KEY}` },
    { id: 'light',     label: '⬜  Light',      style: `https://api.maptiler.com/maps/dataviz/style.json?key=${MAPTILER_KEY}` },
    { id: 'streets',   label: '⊞  Streets',    style: `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}` },
    { id: 'satellite', label: '⊙  Satellite',  style: `https://api.maptiler.com/maps/hybrid/style.json?key=${MAPTILER_KEY}` },
  ];
  const BASEMAP_STYLE = E2E_TEST_MODE
    ? Object.fromEntries(BASEMAPS.map(b => [b.id, BLANK_STYLE]))
    : Object.fromEntries(BASEMAPS.map(b => [b.id, b.style]));

  let map;
  let is3D = false;   // Conductor opens in 2D by default (agreed 15 Jul 2026)
  let showBuildings = true;
  let showRoads = true;
  let currentBasemap = 'dark';
  let basemapSwitching = false; // prevents double-clicks during style reload

  let stage = projectStore.stage;
  let autoArmedStage = null;   // last stage we auto-armed a tool for — see reactive block below
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

  // Continuous tool session (place/edit/delete/move) — see startToolSession()
  // in mapTools.js and docs/conductor-web-context.md (agreed 2 Jul 2026).
  // Non-null while a session is live; used to re-arm the underlying tool
  // after each single action instead of requiring the toolbar button to be
  // clicked again for every asset.
  let activeSession = null;
  let sessionHint = ''; // the "Click an asset to..." hint for the current select-based session — activeToolLabel gets blanked on each pick, so this is what re-arms restore it from

  // validateResults: populated by ValidateRoutesPanel on:results. Row
  // filtering/sorting/CSV moved into RoutesDrawer.svelte with the drawer.
  let validateResults = [];
  let selectedRoute = null;

  // Postcode/asset search + project-extent camera helpers live in
  // mapSearch.js (pure matching split from camera side effects so the
  // matching/bounds logic is unit-testable — see mapSearch.test.js). The
  // search box itself lives in TopBar.svelte; it dispatches the query.
  function onAssetSearch(query) { searchAndZoom(map, projectStore.state, query); }
  function fitToProject() { fitToProjectExtent(map, projectStore.state); }

  // Active project id for the TopBar's Open menu highlight — recomputed on
  // every store mutation (storeVersion bump) so it tracks project switches.
  $: activeProjectIdForMenu = (storeVersion, projectStore.activeId());

  function onDrawerRowClick(r) {
    selectedRoute = r.uprn;
    if (r.flyTo) {
      map.easeTo({ center: r.flyTo, zoom: Math.max(map.getZoom(), 17), duration: 600 });
    } else {
      const ap = (projectStore.state.addressPoints || []).find(a => String(a.properties?.uprn) === String(r.uprn));
      if (ap?.geometry?.coordinates) map.easeTo({ center: ap.geometry.coordinates, zoom: Math.max(map.getZoom(), 17), duration: 600 });
    }
  }

  // Map-layer (re)build lives in mapLayers.js — see setupMapLayers() there.
  // Called on first load AND after every basemap switch, with the current
  // toggle state passed explicitly.
  const layerOpts = () => ({ maptilerKey: MAPTILER_KEY, showBuildings, showRoads });

  onMount(() => {
    map = new maplibregl.Map({
      container: 'map',
      style: BASEMAP_STYLE[currentBasemap],
      center: [-3.77, 56.71],
      zoom: 15,
      pitch: 0,                      // 2D on open — matches is3D default above
      bearing: 0,
      preserveDrawingBuffer: true,   // required so the map canvas can be captured for export
    });
    // TEMP DIAGNOSTIC — exposes map to the console so we can inspect querySourceFeatures
    // directly without a re-deploy each time. Unconditional (not gated on DEV) so it
    // also works on the live Netlify build. REMOVE once the plant-gen issue is solved.
    window.map = map;
    // E2E test seams (guarded — only in VITE_TEST_MODE, never in a production
    // build). Let the branch-classification acceptance spec load a ready-made
    // design and open a right-panel deterministically, instead of driving the
    // map canvas and the radial tool wheel (both far too brittle headless).
    if (E2E_TEST_MODE) {
      window.__conductorSeed = (state) => { projectStore.restoreState(state); };
      window.__conductorOpenPanel = (mode) => { rpMode = mode; };
      window.__conductorStore = projectStore;
    }

    map.on('load', () => {
      setupMapLayers(map, layerOpts());
      // Enforce the current view's camera lock from the start (handler enable/disable
      // state lives on the Map instance and persists across basemap style reloads).
      applyCameraLock(is3D);
      if (projectStore.stage === 'import') rpMode = 'address-import';
      // FSAA: silently resume the last .conductor file if still permitted,
      // else surface a one-click Resume button (re-grant needs a user gesture).
      fsaaTryResume().then(r => {
        if (r.state === 'granted') {
          rpMode = projectStore.stage === 'import' ? 'address-import' : 'default';
          syncToMap(map);
          fitToProject();
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
      setupMapLayers(map, layerOpts());

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
      // Direct source write outside syncToMap -- drop the cache entry so the next
      // sync re-pushes from store state (restores a pre-existing build area that
      // this cancel visually cleared).
      invalidateSyncSource('build-area-src');
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

  // Auto-arm build area / cabinet placement the instant their stage begins,
  // instead of making the sidebar button the only way to start — the button
  // still works (e.g. to re-arm after an Escape bail-out), this just removes
  // it as a required first click. Guarded on autoArmedStage rather than a
  // bare `stage === '...'` check: projectStore.on() reassigns `stage` on
  // EVERY store mutation (not just real transitions), which would otherwise
  // re-fire this on each mutation and wipe an in-progress polygon via the
  // clearTool() inside onDrawBuildArea/onPlaceCabinet.
  $: if (map && stage !== autoArmedStage && (stage === 'build-area' || stage === 'cabinet')) {
    autoArmedStage = stage;
    if (stage === 'build-area') onDrawBuildArea();
    else onPlaceCabinet();
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
      toolLabel: 'CBT Tail — click CBT, tap poles to steer, click the joint to finish',
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

  // Re-arms a tool for the next placement (Point or, since 15 Jul 2026,
  // form-based LineString tools too — name kept for minimal diff, but this
  // is geometry-agnostic: it just calls cfg.activate() again). Shared by
  // onPlaceAsset's first activation and onAssetSaved's post-save re-arm so
  // both go through the exact same path.
  function armPointTool(cfg) {
    const err = cfg.activate(map, (pending) => {
      cfg.setPending(cfg.transform ? cfg.transform(pending) : pending);
      rpMode = cfg.rpMode;
      activeToolLabel = '';
    });
    if (err) {
      showToast(err.error);
      activeToolLabel = '';
      // Ran out of room to place another (e.g. no chamber numbers left in
      // this direction) — end the session gracefully rather than leaving a
      // dead RMB listener with nothing left to arm.
      if (activeSession) activeSession.end('save');
    }
  }

  // Called by mapTools.js once a continuous session has fully ended (RMB ->
  // Save/Cancel resolved, or an external tool switch implicitly ended it via
  // clearTool()'s own fallback). projectStore is already restored/kept and
  // the map tool already cleared by this point — just reset the UI side.
  function endSession(result) {
    activeSession = null;
    sessionHint = '';
    activeToolLabel = '';
    rpMode = 'default';
    Object.values(ASSET_CONFIG).forEach((cfg) => { if (cfg.geometryType === 'Point' || cfg.geometryType === 'LineString') cfg.setPending(null); });
    selectedAsset = null;
    syncToMap(map); // no-op unless Cancel just restored projectStore
  }

  function onPlaceAsset(key) {
    const cfg = ASSET_CONFIG[key];
    clearTool(map); // implicitly ends any dangling session as 'save' — see clearTool() in mapTools.js
    activeToolLabel = cfg.toolLabel;

    if (cfg.skipForm) {
      const err = cfg.activate(map, (feature) => {
        projectStore[cfg.addMethod](cfg.transform ? cfg.transform(feature) : feature);
        syncToMap(map);
      });
      if (err) { showToast(err.error); activeToolLabel = ''; }
      return;
    }

    if (cfg.geometryType === 'Point' || (cfg.geometryType === 'LineString' && !cfg.cleanupOnSave)) {
      // Continuous mode (agreed 2 Jul 2026 for Point tools; extended to
      // form-based line tools 15 Jul 2026 — duct/cable/crossings used to go
      // fully inert once their properties form popped, forcing a trip back
      // to the toolbar for every single line). Tool stays live across
      // repeated placements instead of auto-deactivating after one. RMB
      // opens a Save/Cancel confirmation rather than silently ending — see
      // startToolSession() in mapTools.js. cbtTail stays excluded: one tail
      // per CBT is deliberate, not a bug.
      const label = cfg.toolLabel.replace(/^Place /, '');
      const session = startToolSession(map, {
        onEnd: endSession,
        message: `End this ${label} session? Save keeps everything placed since you started; Cancel undoes it all.`,
      });
      activeSession = session;
      session.rearm(() => armPointTool(cfg));
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

    // Continuous mode: re-arm the same tool for the next placement instead
    // of going inert. cleanupOnSave tools (e.g. cbtTail) explicitly end on
    // save and are never wrapped in a session to begin with.
    if (activeSession && (cfg.geometryType === 'Point' || cfg.geometryType === 'LineString') && !cfg.cleanupOnSave) {
      activeToolLabel = cfg.toolLabel;
      activeSession.rearm(() => armPointTool(cfg));
    }
  }

  function onAssetCancelled(key) {
    const cfg = ASSET_CONFIG[key];
    rpMode = 'default';
    cfg.setPending(null);
    if (activeSession && (cfg.geometryType === 'Point' || cfg.geometryType === 'LineString')) {
      // Cancelling the in-progress form (this one asset was never saved)
      // stays inside the session — re-arm for the next placement rather
      // than ending the whole run. clearTool() isn't called here, since
      // that would trip clearTool()'s own "external switch ends session"
      // fallback; armPointTool() calls cfg.activate(), which calls
      // clearTool() at its own top, so the current one-shot listener still
      // gets cleaned up correctly on the way back in.
      activeSession.rearm(() => armPointTool(cfg));
    } else {
      clearTool(map);
    }
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

  let cbtTailHintShown = false;
  function onPlaceCBTTail() {
    if (!cbtTailHintShown) {
      cbtTailHintShown = true;
      showToast('Click the CBT, then the target joint — the poles between are routed automatically. Tap poles first to steer the route where the network branches.');
    }
    onPlaceAsset('cbtTail');
  }
  function onCBTTailSaved(e) { onAssetSaved('cbtTail', e); }
  function onCBTTailCancelled() { onAssetCancelled('cbtTail'); }

  // ── Asset Edit / Delete / Move ────────────────────────────────────────────

  function armSelectTool(hint) {
    if (hint) activeToolLabel = hint;
    activateSelectTool(map, handleSelectHits);
  }

  function handleSelectHits(hits) {
    if (!hits || !hits.length) return;
    activeToolLabel = ''; // clear the "click an asset..." hint once something is picked
    if (hits.length === 1) {
      selectAsset(hits[0]);
    } else {
      assetPickerHits = hits;
    }
  }

  function selectAsset(hit) {
    selectedAsset = hit;
    // rpMode deliberately NOT changed here any more (was 'asset-selected').
    // AssetEditPanel now renders in-place inside the default view's
    // asset-section instead of replacing the whole panel — see the rpMode
    // fallback branch below. Selecting an asset no longer hides Validation
    // Summary / Engineer Outputs.
  }

  function onAssetPickerChoose(e) {
    assetPickerHits = null;
    selectAsset(e.detail);
  }

  function onAssetPickerCancel() {
    assetPickerHits = null;
    rpMode = 'default';
    if (activeSession) {
      // Stay in the session — the user just didn't want any of the
      // overlapping hits, not "stop editing/deleting/moving altogether".
      activeSession.rearm(() => armSelectTool(sessionHint));
    } else {
      clearTool(map);
      activeToolLabel = '';
    }
  }

  // Shared by Edit/Delete/Move: all three start from the exact same
  // click-an-asset flow (see handleSelectHits above) and only diverge once
  // something is selected and the asset panel is open. One continuous
  // session covers all three uniformly — see docs/conductor-web-context.md
  // (agreed 2 Jul 2026).
  function startAssetSelectSession(hint) {
    clearTool(map); // implicitly ends any dangling session as 'save' — see clearTool() in mapTools.js
    // Explicit reset needed here now: selecting an asset no longer forces
    // rpMode to a dedicated mode (see selectAsset() above), so if some other
    // report panel was showing (BoM, SLD, ...) it would otherwise stay shown
    // instead of the asset-section where AssetEditPanel actually lives.
    rpMode = 'default';
    sessionHint = hint;
    const session = startToolSession(map, {
      onEnd: endSession,
      message: 'End this session? Save keeps everything edited, deleted or moved since you started; Cancel undoes it all.',
    });
    activeSession = session;
    session.rearm(() => armSelectTool(hint));
  }

  function onEditAsset() {
    if (stage !== 'design') return;
    startAssetSelectSession('Click an asset to select it');
  }

  function onDeleteAsset() {
    if (stage !== 'design') return;
    startAssetSelectSession('Click an asset to delete it');
  }

  function onMoveAsset() {
    if (stage !== 'design') return;
    startAssetSelectSession('Click an asset to move it');
  }

  function onAssetPanelSaved(e) {
    const { collection, index, props } = e.detail;
    projectStore.updateAsset(collection, index, props);
    syncToMap(map);
    const arr = projectStore.state[collection];
    if (arr && arr[index]) {
      selectedAsset = { ...selectedAsset, feature: arr[index] };
    }
    // No re-arm needed here: activateSelectTool()'s click listener already
    // stays live across clicks on its own (unlike the placement tools), so
    // it's still listening for the next asset without anything further.
  }

  // Friendly labels for the cascade-delete summary toast (see
  // cascadeDelete.js). Falls back to the raw collection key for anything
  // not listed, so a new collection added later still shows *something*
  // rather than being silently dropped from the message.
  const CASCADE_LABELS = {
    cables: 'cable', spans: 'aerial span', bundles: 'bundle',
    aerialDrops: 'aerial drop', cbtTails: 'CBT tail',
    fibreAssignments: 'fibre assignment', joints: 'joint',
  };
  function describeCascadeSummary(summary) {
    if (!summary) return '';
    const parts = [];
    for (const [coll, n] of Object.entries(summary.removed || {})) {
      if (n > 0) parts.push(`${n} ${CASCADE_LABELS[coll] || coll}${n === 1 ? '' : 's'} removed`);
    }
    for (const [coll, n] of Object.entries(summary.nulled || {})) {
      if (n > 0) parts.push(`${n} ${CASCADE_LABELS[coll] || coll}${n === 1 ? '' : 's'} unlinked`);
    }
    if (!parts.length) return '';
    return `Also cleaned up: ${parts.join(', ')}.`;
  }

  function onAssetPanelDeleted(e) {
    const { collection, index } = e.detail;
    const summary = projectStore.deleteAsset(collection, index);
    syncToMap(map);
    selectedAsset = null;
    rpMode = 'default';
    const note = describeCascadeSummary(summary);
    if (note) showToast(note);
    if (activeSession) {
      // Continuous mode: stay live for the next asset to delete instead of
      // going inert and requiring the toolbar button again.
      activeSession.rearm(() => armSelectTool(sessionHint));
    } else {
      clearTool(map);
      activeToolLabel = '';
    }
  }

  function onAssetPanelMove(e) {
    const { collection, index, feature } = e.detail;
    activeToolLabel = `Move ${selectedAsset.assetId} — click new location (Esc to cancel)`;
    rpMode = 'default';
    const doMove = () => activateMovePointTool(map, { collection, index }, ({ lng, lat }) => {
      projectStore.updateAssetGeometry(collection, index, [lng, lat]);
      syncToMap(map);
      const arr = projectStore.state[collection];
      if (arr && arr[index]) {
        selectedAsset = { ...selectedAsset, feature: arr[index] };
      }
      activeToolLabel = '';
      // Continuous mode: re-arm select so the next click can pick a
      // different asset to move — activateMovePointTool() is a one-shot
      // tool in its own right, so without this the map would otherwise go
      // inert after this single move.
      if (activeSession) activeSession.rearm(() => armSelectTool(sessionHint));
    });
    // activateMovePointTool() calls clearTool() at its own top like every
    // other activate*Tool(), so starting it needs the same rearm() guard as
    // re-arming after a save/delete, or it would trip clearTool()'s
    // "external switch ends the session" fallback and end the session
    // right as Move begins.
    if (activeSession) activeSession.rearm(doMove); else doMove();
  }

  function onAssetPanelClose() {
    selectedAsset = null;
    rpMode = 'default';
    if (activeSession) {
      // Closing the panel just deselects — it's not "stop editing/deleting/
      // moving altogether", so stay in the session.
      activeSession.rearm(() => armSelectTool(sessionHint));
    } else {
      clearTool(map);
      activeToolLabel = '';
    }
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

  // ── branch classification (release-audit §3 / paid-beta gate) ───────────────
  // Opens the resolution list where a user classifies every inferred
  // PASS_THROUGH vs SPLITTER_OUTPUT branch, then re-runs planning — all in-app.
  function onBranchClassify() {
    if (stage !== 'design') return;
    clearTool(map);
    activeToolLabel = '';
    rpMode = 'branch-classify';
  }
  // A single-branch resolve wrote feed_mode to the store (storeVersion already
  // bumped) — just reflect the change on the map.
  function onBranchClassifyChanged() {
    syncToMap(map);
  }
  // Re-run the demand-driven planner over the freshly classified network. Same
  // path as Auto-Assign: assignFibres → applyFibreAssignment stamps the plan
  // status + input fingerprint, so physicalPlanReady() opens the export gate the
  // moment the plan validates, and closes it again on any later edit.
  function onBranchReplan() {
    const result = assignFibres(projectStore.state);
    if (!result.ok) { showToast(result.reason); return; }
    projectStore.applyFibreAssignment(result);
    syncToMap(map);
    fibreAssignResult = result;
    if (result.physicalPlanStatus === 'VALIDATED') showToast('Physical plan validated — splice export available.');
    else showToast('Physical plan: ' + (result.physicalPlanStatus || 'not validated') + '. Resolve remaining branches, then re-run.');
  }
  function onBranchClassifyClose() {
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
    if (toolId === 'branch-classify')     onBranchClassify();
  }

  // ✕ on the active-tool chip — full tool teardown. Extracted from the chip's
  // inline handler when ActiveToolChip became its own component.
  function onToolChipCancel() {
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
  }

  // Lock/unlock the camera's pitch + bearing interaction. In 2D we disable the
  // rotate/pitch drag handlers (right-drag, ctrl-drag), two-finger touch pitch,
  // and the keyboard rotate/pitch keys — so the user can still pan and scroll-zoom,
  // but cannot tilt or spin the camera off flat until they click 3D. scrollZoom,
  // dragPan and touchZoom are untouched, so zoom in/out keeps working.
  function applyCameraLock(threeD) {
    if (!map) return;
    if (threeD) {
      map.dragRotate.enable();
      map.touchPitch.enable();
      map.keyboard.enableRotation();
    } else {
      map.dragRotate.disable();
      map.touchPitch.disable();
      map.keyboard.disableRotation();
    }
  }

  function setView(threeD) {
    is3D = threeD;
    if (!map) return;
    applyCameraLock(threeD);
    map.easeTo({ pitch: threeD ? 60 : 0, bearing: threeD ? -30 : 0, duration: 1200 });
  }

  function toggleBuildings() {
    showBuildings = !showBuildings;
    if (map && map.getLayer('buildings-3d')) {
      map.setLayoutProperty('buildings-3d', 'visibility', showBuildings ? 'visible' : 'none');
    }
  }

  function toggleRoads() {
    showRoads = !showRoads;
    if (!map) return;
    const vis = showRoads ? 'visible' : 'none';
    // The neon effect is two stacked layers: the wide blurred glow + the sharp
    // bright line. Toggle both together.
    if (map.getLayer('roads-glow')) map.setLayoutProperty('roads-glow', 'visibility', vis);
    if (map.getLayer('roads-neon')) map.setLayoutProperty('roads-neon', 'visibility', vis);
  }

  // ── File System Access (durable .conductor file) ──────────────────────────
  let fsaa = { status: 'no-file', lastSaved: null, fileName: null, supported: false };
  let fsaaResume = null;   // { fileName } when a saved file is waiting for a resume click
  fsaaOnStatus(s => { fsaa = s; });

  async function onSaveToFile() {
    try { await fsaaSaveAs(); }
    catch (e) { showError('Could not save file: ' + (e?.message || e)); }
  }
  async function onOpenFile() {
    try {
      if (await fsaaOpenFile()) {
        rpMode = 'default'; activeToolLabel = '';
        if (map) { syncToMap(map); fitToProject(); }
      }
    } catch (e) { showError('Could not open file: ' + (e?.message || e)); }
  }
  async function onResumeFile() {
    if (await fsaaResumePrompt()) {
      fsaaResume = null;
      rpMode = 'default'; activeToolLabel = '';
      if (map) { syncToMap(map); fitToProject(); }
    }
  }
  function onKeydown(e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      if (fsaa.supported && fsaa.fileName) { e.preventDefault(); fsaaSaveNow(); }
    }
  }

  // ── Map sheet export (PNG/SVG) — 2D only ──────────────────────────────────
  // The export dropdown itself lives in TopBar.svelte; it closes itself and
  // dispatches the chosen format here.
  let exporting = false;
  async function doExport(format) {
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

  // CAD sheet (beta): vector technical HLD plot. Additive — reuses the same 2D
  // guard and dropdown as the map export but calls the standalone cadExport.js.
  async function doCadExport(format) {
    if (is3D) { showToast('Switch to 2D view before exporting the CAD sheet.'); return; }
    if (!map) return;
    exporting = true;
    try {
      await exportCadSheet(map, projectStore.state, { format, company: 'GIGALOCH' });
    } catch (e) {
      showError('CAD export failed: ' + String(e?.message || e));
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

  function newProject() {
    if (!confirm('Start a new project? Your current project stays saved and can be re-opened.')) return;
    projectStore.newProject();
    rpMode = 'default';
    activeToolLabel = '';
    if (map) syncToMap(map);
  }

  function openProject(id) {
    const result = projectStore.openProject(id);

    if (result.ok) {
      rpMode = 'default';
      activeToolLabel = '';
      if (map) { syncToMap(map); fitToProject(); }
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
          if (map) { syncToMap(map); fitToProject(); }
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

<svelte:window on:keydown={onKeydown} />

<div class="screen">

  {#if showSaveNudge}
    <SaveNudge on:save={onNudgeSave} on:dismiss={dismissNudge} />
  {/if}

  {#if stage === 'setup'}
    <ProjectSetup on:create={onProjectCreated} />
  {/if}

  <TopBar
    {project}
    {cheapStats}
    {routeStats}
    {statsStale}
    {stage}
    {is3D}
    {exporting}
    {fsaa}
    {fsaaResume}
    activeProjectId={activeProjectIdForMenu}
    on:validateRoutes={onValidateRoutes}
    on:designHealth={onDesignHealth}
    on:splicePlan={onSplicePlan}
    on:sld={onSld}
    on:bom={onBom}
    on:search={(e) => onAssetSearch(e.detail)}
    on:setView={(e) => setView(e.detail)}
    on:resumeFile={onResumeFile}
    on:saveFile={onSaveToFile}
    on:openFile={onOpenFile}
    on:export={(e) => doExport(e.detail)}
    on:cadExport={(e) => doCadExport(e.detail)}
    on:newProject={newProject}
    on:openProject={(e) => openProject(e.detail)}
    on:deleteProject={(e) => onDeleteProject(e.detail.id, e.detail.name)}
  />

  <div class="body">

    <Sidebar
      {stage}
      {activeCat}
      {showBuildings}
      {showRoads}
      basemaps={BASEMAPS}
      {currentBasemap}
      {basemapSwitching}
      on:importAddresses={() => rpMode = 'address-import'}
      on:drawBuildArea={onDrawBuildArea}
      on:placeCabinet={onPlaceCabinet}
      on:selectCat={(e) => activeCat = e.detail}
      on:editAsset={onEditAsset}
      on:deleteAsset={onDeleteAsset}
      on:moveAsset={onMoveAsset}
      on:toggleBuildings={toggleBuildings}
      on:toggleRoads={toggleRoads}
      on:changeBasemap={(e) => changeBasemap(e.detail)}
    />

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
        <ActiveToolChip label={activeToolLabel} toolId={activeToolId} on:cancel={onToolChipCancel} />
      {/if}

      <RoutesDrawer
        results={validateResults}
        {selectedRoute}
        on:rowClick={(e) => onDrawerRowClick(e.detail)}
      />
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

      {:else if rpMode === 'fibre-trace'}
        <FibreTracePanel result={fibreTraceResult} canExportSplice={(storeVersion, physicalPlanReady(projectStore.state))} on:close={onFibreTraceClose} on:downloadRouteSplice={onDownloadRouteSplice} />

      {:else if rpMode === 'fibre-assign'}
        <FibreAssignPanel result={fibreAssignResult} on:close={onFibreAssignClose} />

      {:else if rpMode === 'branch-classify'}
        <BranchClassificationPanel
          storeVersion={storeVersion}
          planStatus={(storeVersion, projectStore.physicalPlanStatus)}
          on:changed={onBranchClassifyChanged}
          on:replan={onBranchReplan}
          on:close={onBranchClassifyClose} />

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
        <DesignHealthPanel autoRun={true} on:close={onDesignHealthClose} on:repaired={() => syncToMap(map)} />

      {:else if rpMode === 'cabinet-cost'}
        <CabinetCostPanel on:close={onCabinetCostClose} />

      {:else}
        <ValidationSummaryPanel
          {stage}
          {routeStats}
          {statsStale}
          {cheapStats}
          {selectedAsset}
          on:designHealth={onDesignHealth}
          on:validateRoutes={onValidateRoutes}
          on:splicePlan={onSplicePlan}
          on:sld={onSld}
          on:bom={onBom}
          on:cabinetCost={onCabinetCost}
          on:saved={onAssetPanelSaved}
          on:deleted={onAssetPanelDeleted}
          on:move={onAssetPanelMove}
          on:close={onAssetPanelClose}
        />
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

  /* ── FSAA file controls ── */

  /* ── Body ── */
  .body { display: flex; flex: 1; overflow: hidden; }


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
  @keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: .3 } }


  /* ── Right panel ── */
  .rpanel { width: 300px; background: #0d1520; border-left: 1px solid #1a2d40; display: flex; flex-direction: column; flex-shrink: 0; overflow: hidden; z-index: 10; }







  /* ── Fibre-assign result panel ── */
  /* ── Topbar account avatar ── */

</style>
