<script>
  // SaveNudge.svelte — one-time "save this project to a file?" banner.
  // Extracted from App.svelte (16 Jul 2026 refactor). Purely presentational:
  // App.svelte owns WHEN it shows (once per session, when stage hits
  // 'design' with no file bound) — this only renders it and reports clicks.
  // Styles copied verbatim, including the fsaaPulse keyframes it animates
  // with (Svelte scopes keyframes per-component, so the definition must
  // travel with the rule that references it).
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();
</script>

<div class="save-nudge" role="alert">
  <span>Save this project to a file? Keeps your work safe on disk with autosave.</span>
  <button class="sn-save" on:click={() => dispatch('save')}>Save File</button>
  <button class="sn-dismiss" on:click={() => dispatch('dismiss')} title="Dismiss">✕</button>
</div>

<style>
  @keyframes fsaaPulse { 0%,100% { box-shadow: 0 0 0 0 #00aaff00; } 50% { box-shadow: 0 0 8px 0 #00aaff44; } }

  .save-nudge {
    position: fixed; top: 56px; right: 16px; z-index: 200;
    display: flex; align-items: center; gap: 10px;
    background: #0d1520; border: 1px solid #00aaff55; border-radius: 6px;
    padding: 10px 12px; box-shadow: 0 8px 24px #00000088;
    font-family: 'Courier New', monospace; font-size: 10.5px; color: #a0c4d8;
    max-width: 320px; animation: fsaaPulse 2.5s ease-in-out infinite;
  }
  .sn-save { background: #102030; border: 1px solid #4dc8ff; color: #4dc8ff; font-size: 9px; letter-spacing: 0.05em; padding: 4px 10px; border-radius: 4px; cursor: pointer; white-space: nowrap; }
  .sn-save:hover { background: #15273a; }
  .sn-dismiss { background: transparent; border: none; color: #5b7488; cursor: pointer; font-size: 11px; padding: 2px 4px; }
  .sn-dismiss:hover { color: #a0c4d8; }
</style>
