<script>
  // WirelessForm.svelte — one form for all three wireless asset kinds (site,
  // sector, link), driven by the field specs in wirelessFields.js so required-
  // ness is defined once and matches the analysis rules.
  import { createEventDispatcher } from 'svelte';
  import { FIELDS_BY_KIND, initialValues, validateFields } from './wirelessFields.js';

  const dispatch = createEventDispatcher();

  export let kind = 'site';           // 'site' | 'sector' | 'link'
  export let mode = 'create';         // 'create' | 'edit'
  export let assetId = '';
  export let subtitle = '';           // e.g. "S1 → S2"
  export let existing = null;         // properties when editing
  export let defaults = {};           // carried values when creating
  export let presets = [];            // selectable presets, default first — see wirelessPresets.js
  let presetId = '';
  $: if (!presetId && presets.length) presetId = presets[0].id;
  $: preset = presets.find(p => p.id === presetId) || presets[0] || null;
  export let note = '';               // live hint for sectors: what the current azimuth points at
  export let aimSet = null;           // { deg, n } — the map handle was dragged; n increases on every move

  const TITLES = { site: 'Wireless Site', sector: 'Sector Antenna', link: 'Point-to-Point Link' };

  $: fields = FIELDS_BY_KIND[kind];
  let values = {};
  let errors = {};
  let touched = false;
  let initFor = '';

  // Re-initialise when the target changes (not on every keystroke).
  $: key = `${kind}|${mode}|${assetId}`;
  $: if (key !== initFor) {
    initFor = key;
    values = initialValues(fields, existing || {}, defaults || {});
    errors = {};
    touched = false;
  }

  $: sections = fields.reduce((acc, f) => {
    (acc[f.section] = acc[f.section] || []).push(f);
    return acc;
  }, {});

  function onSave() {
    touched = true;
    const r = validateFields(fields, values);
    errors = r.errors;
    if (!r.ok) return;
    dispatch('save', r.props);
  }
  $: if (touched) errors = validateFields(fields, values).errors;

  // Map drag -> form: the handle on the map sets the azimuth box.
  let lastAim = 0;
  $: if (aimSet && aimSet.n !== lastAim) { lastAim = aimSet.n; values = { ...values, azimuth_deg: String(aimSet.deg) }; }

  // Form -> map: tell the app what the sector currently looks like so it can
  // draw the ghost fan and handle (typing an azimuth moves the handle too).
  const numOrNull = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  $: if (kind === 'sector') dispatch('preview', { azimuth: numOrNull(values.azimuth_deg), beamwidth: numOrNull(values.beamwidth_deg), range: numOrNull(values.range_m) });

  // Overwrite only the preset's fields in the form (e.g. to replace bad values
  // on an existing link). Nothing is saved until "Save".
  function applyPreset() {
    if (!preset) return;
    const next = { ...values };
    for (const [k, v] of Object.entries(preset.values)) next[k] = v == null ? '' : String(v);
    values = next;
  }
</script>

