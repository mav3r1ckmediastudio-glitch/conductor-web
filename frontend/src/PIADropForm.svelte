<script>
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();

  // pending: a GeoJSON Feature already constructed by activateDropDuctTool,
  // with installation_method/drop_type/owner pre-set by onPlacePIADrop().
  // The form adds PIA-specific metadata then dispatches the updated feature.
  export let pending = null;

  let piaRef       = '';
  let openreachRef = '';
  let notes        = '';

  $: p = pending?.properties || {};
  $: displayId  = p.ddct_id   || '—';
  $: lengthM    = p.length_m  != null ? Math.round(p.length_m) + 'm' : '—';
  $: fromNode   = p.from_chamber || p.from_node || '—';
  $: uprn       = p.uprn || '—';

  function save() {
    const updated = {
      ...pending,
      properties: {
        ...p,
        pia_ref:       piaRef.trim(),
        openreach_ref: openreachRef.trim(),
        notes:         notes.trim(),
      },
    };
    dispatch('save', updated);
    reset();
  }

  function cancel() { dispatch('cancel'); reset(); }

  function reset() {
    piaRef = ''; openreachRef = ''; notes = '';
  }
</script>

{#if pending}
<div class="form">
  <div class="form-hdr">
    <span class="form-title">Digitise PIA UG Drop</span>
    <span class="form-id">{displayId}</span>
  </div>
  <div class="form-coords">
    {lengthM} · PIA_UG drop · From: <span style="color:#4dc8ff">{fromNode}</span>
    {#if uprn !== '—'} · UPRN: {uprn}{/if}
  </div>

  <div class="form-body">

    <div class="section-lbl">PIA IDENTITY</div>

    <div class="field readonly">
      <label for="a11y-piadropform-1">Drop Type</label>
      <input id="a11y-piadropform-1" value="PIA_UG" readonly />
    </div>
    <div class="field readonly">
      <label for="a11y-piadropform-2">Owner</label>
      <input id="a11y-piadropform-2" value="Openreach" readonly />
    </div>
    <div class="field readonly">
      <label for="a11y-piadropform-3">Installation Method</label>
      <input id="a11y-piadropform-3" value="PIA_UG" readonly />
    </div>
    <div class="field">
      <label for="a11y-piadropform-4">PIA Reference <span class="hint">Openreach asset reference</span></label>
      <input id="a11y-piadropform-4" bind:value={piaRef} placeholder="e.g. PIA-XXXXXX" />
    </div>
    <div class="field">
      <label for="a11y-piadropform-5">Openreach Reference <span class="hint">optional</span></label>
      <input id="a11y-piadropform-5" bind:value={openreachRef} placeholder="Additional Openreach ref" />
    </div>

    <div class="divider"></div>
    <div class="section-lbl">NOTES</div>

    <div class="field">
      <input bind:value={notes} placeholder="Wayleave notes, access conditions…" />
    </div>

  </div>

  <div class="form-actions">
    <button class="btn-cancel" on:click={cancel}>Cancel</button>
    <button class="btn-save" on:click={save}>Save PIA Drop</button>
  </div>
</div>
{/if}

<style>
  .form { display: flex; flex-direction: column; height: 100%; background: #0d1520; }
  .form-hdr { padding: 12px 14px 6px; border-bottom: none; display: flex; justify-content: space-between; align-items: baseline; flex-shrink: 0; }
  .form-title { font-size: 9px; color: #a0c4d8; letter-spacing: 0.14em; text-transform: uppercase; font-weight: 600; }
  .form-id { font-size: 11px; color: #4dc8ff; font-weight: 700; letter-spacing: 0.06em; font-family: 'Courier New', monospace; text-shadow: 0 0 8px #00aaff44; }
  .form-coords { padding: 2px 14px 8px; font-size: 8px; color: #3a5a70; letter-spacing: 0.04em; font-family: 'Courier New', monospace; border-bottom: 1px solid #1a2d40; flex-shrink: 0; line-height: 1.6; }
  .form-body { flex: 1; overflow-y: auto; padding: 10px 14px; display: flex; flex-direction: column; gap: 6px; }
  .section-lbl { font-size: 7.5px; color: #3a5a70; letter-spacing: 0.14em; text-transform: uppercase; margin-top: 4px; }
  .divider { height: 1px; background: #1a2d40; margin: 4px 0; }
  .hint { color: #2a4050; font-size: 7px; font-weight: normal; text-transform: none; letter-spacing: 0; }
  .field { display: flex; flex-direction: column; gap: 3px; }
  .field label { font-size: 8px; color: #6a8fa8; letter-spacing: 0.06em; text-transform: uppercase; }
  .field input, .field select {
    background: #080e14; border: 1px solid #1a2d40; color: #a0c4d8;
    font-family: 'Courier New', monospace; font-size: 10px;
    padding: 6px 8px; border-radius: 4px; outline: none;
    width: 100%; box-sizing: border-box;
  }
  .field input:focus, .field select:focus { border-color: #00aaff44; color: #4dc8ff; }
  .field input::placeholder { color: #2a4050; }
  .field.readonly input { color: #3a5a70; cursor: default; }
  .form-actions { display: flex; gap: 6px; padding: 10px 14px; border-top: 1px solid #1a2d40; flex-shrink: 0; }
  .btn-cancel { flex: 1; background: #0a1018; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; padding: 8px; border-radius: 4px; cursor: pointer; }
  .btn-cancel:hover { border-color: #2a4a5e; color: #a0c4d8; }
  .btn-save { flex: 2; background: #00aaff14; border: 1px solid #00aaff44; color: #4dc8ff; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; padding: 8px; border-radius: 4px; cursor: pointer; }
  .btn-save:hover { background: #00aaff22; }
</style>
