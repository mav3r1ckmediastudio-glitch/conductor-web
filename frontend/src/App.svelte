<script>
  import { onMount } from 'svelte';
  import maplibregl from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';

  let map;
  let is3D = false;

  onMount(() => {
    map = new maplibregl.Map({
      container: 'map',
      style: 'https://api.maptiler.com/maps/dataviz-dark/style.json?key=7DkZfFXHsvdG3ZMivAV6',
      center: [-3.77, 56.71],
      zoom: 14,
      pitch: 0,
      bearing: 0
    });

    map.on('load', () => {
      map.addSource('terrain', {
        type: 'raster-dem',
        url: 'https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=7DkZfFXHsvdG3ZMivAV6',
        tileSize: 256
      });

      map.setTerrain({
        source: 'terrain',
        exaggeration: 1.5
      });

      map.addLayer({
        id: 'sky',
        type: 'sky',
        paint: {
          'sky-type': 'atmosphere',
          'sky-atmosphere-sun': [0.0, 90.0],
          'sky-atmosphere-sun-intensity': 15
        }
      });
    });
  });

  function toggleView() {
    if (!map) return;
    is3D = !is3D;
    map.easeTo({
      pitch: is3D ? 60 : 0,
      bearing: is3D ? -30 : 0,
      duration: 1200
    });
  }
</script>

<div id="app">
  <nav id="topbar">
    <span class="logo">CONDUCTOR</span>
    <span class="project">No project loaded</span>
    <button class="view-toggle" on:click={toggleView}>
      {is3D ? '2D' : '3D'}
    </button>
    <span class="status-dot"></span>
  </nav>

  <div id="layout">
    <aside id="left-panel">
      <div class="panel-section">Tools</div>
    </aside>

    <div id="map"></div>

    <aside id="right-panel">
      <div class="panel-section">Design Data</div>
    </aside>
  </div>
</div>

<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  #app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    background: #000;
    color: #fff;
    font-family: 'Inter', monospace;
  }

  #topbar {
    height: 48px;
    background: #0a0a0a;
    border-bottom: 1px solid #1a1a1a;
    display: flex;
    align-items: center;
    padding: 0 20px;
    gap: 20px;
    z-index: 100;
  }

  .logo {
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 4px;
    color: #00ffcc;
  }

  .project {
    font-size: 12px;
    color: #444;
    letter-spacing: 1px;
  }

  .view-toggle {
    margin-left: auto;
    background: transparent;
    border: 1px solid #00ffcc;
    color: #00ffcc;
    font-size: 11px;
    letter-spacing: 2px;
    padding: 4px 14px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .view-toggle:hover {
    background: #00ffcc;
    color: #000;
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #00ffcc;
    box-shadow: 0 0 6px #00ffcc;
  }

  #layout {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  #left-panel {
    width: 200px;
    background: #0a0a0a;
    border-right: 1px solid #1a1a1a;
    z-index: 10;
    flex-shrink: 0;
  }

  #right-panel {
    width: 260px;
    background: #0a0a0a;
    border-left: 1px solid #1a1a1a;
    z-index: 10;
    flex-shrink: 0;
  }

  .panel-section {
    padding: 16px;
    font-size: 11px;
    letter-spacing: 2px;
    color: #333;
    text-transform: uppercase;
    border-bottom: 1px solid #1a1a1a;
  }

  #map {
    flex: 1;
  }
</style>