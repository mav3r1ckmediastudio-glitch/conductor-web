<script>
  // ActiveToolChip.svelte — the floating "active tool" pill over the map.
  // Extracted from App.svelte (16 Jul 2026 refactor). Presentational: shows
  // the live tool label, an ⓘ docs link when the tool has an id, and a ✕
  // that dispatches 'cancel' — App.svelte owns the actual teardown (it
  // touches the map, tool state, pendings, and trace highlights).
  // Styles + the `pulse` keyframes copied verbatim (Svelte scopes keyframes
  // per-component, so the definition travels with the rule using it).
  import { createEventDispatcher } from 'svelte';
  import { docsUrl, toolTip } from './toolDocs.js';
  const dispatch = createEventDispatcher();

  export let label = '';
  export let toolId = '';
</script>

<div class="active-chip">
  <div class="chip-dot"></div>
  <span>{label}</span>
  {#if toolId}
    <a
      href={docsUrl(toolId)}
      target="_blank"
      rel="noopener"
      class="chip-help"
      title={toolTip(toolId)}
      on:click|stopPropagation
    >ⓘ</a>
  {/if}
  <button class="chip-cancel" on:click={() => dispatch('cancel')}>✕</button>
</div>

<style>
  @keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: .3 } }

  .active-chip { position: absolute; bottom: 60px; left: 50%; transform: translateX(-50%); background: #0d1520ee; border: 1px solid #00aaff44; border-radius: 20px; padding: 7px 18px 7px 12px; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: #4dc8ff; display: flex; align-items: center; gap: 8px; white-space: nowrap; z-index: 5; }
  .chip-dot { width: 6px; height: 6px; border-radius: 50%; background: #4dc8ff; box-shadow: 0 0 6px #00aaff; animation: pulse 1.5s ease-in-out infinite; }
  .chip-help { color: #4dc8ff55; font-size: 13px; text-decoration: none; padding: 0 2px; line-height: 1; transition: color 0.12s; }
  .chip-help:hover { color: #4dc8ff; }
  .chip-cancel { background: transparent; border: none; color: #3a5a70; font-size: 11px; cursor: pointer; padding: 0 0 0 8px; line-height: 1; }
  .chip-cancel:hover { color: #ff5555; }
</style>
