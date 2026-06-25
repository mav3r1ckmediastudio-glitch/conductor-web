<script>
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();

  export let areaId = '';

  let areaName = '';
  let phase = 1;
  let status = 'PLANNED';
  let notes = '';
  let error = '';

  function save() {
    if (!areaName.trim()) { error = 'Area name is required.'; return; }
    error = '';
    dispatch('save', { area_id: areaId, area_name: areaName.trim(), phase, status, notes: notes.trim() });
  }

  function cancel() { dispatch('cancel'); }
</script>

<div class="form">
  <div class="form-hdr">
    <span class="form-title">Define Build Area</span>
    <span class="form-id">{areaId}</span>
  </div>
  <div class="form-sub">Step 2 of 3 — Polygon digitised on map</div>

  <div class="form-body">
    <div class="section-lbl">IDENTITY</div>

    <div class="field">
      <label>Area Name *</label>
      <input bind:value={areaName} placeholder="e.g. Tarvin Village" />
    </div>

    <div class="field">
      <label>Phase</label>
      <input type="number" bind:value={phase} min="1" max="99" style="width:80px;" />
    </div>

    <div class="field">
      <label>Status</label>
      <select bind:value={status}>
        <option>PLANNED</option>
        <option>HLD</option>
        <option>MLD</option>
        <option>LLD</option>
        <option>BUILD</option>
        <option>LIVE</option>
      </select>
    </div>

    <div class="divider"></div>
    <div class="section-lbl">NOTES</div>

    <div class="field">
      <input bind:value={notes} placeholder="Free text notes (optional)" />
    </div>

    {#if error}
      <div class="err">{error}</div>
    {/if}
  </div>

  <div class="form-actions">
    <button class="btn-cancel" on:click={cancel}>Cancel</button>
    <button class="btn-save" on:click={save}>Save Build Area →</button>
  </div>
</div>

<style>
  .form { display: flex; flex-direction: column; height: 100%; background: #0d1520; }
  .form-hdr { padding: 12px 14px 4px; border-bottom: none; display: flex; justify-content: space-between; align-items: baseline; flex-shrink: 0; }
  .form-title { font-size: 9px; color: #a0c4d8; letter-spacing: 0.14em; text-transform: uppercase; font-weight: 600; }
  .form-id { font-size: 12px; color: #4dc8ff; font-weight: 700; letter-spacing: 0.06em; font-family: 'Courier New', monospace; text-shadow: 0 0 8px #00aaff44; }
  .form-sub { padding: 2px 14px 10px; font-size: 8px; color: #3a5a70; letter-spacing: 0.06em; border-bottom: 1px solid #1a2d40; flex-shrink: 0; }
  .form-body { flex: 1; overflow-y: auto; padding: 10px 14px; display: flex; flex-direction: column; gap: 8px; }
  .section-lbl { font-size: 7.5px; color: #3a5a70; letter-spacing: 0.14em; text-transform: uppercase; }
  .divider { height: 1px; background: #1a2d40; margin: 2px 0; }
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
  .err { font-size: 8.5px; color: #ff5555; font-family: 'Courier New', monospace; }
  .form-actions { display: flex; gap: 6px; padding: 10px 14px; border-top: 1px solid #1a2d40; flex-shrink: 0; }
  .btn-cancel { flex: 1; background: #0a1018; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; padding: 8px; border-radius: 4px; cursor: pointer; }
  .btn-cancel:hover { border-color: #2a4a5e; color: #a0c4d8; }
  .btn-save { flex: 2; background: #00aaff14; border: 1px solid #00aaff44; color: #4dc8ff; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; padding: 8px; border-radius: 4px; cursor: pointer; }
  .btn-save:hover { background: #00aaff22; }
</style>
