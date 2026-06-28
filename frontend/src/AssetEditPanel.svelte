<script>
  // AssetEditPanel.svelte
  // Shown when rpMode === 'asset-selected'.
  // Receives a selected asset descriptor and emits:
  //   on:close        — user dismissed / cancelled
  //   on:deleted      — asset deleted; parent calls projectStore + syncToMap
  //   on:saved        — asset properties edited; detail = { collection, index, props }
  //   on:move         — user wants to move the asset; parent activates move tool

  import { createEventDispatcher } from 'svelte';
  import { projectStore } from './projectStore.js';
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
    cbt:      { show: ['cbt_id','parent_pole_id','cbt_type','has_splitter','split_ratio','cascade_level','cascade_type','fibre_count','fibre_in','fibre_out','feeder_port','notes'],
                edit: ['cbt_type','has_splitter','split_ratio','cascade_level','cascade_type','fibre_count','notes'] },
    // Line assets
    duct:     { show: ['duct_id','duct_type','length_m','from_node','to_node','notes'],
                edit: ['duct_type','notes'] },
    cable:    { show: ['cable_id','cable_type','fibre_count','length_m','from_node','to_node','notes'],
                edit: ['cable_type','fibre_count','notes'] },
    dropduct: { show: ['ddct_id','length_m','from_node','to_node','notes'],
                edit: ['notes'] },
    bundle:   { show: ['bundle_id','from_node','to_node','notes'],
                edit: ['notes'] },
    span:     { show: ['span_id','cable_type','fibre_count','span_type','length_m','from_node','to_node','notes'],
                edit: ['cable_type','fibre_count','span_type','notes'] },
    adrop:    { show: ['adrop_id','cable_type','fibre_count','splitter_port','length_m','from_node','to_node','notes'],
                edit: ['cable_type','fibre_count','notes'] },
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
    fibre_count:  [2,4,8,12,24,48,96,144,288],
    cascade_level:['1 — Primary','2 — Secondary'],
    cascade_type: ['URBAN_1_2_1_16','RURAL_1_4_1_8','DIRECT_1_32'],
  };

  // Per-asset-type enum overrides. The same field name (e.g. cable_type) means
  // different things on different assets — a UG cable picks FEEDER/DISTRIBUTION,
  // an aerial span is AERIAL_SPAN, an aerial drop is AERIAL_DROP. Keyed by
  // assetType → field → options. Falls back to ENUMS when no override exists.
  const ENUMS_BY_TYPE = {
    span:  { cable_type: ['AERIAL_SPAN','AERIAL_TAIL'] },
    adrop: { cable_type: ['AERIAL_DROP'] },
  };

  function enumFor(key) {
    const t = selected?.assetType;
    if (t && ENUMS_BY_TYPE[t] && ENUMS_BY_TYPE[t][key]) return ENUMS_BY_TYPE[t][key];
    return ENUMS[key] || null;
  }

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
    if (enumFor(key)) return 'select';
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

  // ── Splitter port grid (derived) ───────────────────────────────────────────
  // Faithful to v2: the port→premise map is NOT stored on the CBT. It is derived
  // live from the consumers (aerial drops for a CBT, bundles for a UG joint)
  // pointing at this splitter, read by their splitter_port. Single source of
  // truth — editing/adding a drop and re-running Auto-Assign just reflows here.
  function ratioCap(r) { const m = String(r || '').match(/:(\d+)/); return m ? parseInt(m[1], 10) : 8; }

  $: portGrid = buildPortGrid(selected);

  function buildPortGrid(sel) {
    if (!sel) return null;
    const t = sel.assetType;
    const p = sel.feature.properties;

    let cap, consumers, keyField, keyVal, idField;
    if (t === 'cbt') {
      cap = ratioCap(p.split_ratio || '1:8');
      consumers = projectStore.aerialDrops;
      keyField = 'from_cbt'; keyVal = p.cbt_id; idField = 'adrop_id';
    } else if (t === 'joint' &&
               (p.has_splitter === true || p.has_splitter === 1 || p.has_splitter === 'true')) {
      cap = ratioCap(p.split_ratio || '1:8');
      consumers = projectStore.bundles;
      keyField = 'from_joint'; keyVal = p.joint_id; idField = 'bundle_id';
    } else {
      return null;
    }

    // uprn → address lookup
    const addr = {};
    for (const ap of projectStore.addressPoints || []) {
      addr[String(ap.properties.uprn)] = ap.properties.address || ap.properties.postcode || '';
    }

    const mine = (consumers || []).filter(c => String(c.properties[keyField]) === String(keyVal));
    const ports = [];
    for (let i = 1; i <= cap; i++) ports.push({ port: i, uprn: null, label: null, assetId: null });

    let unassigned = 0;
    for (const c of mine) {
      const sp = c.properties.splitter_port;
      if (sp == null || sp < 1 || sp > cap) { unassigned++; continue; }
      const slot = ports.find(x => x.port === sp);
      if (slot) {
        const u = c.properties.uprn;
        slot.uprn = u != null ? String(u) : null;
        slot.assetId = c.properties[idField] || '';
        slot.label = u != null
          ? (String(u) + (addr[String(u)] ? '  ' + addr[String(u)] : ''))
          : (c.properties[idField] || '');
      }
    }

    return {
      cap,
      ports,
      unassigned,
      total: mine.length,
      anyAssigned: ports.some(x => x.uprn != null),
    };
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
                {#each enumFor(key) as opt}
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

    {#if !editMode && portGrid}
      <div class="port-section">
        <div class="port-hdr">
          <span class="port-title">Splitter Ports</span>
          <span class="port-cap">1:{portGrid.cap}</span>
        </div>
        {#if portGrid.anyAssigned}
          <div class="port-grid">
            {#each portGrid.ports as pt}
              <div class="port-row">
                <span class="port-pill">PO{pt.port}</span>
                {#if pt.uprn}
                  <span class="port-val active" title={pt.label}>{pt.label}</span>
                {:else}
                  <span class="port-val spare">Spare</span>
                {/if}
              </div>
            {/each}
          </div>
          {#if portGrid.unassigned > 0}
            <div class="port-warn">{portGrid.unassigned} consumer{portGrid.unassigned === 1 ? '' : 's'} not yet assigned a port — re-run Auto-Assign Fibres.</div>
          {/if}
        {:else}
          <div class="port-empty">
            {portGrid.total > 0
              ? `${portGrid.total} consumer${portGrid.total === 1 ? '' : 's'} connected — run Auto-Assign Fibres to populate ports.`
              : 'No premises connected to this splitter yet.'}
          </div>
        {/if}
      </div>
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

  /* ── Splitter port grid ── */
  .port-section { margin-top: 12px; padding-top: 10px; border-top: 1px solid #1a2d40; }
  .port-hdr { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .port-title { font-size: 8px; color: #3a5a70; letter-spacing: 0.12em; text-transform: uppercase; }
  .port-cap { font-size: 8px; color: #4dc8ff; background: #00aaff14; border: 1px solid #00aaff33; border-radius: 10px; padding: 1px 8px; letter-spacing: 0.06em; }
  .port-grid { display: flex; flex-direction: column; gap: 4px; }
  .port-row { display: flex; align-items: center; gap: 7px; }
  .port-pill { flex-shrink: 0; min-width: 34px; text-align: center; background: #0f1c28; color: #7ab8d4; border: 1px solid #1a2d40; border-radius: 3px; padding: 2px 6px; font-size: 8.5px; font-weight: 700; letter-spacing: 0.04em; }
  .port-val { flex: 1; font-size: 8.5px; padding: 3px 8px; border-radius: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .port-val.active { background: #00aaff0d; border: 1px solid #00aaff2a; color: #a0c4d8; }
  .port-val.spare { background: #0a1018; border: 1px solid #14202c; color: #3a5a70; font-style: italic; }
  .port-empty { font-size: 8px; color: #3a5a70; line-height: 1.6; letter-spacing: 0.03em; padding: 2px 0; }
  .port-warn { font-size: 8px; color: #ffaa44; line-height: 1.6; margin-top: 6px; letter-spacing: 0.02em; }

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
