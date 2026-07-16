<script>
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();

  export let pending = null;
  // pending: { coordinates, duct_id, duct_seq, compass_leg, area_id, pop_id,
  //            from_node, from_node_type, to_node, to_node_type, length_m }

  let spurSuffix    = '';
  let crossingType  = 'DIRECTIONAL_DRILL';
  let ductType      = 'HDPE_50_40';
  let status        = 'PROPOSED';
  let owner         = 'Gigaloch';
  let watercourseId = '';
  let wayleaveReq   = true;
  let wayleaveId    = '';
  let permitRef     = '';
  let permitExpiry  = '';
  let enviroRef     = '';
  let piaRef        = '';
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
      duct_type:           ductType,
      installation_method: 'STREAM_CROSSING',
      crossing_type:       crossingType,
      watercourse_id:      watercourseId.trim(),
      status,
      owner:               owner.trim(),
      wayleave_req:        wayleaveReq,
      wayleave_id:         wayleaveId.trim(),
      permit_ref:          permitRef.trim(),
      permit_expiry:       permitExpiry.trim(),
      environmental_ref:   enviroRef.trim(),
      pia_ref:             piaRef.trim(),
      notes:               notes.trim(),
    });
    reset();
  }

  function cancel() { dispatch('cancel'); reset(); }

  function reset() {
    spurSuffix = ''; crossingType = 'DIRECTIONAL_DRILL'; ductType = 'HDPE_50_40';
    status = 'PROPOSED'; owner = 'Gigaloch'; watercourseId = '';
    wayleaveReq = true; wayleaveId = ''; permitRef = ''; permitExpiry = '';
    enviroRef = ''; piaRef = ''; notes = '';
  }
</script>

{#if pending}
<div class="form">
  <div class="form-hdr">
    <span class="form-title">Stream Crossing</span>
    <span class="form-id">{displayId}</span>
  </div>
  <div class="form-coords">
    {pending.length_m}m · {pending.coordinates.length} vertices
    · Leg: <span style="color:#4dc8ff">{pending.compass_leg}</span>
    · {pending.from_node} → {pending.to_node}
  </div>

  <div class="form-body">

    <div class="section-lbl">CROSSING</div>

    <div class="field">
      <label for="a11y-streamcrossingform-1">Crossing Method</label>
      <select id="a11y-streamcrossingform-1" bind:value={crossingType}>
        <option>DIRECTIONAL_DRILL</option>
        <option>MOLING</option>
        <option>OPEN_CUT</option>
        <option>FLUME</option>
        <option>BRIDGE_ATTACHED</option>
      </select>
    </div>
    <div class="field">
      <label for="a11y-streamcrossingform-2">Duct Type</label>
      <select id="a11y-streamcrossingform-2" bind:value={ductType}>
        <option>HDPE_50_40</option>
        <option>HDPE_63_51</option>
        <option>HDPE_110_94</option>
        <option>MDPE_25_21</option>
      </select>
    </div>
    <div class="field">
      <label for="a11y-streamcrossingform-3">Status</label>
      <select id="a11y-streamcrossingform-3" bind:value={status}>
        <option>PROPOSED</option>
        <option>PERMIT_APPLIED</option>
        <option>PERMITTED</option>
        <option>INSTALLED</option>
        <option>ABANDONED</option>
      </select>
    </div>
    <div class="field">
      <label for="a11y-streamcrossingform-4">Spur Suffix <span class="hint">leave blank for main route</span></label>
      <input id="a11y-streamcrossingform-4" bind:value={spurSuffix} placeholder="e.g. a, b" maxlength="6" />
    </div>

    <div class="divider"></div>
    <div class="section-lbl">WAYLEAVE & ENVIRONMENT</div>

    <div class="field">
      <label for="a11y-streamcrossingform-5">Watercourse ID <span class="hint">OS or EA reference</span></label>
      <input id="a11y-streamcrossingform-5" bind:value={watercourseId} placeholder="e.g. WC-1234567" />
    </div>
    <div class="check-row">
      <input type="checkbox" bind:checked={wayleaveReq} id="sc-wl" />
      <label for="sc-wl">Wayleave / riparian consent required</label>
    </div>
    {#if wayleaveReq}
    <div class="field">
      <label for="a11y-streamcrossingform-11">Wayleave ID</label>
      <input id="a11y-streamcrossingform-11" bind:value={wayleaveId} placeholder="Wayleave / consent reference" />
    </div>
    {/if}
    <div class="field">
      <label for="a11y-streamcrossingform-6">Environmental Permit Ref <span class="hint">EA / NatureScot</span></label>
      <input id="a11y-streamcrossingform-6" bind:value={enviroRef} placeholder="e.g. EPR/AB1234CD/A001" />
    </div>
    <div class="field">
      <label for="a11y-streamcrossingform-7">Consent / Permit Reference</label>
      <input id="a11y-streamcrossingform-7" bind:value={permitRef} placeholder="Planning / S50 ref (optional)" />
    </div>
    <div class="field">
      <label for="a11y-streamcrossingform-8">Permit Expiry</label>
      <input id="a11y-streamcrossingform-8" bind:value={permitExpiry} placeholder="e.g. 2025-12-31" />
    </div>

    <div class="divider"></div>
    <div class="section-lbl">OWNER & PIA</div>

    <div class="field">
      <label for="a11y-streamcrossingform-9">Owner</label>
      <input id="a11y-streamcrossingform-9" bind:value={owner} />
    </div>
    <div class="field">
      <label for="a11y-streamcrossingform-10">PIA Reference</label>
      <input id="a11y-streamcrossingform-10" bind:value={piaRef} placeholder="Openreach PIA ref (if applicable)" />
    </div>

    <div class="divider"></div>
    <div class="section-lbl">NOTES</div>

    <div class="field">
      <input bind:value={notes} placeholder="Bank conditions, species concerns, access notes…" />
    </div>

  </div>

  <div class="form-actions">
    <button class="btn-cancel" on:click={cancel}>Cancel</button>
    <button class="btn-save" on:click={save}>Save Crossing</button>
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
  .check-row { display: flex; align-items: center; gap: 8px; }
  .check-row label { font-size: 9px; color: #6a8fa8; cursor: pointer; }
  .form-actions { display: flex; gap: 6px; padding: 10px 14px; border-top: 1px solid #1a2d40; flex-shrink: 0; }
  .btn-cancel { flex: 1; background: #0a1018; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; padding: 8px; border-radius: 4px; cursor: pointer; }
  .btn-cancel:hover { border-color: #2a4a5e; color: #a0c4d8; }
  .btn-save { flex: 2; background: #00aaff14; border: 1px solid #00aaff44; color: #4dc8ff; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; padding: 8px; border-radius: 4px; cursor: pointer; }
  .btn-save:hover { background: #00aaff22; }
</style>
