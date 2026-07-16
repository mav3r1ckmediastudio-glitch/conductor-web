<script>
  // ValidationSummaryPanel.svelte — the right panel's DEFAULT content:
  // validation summary counts, network-integrity bar, engineer-output
  // shortcuts, and the selected-asset section (hosting AssetEditPanel).
  // Extracted from App.svelte's inline {:else} branch of the rpMode switch
  // (16 Jul 2026 refactor). App.svelte owns all the data and the rpMode
  // switch itself; button clicks and AssetEditPanel events dispatch/forward
  // up unchanged.
  import { createEventDispatcher } from 'svelte';
  import AssetEditPanel from './AssetEditPanel.svelte';
  const dispatch = createEventDispatcher();

  export let stage = 'setup';
  export let routeStats = { routed: null, partial: null, unserved: null };
  export let statsStale = false;
  export let cheapStats = { premises: 0 };
  export let selectedAsset = null;
</script>

<div class="rp-hdr">
  <span class="rp-hdr-title">Validation Summary</span>
  <span class="rp-timestamp">—</span>
  <button class="rp-refresh">↻</button>
  <button class="health-btn" disabled={stage !== 'design'} on:click={() => dispatch('designHealth')}>✓ Health</button>
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
  <button class="out-btn" disabled={stage !== 'design'} on:click={() => dispatch('validateRoutes')}>↗ Validate Fibre Routes</button>
  <button class="out-btn" disabled={stage !== 'design'} on:click={() => dispatch('splicePlan')}>↗ Splice Plan Export</button>
  <button class="out-btn" disabled={stage !== 'design'} on:click={() => dispatch('sld')}>↗ Single Line Diagram</button>
  <button class="out-btn" disabled={stage !== 'design'} on:click={() => dispatch('bom')}>↗ Bill of Materials</button>
  <button class="out-btn" disabled={stage !== 'design'} on:click={() => dispatch('cabinetCost')}>↗ Cabinet Cost Calculator</button>
</div>

  <div class="rp-splitter"></div>

  <div class="asset-section">
    {#if selectedAsset}
      <AssetEditPanel
        selected={selectedAsset}
        on:saved
        on:deleted
        on:move
        on:close
      />
    {:else}
      <div class="asset-hdr">
        <div class="asset-hdr-lbl">Selected Asset</div>
        <div class="asset-type">—</div>
        <div class="asset-id">—</div>
      </div>
      <div class="asset-body" style="padding:12px 14px;font-size:11px;color:#6ba3c7;letter-spacing:0.03em;line-height:1.8;">
        Use Edit Asset to select and inspect an asset.
      </div>
    {/if}
  </div>

<style>
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
</style>
