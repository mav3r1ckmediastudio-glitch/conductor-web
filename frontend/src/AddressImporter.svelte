<script>
  import { createEventDispatcher } from 'svelte';
  import { parseAddressCsv } from './projectStore.js';
  import shpjs from 'shpjs';

  const dispatch = createEventDispatcher();

  let dragover = false;
  let loading = false;
  let result = null;
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

  async function processFile(file) {
    error = '';
    result = null;
    loading = true;

    const name = file.name.toLowerCase();

    try {
      if (name.endsWith('.csv')) {
        const text = await file.text();
        const parsed = parseAddressCsv(text);
        result = parsed;
      } else if (name.endsWith('.zip') || name.endsWith('.shp')) {
        const buffer = await file.arrayBuffer();
        const geojson = await shpjs(buffer);
        const fc = geojson.type === 'FeatureCollection' ? geojson : { type: 'FeatureCollection', features: [geojson] };
        result = { features: fc.features, skipped: 0, total: fc.features.length };
      } else {
        throw new Error('Unsupported file type. Use CSV or zipped SHP.');
      }
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
    <span class="imp-title">Import Address Data</span>
    <span class="imp-sub">Step 1 of 3</span>
  </div>
  <div class="imp-hint">
    Load a CSV or SHP file of address/UPRN data to visualise premises before drawing your build area.
    Supports AddressBase, PKC Gazetteer, and BDUK BAMM formats.
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
      <div class="dz-text ok">{result.features.length.toLocaleString()} addresses loaded</div>
      {#if result.skipped > 0}
        <div class="dz-sub">{result.skipped} rows skipped (missing coordinates)</div>
      {/if}
    {:else}
      <div class="dz-icon">⬆</div>
      <div class="dz-text">Drop CSV or SHP here</div>
      <div class="dz-sub">or click to browse</div>
      <input class="dz-input" type="file" accept=".csv,.shp,.zip" on:change={onFileInput} />
    {/if}
  </div>

  {#if error}
    <div class="imp-error">{error}</div>
  {/if}

  <div class="imp-actions">
    <button class="btn-skip" on:click={skip}>Skip for now</button>
    {#if result}
      <button class="btn-load" on:click={confirm}>Load onto map →</button>
    {/if}
  </div>
</div>

<style>
  .importer { display: flex; flex-direction: column; height: 100%; background: #0d1520; }

  .imp-hdr { padding: 12px 14px 6px; border-bottom: 1px solid #1a2d40; display: flex; justify-content: space-between; align-items: baseline; flex-shrink: 0; }
  .imp-title { font-size: 9px; color: #a0c4d8; letter-spacing: 0.14em; text-transform: uppercase; font-weight: 600; }
  .imp-sub { font-size: 8px; color: #3a5a70; letter-spacing: 0.08em; }

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
  .dz-sub { font-size: 8px; color: #3a5a70; }
  .dz-input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; }

  .imp-error { margin: 0 14px; font-size: 8.5px; color: #ff5555; font-family: 'Courier New', monospace; }

  .imp-actions { display: flex; gap: 6px; padding: 10px 14px 14px; border-top: 1px solid #1a2d40; flex-shrink: 0; }
  .btn-skip { flex: 1; background: transparent; border: 1px solid #1a2d40; color: #3a5a70; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; padding: 8px; border-radius: 4px; cursor: pointer; }
  .btn-skip:hover { color: #6a8fa8; border-color: #2a4a5e; }
  .btn-load { flex: 2; background: #00aaff14; border: 1px solid #00aaff44; color: #4dc8ff; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; padding: 8px; border-radius: 4px; cursor: pointer; }
  .btn-load:hover { background: #00aaff22; }
</style>
