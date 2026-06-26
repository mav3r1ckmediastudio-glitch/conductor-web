<script>
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher();

  export let pending = null;

  let cbtModel     = '';
  let status       = 'PROPOSED';
  let hasSplitter  = false;
  let splitRatio   = '';
  let cascadeLevel = '';
  let cascadeType  = '';
  let notes        = '';

  const statuses = ['PROPOSED', 'SURVEY', 'INSTALLED', 'LIVE'];

  function onSave() {
    if (hasSplitter) {
      if (!splitRatio)   { alert('Please select a Split Ratio.'); return; }
      if (!cascadeLevel) { alert('Please select a Cascade Level.'); return; }
    }

    dispatch('save', {
      cbt_id:         pending.cbt_id,
      parent_pole_id: pending.parent_pole_id,
      area_id:        pending.area_id,
      pop_id:         pending.pop_id,
      lng:            pending.lng,
      lat:            pending.lat,
      cbt_model:      cbtModel.trim() || null,
      status,
      has_splitter:   hasSplitter,
      split_ratio:    hasSplitter ? splitRatio   : null,
      cascade_level:  hasSplitter ? cascadeLevel : null,
      cascade_type:   hasSplitter ? cascadeType  : null,
      notes:          notes.trim() || null,
    });
    reset();
  }

  function onCancel() {
    dispatch('cancel');
    reset();
  }

  function reset() {
    cbtModel = ''; status = 'PROPOSED';
    hasSplitter = false; splitRatio = '';
    cascadeLevel = ''; cascadeType = ''; notes = '';
  }

  $: if (pending) {
    setTimeout(() => {
      const el = document.querySelector('.form-cbt-model');
      if (el) el.focus();
    }, 0);
  }
</script>

<div class="cbt-form">
  <div class="form-header">
    <span class="form-title">Place CBT</span>
    <span class="form-id">{pending?.cbt_id || ''}</span>
  </div>

  <div class="form-section">
    <div class="form-section-title">IDENTITY</div>

    <div class="form-group">
      <label for="parent">Parent Pole</label>
      <input id="parent" type="text" value={pending?.parent_pole_id || ''} readonly class="form-readonly" />
    </div>

    <div class="form-group">
      <label for="model">CBT Model</label>
      <input
        id="model"
        type="text"
        class="form-cbt-model"
        placeholder="e.g. Tyco / Prysmian (optional)"
        bind:value={cbtModel}
      />
    </div>

    <div class="form-group">
      <label for="status">Status</label>
      <select id="status" bind:value={status}>
        {#each statuses as s}
          <option value={s}>{s}</option>
        {/each}
      </select>
    </div>
  </div>

  <div class="form-section">
    <div class="form-section-title">SPLITTER</div>

    <label class="check-label">
      <input type="checkbox" bind:checked={hasSplitter} />
      <span>Contains passive optical splitter</span>
    </label>

    {#if hasSplitter}
      <div class="form-group" style="margin-top:10px">
        <label for="ratio">Split Ratio *</label>
        <select id="ratio" bind:value={splitRatio}>
          <option value="">— select —</option>
          <option>1:2</option>
          <option>1:4</option>
          <option>1:8</option>
          <option>1:16</option>
          <option>1:32</option>
        </select>
      </div>

      <div class="form-group">
        <label for="level">Cascade Level *</label>
        <select id="level" bind:value={cascadeLevel}>
          <option value="">— select —</option>
          <option value="1">1 — Primary</option>
          <option value="2">2 — Secondary</option>
        </select>
      </div>

      <div class="form-group">
        <label for="ctype">Cascade Type</label>
        <select id="ctype" bind:value={cascadeType}>
          <option value="">— not set —</option>
          <option>URBAN_1_2_1_16</option>
          <option>RURAL_1_4_1_8</option>
          <option>DIRECT_1_32</option>
        </select>
      </div>
    {/if}
  </div>

  <div class="form-section">
    <div class="form-section-title">NOTES</div>
    <input
      type="text"
      placeholder="Free text (optional)"
      bind:value={notes}
      class="form-notes"
    />
  </div>

  <div class="form-actions">
    <button class="btn-cancel" on:click={onCancel}>Cancel</button>
    <button class="btn-save" on:click={onSave}>Place CBT</button>
  </div>
</div>

<style>
  .cbt-form {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #0d1520;
    color: #6a8fa8;
  }

  .form-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: #0a0f14;
    border-bottom: 1px solid #1a2d40;
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .form-title {
    font-size: 13px;
    font-weight: bold;
    color: #7ab8d4;
  }

  .form-id {
    font-family: 'Courier New', monospace;
    font-size: 12px;
    color: #a0c4d8;
  }

  .form-section {
    padding: 12px 16px;
    border-bottom: 1px solid #1a2d40;
  }

  .form-section-title {
    font-size: 11px;
    font-weight: bold;
    color: #4dc8ff;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 10px;
  }

  label {
    font-size: 11px;
    color: #3a5a70;
    font-weight: 500;
  }

  input, select {
    padding: 6px 8px;
    background: #1a2d40;
    border: 1px solid #2a4a5e;
    color: #7ab8d4;
    font-size: 12px;
    border-radius: 2px;
  }

  input:focus, select:focus {
    outline: none;
    border-color: #4dc8ff;
    background: #0d1520;
    color: #a0c4d8;
  }

  input::placeholder {
    color: #2a4a5e;
  }

  .form-readonly {
    font-family: 'Courier New', monospace;
    color: #a0c4d8;
    background: #0a0f14;
    border-color: #1a2d40;
  }

  .check-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #6a8fa8;
    cursor: pointer;
  }

  .check-label input {
    width: auto;
    padding: 0;
  }

  .form-notes {
    margin-top: 6px;
  }

  .form-actions {
    display: flex;
    gap: 8px;
    padding: 12px 16px;
    margin-top: auto;
    border-top: 1px solid #1a2d40;
    background: #0a0f14;
  }

  .btn-cancel, .btn-save {
    flex: 1;
    padding: 8px 12px;
    font-size: 12px;
    font-weight: bold;
    border: none;
    border-radius: 2px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-cancel {
    background: #1a2d40;
    color: #7ab8d4;
  }

  .btn-cancel:hover {
    background: #2a4a5e;
    color: #a0c4d8;
  }

  .btn-save {
    background: #4dc8ff;
    color: #0a0f14;
  }

  .btn-save:hover {
    background: #00aaff;
    color: #0a0f14;
  }
</style>
