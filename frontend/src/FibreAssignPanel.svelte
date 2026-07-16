<script>
  // FibreAssignPanel.svelte — results panel for the fibre auto-assign run.
  // Extracted from App.svelte's inline rpanel markup (16 Jul 2026 refactor).
  // Purely presentational: App.svelte runs assignFibres() and owns the
  // result; this renders stats/flags/log and dispatches 'close'.
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();

  export let result = null;
</script>

<div class="fa-panel">
  <div class="fa-hdr">
    <span class="fa-title">Auto-Assign Fibres</span>
    <button class="fa-close" on:click={() => dispatch('close')} title="Dismiss">✕</button>
  </div>
  {#if result}
    <div class="fa-stats">
      <div class="fa-stat"><div class="fa-sv ok">{result.stats.assigned}</div><div class="fa-sl">Assigned</div></div>
      <div class="fa-stat"><div class="fa-sv">{result.stats.splitters}</div><div class="fa-sl">Splitters</div></div>
      <div class="fa-stat"><div class="fa-sv">{result.stats.spare}</div><div class="fa-sl">Spare</div></div>
      <div class="fa-stat"><div class="fa-sv {result.stats.overcap ? 'bad' : ''}">{result.stats.overcap}</div><div class="fa-sl">Over-cap</div></div>
    </div>
    <div class="fa-sub">
      {result.stats.feeders} feeder (1:4) · {result.stats.terminals} terminal splitter{result.stats.terminals === 1 ? '' : 's'}
    </div>

    <div class="fa-phys" class:ok={result.physicalPlanStatus === 'VALIDATED'} class:bad={result.physicalPlanStatus === 'INVALID'}>
      <span class="fa-phys-dot"></span>
      {#if result.physicalPlanStatus === 'VALIDATED'}
        Physical fibre plan VALIDATED — through-splices &amp; dark storage computed from demand. Splice-plan export enabled.
      {:else if result.physicalPlanStatus === 'INVALID'}
        Physical fibre plan could not be validated{result.physicalPlan && result.physicalPlan.errors && result.physicalPlan.errors.length ? ` (${result.physicalPlan.errors.length} issue${result.physicalPlan.errors.length === 1 ? '' : 's'})` : ''}. Splitter ports are still assigned; splice-plan export stays disabled.
      {:else}
        Physical fibre plan not calculated. Splitter ports only.
      {/if}
    </div>

    {#if result.physicalPlanStatus === 'INVALID' && result.physicalPlan && result.physicalPlan.errors && result.physicalPlan.errors.length}
      <div class="fa-flags">
        <div class="fa-flags-lbl">⚠ Physical plan issues</div>
        {#each result.physicalPlan.errors.slice(0, 12) as er}
          <div class="fa-flag">{er.message || er.code}</div>
        {/each}
      </div>
    {/if}

    {#if result.flags.length}
      <div class="fa-flags">
        <div class="fa-flags-lbl">⚠ {result.flags.length} warning{result.flags.length === 1 ? '' : 's'}</div>
        {#each result.flags as fl}
          <div class="fa-flag">{fl}</div>
        {/each}
      </div>
    {/if}

    <div class="fa-log-lbl">Log</div>
    <div class="fa-log">
      {#each result.log as line}
        <div class="fa-log-line">{line}</div>
      {/each}
    </div>

    <div class="fa-note">Click a CBT with “Edit Asset” to see its splitter port grid.</div>
  {/if}
  <div class="fa-actions">
    <button class="fa-done" on:click={() => dispatch('close')}>Done</button>
  </div>
</div>

<style>
  .fa-panel { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
  .fa-hdr { height: 44px; background: #0d1520; border-bottom: 1px solid #1a2d40; display: flex; align-items: center; padding: 0 14px; gap: 8px; flex-shrink: 0; }
  .fa-title { font-size: 9px; color: #a0c4d8; letter-spacing: 0.14em; text-transform: uppercase; flex: 1; font-weight: 600; }
  .fa-close { background: #0f1c28; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 11px; width: 24px; height: 24px; border-radius: 4px; cursor: pointer; }
  .fa-close:hover { border-color: #ff555544; color: #ff5555; }
  .fa-stats { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 5px; padding: 12px 14px 6px; }
  .fa-stat { background: #080e14; border-radius: 5px; padding: 8px 4px; text-align: center; }
  .fa-sv { font-size: 17px; font-weight: 700; line-height: 1; color: #7ab8d4; }
  .fa-sv.ok { color: #4dc8ff; }
  .fa-sv.bad { color: #ff5555; }
  .fa-sl { font-size: 6.5px; color: #3a5a70; letter-spacing: 0.06em; text-transform: uppercase; margin-top: 3px; }
  .fa-sub { font-size: 8px; color: #6a8fa8; letter-spacing: 0.04em; padding: 2px 14px 8px; }
  .fa-phys { display: flex; align-items: flex-start; gap: 6px; margin: 0 14px 8px; padding: 8px 10px; border-radius: 5px; font-size: 8px; line-height: 1.5; letter-spacing: 0.03em; background: #6a8fa80a; border: 1px solid #1a2d40; color: #6a8fa8; }
  .fa-phys-dot { width: 7px; height: 7px; border-radius: 50%; background: #6a8fa8; margin-top: 2px; flex-shrink: 0; }
  .fa-phys.ok { background: #00e0a00a; border-color: #00e0a044; color: #6fdcbf; }
  .fa-phys.ok .fa-phys-dot { background: #00e0a0; }
  .fa-phys.bad { background: #ffaa440a; border-color: #ffaa4444; color: #c79552; }
  .fa-phys.bad .fa-phys-dot { background: #ffaa44; }
  .fa-flags { margin: 0 14px 8px; padding: 8px 10px; background: #ffaa440a; border: 1px solid #ffaa4433; border-radius: 5px; }
  .fa-flags-lbl { font-size: 8px; color: #ffaa44; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 5px; }
  .fa-flag { font-size: 8px; color: #c79552; line-height: 1.5; padding: 1px 0; }
  .fa-log-lbl { font-size: 7.5px; color: #3a5a70; letter-spacing: 0.12em; text-transform: uppercase; padding: 4px 14px 4px; }
  .fa-log { flex: 1; overflow-y: auto; padding: 0 14px; }
  .fa-log-line { font-size: 8px; color: #6a8fa8; line-height: 1.6; padding: 1px 0; border-bottom: 1px solid #0c141c; }
  .fa-note { font-size: 8px; color: #3a5a70; letter-spacing: 0.03em; padding: 8px 14px; line-height: 1.6; }
  .fa-actions { padding: 10px 14px; border-top: 1px solid #1a2d40; flex-shrink: 0; }
  .fa-done { width: 100%; background: #00aaff14; border: 1px solid #00aaff44; color: #4dc8ff; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; padding: 8px; border-radius: 4px; cursor: pointer; }
  .fa-done:hover { background: #00aaff22; }
</style>
