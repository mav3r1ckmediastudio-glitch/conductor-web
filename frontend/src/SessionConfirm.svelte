<script>
  // SessionConfirm.svelte
  // Mounted once at app root (see App.svelte). Shown when RMB ends a
  // continuous tool session (place/edit/delete/move — see
  // startToolSession() in mapTools.js). Styled to match
  // AssetPickerDialog.svelte, the existing dialog in this same select flow.
  //
  //   Save   — keep everything done since the session started.
  //   Cancel — full rollback to the state before the session started.
  //
  // Deliberately has NO backdrop-click-to-dismiss and NO Escape handling:
  // unlike AssetPickerDialog (a simple picker), dismissing this ambiguously
  // must not silently pick either Save or Cancel for the user.

  import { onMount, onDestroy } from 'svelte';
  import { onSessionConfirmRequest } from './sessionConfirm.js';

  let visible = false;
  let message = '';
  let resolvePromise = null;

  function handleRequest(msg) {
    message = msg;
    visible = true;
    return new Promise((resolve) => { resolvePromise = resolve; });
  }

  function choose(result) {
    visible = false;
    if (resolvePromise) { resolvePromise(result); resolvePromise = null; }
  }

  let unsubscribe;
  onMount(() => { unsubscribe = onSessionConfirmRequest(handleRequest); });
  onDestroy(() => { if (unsubscribe) unsubscribe(); });
</script>

{#if visible}
  <div class="sc-backdrop" role="presentation">
    <div class="sc" role="dialog" aria-modal="true" tabindex="-1">
      <div class="sc-hdr">
        <span class="sc-title">End Session</span>
      </div>

      <div class="sc-info">{message}</div>

      <div class="sc-actions">
        <button class="sc-save" on:click={() => choose('save')}>Save</button>
        <button class="sc-cancel" on:click={() => choose('cancel')}>Cancel</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .sc-backdrop {
    position: fixed; inset: 0; z-index: 4000;
    background: #00060bcc;
    display: flex; align-items: center; justify-content: center;
  }

  .sc {
    width: 340px; max-width: 90vw;
    background: #0a1018;
    border: 1px solid #1a2d40;
    border-radius: 6px;
    box-shadow: 0 12px 40px #000a, 0 0 0 1px #00aaff14;
    overflow: hidden;
    font-family: 'Courier New', monospace;
  }

  .sc-hdr {
    display: flex; align-items: center; gap: 8px;
    padding: 11px 14px;
    border-bottom: 1px solid #1a2d40;
    background: #0d1520;
  }
  .sc-title {
    flex: 1; font-size: 11px; font-weight: 700; letter-spacing: 0.1em;
    text-transform: uppercase; color: #4dc8ff; text-shadow: 0 0 8px #00aaff44;
  }

  .sc-info {
    padding: 14px 14px 8px;
    font-size: 9px; line-height: 1.6; color: #6a8fa8;
    letter-spacing: 0.03em;
  }

  .sc-actions {
    display: flex; gap: 8px;
    padding: 8px 14px 14px;
  }

  .sc-save, .sc-cancel {
    flex: 1;
    padding: 9px;
    border-radius: 4px;
    font-family: 'Courier New', monospace;
    font-size: 9px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
    cursor: pointer;
    transition: all 0.12s;
  }

  .sc-save {
    background: #00aaff1a;
    border: 1px solid #00aaff66;
    color: #4dc8ff;
  }
  .sc-save:hover { background: #00aaff2e; border-color: #4dc8ff; }

  .sc-cancel {
    background: #0f1c28;
    border: 1px solid #1a2d40;
    color: #6a8fa8;
  }
  .sc-cancel:hover { color: #ff8888; border-color: #ff555566; }
</style>
