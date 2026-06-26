<script>
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();

  export let pending = null; // { lng, lat, chamber_id, chamber_seq, compass_dir, area_id, pop_id }

  // Identity
  let spurSuffix = '';
  let chamberType = 'ACCESS_CHAMBER';
  let chamberSize = 'SMALL';
  let ringCount = 4;
  let status = 'PROPOSED';

  // Physical
  let owner = 'Gigaloch';
  let piaRef = '';
  let lidType = '';
  let depthM = 0;
  let surfaceType = '';
  let piaChamberType = '';

  // Notes
  let photoRef = '';
  let notes = '';
  let openreachRef = '';

  // Derived chamber ID with optional spur suffix
  $: displayId = pending
    ? spurSuffix.trim()
      ? `${pending.area_id}-CMBR-${String(pending.chamber_seq).padStart(4,'0')}(${spurSuffix.trim()})`
      : `${pending.area_id}-CMBR-${String(pending.chamber_seq).padStart(4,'0')}`
    : '';

  $: dirLabel = pending ? ({
    N: 'North  (0001–0999)',
    S: 'South  (1001–1999)',
    W: 'West   (2001–2999)',
    E: 'East   (3001–3999)',
  }[pending.compass_dir] || pending.compass_dir) : '';

  function save() {
    dispatch('save', {
      lng: pending.lng, lat: pending.lat,
      chamber_id:       displayId,
      chamber_seq:      pending.chamber_seq,
      spur_suffix:      spurSuffix.trim(),
      compass_dir:      pending.compass_dir,
      pop_id:           pending.pop_id,
      area_id:          pending.area_id,
      chamber_type:     chamberType,
      chamber_size:     chamberSize,
      ring_count:       ringCount || null,
      status,
      owner:            owner.trim(),
      pia_ref:          piaRef.trim(),
      lid_type:         lidType,
      depth_m:          depthM || null,
      surface_type:     surfaceType,
      pia_chamber_type: piaChamberType,
      photo_ref:        photoRef.trim(),
      notes:            notes.trim(),
      openreach_ref:    openreachRef.trim(),
    });
    reset();
  }

  function cancel() { dispatch('cancel'); reset(); }

  function reset() {
    spurSuffix = ''; chamberType = 'ACCESS_CHAMBER'; chamberSize = 'SMALL';
    ringCount = 4; status = 'PROPOSED'; owner = 'Gigaloch';
    piaRef = ''; lidType = ''; depthM = 0; surfaceType = '';
    piaChamberType = ''; photoRef = ''; notes = ''; openreachRef = '';
  }
</script>

{#if pending}
<div class="form">
  <div class="form-hdr">
    <span class="form-title">Place Chamber</span>
    <span class="form-id">{displayId}</span>
  </div>
  <div class="form-coords">
    {pending.lng.toFixed(5)}, {pending.lat.toFixed(5)}
    &nbsp;·&nbsp; Direction: <span style="color:#4dc8ff">{pending.compass_dir}</span>
  </div>

  <div class="form-body">

    <div class="section-lbl">IDENTITY</div>

    <div class="field">
      <label>Spur Suffix <span class="hint">e.g. a, b, c1 — leave blank for main route</span></label>
      <input bind:value={spurSuffix} placeholder="blank = main route" maxlength="6" />
    </div>
    <div class="field readonly">
      <label>Direction from Cabinet</label>
      <input value={dirLabel} readonly />
    </div>
    <div class="field">
      <label>Chamber Function</label>
      <select bind:value={chamberType}>
        <option>ACCESS_CHAMBER</option>
        <option>JOINT</option>
        <option>BURIED_JOINT</option>
      </select>
    </div>
    <div class="field">
      <label>Chamber Size</label>
      <select bind:value={chamberSize}>
        <option>SMALL</option>
        <option>LARGE</option>
      </select>
    </div>
    <div class="field">
      <label>Ring Count <span class="hint">STAKKAbox rings, 0 for buried joint</span></label>
      <input type="number" bind:value={ringCount} min="0" max="10" style="width:80px" />
    </div>
    <div class="field">
      <label>Status</label>
      <select bind:value={status}>
        <option>PROPOSED</option>
        <option>SURVEY</option>
        <option>INSTALLED</option>
      </select>
    </div>

    <div class="divider"></div>
    <div class="section-lbl">PHYSICAL</div>

    <div class="field">
      <label>Owner</label>
      <input bind:value={owner} />
    </div>
    <div class="field">
      <label>PIA Reference <span class="hint">Openreach, if applicable</span></label>
      <input bind:value={piaRef} placeholder="e.g. PIA-XXXXXX" />
    </div>
    <div class="field">
      <label>Openreach Reference</label>
      <input bind:value={openreachRef} placeholder="Openreach asset ref (optional)" />
    </div>
    <div class="field">
      <label>Lid Type</label>
      <select bind:value={lidType}>
        <option value="">— not yet set —</option>
        <option>STEEL_CONCRETE</option>
        <option>IRON</option>
        <option>COMPOSITE</option>
        <option>RECESSED</option>
      </select>
    </div>
    <div class="field">
      <label>Depth (m)</label>
      <input type="number" bind:value={depthM} min="0" max="5" step="0.1" style="width:80px" />
    </div>
    <div class="field">
      <label>Surface Type</label>
      <select bind:value={surfaceType}>
        <option value="">— not yet set —</option>
        <option>TARMAC</option>
        <option>CONCRETE</option>
        <option>GRASS</option>
        <option>GRAVEL</option>
        <option>VERGE</option>
        <option>FOOTPATH</option>
      </select>
    </div>
    <div class="field">
      <label>PIA Chamber Type</label>
      <select bind:value={piaChamberType}>
        <option value="">— not applicable —</option>
        <option>STAKKABOX_FORTRESS</option>
        <option>OPENREACH_STANDARD</option>
        <option>BESPOKE</option>
      </select>
    </div>

    <div class="divider"></div>
    <div class="section-lbl">NOTES & REFS</div>

    <div class="field">
      <label>Photo Reference</label>
      <input bind:value={photoRef} placeholder="Photo filename or URL (optional)" />
    </div>
    <div class="field">
      <label>Notes</label>
      <input bind:value={notes} placeholder="Survey findings, access notes…" />
    </div>

  </div>

  <div class="form-actions">
    <button class="btn-cancel" on:click={cancel}>Cancel</button>
    <button class="btn-save" on:click={save}>Place Chamber</button>
  </div>
</div>
{/if}

<style>
  .form { display: flex; flex-direction: column; height: 100%; background: #0d1520; }
  .form-hdr { padding: 12px 14px 6px; border-bottom: none; display: flex; justify-content: space-between; align-items: baseline; flex-shrink: 0; }
  .form-title { font-size: 9px; color: #a0c4d8; letter-spacing: 0.14em; text-transform: uppercase; font-weight: 600; }
  .form-id { font-size: 11px; color: #4dc8ff; font-weight: 700; letter-spacing: 0.06em; font-family: 'Courier New', monospace; text-shadow: 0 0 8px #00aaff44; }
  .form-coords { padding: 2px 14px 8px; font-size: 8px; color: #3a5a70; letter-spacing: 0.06em; font-family: 'Courier New', monospace; border-bottom: 1px solid #1a2d40; flex-shrink: 0; }
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
