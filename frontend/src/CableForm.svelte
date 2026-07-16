<script>
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();

  // pending: { coordinates, cable_id, area_id, pop_id,
  //            from_node, from_node_type, to_node, to_node_type,
  //            length_m, duct_id }
  export let pending = null;

  let cableType  = 'DISTRIBUTION';
  let fibreCount = '48';
  let fibreType  = 'G.657A2';
  let status     = 'PROPOSED';
  let notes      = '';

  // Branch classification (release-audit §3): how this cable is fed from its
  // upstream node. PASS_THROUGH = raw fibres continue downstream and carry
  // demand; SPLITTER_OUTPUT = an optical output leg of the upstream splitter
  // (then splitter_id / splitter_port identify which leg). No default — the
  // classification must be a DELIBERATE choice (a silent PASS_THROUGH default
  // would bypass inferred-classification protection for a cable leaving a
  // splitter), so Place stays disabled until the user picks a mode (and, for a
  // splitter output, supplies its splitter id + port).
  let feedMode     = '';
  let splitterId   = '';
  let splitterPort = '';

  $: tubeCount = Math.floor(parseInt(fibreCount) / 12);

  // Place is enabled only once the branch is deliberately + completely classified.
  $: canSave = feedMode === 'PASS_THROUGH' ||
    (feedMode === 'SPLITTER_OUTPUT' && splitterId.trim() !== '' && splitterPort !== '' && parseInt(splitterPort, 10) >= 1);

  function save() {
    dispatch('save', {
      coordinates:    pending.coordinates,
      cable_id:       pending.cable_id,
      area_id:        pending.area_id,
      pop_id:         pending.pop_id,
      duct_id:        pending.duct_id || null,
      cable_type:     cableType,
      fibre_count:    parseInt(fibreCount),
      tube_count:     tubeCount,
      fibre_type:     fibreType,
      from_node:      pending.from_node,
      from_node_type: pending.from_node_type,
      to_node:        pending.to_node,
      to_node_type:   pending.to_node_type,
      length_m:       pending.length_m,
      status,
      feed_mode:      feedMode,
      splitter_id:    feedMode === 'SPLITTER_OUTPUT' ? (splitterId.trim() || null) : null,
      splitter_port:  feedMode === 'SPLITTER_OUTPUT' && splitterPort !== '' ? parseInt(splitterPort, 10) : null,
      notes: notes.trim(),
    });
    reset();
  }

  function cancel() { dispatch('cancel'); reset(); }

  function reset() {
    cableType = 'DISTRIBUTION'; fibreCount = '48';
    fibreType = 'G.657A2'; status = 'PROPOSED'; notes = '';
    feedMode = ''; splitterId = ''; splitterPort = '';
  }
</script>

{#if pending}
<div class="form">
  <div class="form-hdr">
    <span class="form-title">Digitise Cable</span>
    <span class="form-id">{pending.cable_id}</span>
  </div>
  <div class="form-coords">
    <span style="color:#4dc8ff">{pending.from_node_type}</span> {pending.from_node}
    &nbsp;→&nbsp;
    <span style="color:#4dc8ff">{pending.to_node_type}</span> {pending.to_node}
    &nbsp;·&nbsp; {pending.length_m} m
  </div>

  <div class="form-body">

    <div class="section-lbl">IDENTITY</div>

    <div class="field readonly">
      <label for="a11y-cableform-1">Cable ID</label>
      <input id="a11y-cableform-1" value={pending.cable_id} readonly />
    </div>
    <div class="field readonly">
      <label for="a11y-cableform-2">Length</label>
      <input id="a11y-cableform-2" value="{pending.length_m} m" readonly class="calc" />
    </div>
    <div class="field readonly">
      <label for="a11y-cableform-3">Parent Duct</label>
      <input id="a11y-cableform-3" value={pending.duct_id || '— not matched'} readonly class={pending.duct_id ? 'calc' : ''} />
    </div>

    <div class="divider"></div>
    <div class="section-lbl">CABLE SPEC</div>

    <div class="field">
      <label for="a11y-cableform-4">Cable Type *</label>
      <select id="a11y-cableform-4" bind:value={cableType}>
        <option>FEEDER</option>
        <option>DISTRIBUTION</option>
        <option>BACKHAUL</option>
        <option>AERIAL</option>
      </select>
    </div>
    <div class="field">
      <label for="a11y-cableform-5">Fibre Count *</label>
      <select id="a11y-cableform-5" bind:value={fibreCount}>
        <option>12</option>
        <option>24</option>
        <option>48</option>
        <option>96</option>
        <option>144</option>
      </select>
    </div>
    <div class="field readonly">
      <label for="a11y-cableform-6">Tube Count <span class="hint">auto — fibres ÷ 12</span></label>
      <input id="a11y-cableform-6" value={tubeCount} readonly class="calc" />
    </div>
    <div class="field">
      <label for="a11y-cableform-7">Fibre Type</label>
      <select id="a11y-cableform-7" bind:value={fibreType}>
        <option>G.657A2</option>
        <option>G.657A1</option>
        <option>G.652D</option>
      </select>
    </div>
    <div class="field">
      <label for="a11y-cableform-8">Status</label>
      <select id="a11y-cableform-8" bind:value={status}>
        <option>PROPOSED</option>
        <option>SURVEY</option>
        <option>INSTALLED</option>
        <option>LIVE</option>
      </select>
    </div>

    <div class="divider"></div>
    <div class="section-lbl">BRANCH CLASSIFICATION</div>

    <div class="field">
      <label for="a11y-cableform-9">Feed Mode *</label>
      <select id="a11y-cableform-9" bind:value={feedMode} data-testid="cable-feed-mode">
        <option value="" disabled>Select feed mode…</option>
        <option value="PASS_THROUGH">PASS_THROUGH — raw fibres continue downstream</option>
        <option value="SPLITTER_OUTPUT">SPLITTER_OUTPUT — optical leg of the upstream splitter</option>
      </select>
    </div>
    {#if feedMode === 'SPLITTER_OUTPUT'}
      <div class="field">
        <label for="a11y-cableform-10">Splitter ID <span class="hint">upstream splitter, e.g. JNT-001-SP</span></label>
        <input id="a11y-cableform-10" bind:value={splitterId} placeholder="{pending.from_node ? pending.from_node + '-SP' : 'e.g. JNT-001-SP'}" data-testid="cable-splitter-id" />
      </div>
      <div class="field">
        <label for="a11y-cableform-11">Splitter Port <span class="hint">optical output number</span></label>
        <input id="a11y-cableform-11" bind:value={splitterPort} type="number" min="1" placeholder="e.g. 1" data-testid="cable-splitter-port" />
      </div>
    {/if}

    <div class="divider"></div>
    <div class="section-lbl">NOTES</div>

    <div class="field">
      <label for="a11y-cableform-12">Notes</label>
      <input id="a11y-cableform-12" bind:value={notes} placeholder="Optional notes" />
    </div>

  </div>

  <div class="form-actions">
    <button class="btn-cancel" on:click={cancel}>Cancel</button>
    <button class="btn-save" on:click={save} disabled={!canSave}
            title={canSave ? '' : 'Choose a feed mode first'} data-testid="cable-place">Place Cable</button>
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
  .btn-save:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-save:disabled:hover { background: #00aaff14; }
</style>
