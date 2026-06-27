<script>
  // AssetEditPanel.svelte
  // Shown when rpMode === 'asset-selected'.
  // Receives a selected asset descriptor and emits:
  //   on:close        — user dismissed / cancelled
  //   on:deleted      — asset deleted; parent calls projectStore + syncToMap
  //   on:saved        — asset properties edited; detail = { collection, index, props }
  //   on:move         — user wants to move the asset; parent activates move tool

  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();

  // asset descriptor set by App.svelte when a pick succeeds:
  // { collection, index, feature, assetType, assetId, label }
  export let selected = null;

  let confirmingDelete = false;
  let editMode = false;

  // Editable fields — built reactively from the selected feature's properties.
  let editProps = {};

  $: if (selected) {
    confirmingDelete = false;
    editMode = false;
    editProps = { ...selected.feature.properties };
  }

  // ── Field metadata ─────────────────────────────────────────────────────────
  // Which fields to SHOW in view mode, and which to allow EDITING.
  // Keys not listed here are still preserved on save — they just won't show.

  const FIELD_META = {
    // Point assets
    chamber:  { show: ['chamber_id','chamber_type','compass_dir','pop_id','notes'],
                edit: ['chamber_type','notes'] },
    joint:    { show: ['joint_id','joint_type','chamber_id','has_splitter','split_ratio','notes'],
                edit: ['joint_type','has_splitter','split_ratio','notes'] },
    pole:     { show: ['pole_id','pop_id','notes'],
                edit: ['notes'] },
    cbt:      { show: ['cbt_id','parent_pole_id','cbt_type','fibre_count','notes'],
                edit: ['cbt_type','fibre_count','notes'] },
    // Line assets
    duct:     { show: ['duct_id','duct_type','length_m','from_node','to_node','notes'],
                edit: ['duct_type','notes'] },
    cable:    { show: ['cable_id','cable_type','fibre_count','length_m','from_node','to_node','notes'],
                edit: ['cable_type','fibre_count','notes'] },
    dropduct: { show: ['ddct_id','length_m','from_node','to_node','notes'],
                edit: ['notes'] },
    bundle:   { show: ['bundle_id','from_node','to_node','notes'],
                edit: ['notes'] },
    span:     { show: ['span_id','span_type','length_m','from_node','to_node','notes'],
                edit: ['span_type','notes'] },
    adrop:    { show: ['adrop_id','length_m','from_node','to_node','notes'],
                edit: ['notes'] },
    cbttail:  { show: ['tail_id','cable_type','from_cbt','to_joint','length_m','notes'],
                edit: ['notes'] },
  };

  // Enum options for select fields
  const ENUMS = {
    chamber_type: ['DISTRIBUTION','JOINT','POP','CUSTOMER'],
    joint_type:   ['SPLICE','SPLITTER','PASS-THROUGH'],
    has_splitter: ['true','false'],
    split_ratio:  ['1:2','1:4','1:8','1:16','1:32'],
    duct_type:    ['MAIN','BRANCH','STUB','PIA_SUBDUCT'],
    cable_type:   ['FEEDER','DISTRIBUTION','DROP','AERIAL_TAIL'],
    cbt_type:     ['STANDARD','COMPACT'],
    span_type:    ['AERIAL','LASH','FIGURE8'],
  };

  function meta() {
    return FIELD_META[selected?.assetType] || { show: [], edit: [] };
  }

  function displayValue(key, val) {
    if (val === null || val === undefined || val === '') return '—';
    if (key === 'length_m') return `${val} m`;
    return String(val);
  }

  function isEditable(key) {
    return meta().edit.includes(key);
  }

  function fieldType(key) {
    if (ENUMS[key]) return 'select';
    if (key === 'notes') return 'textarea';
    return 'text';
  }

  function isPointAsset() {
    return ['chamber','joint','pole','cbt'].includes(selected?.assetType);
  }

  function onSave() {
    dispatch('saved', {
      collection: selected.collection,
      index:      selected.index,
      props:      { ...selected.feature.properties, ...editProps },
    });
    editMode = false;
  }

  function onDelete() {
    dispatch('deleted', {
      collection: selected.collection,
      index:      selected.index,
    });
  }

  function onMove() {
    dispatch('move', {
      collection: selected.collection,
      index:      selected.index,
      feature:    selected.feature,
    });
  }

  function onClose() {
    editMode = false;
    confirmingDelete = false;
    dispatch('close');
  }
</script>

