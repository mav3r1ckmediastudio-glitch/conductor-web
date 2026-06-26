<script>
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher();

  export let pending = null;

  let openreachRef = '';
  let poleType = '— not set —';
  let status = 'PROPOSED';
  let notes = '';

  const poleTypes = [
    '— not set —',
    'SOFTWOOD_7M', 'SOFTWOOD_9M', 'SOFTWOOD_11M',
    'CONCRETE_7M', 'CONCRETE_9M',
    'STEEL',
    'OTHER',
  ];

  const statuses = ['PROPOSED', 'SURVEY', 'INSTALLED'];

  function onSave() {
    dispatch('save', {
      pole_id: pending.pole_id,
      area_id: pending.area_id,
      pop_id: pending.pop_id,
      lng: pending.lng,
      lat: pending.lat,
      openreach_ref: openreachRef.trim() || null,
      pole_type: poleType !== '— not set —' ? poleType : null,
      status,
      notes: notes.trim() || null,
    });
    reset();
  }

  function onCancel() {
    dispatch('cancel');
    reset();
  }

  function reset() {
    openreachRef = '';
    poleType = '— not set —';
    status = 'PROPOSED';
    notes = '';
  }

  $: if (pending) {
    // Auto-focus first input when form loads
    setTimeout(() => {
      const el = document.querySelector('.form-pole-ref');
      if (el) el.focus();
    }, 0);
  }
</script>

<div class="pole-form">
  <div class="form-header">
    <span class="form-title">Place Pole</span>
    <span class="form-id">{pending?.pole_id || ''}</span>
  </div>

  <div class="form-section">
    <div class="form-section-title">IDENTITY</div>
    
    <div class="form-group">
      <label for="ref">Openreach Ref</label>
      <input
        id="ref"
        type="text"
        class="form-pole-ref"
        placeholder="Stamped on pole (optional)"
        bind:value={openreachRef}
      />
    </div>

    <div class="form-group">
      <label for="type">Pole Type</label>
      <select id="type" bind:value={poleType}>
        {#each poleTypes as t}
          <option value={t}>{t}</option>
        {/each}
      </select>
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
    <button class="btn-save" on:click={onSave}>Place Pole</button>
  </div>
</div>

<style>
  .pole-form {
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
