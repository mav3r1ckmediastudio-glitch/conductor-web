// mapTools.js — Map interaction layer for Conductor Web
// Works with projectStore.js for state. All geometry WGS84.
//
// This file was decomposed (16 Jul 2026) from a single 3,292-line module into
// focused modules (mapGeom / mapIds / mapSources / toolSession / mapPick /
// mapDrawTools / fibreOverlays). It now stands as the stable public facade:
// every symbol the rest of the app imported from mapTools.js is re-exported
// here unchanged, so App.svelte, mapLayers.js and mapSearch.js need no edits.

export {
  ensureSources,
  ensureTerrainLayers,
  getPoleLayer,
  invalidateSyncSource,
  stopCablePulse,
  syncToMap,
} from './mapSources.js';
export {
  clearSearchMarker,
  clearTool,
  hasActiveSession,
  setSearchMarker,
  startToolSession,
} from './toolSession.js';
export {
  activateMovePointTool,
  activateSelectTool,
  pickAllAssets,
  pickAsset,
  snapToNode,
} from './mapPick.js';
export {
  activateAerialDropTool,
  activateAerialSpanTool,
  activateBuildAreaTool,
  activateBundleTool,
  activateCBTTailTool,
  activateCBTTool,
  activateCabinetTool,
  activateCableTool,
  activateChamberTool,
  activateDropDuctTool,
  activateDuctTool,
  activateJointTool,
  activatePoleTool,
  applyCookieCutter,
} from './mapDrawTools.js';
export {
  activateFibreCountTool,
  activateFibreTraceTool,
  clearCountHighlight,
  clearTraceHighlight,
  ensureTraceLayers,
} from './fibreOverlays.js';
export {
  compassLeg,
} from './mapGeom.js';