{#if selected}
<div class="aep">

  <!-- Header -->
  <div class="aep-hdr">
    <div class="aep-type">{selected.label}</div>
    <div class="aep-id">{selected.assetId}</div>
    <button class="aep-close" on:click={onClose} title="Dismiss">✕</button>
  </div>

  <!-- Property rows -->
  <div class="aep-body">
    {#if !editMode}
      {#each meta().show as key}
        {#if selected.feature.properties[key] !== undefined}
          <div class="arow">
            <span class="ak">{key.replace(/_/g,' ')}</span>
            <span class="av">{displayValue(key, selected.feature.properties[key])}</span>
          </div>
        {/if}
      {/each}
    {:else}
      <!-- Edit fields -->
      {#each meta().show as key}
        {#if selected.feature.properties[key] !== undefined}
          <div class="arow-edit">
            <label class="edit-lbl">{key.replace(/_/g,' ')}</label>
            {#if !isEditable(key)}
              <span class="av locked">{displayValue(key, selected.feature.properties[key])}</span>
            {:else if fieldType(key) === 'select'}
              <select class="edit-sel" bind:value={editProps[key]}>
                {#each ENUMS[key] as opt}
                  <option value={opt}>{opt}</option>
                {/each}
              </select>
            {:else if fieldType(key) === 'textarea'}
              <textarea class="edit-ta" rows="2" bind:value={editProps[key]}></textarea>
            {:else}
              <input class="edit-inp" type="text" bind:value={editProps[key]} />
            {/if}
          </div>
        {/if}
      {/each}
    {/if}
  </div>

  <!-- Delete confirm banner -->
  {#if confirmingDelete}
    <div class="del-confirm">
      <div class="del-warn">Delete {selected.assetId}? This cannot be undone.</div>
      <div class="del-btns">
        <button class="del-yes" on:click={onDelete}>Yes, Delete</button>
        <button class="del-no" on:click={() => confirmingDelete = false}>Cancel</button>
      </div>
    </div>
  {/if}

  <!-- Action buttons -->
  <div class="aep-actions">
    {#if !editMode}
      <button class="act-btn edit" on:click={() => { editMode = true; editProps = { ...selected.feature.properties }; }}>✎ Edit</button>
      {#if isPointAsset()}
        <button class="act-btn move" on:click={onMove}>⇄ Move</button>
      {/if}
      <button class="act-btn del" on:click={() => confirmingDelete = !confirmingDelete}>✕ Delete</button>
    {:else}
      <button class="act-btn save" on:click={onSave}>✓ Save</button>
      <button class="act-btn cancel" on:click={() => { editMode = false; confirmingDelete = false; }}>✕ Cancel</button>
    {/if}
  </div>

</div>
{/if}

<style>
  .aep { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

  .aep-hdr { padding: 12px 14px 10px; border-bottom: 1px solid #1a2d40; flex-shrink: 0; display: flex; align-items: flex-start; gap: 8px; }
  .aep-type { font-size: 7.5px; color: #3a5a70; letter-spacing: 0.12em; text-transform: uppercase; flex: 1; margin-top: 2px; }
  .aep-id { font-size: 13px; font-weight: 700; letter-spacing: 0.07em; color: #4dc8ff; text-shadow: 0 0 8px #00aaff44; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px; }
  .aep-close { background: transparent; border: none; color: #3a5a70; font-size: 12px; cursor: pointer; padding: 0; line-height: 1; flex-shrink: 0; }
  .aep-close:hover { color: #ff5555; }

  .aep-body { flex: 1; overflow-y: auto; padding: 4px 14px; }

  .arow { display: flex; justify-content: space-between; align-items: center; padding: 5px 0; border-bottom: 1px solid #080e14; }
  .arow-edit { display: flex; flex-direction: column; gap: 3px; padding: 5px 0; border-bottom: 1px solid #080e14; }
  .ak { font-size: 8.5px; color: #6a8fa8; text-transform: uppercase; letter-spacing: 0.05em; }
  .av { font-size: 8.5px; color: #a0c4d8; text-align: right; }
  .av.locked { color: #3a5a70; font-style: italic; }

  .edit-lbl { font-size: 7.5px; color: #3a5a70; text-transform: uppercase; letter-spacing: 0.08em; }
  .edit-inp, .edit-sel, .edit-ta {
    width: 100%; background: #080e14; border: 1px solid #1a2d40; color: #a0c4d8;
    font-family: 'Courier New', monospace; font-size: 9px; padding: 4px 7px;
    border-radius: 3px; outline: none;
  }
  .edit-inp:focus, .edit-sel:focus, .edit-ta:focus { border-color: #00aaff44; }
  .edit-ta { resize: vertical; min-height: 40px; }
  .edit-sel option { background: #0d1520; }

  .del-confirm { margin: 0 14px 0; padding: 10px; background: #ff555514; border: 1px solid #ff555533; border-radius: 4px; flex-shrink: 0; }
  .del-warn { font-size: 8.5px; color: #ff5555; letter-spacing: 0.04em; margin-bottom: 8px; }
  .del-btns { display: flex; gap: 6px; }
  .del-yes { flex: 1; background: #ff555520; border: 1px solid #ff555555; color: #ff5555; font-family: 'Courier New', monospace; font-size: 8px; letter-spacing: 0.06em; text-transform: uppercase; padding: 5px; border-radius: 3px; cursor: pointer; }
  .del-yes:hover { background: #ff555533; }
  .del-no { flex: 1; background: #0f1c28; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 8px; letter-spacing: 0.06em; text-transform: uppercase; padding: 5px; border-radius: 3px; cursor: pointer; }
  .del-no:hover { color: #a0c4d8; }

  .aep-actions { padding: 10px 14px; display: flex; gap: 5px; border-top: 1px solid #1a2d40; flex-shrink: 0; }
  .act-btn { flex: 1; background: #0a1018; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 8px; letter-spacing: 0.06em; text-transform: uppercase; padding: 6px 4px; border-radius: 4px; cursor: pointer; text-align: center; transition: all 0.12s; }
  .act-btn.edit:hover  { border-color: #00aaff44; color: #4dc8ff; }
  .act-btn.move:hover  { border-color: #ffaa4444; color: #ffaa44; }
  .act-btn.del:hover   { border-color: #ff555544; color: #ff5555; }
  .act-btn.save        { border-color: #00aaff44; color: #4dc8ff; background: #00aaff0a; }
  .act-btn.save:hover  { background: #00aaff18; }
  .act-btn.cancel:hover { border-color: #ff555544; color: #ff5555; }
</style>
