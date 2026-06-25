<script>
  import { onMount } from 'svelte';
  import maplibregl from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import RadialWheel from './RadialWheel.svelte';

  const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY;

  let map;
  let is3D = true;
  let drawerOpen = false;

  // Routes data
  const ROUTES = [
    {id:'ENG-CH3-TAIL-002',status:'Routed',  from:'ENG-CH3-CBT-002',to:'ENG-CH3-JNT-005',len:'0.20 km',assets:'1',fibres:'1',cap:'100%',updated:'12/05/2024',eng:'—'},
    {id:'ENG-CH3-RTE-001', status:'Unserved',from:'ENG-CH3-JNT-001',to:'ENG-CH3-PRE-012',len:'73 m',   assets:'—',fibres:'—',cap:'0%',  updated:'—',       eng:'—'},
    {id:'ENG-CH3-RTE-002', status:'Unserved',from:'ENG-CH3-JNT-001',to:'ENG-CH3-PRE-034',len:'57 m',   assets:'—',fibres:'—',cap:'0%',  updated:'—',       eng:'—'},
    {id:'ENG-CH3-RTE-003', status:'Unserved',from:'ENG-CH3-JNT-002',to:'ENG-CH3-PRE-056',len:'46 m',   assets:'—',fibres:'—',cap:'0%',  updated:'—',       eng:'—'},
    {id:'ENG-CH3-RTE-004', status:'Unserved',from:'ENG-CH3-JNT-002',to:'ENG-CH3-PRE-078',len:'78 m',   assets:'—',fibres:'—',cap:'0%',  updated:'—',       eng:'—'},
    {id:'ENG-CH3-RTE-005', status:'Partial', from:'ENG-CH3-JNT-003',to:'ENG-CH3-PRE-090',len:'112 m',  assets:'2',fibres:'1',cap:'50%', updated:'12/05/2024',eng:'PW'},
  ];

  let selectedRoute = 'ENG-CH3-TAIL-002';
  let activeToolLabel = 'Civil — Place Chamber';
  let activeCat = 'civil';   

  function onToolSelected(e) {
    const { label, category } = e.detail;
    const catLabel = category.charAt(0).toUpperCase() + category.slice(1);
    activeToolLabel = `${catLabel} — ${label}`;
  }

  const ASSET_ROWS = [
    ['ID',          'ENG-CH3-JNT-004', ''],
    ['Type',        'Splice', ''],
    ['Closure',     'Prysmian CMJ', ''],
    ['Has Splitter','True', 'ok'],
    ['Split Ratio', '1:8', ''],
    ['Cascade Lvl', '2', ''],
    ['Status',      'In Service', 'ok'],
    ['Notes',       '—', ''],
  ];

  function statusClass(s) {
    return s === 'Routed' ? 'routed' : s === 'Partial' ? 'partial' : 'unserved';
  }

  function capStyle(cap) {
    if (cap === '100%') return 'color:#4dc8ff;';
    if (cap === '0%') return 'color:#ff5555;';
    return 'color:#ffaa44;';
  }

  onMount(() => {
    map = new maplibregl.Map({
      container: 'map',
      style: `https://api.maptiler.com/maps/dataviz-dark/style.json?key=${MAPTILER_KEY}`,
      center: [-3.77, 56.71],
      zoom: 15,
      pitch: 60,
      bearing: -30
    });

    map.on('load', () => {
      map.addSource('terrain', {
        type: 'raster-dem',
        url: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${MAPTILER_KEY}`,
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
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 6, 16, 16],
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
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 16, 2],
          'line-opacity': 0.9
        }
      });
    });
  });

  function setView(threeD) {
    is3D = threeD;
    if (!map) return;
    map.easeTo({
      pitch: threeD ? 60 : 0,
      bearing: threeD ? -30 : 0,
      duration: 1200
    });
  }
</script>

<div class="screen">

  <!-- TOPBAR -->
  <div class="topbar">
    <div class="tb-logo">
      <div class="logo-main">CONDUCTOR</div>
      <div class="logo-sub">FTTP DESIGN</div>
    </div>
    <div class="tb-stats">
      <div class="stat"><div class="sv neu" style="font-size:11px;">TARVIN VILLAGE 002</div><div class="sl">ENG-CH3</div></div>
      <div class="stat"><div class="sv neu">1189</div><div class="sl">Premises</div></div>
      <div class="stat"><div class="sv ok">31</div><div class="sl">Routed</div></div>
      <div class="stat"><div class="sv wrn">0</div><div class="sl">Partial</div></div>
      <div class="stat"><div class="sv bad">1158</div><div class="sl">Unserved</div></div>
      <div class="stat"><div class="sv neu">1.6 km</div><div class="sl">Fibre</div></div>
      <div class="stat"><div class="sv neu">1.5 km</div><div class="sl">Duct</div></div>
      <div class="stat" style="border-right:none;"><div class="sv neu">£22,827</div><div class="sl">Est. Materials</div></div>
    </div>
    <div class="tb-centre">
      <div class="tb-grp-wrap">
        <div class="tb-grp-lbl">Validation</div>
        <div class="tb-grp">
          <button class="tb-btn hi">✓ Validate Routes</button>
          <button class="tb-btn hi">⚡ Design Health</button>
        </div>
      </div>
      <div class="tb-sep"></div>
      <div class="tb-grp-wrap">
        <div class="tb-grp-lbl">Outputs</div>
        <div class="tb-grp">
          <button class="tb-btn">Splice Plan</button>
          <button class="tb-btn">Route Splice</button>
          <button class="tb-btn">Single Line Diagram</button>
          <button class="tb-btn">Bill of Materials</button>
          <button class="tb-btn">Cabinet Cost</button>
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
    </div>
  </div>

  <div class="body">

    <!-- SIDEBAR -->
    <div class="sidebar">
      <div class="sid-lbl">Build Tools</div>
      <button class="cat-pill" class:on={activeCat==='civil'}  on:click={() => activeCat='civil'}>⬡ Civil</button>
      <button class="cat-pill" class:on={activeCat==='fibre'}  on:click={() => activeCat='fibre'}>⌁ Fibre</button>
      <button class="cat-pill" class:on={activeCat==='aerial'} on:click={() => activeCat='aerial'}>⌒ Aerial &amp; Poles</button>
      <button class="cat-pill" class:on={activeCat==='pia'}    on:click={() => activeCat='pia'}>⬛ PIA Underground</button>
      <div class="sid-div"></div>
      <div class="sid-lbl">Asset Tools</div>
      <button class="asset-btn">✎ Edit Asset</button>
      <button class="asset-btn">✕ Delete Asset</button>
      <button class="asset-btn">⇄ Move Asset</button>
    </div>

    <!-- MAP + ROUTES DRAWER -->
    <div class="map-wrap">
      <div id="map"></div>

      <!-- Radial tool wheel -->
     <RadialWheel {activeCat} on:tool-selected={onToolSelected} />

      <div class="active-chip"><div class="chip-dot"></div><span>{activeToolLabel}</span></div>

      <!-- Routes drawer -->
      <div class="routes-drawer" style="height:{drawerOpen ? '220px' : '36px'};">
        <div class="routes-handle" on:click={() => drawerOpen = !drawerOpen}>
          <span class="handle-title">Routes</span>
          <span class="handle-count">12</span>
          <span style="font-size:8px;color:#3a5a70;margin-left:4px;letter-spacing:0.06em;">{selectedRoute} selected</span>
          <select class="handle-filter" on:click|stopPropagation>
            <option>All Routes</option>
            <option>Routed</option>
            <option>Partial</option>
            <option>Unserved</option>
          </select>
          <input class="handle-search" placeholder="Search routes..." on:click|stopPropagation />
          <button class="handle-csv" on:click|stopPropagation>↓ CSV</button>
          <button class="handle-toggle">{drawerOpen ? '▼' : '▲'}</button>
        </div>
        {#if drawerOpen}
        <div class="routes-table-wrap">
          <table class="routes-table">
            <thead>
              <tr>
                <th>Route ID</th><th>Status</th><th>From</th><th>To</th>
                <th>Length</th><th>Assets</th><th>Fibres</th><th>Capacity</th>
                <th>Updated</th><th>Engineer</th>
              </tr>
            </thead>
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

    <!-- RIGHT PANEL -->
    <div class="rpanel">

      <div class="rp-hdr">
        <span class="rp-hdr-title">Validation Summary</span>
        <span class="rp-timestamp">Updated 21:18</span>
        <button class="rp-refresh">↻</button>
        <button class="health-btn">✓ Health</button>
      </div>

      <div class="val-body">
        <div class="val-counts">
          <div class="vc"><div class="vc-val bad">0</div><div class="vc-lbl">Critical</div></div>
          <div class="vc"><div class="vc-val bad">0</div><div class="vc-lbl">Errors</div></div>
          <div class="vc"><div class="vc-val wrn">0</div><div class="vc-lbl">Warnings</div></div>
          <div class="vc"><div class="vc-val neu">1158</div><div class="vc-lbl">Total</div></div>
        </div>
        <div class="int-row"><span class="int-k">Network Integrity</span><span class="int-v">3%</span></div>
        <div class="int-bar"><div class="int-fill"></div></div>
        <div class="checks-note">1,978 of 1,978 checks passed · 1,158 premises not yet connected</div>
      </div>

      <div class="health-banner caution">
        ⚠ CAUTION — 1,158 unserved premises. Cabinet placed, civil routes traced but fibre not yet assigned. Run Assign Fibre Roles to progress.
      </div>

      <div class="outputs-section">
        <div class="outputs-lbl">Engineer Outputs</div>
        <button class="out-btn">↗ Splice Plan Export</button>
        <button class="out-btn">↗ Route Splice Export</button>
        <button class="out-btn">↗ Single Line Diagram</button>
        <button class="out-btn">↗ Bill of Materials</button>
        <button class="out-btn">↗ Cabinet Cost Calculator</button>
      </div>

      <div class="rp-splitter"></div>

      <div class="asset-section">
        <div class="asset-hdr">
          <div class="asset-hdr-lbl">Selected Asset</div>
          <div class="asset-type">Joint / Closure</div>
          <div class="asset-id">ENG-CH3-JNT-004</div>
        </div>
        <div class="asset-body">
          {#each ASSET_ROWS as [k, v, cls]}
            <div class="arow"><span class="ak">{k}</span><span class="av {cls}">{v}</span></div>
          {/each}
        </div>
        <div class="asset-actions">
          <button class="act-btn">✎ Edit</button>
          <button class="act-btn">⇄ Move</button>
          <button class="act-btn">✕ Delete</button>
          <button class="act-btn">◎ Trace</button>
        </div>
      </div>

      <div class="rp-splitter"></div>

      <div class="ri-section">
        <div class="ri-hdr">
          <div>
            <div class="ri-lbl" style="margin-bottom:4px;">Route Inspector</div>
            <div class="ri-id">ENG-CH3-TAIL-002</div>
          </div>
          <span class="ri-badge">Routed</span>
        </div>
        <div class="ri-from">ENG-CH3-CBT-002 → ENG-CH3-JNT-005</div>
        <div class="ri-stats">
          <div class="ri-stat"><div class="ri-sv">0.20 km</div><div class="ri-sl">Length</div></div>
          <div class="ri-stat"><div class="ri-sv">1</div><div class="ri-sl">Fibres</div></div>
          <div class="ri-stat"><div class="ri-sv">—</div><div class="ri-sl">Assets</div></div>
          <div class="ri-stat"><div class="ri-sv ok">100%</div><div class="ri-sl">Capacity</div></div>
        </div>
      </div>

    </div>
  </div>

</div>

<style>
  :global(body) { margin: 0; }
  * { box-sizing: border-box; }

  .screen {
    width: 100vw;
    height: 100vh;
    background: #0a0f14;
    display: flex;
    flex-direction: column;
    font-family: 'Courier New', Courier, monospace;
    overflow: hidden;
  }

  /* TOPBAR */
  .topbar { height: 52px; background: #0d1520; border-bottom: 1px solid #1a2d40; display: flex; align-items: stretch; flex-shrink: 0; }
  .tb-logo { display: flex; flex-direction: column; justify-content: center; padding: 0 16px 0 14px; border-right: 1px solid #1a2d40; }
  .logo-main { color: #4dc8ff; font-size: 13px; font-weight: 700; letter-spacing: 0.16em; text-shadow: 0 0 12px #00aaff66; }
  .logo-sub { color: #3a5a70; font-size: 8px; letter-spacing: 0.12em; margin-top: 2px; }
  .tb-stats { display: flex; align-items: stretch; border-right: 2px solid #1a2d40; }
  .stat { display: flex; flex-direction: column; justify-content: center; padding: 0 14px; border-right: 1px solid #1a2d4044; }
  .sv { font-size: 15px; font-weight: 700; line-height: 1; }
  .sv.neu { color: #7ab8d4; }
  .sv.ok { color: #4dc8ff; text-shadow: 0 0 8px #00aaff55; }
  .sv.bad { color: #ff5555; }
  .sv.wrn { color: #ffaa44; }
  .sl { font-size: 8px; letter-spacing: 0.09em; color: #3a5a70; margin-top: 3px; text-transform: uppercase; }
  .tb-centre { flex: 1; display: flex; align-items: center; justify-content: center; padding: 0 20px; gap: 6px; }
  .tb-sep { width: 1px; height: 28px; background: #1a2d40; margin: 0 6px; }
  .tb-grp { display: flex; align-items: center; gap: 5px; }
  .tb-grp-wrap { display: flex; flex-direction: column; align-items: center; gap: 3px; }
  .tb-grp-lbl { font-size: 8px; color: #3a5a70; letter-spacing: 0.1em; text-transform: uppercase; }
  .tb-btn { background: #0f1c28; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; padding: 0 14px; height: 30px; border-radius: 6px; cursor: pointer; white-space: nowrap; display: flex; align-items: center; gap: 6px; }
  .tb-btn.hi { background: #00aaff14; border-color: #00aaff44; color: #4dc8ff; }
  .tb-right { display: flex; align-items: center; gap: 10px; padding: 0 16px; border-left: 2px solid #1a2d40; }
  .srch { background: #080e14; border: 1px solid #1a2d40; color: #7ab8d4; font-family: 'Courier New', monospace; font-size: 10px; padding: 6px 12px; border-radius: 5px; width: 210px; outline: none; }
  .srch::placeholder { color: #2a4050; }
  .go { background: #00aaff14; border: 1px solid #00aaff44; color: #4dc8ff; font-family: 'Courier New', monospace; font-size: 9px; padding: 6px 12px; border-radius: 5px; cursor: pointer; }
  .vtog { display: flex; border: 1px solid #1a2d40; border-radius: 5px; overflow: hidden; }
  .vt { background: #0f1c28; border: none; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 9px; padding: 6px 12px; cursor: pointer; }
  .vt.on { background: #1a2d40; color: #4dc8ff; }

  .body { display: flex; flex: 1; overflow: hidden; position: relative; }

  /* SIDEBAR */
  .sidebar { width: 140px; background: #0d1520; border-right: 1px solid #1a2d40; display: flex; flex-direction: column; justify-content: center; flex-shrink: 0; z-index: 10; }
  .sid-lbl { font-size: 8px; color: #3a5a70; letter-spacing: 0.12em; text-transform: uppercase; padding: 12px 12px 6px 12px; }
  .sid-div { height: 1px; background: #1a2d40; margin: 8px 12px; }
  .sid-hint { font-size: 8px; color: #2a4050; letter-spacing: 0.08em; text-transform: uppercase; padding: 4px 12px; line-height: 1.6; }
  .cat-pill { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-left: 2px solid transparent; color: #6a8fa8; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; transition: all 0.15s; background: transparent; border-top: none; border-right: none; border-bottom: none; width: 100%; text-align: left; font-family: 'Courier New', monospace; }
  .cat-pill:hover { background: #0f1c28; color: #a0c4d8; border-left-color: #2a4a5e; }
  .cat-pill.on { background: #00aaff0a; border-left-color: #4dc8ff; color: #4dc8ff; }
  .asset-btn { display: flex; align-items: center; gap: 8px; padding: 9px 12px; border-left: 2px solid transparent; color: #6a8fa8; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; transition: all 0.15s; background: transparent; border-top: none; border-right: none; border-bottom: none; width: 100%; text-align: left; font-family: 'Courier New', monospace; }
  .asset-btn:hover { background: #0f1c28; color: #a0c4d8; border-left-color: #2a4a5e; }

  /* MAP */
  .map-wrap { flex: 1; position: relative; overflow: hidden; }
  #map { width: 100%; height: 100%; }
  .active-chip { position: absolute; bottom: 60px; left: 50%; transform: translateX(-50%); background: #0d1520ee; border: 1px solid #00aaff44; border-radius: 20px; padding: 7px 18px 7px 12px; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: #4dc8ff; display: flex; align-items: center; gap: 8px; white-space: nowrap; z-index: 5; }
  .chip-dot { width: 6px; height: 6px; border-radius: 50%; background: #4dc8ff; box-shadow: 0 0 6px #00aaff; animation: pulse 1.5s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: .3 } }

  /* ROUTES DRAWER */
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

  /* RIGHT PANEL */
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
</style>
