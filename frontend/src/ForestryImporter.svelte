<script>
  // ForestryImporter.svelte — mirrors AddressImporter.svelte's file-drop
  // pattern for forest-stand polygons (National Forest Inventory or similar).
  // Unlike address import, this is optional, available at any project stage,
  // and never advances the onboarding stage.
  import { createEventDispatcher } from 'svelte';
  import { typicalCanopy } from './forestryHeights.js';

  const dispatch = createEventDispatcher();

  let dragover = false;
  let loading = false;
  let result = null;   // { features, total, skipped, byGroup: { group: count } }
  let error = '';

  function onDragover(e) { e.preventDefault(); dragover = true; }
  function onDragleave() { dragover = false; }

  function onDrop(e) {
    e.preventDefault();
    dragover = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) processFile(file);
  }

  function onFileInput(e) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }

  // Attaches the typical-height classification at import time (once, here)
  // rather than at render time, so it's inspectable/exportable like any
  // other stored property, and every consumer (map layer, BoM, a future
  // export) reads the same value instead of recomputing it differently.
  function classify(features) {
    let skipped = 0;
    const byGroup = {};
    const out = [];
    for (const f of features || []) {
      if (!f?.geometry || (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon')) { skipped++; continue; }
      const p = f.properties || {};
      const { group, heightM } = typicalCanopy(p.IFT_IOA ?? p.ift_ioa, p.CATEGORY ?? p.category);
      byGroup[group] = (byGroup[group] || 0) + 1;
      out.push({ ...f, properties: { ...p, canopy_group: group, typical_height_m: heightM, height_source: 'typical' } });
    }
    return { features: out, total: out.length, skipped, byGroup };
  }

  async function processFile(file) {
    error = '';
    result = null;
    loading = true;

    const name = file.name.toLowerCase();

    try {
      let features;
      if (name.endsWith('.json') || name.endsWith('.geojson')) {
        const geojson = JSON.parse(await file.text());
        features = geojson.type === 'FeatureCollection' ? geojson.features : [geojson];
      } else if (name.endsWith('.zip') || name.endsWith('.shp')) {
        // Dynamic import: same rationale as AddressImporter — shpjs is only
        // needed for this comparatively rare file type.
        const shpjs = (await import('shpjs')).default;
        const buffer = await file.arrayBuffer();
        const geojson = await shpjs(buffer);
        const fc = geojson.type === 'FeatureCollection' ? geojson : { type: 'FeatureCollection', features: [geojson] };
        features = fc.features;
      } else {
        throw new Error('Unsupported file type. Use a zipped SHP or GeoJSON.');
      }
      result = classify(features);
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  function confirm() {
    if (result) dispatch('imported', result.features);
  }

  function skip() {
    dispatch('skip');
  }
</script>

<div class="importer">
  <div class="imp-hdr">
    <span class="imp-title">Import Forestry Data</span>
  </div>
  <div class="imp-hint">
    Load a zipped SHP or GeoJSON of forest stand polygons (e.g. the National Forest Inventory) to show
    woodland on the map. Each stand is given a TYPICAL height for its species group — this is a planning
    estimate, not a measurement, and is shown on the map with a dashed outline to make that clear.
    If a build area is already drawn, stands outside it are cut immediately.
  </div>

  <div
    class="dropzone"
    class:over={dragover}
    on:dragover={onDragover}
    on:dragleave={onDragleave}
    on:drop={onDrop}
    role="region"
    aria-label="Drop zone"
  >
    {#if loading}
      <div class="dz-icon">⟳</div>
      <div class="dz-text">Parsing file…</div>
    {:else if result}
      <div class="dz-icon ok">✓</div>
      <div class="dz-text ok">{result.total.toLocaleString()} stands loaded</div>
      <div class="dz-sub">
        {#each Object.entries(result.byGroup) as [group, n]}{group}: {n}&nbsp;&nbsp;{/each}
      </div>
      {#if result.skipped > 0}
        <div class="dz-sub">{result.skipped} features skipped (not a polygon)</div>
      {/if}
    {:else}
      <div class="dz-icon">⬆</div>
      <div class="dz-text">Drop SHP (zipped) or GeoJSON here</div>
      <div class="dz-sub">or click to browse</div>
      <input class="dz-input" type="file" accept=".shp,.zip,.json,.geojson" data-testid="forestry-file-input" on:change={onFileInput} />
    {/if}
  </div>

  {#if error}
    <div class="imp-error">{error}</div>
  {/if}

  <div class="imp-actions">
    <button class="btn-skip" on:click={skip}>Cancel</button>
    {#if result}
      <button class="btn-load" data-testid="forestry-load" on:click={confirm}>Load onto map →</button>
    {/if}
  </div>
</div>

<style>
  .importer { display: flex; flex-direction: column; height: 100%; background: #0d1520; }

  .imp-hdr { padding: 12px 14px 6px; border-bottom: 1px solid #1a2d40; flex-shrink: 0; }
  .imp-title { font-size: 9px; color: #a0c4d8; letter-spacing: 0.14em; text-transform: uppercase; font-weight: 600; }

  .imp-hint { padding: 10px 14px; font-size: 8.5px; color: #6a8fa8; line-height: 1.6; letter-spacing: 0.03em; border-bottom: 1px solid #1a2d40; flex-shrink: 0; }

  .dropzone {
    margin: 14px;
    border: 1px dashed #1a2d40;
    border-radius: 6px;
    padding: 32px 14px;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
    cursor: pointer;
    position: relative;
    transition: border-color 0.15s, background 0.15s;
    flex: 1;
  }
  .dropzone.over { border-color: #4dc8ff; background: #00aaff08; }
  .dropzone:hover { border-color: #2a4a5e; }

  .dz-icon { font-size: 28px; color: #3a5a70; }
  .dz-icon.ok { color: #4dc8ff; }
  .dz-text { font-size: 10px; color: #6a8fa8; letter-spacing: 0.06em; text-transform: uppercase; font-family: 'Courier New', monospace; }
  .dz-text.ok { color: #4dc8ff; }
  .dz-sub { font-size: 8px; color: #3a5a70; text-align: center; }
  .dz-input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; }

  .imp-error { margin: 0 14px; font-size: 8.5px; color: #ff5555; font-family: 'Courier New', monospace; }

  .imp-actions { display: flex; gap: 6px; padding: 10px 14px 14px; border-top: 1px solid #1a2d40; flex-shrink: 0; }
  .btn-skip { flex: 1; background: transparent; border: 1px solid #1a2d40; color: #3a5a70; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; padding: 8px; border-radius: 4px; cursor: pointer; }
  .btn-skip:hover { color: #6a8fa8; border-color: #2a4a5e; }
  .btn-load { flex: 2; background: #00aaff14; border: 1px solid #00aaff44; color: #4dc8ff; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; padding: 8px; border-radius: 4px; cursor: pointer; }
  .btn-load:hover { background: #00aaff22; }
</style>
