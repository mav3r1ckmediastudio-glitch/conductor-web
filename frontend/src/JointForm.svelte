<script>
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();

  // pending: { lng, lat, joint_id, chamber_id, chamber_seq, pop_id, area_id }
  export let pending = null;

  let jointType     = 'SPLICE';
  let closureType   = '';
  let fibreIn       = 0;
  let fibreOut      = 0;
  let status        = 'PROPOSED';
  let hasSplitter   = false;
  let splitRatio    = '';
  let cascadeLevel  = '';
  let cascadeType   = '';
  let notes         = '';

  // Splitter only valid on SPLICE joints
  $: if (jointType !== 'SPLICE') { hasSplitter = false; }

  function save() {
    if (hasSplitter) {
      if (!splitRatio)   { alert('Please select a Split Ratio.'); return; }
      if (!cascadeLevel) { alert('Please select a Cascade Level.'); return; }
    }
    dispatch('save', {
      lng:           pending.lng,
      lat:           pending.lat,
      joint_id:      pending.joint_id,
      chamber_id:    pending.chamber_id,
      pop_id:        pending.pop_id,
      area_id:       pending.area_id,
      joint_type:    jointType,
      closure_type:  closureType.trim(),
      fibre_in:      fibreIn  || null,
      fibre_out:     fibreOut || null,
      status,
      has_splitter:  hasSplitter,
      split_ratio:   hasSplitter ? splitRatio  : null,
      cascade_level: hasSplitter ? cascadeLevel : null,
      cascade_type:  hasSplitter ? cascadeType  : null,
      notes:         notes.trim(),
    });
    reset();
  }

  function cancel() { dispatch('cancel'); reset(); }

  function reset() {
    jointType = 'SPLICE'; closureType = ''; fibreIn = 0; fibreOut = 0;
    status = 'PROPOSED'; hasSplitter = false; splitRatio = '';
    cascadeLevel = ''; cascadeType = ''; notes = '';
  }
</script>

