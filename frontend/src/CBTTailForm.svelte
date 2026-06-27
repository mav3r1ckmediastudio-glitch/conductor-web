<script>
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();

  // pending: { coordinates, tail_id, area_id, pop_id,
  //            from_cbt, to_joint, via_poles[], node_chain[], node_types[], length_m }
  export let pending = null;

  let fibreCount = '12';
  let fibreType  = 'G.657A2';
  let status     = 'PROPOSED';
  let notes      = '';

  // A tail of 12f uses one loose tube; keep parity with CableForm's display.
  $: tubeCount = Math.max(1, Math.floor(parseInt(fibreCount) / 12));

  function save() {
    dispatch('save', {
      coordinates:  pending.coordinates,
      tail_id:      pending.tail_id,
      area_id:      pending.area_id,
      pop_id:       pending.pop_id,
      from_cbt:     pending.from_cbt,
      to_joint:     pending.to_joint,
      via_poles:    pending.via_poles || [],
      node_chain:   pending.node_chain || [],
      node_types:   pending.node_types || [],
      length_m:     pending.length_m,
      cable_type:   'AERIAL_TAIL',
      fibre_count:  parseInt(fibreCount),
      tube_count:   tubeCount,
      fibre_type:   fibreType,
      status,
      notes: notes.trim(),
    });
    reset();
  }

  function cancel() { dispatch('cancel'); reset(); }

  function reset() {
    fibreCount = '12'; fibreType = 'G.657A2'; status = 'PROPOSED'; notes = '';
  }
</script>

{#if pending}
<div class="form">
  <div class="form-hdr">
    <span class="form-title">Draw CBT Tail</span>
    <span class="form-id">{pending.tail_id}</span>
  </div>
  <div class="form-coords">
    <span style="color:#4dc8ff">CBT</span> {pending.from_cbt}
    &nbsp;→&nbsp;
    <span style="color:#4dc8ff">JOINT</span> {pending.to_joint}
    &nbsp;·&nbsp; {pending.length_m} m
  </div>

  <div class="form-body">

    <div class="section-lbl">IDENTITY</div>

    <div class="field readonly">
      <label>Tail ID</label>
      <input value={pending.tail_id} readonly />
    </div>
    <div class="field readonly">
      <label>Length <span class="hint">true measured — BoM</span></label>
      <input value="{pending.length_m} m" readonly class="calc" />
    </div>
    <div class="field readonly">
      <label>From CBT</label>
      <input value={pending.from_cbt} readonly class="calc" />
    </div>
    <div class="field readonly">
      <label>To Joint</label>
      <input value={pending.to_joint} readonly class="calc" />
    </div>
    <div class="field readonly">
      <label>Via Poles <span class="hint">route order</span></label>
      <input value={(pending.via_poles && pending.via_poles.length) ? pending.via_poles.join(' → ') : '— direct'} readonly class={pending.via_poles && pending.via_poles.length ? 'calc' : ''} />
    </div>

    <div class="divider"></div>
    <div class="section-lbl">FIBRE SPEC</div>

    <div class="field">
      <label>Fibre Count *</label>
      <select bind:value={fibreCount}>
        <option>2</option>
        <option>4</option>
        <option>8</option>
        <option>12</option>
        <option>24</option>
      </select>
    </div>
    <div class="field readonly">
      <label>Tube Count <span class="hint">auto — fibres ÷ 12</span></label>
      <input value={tubeCount} readonly class="calc" />
    </div>
    <div class="field">
      <label>Fibre Type</label>
      <select bind:value={fibreType}>
        <option>G.657A2</option>
        <option>G.657A1</option>
        <option>G.652D</option>
      </select>
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
    <div class="section-lbl">NOTES</div>

    <div class="field">
      <label>Notes</label>
      <input bind:value={notes} placeholder="Optional notes" />
    </div>

  </div>

  <div class="form-actions">
    <button class="btn-cancel" on:click={cancel}>Cancel</button>
    <button class="btn-save" on:click={save}>Place Tail</button>
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
  .field input, .field select {
    background: #080e14; border: 1px solid #1a2d40; color: #a0c4d8;
    font-family: 'Courier New', monospace; font-size: 10px;
    padding: 6px 8px; border-radius: 4px; outline: none;
    width: 100%; box-sizing: border-box;
  }
  .field input:focus, .field select:focus { border-color: #00aaff44; color: #4dc8ff; }
  .field input::placeholder { color: #2a4050; }
  .field.readonly input { color: #3a5a70; cursor: default; }
  .field input.calc { color: #4dc8ff; }
  .form-actions { display: flex; gap: 6px; padding: 10px 14px; border-top: 1px solid #1a2d40; flex-shrink: 0; }
  .btn-cancel { flex: 1; background: #0a1018; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; padding: 8px; border-radius: 4px; cursor: pointer; }
  .btn-cancel:hover { border-color: #2a4a5e; color: #a0c4d8; }
  .btn-save { flex: 2; background: #00aaff14; border: 1px solid #00aaff44; color: #4dc8ff; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; padding: 8px; border-radius: 4px; cursor: pointer; }
  .btn-save:hover { background: #00aaff22; }
</style>