<div class="wform">
  <div class="form-header">
    <span class="form-title">{mode === 'edit' ? 'Edit' : 'Add'} {TITLES[kind]}</span>
    <span class="form-id">{assetId}</span>
  </div>
  {#if subtitle}<div class="subtitle">{subtitle}</div>{/if}
  {#if note}<div class="note" data-testid="wf-note">{note}</div>{/if}
  {#if preset}
    <div class="preset">
      <div class="preset-t">{mode === 'create' ? 'Pre-filled from' : 'Preset'}:
        {#if presets.length > 1}
          <select data-testid="wf-preset-select" bind:value={presetId}>{#each presets as p}<option value={p.id}>{p.name}</option>{/each}</select>
        {:else}<b>{preset.name}</b>{/if}
      </div>
      <div class="preset-h" data-testid="wf-preset-note">{preset.note}</div>
      <button class="btn-preset" data-testid="wf-apply-preset" on:click={applyPreset}>{mode === 'create' ? 'Reset to preset values' : 'Fill with preset values'}</button>
    </div>
  {/if}

  <div class="body">
    {#each Object.entries(sections) as [title, list]}
      <div class="form-section">
        <div class="form-section-title">{title}</div>
        {#each list as f (f.key)}
          <div class="form-group" class:bad={errors[f.key]}>
            {#if f.type === 'boolean'}
              <label class="chk"><input id={'wf-' + f.key} type="checkbox" bind:checked={values[f.key]} /> {f.label}</label>
            {:else}
              <label for={'wf-' + f.key}>{f.label}{#if f.required}<span class="req"> *</span>{/if}</label>
              <input
                id={'wf-' + f.key}
                type={f.type === 'number' ? 'text' : 'text'}
                inputmode={f.type === 'number' ? 'decimal' : 'text'}
                autocomplete="off"
                bind:value={values[f.key]}
                data-testid={'wf-input-' + f.key}
              />
            {/if}
            {#if errors[f.key]}<div class="err" data-testid={'wf-error-' + f.key}>{errors[f.key]}</div>
            {:else if f.help}<div class="help">{f.help}</div>{/if}
          </div>
        {/each}
      </div>
    {/each}
  </div>

  <div class="form-actions">
    <button class="btn-cancel" on:click={() => dispatch('cancel')}>Cancel</button>
    <button class="btn-save" data-testid="wf-save" on:click={onSave}>{mode === 'edit' ? 'Save changes' : 'Add ' + TITLES[kind]}</button>
  </div>
</div>

<style>
  .wform { display: flex; flex-direction: column; height: 100%; background: #0d1520; color: #6a8fa8; }
  .form-header { display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: #0a0f14; border-bottom: 1px solid #1a2d40; position: sticky; top: 0; z-index: 10; }
  .form-title { font-size: 13px; font-weight: bold; color: #7ab8d4; }
  .form-id { font-family: 'Courier New', monospace; font-size: 12px; color: #a0c4d8; }
  .subtitle { padding: 6px 16px; font-size: 11px; color: #3a5a70; border-bottom: 1px solid #1a2d40; }
  .body { overflow-y: auto; flex: 1; }
  .note { padding: 8px 16px; font-size: 11px; line-height: 1.4; color: #9adfc0; border-bottom: 1px solid #1a2d40; }
  .preset { padding: 8px 16px; border-bottom: 1px solid #1a2d40; display: flex; flex-direction: column; gap: 4px; }
  .preset-t { font-size: 11px; color: #7ab8d4; } .preset-t b { color: #4dc8ff; }
  .preset-t select { display: block; width: 100%; margin-top: 4px; padding: 4px 6px; background: #1a2d40; color: #a0c4d8; border: 1px solid #2a4a5e; border-radius: 2px; font-size: 11px; }
  .preset-h { font-size: 10px; color: #2f5068; line-height: 1.4; }
  .btn-preset { align-self: flex-start; padding: 4px 10px; font-size: 11px; background: #1a2d40; color: #7ab8d4; border: 1px solid #2a4a5e; border-radius: 2px; cursor: pointer; }
  .btn-preset:hover { background: #2a4a5e; color: #a0c4d8; }
  .form-section { padding: 12px 16px; border-bottom: 1px solid #1a2d40; }
  .form-section-title { font-size: 11px; font-weight: bold; color: #4dc8ff; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
  .form-group { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
  label { font-size: 11px; color: #3a5a70; font-weight: 500; }
  .req { color: #ff8a5c; }
  .chk { display: flex; gap: 8px; align-items: center; color: #7ab8d4; }
  input[type='text'] { padding: 6px 8px; background: #1a2d40; border: 1px solid #2a4a5e; color: #7ab8d4; font-size: 12px; border-radius: 2px; }
  input[type='text']:focus { outline: none; border-color: #4dc8ff; background: #0d1520; color: #a0c4d8; }
  .bad input[type='text'] { border-color: #ff5c5c; }
  .err { font-size: 10px; color: #ff8a8a; }
  .help { font-size: 10px; color: #2f5068; line-height: 1.4; }
  .form-actions { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid #1a2d40; background: #0a0f14; }
  .btn-cancel, .btn-save { flex: 1; padding: 8px 12px; font-size: 12px; font-weight: bold; border: none; border-radius: 2px; cursor: pointer; transition: all 0.2s; }
  .btn-cancel { background: #1a2d40; color: #7ab8d4; }
  .btn-cancel:hover { background: #2a4a5e; color: #a0c4d8; }
  .btn-save { background: #4dc8ff; color: #0a0f14; }
  .btn-save:hover { background: #00aaff; }
</style>
