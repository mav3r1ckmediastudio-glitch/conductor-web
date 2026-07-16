<script>
  // AssetPickerDialog.svelte
  // Shown when a single click lands on multiple overlapping assets (e.g. a CBT
  // mounted on a pole, or a span terminating on a pole). Lets the user choose
  // which asset to act on. Ported from the Conductor v2 QGIS picker dialog.
  //
  //   on:choose  — detail = the selected hit descriptor
  //   on:cancel  — user dismissed without choosing

  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();

  // Array of hit descriptors: { collection, index, feature, assetType, assetId, label, dist }
  export let hits = [];

  function choose(hit) {
    dispatch('choose', hit);
  }

  function cancel() {
    dispatch('cancel');
  }

  function onKeydown(e) {
    if (e.key === 'Escape') cancel();
  }
</script>

<svelte:window on:keydown={onKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="apd-backdrop" on:click={cancel} role="presentation">
  <div class="apd" on:click|stopPropagation role="dialog" aria-modal="true" tabindex="-1">
    <div class="apd-hdr">
      <span class="apd-title">Multiple Assets Here</span>
      <button class="apd-close" on:click={cancel} title="Cancel">✕</button>
    </div>

    <div class="apd-info">
      These assets overlap at the point you clicked. Choose which one to work with:
    </div>

    <div class="apd-list">
      {#each hits as hit}
        <button class="apd-item" on:click={() => choose(hit)}>
          <span class="apd-item-type">{hit.label}</span>
          <span class="apd-item-id">{hit.assetId}</span>
        </button>
      {/each}
    </div>

    <button class="apd-cancel" on:click={cancel}>Cancel</button>
  </div>
</div>

<style>
  .apd-backdrop {
    position: fixed; inset: 0; z-index: 4000;
    background: #00060bcc;
    display: flex; align-items: center; justify-content: center;
  }

  .apd {
    width: 360px; max-width: 90vw;
    background: #0a1018;
    border: 1px solid #1a2d40;
    border-radius: 6px;
    box-shadow: 0 12px 40px #000a, 0 0 0 1px #00aaff14;
    overflow: hidden;
    font-family: 'Courier New', monospace;
  }

  .apd-hdr {
    display: flex; align-items: center; gap: 8px;
    padding: 11px 14px;
    border-bottom: 1px solid #1a2d40;
    background: #0d1520;
  }
  .apd-title {
    flex: 1; font-size: 11px; font-weight: 700; letter-spacing: 0.1em;
    text-transform: uppercase; color: #4dc8ff; text-shadow: 0 0 8px #00aaff44;
  }
  .apd-close {
    background: transparent; border: none; color: #3a5a70;
    font-size: 12px; cursor: pointer; padding: 0; line-height: 1;
  }
  .apd-close:hover { color: #ff5555; }

  .apd-info {
    padding: 11px 14px 8px;
    font-size: 9px; line-height: 1.5; color: #6a8fa8;
    letter-spacing: 0.03em;
  }

  .apd-list {
    display: flex; flex-direction: column; gap: 5px;
    padding: 4px 14px 8px;
    max-height: 280px; overflow-y: auto;
  }

  .apd-item {
    display: flex; align-items: center; gap: 10px;
    padding: 9px 12px;
    background: #080e14;
    border: 1px solid #1a2d40;
    border-radius: 4px;
    cursor: pointer;
    text-align: left;
    transition: all 0.12s;
  }
  .apd-item:hover {
    border-color: #00aaff44;
    background: #00aaff0a;
  }
  .apd-item-type {
    flex-shrink: 0;
    font-size: 7.5px; letter-spacing: 0.12em; text-transform: uppercase;
    color: #3a5a70;
    min-width: 86px;
  }
  .apd-item:hover .apd-item-type { color: #6a8fa8; }
  .apd-item-id {
    flex: 1;
    font-size: 11px; font-weight: 700; letter-spacing: 0.05em;
    color: #4dc8ff;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  .apd-cancel {
    width: calc(100% - 28px); margin: 0 14px 14px;
    padding: 8px;
    background: #0f1c28;
    border: 1px solid #1a2d40;
    border-radius: 4px;
    color: #6a8fa8;
    font-family: 'Courier New', monospace;
    font-size: 8px; letter-spacing: 0.06em; text-transform: uppercase;
    cursor: pointer;
  }
  .apd-cancel:hover { color: #a0c4d8; border-color: #3a5a70; }
</style>
