// mapLayers.js — basemap-independent custom layer setup for the main map.
//
// Extracted from App.svelte (16 Jul 2026 refactor) verbatim except for the
// three pieces of component state it used to close over (MAPTILER_KEY,
// showBuildings, showRoads), which are now explicit options. App.svelte owns
// the map instance and WHEN this runs (first load + after every basemap
// switch); this module owns WHAT gets (re)built on it. Pulled out so the
// layer inventory can be understood and reviewed without paging through a
// 2,300-line component.
//
// Defensive throughout — every addLayer/addSource is guarded so re-calling
// on an already-set-up map is a no-op. That property is load-bearing:
// changeBasemap() re-runs this after setStyle() wipes everything, and the
// first 'load' event may race a fast style switch.

import { ensureSources, ensureTerrainLayers, syncToMap } from './mapTools.js';

/**
 * (Re)build every custom source/layer on the map: GeoJSON sources, terrain
 * DEM, terrain-dependent line layers, the 3D pole CustomLayerInterface,
 * decorative building/road overlays, visibility state, and stored data.
 *
 * @param map        maplibregl.Map
 * @param options.maptilerKey   API key for the terrain DEM tile URL.
 * @param options.showBuildings current buildings-toggle state to restore.
 * @param options.showRoads     current roads-toggle state to restore.
 */
export function setupMapLayers(map, { maptilerKey, showBuildings, showRoads }) {
  // 1. GeoJSON sources + non-terrain symbol layers (chambers, joints, labels etc.)
  ensureSources(map);

  // 2. Terrain DEM source + elevation. Guarded on the key actually being
  // set: without one, this URL is a guaranteed-401 tile request that leaves
  // the map permanently "loading" (map.loaded() never true) and spams the
  // console — the situation in E2E test mode (VITE_TEST_MODE=1 runs with no
  // key on purpose), and also what a misconfigured production deploy with a
  // missing VITE_MAPTILER_KEY used to do. Everything else in this function
  // is local GeoJSON and works fine without terrain.
  if (maptilerKey) {
    if (!map.getSource('terrain')) {
      map.addSource('terrain', {
        type: 'raster-dem',
        url: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${maptilerKey}`,
        tileSize: 256,
      });
    }
    map.setTerrain({ source: 'terrain', exaggeration: 1.5 });
  }

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

  // 5. Restore building + road visibility from current toggle state
  if (map.getLayer('buildings-3d')) {
    map.setLayoutProperty('buildings-3d', 'visibility', showBuildings ? 'visible' : 'none');
  }
  const roadVis = showRoads ? 'visible' : 'none';
  if (map.getLayer('roads-glow')) map.setLayoutProperty('roads-glow', 'visibility', roadVis);
  if (map.getLayer('roads-neon')) map.setLayoutProperty('roads-neon', 'visibility', roadVis);

  // 6. Push all stored GeoJSON data into sources
  syncToMap(map);
}
