<script>
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();

  // pending: { coordinates, tail_id, area_id, pop_id,
  //            from_cbt, to_joint, via_poles[], node_chain[], node_types[], length_m }
  export let pending = null;

  // A CBT tail is normally the single feeder fibre into the CBT's splitter —
  // 1 is the normal case, not an edge case (confirmed 2 Jul 2026). Kept
  // editable rather than hardcoded, in case a tail legitimately needs more
  // some day, but '1' needs to actually exist as an option and be the
  // default it starts on, not something you have to know to change away
  // from '12' every single time.
  let fibreCount = '1';
  let fibreType  = 'G.657A2';
  let status     = 'PROPOSED';
  let notes      = '';

  // Branch classification (release-audit §3). A CBT tail from a splitter to a
  // CBT is normally an optical output leg, so we PROPOSE SPLITTER_OUTPUT — but
  // never silently assume it. The user must tick an explicit confirmation
  // before the tail can be placed as a splitter output; switching to
  // PASS_THROUGH clears that requirement.
  let feedMode     = 'SPLITTER_OUTPUT';
  let splitterId   = '';
  let splitterPort = '';
  let splitterConfirmed = false;

  // Proposed default splitter id: the upstream joint the tail terminates on.
  $: proposedSplitterId = pending && pending.to_joint ? `${pending.to_joint}-SP` : '';
  // Save is blocked until a proposed SPLITTER_OUTPUT is explicitly confirmed.
  $: needsConfirm = feedMode === 'SPLITTER_OUTPUT' && !splitterConfirmed;

  // Same formula as CableForm's display — a single loose tube covers up to
  // 12 fibres. For a tail's normal 1-fibre case this is just 1 tube.
  $: tubeCount = Math.max(1, Math.floor(parseInt(fibreCount) / 12));

  function save() {
    if (needsConfirm) return; // must confirm SPLITTER_OUTPUT first
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
      feed_mode:     feedMode,
      splitter_id:   feedMode === 'SPLITTER_OUTPUT' ? ((splitterId.trim() || proposedSplitterId) || null) : null,
      splitter_port: feedMode === 'SPLITTER_OUTPUT' && splitterPort !== '' ? parseInt(splitterPort, 10) : null,
      notes: notes.trim(),
    });
    reset();
  }

  function cancel() { dispatch('cancel'); reset(); }

  function reset() {
    fibreCount = '1'; fibreType = 'G.657A2'; status = 'PROPOSED'; notes = '';
    feedMode = 'SPLITTER_OUTPUT'; splitterId = ''; splitterPort = ''; splitterConfirmed = false;
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
      <label for="a11y-cbttailform-1">Tail ID</label>
      <input id="a11y-cbttailform-1" value={pending.tail_id} readonly />
    </div>
    <div class="field readonly">
      <label for="a11y-cbttailform-2">Length <span class="hint">true measured — BoM</span></label>
      <input id="a11y-cbttailform-2" value="{pending.length_m} m" readonly class="calc" />
    </div>
    <div class="field readonly">
      <label for="a11y-cbttailform-3">From CBT</label>
      <input id="a11y-cbttailform-3" value={pending.from_cbt} readonly class="calc" />
    </div>
    <div class="field readonly">
      <label for="a11y-cbttailform-4">To Joint</label>
      <input id="a11y-cbttailform-4" value={pending.to_joint} readonly class="calc" />
    </div>
    <div class="field readonly">
      <label for="a11y-cbttailform-5">Via Poles <span class="hint">route order</span></label>
      <input id="a11y-cbttailform-5" value={(pending.via_poles && pending.via_poles.length) ? pending.via_poles.join(' → ') : '— direct'} readonly class={pending.via_poles && pending.via_poles.length ? 'calc' : ''} />
    </div>

    <div class="divider"></div>
    <div class="section-lbl">FIBRE SPEC</div>

    <div class="field">
      <label for="a11y-cbttailform-6">Fibre Count *</label>
      <select id="a11y-cbttailform-6" bind:value={fibreCount}>
        <option>1</option>
        <option>2</option>
        <option>4</option>
        <option>8</option>
        <option>12</option>
        <option>24</option>
      </select>
    </div>
    <div class="field readonly">
      <label for="a11y-cbttailform-7">Tube Count <span class="hint">auto — fibres ÷ 12</span></label>
      <input id="a11y-cbttailform-7" value={tubeCount} readonly class="calc" />
    </div>
    <div class="field">
      <label for="a11y-cbttailform-8">Fibre Type</label>
      <select id="a11y-cbttailform-8" bind:value={fibreType}>
        <option>G.657A2</option>
        <option>G.657A1</option>
        <option>G.652D</option>
      </select>
    </div>
    <div class="field">
      <label for="a11y-cbttailform-9">Status</label>
      <select id="a11y-cbttailform-9" bind:value={status}>
        <option>PROPOSED</option>
        <option>SURVEY</option>
        <option>INSTALLED</option>
        <option>LIVE</option>
      </select>
    </div>

    <div class="divider"></div>
    <div class="section-lbl">BRANCH CLASSIFICATION</div>

    <div class="field">
      <label for="a11y-cbttailform-10">Feed Mode *</label>
      <select id="a11y-cbttailform-10" bind:value={feedMode} data-testid="tail-feed-mode">
        <option value="SPLITTER_OUTPUT">SPLITTER_OUTPUT — optical leg of the splitter (proposed)</option>
        <option value="PASS_THROUGH">PASS_THROUGH — raw fibres continue downstream</option>
      </select>
    </div>
    {#if feedMode === 'SPLITTER_OUTPUT'}
      <div class="field">
        <label for="a11y-cbttailform-11">Splitter ID <span class="hint">upstream splitter</span></label>
        <input id="a11y-cbttailform-11" bind:value={splitterId} placeholder={proposedSplitterId || 'e.g. JNT-001-SP'} data-testid="tail-splitter-id" />
      </div>
      <div class="field">
        <label for="a11y-cbttailform-12">Splitter Port <span class="hint">optical output number</span></label>
        <input id="a11y-cbttailform-12" bind:value={splitterPort} type="number" min="1" placeholder="e.g. 1" data-testid="tail-splitter-port" />
      </div>
      <label class="confirm-row">
        <input type="checkbox" bind:checked={splitterConfirmed} data-testid="tail-splitter-confirm" />
        <span>Confirm this tail is a splitter output leg</span>
      </label>
    {/if}

    <div class="divider"></div>
    <div class="section-lbl">NOTES</div>

    <div class="field">
      <label for="a11y-cbttailform-13">Notes</label>
      <input id="a11y-cbttailform-13" bind:value={notes} placeholder="Optional notes" />
    </div>

  </div>

  <div class="form-actions">
    <button class="btn-cancel" on:click={cancel}>Cancel</button>
    <button class="btn-save" on:click={save} disabled={needsConfirm} data-testid="tail-place">Place Tail</button>
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
  .confirm-row { display: flex; align-items: center; gap: 6px; font-size: 8.5px; color: #a0c4d8; letter-spacing: 0.04em; text-transform: none; cursor: pointer; margin-top: 2px; }
  .confirm-row input { width: auto; }
</style>
