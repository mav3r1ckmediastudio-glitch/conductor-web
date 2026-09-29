<script>
  // Sidebar.svelte — the left rail: workflow step buttons (import → build
  // area → cabinet), then the design-stage tool categories, asset tools,
  // layer toggles and basemap switcher. Extracted from App.svelte (16 Jul
  // 2026 refactor). Fully presentational — every click dispatches up;
  // App.svelte owns stage/category/toggle state and the map effects.
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();

  export let stage = 'setup';
  export let activeCat = 'civil';
  export let showBuildings = true;
  export let showForestry = true;
  export let showRoads = true;
  export let showHillshade = false;
  export let basemaps = [];          // [{ id, label }] — style URLs stay in App.svelte
  export let currentBasemap = 'dark';
  export let basemapSwitching = false;

  // Which build is this tab running? Commit + build time, so a stale tab or deploy is obvious.
  const VERSION = typeof __APP_VERSION__ !== 'undefined' ? String(__APP_VERSION__) : 'dev';
  const BUILT = typeof __BUILD_TIME__ !== 'undefined' ? String(__BUILD_TIME__) : '';
  const buildLabel = `${(VERSION.split('+')[1] || VERSION).slice(0, 7)}${BUILT ? ' · ' + BUILT.slice(5) : ''}`;
</script>

<div class="sidebar" class:design-scroll={stage === 'design'}>
  {#if stage === 'import'}
    <div class="sid-lbl">Step 1</div>
    <button class="cat-pill on" on:click={() => dispatch('importAddresses')}>⬆ Import Address Data</button>
    <div class="sid-hint">Import a CSV or SHP of address data to inform your build area boundary.</div>
  {:else if stage === 'build-area'}
    <div class="sid-lbl">Step 2</div>
    <button class="cat-pill on" on:click={() => dispatch('drawBuildArea')}>⬡ Draw Build Area</button>
    <div class="sid-hint">Click corners on the map to define your build area polygon. Right-click to finish.</div>
  {:else if stage === 'cabinet'}
    <div class="sid-lbl">Step 3</div>
    <button class="cat-pill on" on:click={() => dispatch('placeCabinet')}>■ Place Cabinet / POP</button>
    <div class="sid-hint">Place your cabinet or POP. All design tools unlock after this step.</div>
  {:else if stage === 'design'}
    <div class="sid-lbl">Build Tools</div>
    <button class="cat-pill" class:on={activeCat==='civil'}  on:click={() => dispatch('selectCat', 'civil')}>⬡ Civil</button>
    <button class="cat-pill" class:on={activeCat==='fibre'}  on:click={() => dispatch('selectCat', 'fibre')}>⌁ Fibre</button>
    <button class="cat-pill" class:on={activeCat==='aerial'} on:click={() => dispatch('selectCat', 'aerial')}>⌒ Aerial &amp; Poles</button>
    <button class="cat-pill" class:on={activeCat==='pia'}    on:click={() => dispatch('selectCat', 'pia')}>⬛ PIA Underground</button>
    <button class="cat-pill" class:on={activeCat==='wireless'} on:click={() => dispatch('selectCat', 'wireless')}>◉ Wireless</button>
    <div class="sid-div"></div>
    <div class="sid-lbl">Asset Tools</div>
    <button class="asset-btn" on:click={() => dispatch('editAsset')}>✎ Edit Asset</button>
    <button class="asset-btn" on:click={() => dispatch('deleteAsset')}>✕ Delete Asset</button>
    <button class="asset-btn" on:click={() => dispatch('moveAsset')}>⇄ Move Asset</button>
    <button class="asset-btn" class:on={showBuildings} on:click={() => dispatch('toggleBuildings')}>⌂ Buildings</button>
    <button class="asset-btn" on:click={() => dispatch('importForestry')}>♣ Import Forestry</button>
    <button class="asset-btn" class:on={showForestry} on:click={() => dispatch('toggleForestry')}>♣ Forestry</button>
    <button class="asset-btn" on:click={() => dispatch('recutForestry')}>✂ Recut Forestry to Build Area</button>
    <button class="asset-btn" class:on={showRoads} on:click={() => dispatch('toggleRoads')}>▬ Roads</button>
    <button class="asset-btn" class:on={showHillshade} on:click={() => dispatch('toggleHillshade')}>⛰ Terrain relief</button>
    <div class="sid-basemap-dock">
      <div class="sid-div"></div>
      <div class="sid-lbl">Basemap</div>
      <div class="basemap-wrap">
        {#each basemaps as bm}
          <button
            class="basemap-btn"
            class:on={currentBasemap === bm.id}
            disabled={basemapSwitching}
            on:click={() => dispatch('changeBasemap', bm.id)}
          >{bm.label}</button>
        {/each}
      </div>
      <div class="build-stamp" data-testid="build-stamp" title={VERSION + (BUILT ? ' — built ' + BUILT : '')}>build {buildLabel}</div>
    </div>
  {/if}
</div>

<style>
  /* ── Sidebar ── */
  .sidebar { width: 140px; background: #0d1520; border-right: 1px solid #1a2d40; display: flex; flex-direction: column; justify-content: center; flex-shrink: 0; z-index: 10; position: relative; overflow-y: auto; }
  /* The design stage's tool list can outgrow the sidebar (more asset-tool buttons than fit at once).
     The other three onboarding stages are one short, centred prompt each and should stay untouched --
     this only applies once the design-stage tool list is showing. padding-bottom reserves room for the
     absolutely-positioned basemap dock below, so scrolling to the end of the list doesn't still leave
     the last button hidden under it. */
  .sidebar.design-scroll { justify-content: flex-start; padding-bottom: 200px; }
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
  .build-stamp { padding: 0 10px 4px; font-size: 7px; letter-spacing: 0.04em; color: #2f5068; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
