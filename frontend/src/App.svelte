<script>
  import { onMount } from 'svelte';
  import maplibregl from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import MetricCard from './MetricCard.svelte';
  import ToolGroup from './ToolGroup.svelte';

  let map;
  let is3D = false;
  let bottomOpen = true;

  onMount(() => {
    map = new maplibregl.Map({
      container: 'map',
      style: 'https://api.maptiler.com/maps/dataviz-dark/style.json?key=7DkZfFXHsvdG3ZMivAV6',
      center: [-3.77, 56.71],
      zoom: 15,
      pitch: 0,
      bearing: 0
    });

    map.on('load', () => {
      map.addSource('terrain', {
        type: 'raster-dem',
        url: 'https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=7DkZfFXHsvdG3ZMivAV6',
        tileSize: 256
      });

      map.setTerrain({ source: 'terrain', exaggeration: 1.5 });

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
          'fill-extrusion-opacity': 0.3
        }
      });

      map.addLayer({
        id: 'roads-glow',
        source: 'maptiler_planet',
        'source-layer': 'transportation',
        type: 'line',
        filter: ['in', 'class', 'motorway', 'primary', 'secondary', 'tertiary', 'residential'],
        paint: {
          'line-color': '#00aaff',
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            12, 6,
            16, 16
          ],
          'line-blur': 10,
          'line-opacity': 0.6
        }
      });

      map.addLayer({
        id: 'roads-neon',
        source: 'maptiler_planet',
        'source-layer': 'transportation',
        type: 'line',
        filter: ['in', 'class', 'motorway', 'primary', 'secondary', 'tertiary', 'residential'],
        paint: {
          'line-color': '#00ccff',
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            12, 1,
            16, 2
          ],
          'line-opacity': 0.9
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
    <div class="top-left">
      <span class="logo">CONDUCTOR</span>
      <span class="mode">FTTP Design</span>
    </div>
    <div class="top-center">
      <input class="search" type="text" placeholder="Zoom to postcode or asset..." />
      <button class="search-btn">Go</button>
    </div>
    <div class="top-right">
      <button class="view-toggle" on:click={toggleView}>{is3D ? '2D' : '3D'}</button>
      <span class="status-dot"></span>
    </div>
  </nav>

  <div id="main">

    <aside id="left-panel">
      <div class="project-header">
        <span class="project-name">TARVIN VILLAGE 002</span>
        <span class="project-code">ENG-CH3</span>
      </div>

      <div class="metrics-grid">
        <MetricCard label="Premises" value="1189" />
        <MetricCard label="Routed" value="31" color="#00ffcc" />
        <MetricCard label="Partial" value="0" color="#f59e0b" />
        <MetricCard label="Unserved" value="1158" color="#ef4444" />
      </div>

      <div class="metrics-row">
        <div class="metric-inline">
          <span class="mi-value">1.6 km</span>
          <span class="mi-label">Fibre</span>
        </div>
        <div class="metric-inline">
          <span class="mi-value">1.5 km</span>
          <span class="mi-label">Duct</span>
        </div>
        <div class="metric-inline">
          <span class="mi-value">£22,827</span>
          <span class="mi-label">Est. Materials</span>
        </div>
      </div>

      <div class="tab-row">
        <button class="tab active">Design</button>
        <button class="tab">PIA</button>
      </div>

      <div class="tool-groups">
        <ToolGroup label="Design" count={3} tools={[
          { icon: '⟋', label: 'Route', sub: 'Create and edit network routes' },
          { icon: '◼', label: 'Place Cabinet / POP' },
          { icon: '⬡', label: 'Place Chamber' },
          { icon: '—', label: 'Place Duct' },
          { icon: '⬚', label: 'Build Areas' },
        ]} />
        <ToolGroup label="Civil" count={6} tools={[
          { icon: '✎', label: 'Edit Cabinet / POP' },
          { icon: '⬡', label: 'Place Chamber' },
          { icon: '—', label: 'Place Duct' },
        ]} />
        <ToolGroup label="Workflow" tools={[
          { icon: '✓', label: 'Validate Design' },
          { icon: '⚙', label: 'Run Design Checks' },
          { icon: '↓', label: 'Export Outputs' },
        ]} />
      </div>
    </aside>

    <div id="center">
      <div id="map"></div>

      {#if bottomOpen}
      <div id="bottom-panel">
        <div class="bottom-header">
          <span class="bottom-title">ROUTES <span class="count">12</span></span>
          <div class="bottom-controls">
            <select class="route-filter"><option>All Routes</option></select>
            <input class="route-search" type="text" placeholder="Search routes..." />
            <button class="icon-btn">↓CSV</button>
            <button class="icon-btn" on:click={() => bottomOpen = false}>✕</button>
          </div>
        </div>
        <table class="routes-table">
          <thead>
            <tr>
              <th>Route ID</th><th>Status</th><th>From</th><th>To</th>
              <th>Length</th><th>Assets</th><th>Fibres</th>
              <th>Capacity</th><th>Updated</th><th>Engineer</th>
            </tr>
          </thead>
          <tbody>
            <tr class="routed">
              <td>ENG-CH3-...</td>
              <td><span class="status routed">Routed</span></td>
              <td>ENG-CH3-...</td><td>ENG-CH3-...</td>
              <td>0.20 km</td><td>—</td><td>1</td><td>100%</td><td>—</td><td>—</td>
            </tr>
            <tr>
              <td>ENG-CH3-...</td>
              <td><span class="status unserved">Unserved</span></td>
              <td>ENG-CH3-...</td><td>ENG-CH3-...</td>
              <td>73 m</td><td>—</td><td>—</td><td>0%</td><td>—</td><td>—</td>
            </tr>
            <tr>
              <td>ENG-CH3-...</td>
              <td><span class="status unserved">Unserved</span></td>
              <td>ENG-CH3-...</td><td>ENG-CH3-...</td>
              <td>57 m</td><td>—</td><td>—</td><td>0%</td><td>—</td><td>—</td>
            </tr>
          </tbody>
        </table>
      </div>
      {/if}
    </div>

    <aside id="right-panel">
      <div class="section-header">
        VALIDATION SUMMARY
        <button class="health-btn">✓ Health</button>
      </div>

      <div class="validation-cards">
        <div class="val-card critical"><span class="val-num">0</span><span class="val-label">Critical</span></div>
        <div class="val-card error"><span class="val-num">0</span><span class="val-label">Errors</span></div>
        <div class="val-card warning"><span class="val-num">0</span><span class="val-label">Warnings</span></div>
        <div class="val-card info"><span class="val-num">1158</span><span class="val-label">Total</span></div>
      </div>

      <div class="integrity-row">
        <span>Network Integrity</span>
        <span class="integrity-pct">3%</span>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:3%"></div></div>

      <div class="section-header">ISSUES</div>
      <div class="issues-grid">
        <div class="issue-card routed-card"><span class="issue-num">31</span><span class="issue-label">Routed</span></div>
        <div class="issue-card partial-card"><span class="issue-num">0</span><span class="issue-label">Partial</span></div>
        <div class="issue-card unserved-card"><span class="issue-num">1158</span><span class="issue-label">Unserved</span></div>
        <div class="issue-card total-card"><span class="issue-num">1189</span><span class="issue-label">Total</span></div>
      </div>

      <div class="section-header">ENGINEER OUTPUTS</div>
      <div class="output-list">
        <div class="output-row">Splice Plan Export <span class="chevron">›</span></div>
        <div class="output-row">Route Splice Export <span class="chevron">›</span></div>
        <div class="output-row">Single Line Diagram <span class="chevron">›</span></div>
        <div class="output-row">Bill of Materials <span class="chevron">›</span></div>
      </div>

      <div class="section-header">SELECTED ASSET</div>
      <div class="asset-inspector">
        <div class="asset-type">JOINT / CLOSURE</div>
        <div class="asset-id">ENG-CH3-JNT-004</div>
        <div class="asset-fields">
          <div class="field-row"><span class="field-key">ID</span><span class="field-val">ENG-CH3-JNT-004</span></div>
          <div class="field-row"><span class="field-key">Type</span><span class="field-val">SPLICE</span></div>
          <div class="field-row"><span class="field-key">Closure</span><span class="field-val">Prysmian CMJ</span></div>
          <div class="field-row"><span class="field-key">Has Splitter</span><span class="field-val">True</span></div>
          <div class="field-row"><span class="field-key">Split Ratio</span><span class="field-val">1:8</span></div>
        </div>
      </div>
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
    background: #0d1117;
    color: #e0e0e0;
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 12px;
  }

  #topbar {
    height: 44px;
    background: #0f1923;
    border-bottom: 1px solid #1e2d3d;
    display: flex;
    align-items: center;
    padding: 0 16px;
    gap: 16px;
    z-index: 100;
    flex-shrink: 0;
  }

  .top-left { display: flex; align-items: center; gap: 10px; }
  .top-center { display: flex; align-items: center; gap: 6px; flex: 1; max-width: 400px; margin: 0 auto; }
  .top-right { display: flex; align-items: center; gap: 10px; margin-left: auto; }

  .logo { font-size: 14px; font-weight: 800; letter-spacing: 3px; color: #00ffcc; }
  .mode { font-size: 10px; color: #5a7a8a; letter-spacing: 1px; text-transform: uppercase; }

  .search {
    flex: 1;
    background: #0d1117;
    border: 1px solid #1e2d3d;
    color: #e0e0e0;
    padding: 5px 10px;
    font-size: 11px;
    outline: none;
    border-radius: 3px;
  }

  .search-btn {
    background: #00ffcc;
    border: none;
    color: #0d1117;
    padding: 5px 12px;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    border-radius: 3px;
  }

  .view-toggle {
    background: transparent;
    border: 1px solid #1e2d3d;
    color: #00ffcc;
    font-size: 10px;
    letter-spacing: 2px;
    padding: 3px 10px;
    cursor: pointer;
    border-radius: 3px;
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #00ffcc;
    box-shadow: 0 0 6px #00ffcc;
  }

  #main { display: flex; flex: 1; overflow: hidden; }

  #left-panel {
    width: 220px;
    background: #0f1923;
    border-right: 1px solid #1e2d3d;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    flex-shrink: 0;
  }

  .project-header { padding: 10px 12px; border-bottom: 1px solid #1e2d3d; }

  .project-name {
    display: block;
    font-size: 11px;
    font-weight: 700;
    color: #00ffcc;
    letter-spacing: 1px;
  }

  .project-code { font-size: 10px; color: #5a7a8a; }

  .metrics-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px;
    background: #1e2d3d;
    border-bottom: 1px solid #1e2d3d;
  }

  .metrics-row { display: flex; border-bottom: 1px solid #1e2d3d; }

  .metric-inline {
    flex: 1;
    padding: 8px 10px;
    border-right: 1px solid #1e2d3d;
    display: flex;
    flex-direction: column;
  }

  .metric-inline:last-child { border-right: none; }
  .mi-value { font-size: 11px; font-weight: 700; color: #e0e0e0; }
  .mi-label { font-size: 9px; color: #5a7a8a; text-transform: uppercase; letter-spacing: 0.5px; }

  .tab-row { display: flex; border-bottom: 1px solid #1e2d3d; }

  .tab {
    flex: 1;
    padding: 8px;
    background: transparent;
    border: none;
    color: #5a7a8a;
    font-size: 11px;
    letter-spacing: 1px;
    cursor: pointer;
    text-transform: uppercase;
    border-bottom: 2px solid transparent;
  }

  .tab.active { color: #00ffcc; border-bottom-color: #00ffcc; }
  .tool-groups { flex: 1; overflow-y: auto; }

  #center { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  #map { flex: 1; }

  #bottom-panel {
    height: 200px;
    background: #0f1923;
    border-top: 1px solid #1e2d3d;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }

  .bottom-header {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    border-bottom: 1px solid #1e2d3d;
    gap: 10px;
    flex-shrink: 0;
  }

  .bottom-title { font-size: 11px; letter-spacing: 2px; color: #5a7a8a; text-transform: uppercase; }

  .count {
    background: #1e2d3d;
    color: #00ffcc;
    padding: 1px 6px;
    border-radius: 10px;
    font-size: 10px;
    margin-left: 6px;
  }

  .bottom-controls { display: flex; align-items: center; gap: 6px; margin-left: auto; }

  .route-filter, .route-search {
    background: #0d1117;
    border: 1px solid #1e2d3d;
    color: #e0e0e0;
    padding: 3px 8px;
    font-size: 11px;
    outline: none;
    border-radius: 3px;
  }

  .icon-btn {
    background: #1e2d3d;
    border: none;
    color: #5a7a8a;
    padding: 3px 8px;
    font-size: 10px;
    cursor: pointer;
    border-radius: 3px;
  }

  .routes-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
    display: block;
    overflow-y: auto;
    flex: 1;
  }

  .routes-table thead { display: table; width: 100%; table-layout: fixed; }
  .routes-table tbody { display: table; width: 100%; table-layout: fixed; }

  .routes-table th {
    padding: 6px 10px;
    text-align: left;
    color: #5a7a8a;
    font-weight: 600;
    letter-spacing: 0.5px;
    border-bottom: 1px solid #1e2d3d;
    background: #0d1117;
  }

  .routes-table td {
    padding: 6px 10px;
    border-bottom: 1px solid #1a2535;
    color: #c0c0c0;
  }

  .routes-table tr.routed td { background: rgba(0,255,204,0.04); }

  .status { padding: 2px 8px; border-radius: 3px; font-size: 10px; font-weight: 600; }
  .status.routed { background: rgba(0,255,204,0.15); color: #00ffcc; }
  .status.unserved { background: rgba(239,68,68,0.15); color: #ef4444; }

  #right-panel {
    width: 300px;
    background: #0f1923;
    border-left: 1px solid #1e2d3d;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    flex-shrink: 0;
  }

  .section-header {
    padding: 8px 12px;
    font-size: 10px;
    letter-spacing: 2px;
    color: #5a7a8a;
    text-transform: uppercase;
    border-bottom: 1px solid #1e2d3d;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .health-btn {
    background: #00ffcc;
    border: none;
    color: #0d1117;
    font-size: 9px;
    font-weight: 700;
    padding: 2px 8px;
    cursor: pointer;
    border-radius: 3px;
    letter-spacing: 1px;
  }

  .validation-cards {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 1fr;
    gap: 1px;
    background: #1e2d3d;
    border-bottom: 1px solid #1e2d3d;
  }

  .val-card {
    background: #0f1923;
    padding: 10px 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
  }

  .val-num { font-size: 20px; font-weight: 800; }
  .val-label { font-size: 9px; color: #5a7a8a; text-transform: uppercase; letter-spacing: 0.5px; }

  .val-card.critical .val-num { color: #ef4444; }
  .val-card.error .val-num { color: #f59e0b; }
  .val-card.warning .val-num { color: #f59e0b; }
  .val-card.info .val-num { color: #00ffcc; }

  .integrity-row {
    display: flex;
    justify-content: space-between;
    padding: 8px 12px 4px;
    font-size: 11px;
    color: #5a7a8a;
  }

  .integrity-pct { color: #e0e0e0; }

  .progress-bar { height: 3px; background: #1e2d3d; margin: 0 12px 8px; border-radius: 2px; }
  .progress-fill { height: 100%; background: #00ffcc; border-radius: 2px; }

  .issues-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 1fr;
    gap: 1px;
    background: #1e2d3d;
    border-bottom: 1px solid #1e2d3d;
  }

  .issue-card {
    background: #0f1923;
    padding: 8px 6px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
  }

  .issue-num { font-size: 16px; font-weight: 800; }
  .issue-label { font-size: 9px; color: #5a7a8a; text-transform: uppercase; }

  .routed-card .issue-num { color: #00ffcc; }
  .partial-card .issue-num { color: #f59e0b; }
  .unserved-card .issue-num { color: #ef4444; }
  .total-card .issue-num { color: #e0e0e0; }

  .output-list { border-bottom: 1px solid #1e2d3d; }

  .output-row {
    padding: 9px 12px;
    border-bottom: 1px solid #1a2535;
    color: #c0c0c0;
    display: flex;
    justify-content: space-between;
    cursor: pointer;
    font-size: 11px;
  }

  .output-row:hover { background: #131c24; color: #00ffcc; }
  .chevron { color: #5a7a8a; }

  .asset-inspector { padding: 10px 12px; flex: 1; }
  .asset-type { font-size: 9px; letter-spacing: 2px; color: #5a7a8a; text-transform: uppercase; margin-bottom: 4px; }
  .asset-id { font-size: 14px; font-weight: 700; color: #00ffcc; margin-bottom: 12px; }

  .field-row {
    display: flex;
    justify-content: space-between;
    padding: 5px 0;
    border-bottom: 1px solid #1a2535;
    font-size: 11px;
  }

  .field-key { color: #5a7a8a; }
  .field-val { color: #e0e0e0; }
</style>