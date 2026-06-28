<script>
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();

  export let pending = null;
  // pending: { coordinates, duct_id, duct_seq, compass_leg, area_id, pop_id,
  //            from_node, from_node_type, to_node, to_node_type, length_m }

  let spurSuffix    = '';
  let status        = 'PROPOSED';
  let piaRef        = '';
  let openreachRef  = '';
  let subductCount  = 1;   // number of subducts within this PIA section
  let surfaceType   = '';
  let depthM        = 0.45;
  let notes         = '';

  $: displayId = pending
    ? spurSuffix.trim()
      ? `${pending.area_id}-DUCT-${String(pending.duct_seq).padStart(3,'0')}(${spurSuffix.trim()})`
      : `${pending.area_id}-DUCT-${String(pending.duct_seq).padStart(3,'0')}`
    : '';

  function save() {
    dispatch('save', {
      coordinates:         pending.coordinates,
      duct_id:             displayId,
      duct_seq:            pending.duct_seq,
      spur_suffix:         spurSuffix.trim(),
      compass_leg:         pending.compass_leg,
      area_id:             pending.area_id,
      pop_id:              pending.pop_id,
      from_node:           pending.from_node,
      from_node_type:      pending.from_node_type,
      to_node:             pending.to_node,
      to_node_type:        pending.to_node_type,
      length_m:            pending.length_m,
      duct_type:           'PIA_SUBDUCT',
      installation_method: 'PIA_UG',
      owner:               'Openreach',
      status,
      pia_ref:             piaRef.trim(),
      openreach_ref:       openreachRef.trim(),
      subduct_count:       subductCount || 1,
      surface_type:        surfaceType,
      depth_m:             depthM,
      notes:               notes.trim(),
    });
    reset();
  }

  function cancel() { dispatch('cancel'); reset(); }

  function reset() {
    spurSuffix = ''; status = 'PROPOSED'; piaRef = ''; openreachRef = '';
    subductCount = 1; surfaceType = ''; depthM = 0.45; notes = '';
  }
</script>

{#if pending}
<div class="form">
  <div class="form-hdr">
    <span class="form-title">Digitise PIA UG Duct</span>
    <span class="form-id">{displayId}</span>
  </div>
  <div class="form-coords">
    {pending.length_m}m · {pending.coordinates.length} vertices
    · Leg: <span style="color:#4dc8ff">{pending.compass_leg}</span>
    · {pending.from_node} → {pending.to_node}
  </div>

  <div class="form-body">

    <div class="section-lbl">PIA IDENTITY</div>

    <div class="field readonly">
      <label>Duct Type</label>
      <input value="PIA_SUBDUCT" readonly />
    </div>
    <div class="field readonly">
      <label>Owner</label>
      <input value="Openreach" readonly />
    </div>
    <div class="field">
      <label>PIA Reference <span class="hint">required — Openreach asset ref</span></label>
      <input bind:value={piaRef} placeholder="e.g. PIA-XXXXXX" />
    </div>
    <div class="field">
      <label>Openreach Reference</label>
      <input bind:value={openreachRef} placeholder="Additional Openreach ref (optional)" />
    </div>
    <div class="field">
      <label>Status</label>
      <select bind:value={status}>
        <option>PROPOSED</option>
        <option>PERMIT_APPLIED</option>
        <option>PERMITTED</option>
        <option>INSTALLED</option>
        <option>ABANDONED</option>
      </select>
    </div>
    <div class="field">
      <label>Subduct Count <span class="hint">number of 22/17mm subducts in this section</span></label>
      <input type="number" bind:value={subductCount} min="1" max="12" style="width:80px" />
    </div>
    <div class="field">
      <label>Spur Suffix <span class="hint">leave blank for main route</span></label>
      <input bind:value={spurSuffix} placeholder="e.g. a, b" maxlength="6" />
    </div>

    <div class="divider"></div>
    <div class="section-lbl">PHYSICAL</div>

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
        <option>MIXED</option>
      </select>
    </div>
    <div class="field">
      <label>Depth (m)</label>
      <input type="number" bind:value={depthM} min="0" max="3" step="0.05" style="width:80px" />
    </div>

    <div class="divider"></div>
    <div class="section-lbl">NOTES</div>

    <div class="field">
      <input bind:value={notes} placeholder="Survey notes, PIA access conditions…" />
    </div>

  </div>

  <div class="form-actions">
    <button class="btn-cancel" on:click={cancel}>Cancel</button>
    <button class="btn-save" on:click={save}>Save PIA Duct</button>
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