{#if pending}
<div class="form">
  <div class="form-hdr">
    <span class="form-title">Place Joint</span>
    <span class="form-id">{pending.joint_id}</span>
  </div>
  <div class="form-coords">
    {pending.lng.toFixed(5)}, {pending.lat.toFixed(5)}
    &nbsp;·&nbsp; Chamber: <span style="color:#4dc8ff">{pending.chamber_id}</span>
  </div>

  <div class="form-body">

    <div class="section-lbl">IDENTITY</div>

    <div class="field readonly">
      <label>Joint ID</label>
      <input value={pending.joint_id} readonly />
    </div>
    <div class="field readonly">
      <label>Parent Chamber</label>
      <input value={pending.chamber_id} readonly />
    </div>
    <div class="field">
      <label>Joint Type *</label>
      <select bind:value={jointType}>
        <option>SPLICE</option>
        <option>BLOWING_POINT</option>
        <option>END_OF_LINE</option>
      </select>
    </div>
    <div class="field">
      <label>Closure Model <span class="hint">e.g. Commscope ADP-FS4 (optional)</span></label>
      <input bind:value={closureType} placeholder="Manufacturer / model" />
    </div>
    <div class="field row">
      <div style="flex:1;">
        <label>Fibres In</label>
        <input type="number" bind:value={fibreIn} min="0" max="288" />
      </div>
      <div style="flex:1;">
        <label>Fibres Out</label>
        <input type="number" bind:value={fibreOut} min="0" max="288" />
      </div>
    </div>
    <div class="field">
      <label>Status</label>
      <select bind:value={status}>
        <option>PROPOSED</option>
        <option>SURVEY</option>
        <option>INSTALLED</option>
        <option>LIVE</option>
      </select>
    </div>

    <div class="divider"></div>
    <div class="section-lbl">SPLITTER <span class="hint">leave unchecked for through-splice or blowing point</span></div>

    <div class="field check">
      <label class="check-label">
        <input type="checkbox" bind:checked={hasSplitter} disabled={jointType !== 'SPLICE'} />
        <span>Contains passive optical splitter</span>
      </label>
    </div>

    {#if hasSplitter}
    <div class="field">
      <label>Split Ratio *</label>
      <select bind:value={splitRatio}>
        <option value="">— select —</option>
        <option>1:2</option>
        <option>1:4</option>
        <option>1:8</option>
        <option>1:16</option>
        <option>1:32</option>
      </select>
    </div>
    <div class="field">
      <label>Cascade Level *</label>
      <select bind:value={cascadeLevel}>
        <option value="">— select —</option>
        <option value="1">1 — Primary</option>
        <option value="2">2 — Secondary</option>
      </select>
    </div>
    <div class="field">
      <label>Cascade Type</label>
      <select bind:value={cascadeType}>
        <option value="">— not set —</option>
        <option>URBAN_1_2_1_16</option>
        <option>RURAL_1_4_1_8</option>
        <option>DIRECT_1_32</option>
      </select>
    </div>
    {/if}

    <div class="divider"></div>
    <div class="section-lbl">NOTES</div>

    <div class="field">
      <label>Notes</label>
      <input bind:value={notes} placeholder="Free text notes (optional)" />
    </div>

  </div>

  <div class="form-actions">
    <button class="btn-cancel" on:click={cancel}>Cancel</button>
    <button class="btn-save" on:click={save}>Place Joint</button>
  </div>
</div>
{/if}

<style>
  .form { display: flex; flex-direction: column; height: 100%; background: #0d1520; }
  .form-hdr { padding: 12px 14px 6px; display: flex; justify-content: space-between; align-items: baseline; flex-shrink: 0; }
  .form-title { font-size: 9px; color: #a0c4d8; letter-spacing: 0.14em; text-transform: uppercase; font-weight: 600; }
  .form-id { font-size: 11px; color: #4dc8ff; font-weight: 700; letter-spacing: 0.06em; font-family: 'Courier New', monospace; text-shadow: 0 0 8px #00aaff44; }
  .form-coords { padding: 2px 14px 8px; font-size: 8px; color: #3a5a70; letter-spacing: 0.06em; font-family: 'Courier New', monospace; border-bottom: 1px solid #1a2d40; flex-shrink: 0; }
  .form-body { flex: 1; overflow-y: auto; padding: 10px 14px; display: flex; flex-direction: column; gap: 6px; }
  .section-lbl { font-size: 7.5px; color: #3a5a70; letter-spacing: 0.14em; text-transform: uppercase; margin-top: 4px; }
  .divider { height: 1px; background: #1a2d40; margin: 4px 0; }
  .hint { color: #2a4050; font-size: 7px; font-weight: normal; text-transform: none; letter-spacing: 0; }
  .field { display: flex; flex-direction: column; gap: 3px; }
  .field label { font-size: 8px; color: #6a8fa8; letter-spacing: 0.06em; text-transform: uppercase; }
  .field.row { flex-direction: row; gap: 8px; }
  .field.row > div { display: flex; flex-direction: column; gap: 3px; }
  .field.row label { font-size: 8px; color: #6a8fa8; letter-spacing: 0.06em; text-transform: uppercase; }
  .field input, .field select {
    background: #080e14; border: 1px solid #1a2d40; color: #a0c4d8;
    font-family: 'Courier New', monospace; font-size: 10px;
    padding: 6px 8px; border-radius: 4px; outline: none;
    width: 100%; box-sizing: border-box;
  }
  .field input:focus, .field select:focus { border-color: #00aaff44; color: #4dc8ff; }
  .field input::placeholder { color: #2a4050; }
  .field.readonly input { color: #3a5a70; cursor: default; }
  .field.check { flex-direction: row; align-items: center; }
  .check-label { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 9px; color: #a0c4d8; text-transform: none; letter-spacing: 0; }
  .check-label input[type="checkbox"] { width: 14px; height: 14px; accent-color: #4dc8ff; cursor: pointer; }
  .check-label input[type="checkbox"]:disabled { opacity: 0.3; cursor: not-allowed; }
  .form-actions { display: flex; gap: 6px; padding: 10px 14px; border-top: 1px solid #1a2d40; flex-shrink: 0; }
  .btn-cancel { flex: 1; background: #0a1018; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; padding: 8px; border-radius: 4px; cursor: pointer; }
  .btn-cancel:hover { border-color: #2a4a5e; color: #a0c4d8; }
  .btn-save { flex: 2; background: #00aaff14; border: 1px solid #00aaff44; color: #4dc8ff; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; padding: 8px; border-radius: 4px; cursor: pointer; }
  .btn-save:hover { background: #00aaff22; }
</style>
