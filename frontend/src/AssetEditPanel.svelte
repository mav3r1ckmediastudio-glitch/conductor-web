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
  import { splitterIdFor } from './splitterId.js';
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
    cbttail:  { show: ['tail_id','cable_type','fibre_count','from_cbt','to_joint','length_m','notes'],
                edit: ['fibre_count','notes'] },
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
    span:    { cable_type: ['AERIAL_SPAN','AERIAL_TAIL'] },
    adrop:   { cable_type: ['AERIAL_DROP'] },
    // A tail is the single feeder fibre into a CBT's splitter — 1 is the
    // normal case, not an edge case, unlike the shared fibre_count list
    // (cable/span/adrop/cbt) which is genuinely never 1 in practice.
    cbttail: { fibre_count: [1, 2, 4, 8, 12, 24] },
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

  // Branch-classifiable line assets (release-audit §3): cables, aerial spans and
  // CBT tails can each be a raw PASS_THROUGH branch or a SPLITTER_OUTPUT leg. The
  // control is always shown for these (even when feed_mode is unset) so an
  // inferred/unclassified branch can be resolved here without editing JSON.
  $: isClassifiable = ['cable','span','cbttail'].includes(selected?.assetType);

  function onSave() {
    const props = { ...selected.feature.properties, ...editProps };
    // Clearing stale optical metadata: when a branch is no longer a
    // SPLITTER_OUTPUT, its old splitter_id / splitter_port must not linger (a
    // leftover id with a now-meaningless port would otherwise mislead the plan).
    if (isClassifiable && props.feed_mode !== 'SPLITTER_OUTPUT') {
      props.splitter_id = null;
      props.splitter_port = null;
    }
    dispatch('saved', {
      collection: selected.collection,
      index:      selected.index,
      props,
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

  // ── Port grid helpers ──────────────────────────────────────────────────────
  function ratioCap(r) { const m = String(r || '').match(/:(\d+)/); return m ? parseInt(m[1], 10) : 8; }

  // ── Terminal splitter port grid ────────────────────────────────────────────
  // Faithful to v2: the port→premise map is NOT stored on the CBT/joint. It is
  // derived live from the consumers (aerial drops for a CBT, bundles for a UG
  // joint) pointing at this splitter, read by their splitter_port. Single source
  // of truth — editing/adding a drop and re-running Auto-Assign just reflows here.
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
               (p.has_splitter === true || p.has_splitter === 1 || p.has_splitter === 'true') &&
               ratioCap(p.split_ratio) !== 4) {
      // Terminal splitter UG joint (1:8 etc.) — consumers are bundles
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

  // ── Feeder port grid (1:4 joint → downstream terminal splitters) ───────────
  // A 1:4 feeder joint's "consumers" are child CBTs/joints that have
  // feeder_port set pointing at this joint. We show PO1..PO4 with the child
  // splitter id in each occupied slot.
  $: feederGrid = buildFeederGrid(selected);

  function buildFeederGrid(sel) {
    if (!sel) return null;
    const t = sel.assetType;
    const p = sel.feature.properties;

    // Only applies to joints declared as 1:4 splitters
    if (t !== 'joint') return null;
    const isSplitter = p.has_splitter === true || p.has_splitter === 1 || p.has_splitter === 'true';
    if (!isSplitter) return null;
    if (ratioCap(p.split_ratio) !== 4) return null;

    const cap = 4;
    const jointId = String(p.joint_id);

    // Collect child splitters: CBTs or joints that have this joint as their
    // upstream feeder. In the assign engine, feeder_port is stored on the child.
    // We identify children by walking store.cbts + store.joints and checking
    // whether the BFS parent path from that child to the POP passes through this
    // joint. However, since we don't have the BFS here, we use a pragmatic
    // proxy: a child references this joint implicitly when it has a feeder_port
    // set AND its geometry is "nearby" — which is unreliable. Instead, we use
    // the assignment records stored in fibreAssignments:
    //   records with joint_id === this jointId AND fibre_role === 'SPLITTER_OUTPUT'
    //   carry downstream: <childId>. We map those to feeder_port via the child's
    //   feeder_port property.
    //
    // But simpler and more reliable: scan cbts + joints for those whose
    // traceUpToSplitter === this joint. We can't run the BFS here without the
    // full store, but we CAN use the feeder_port stored on the child (written by
    // applyFibreAssignment). A child belongs to this feeder if it has a
    // feeder_port AND its nearest upstream splitter in the assignment records is
    // this joint. We identify that by scanning fibreAssignments for records
    // { joint_id: thisJoint, fibre_role: 'SPLITTER_OUTPUT', downstream: childId }.

    const records = projectStore.fibreAssignments || [];
    // Build port→childId from SPLITTER_OUTPUT records for this feeder joint
    // (the splitter_id for a feeder = splitterIdFor(jointId))
    const spid = splitterIdFor(jointId);
    const portMap = {}; // port (int) → childId (string)
    for (const rec of records) {
      if (rec.splitter_id === spid && rec.fibre_role === 'SPLITTER_OUTPUT' && rec.downstream) {
        portMap[rec.port] = String(rec.downstream);
      }
    }

    // Build display ports
    const ports = [];
    for (let i = 1; i <= cap; i++) {
      const childId = portMap[i];
      if (childId) {
        // Identify if it's a CBT or joint, find its split_ratio
        let childLabel = childId;
        let childRatio = '';
        const cbt = (projectStore.cbts || []).find(c => String(c.properties.cbt_id) === childId);
        if (cbt) {
          childLabel = childId;
          childRatio = cbt.properties.split_ratio || '1:8';
        } else {
          const jnt = (projectStore.joints || []).find(j => String(j.properties.joint_id) === childId);
          if (jnt) {
            childLabel = childId;
            childRatio = jnt.properties.split_ratio || '1:8';
          }
        }
        ports.push({ port: i, childId, childLabel, childRatio, occupied: true });
      } else {
        ports.push({ port: i, childId: null, childLabel: null, childRatio: null, occupied: false });
      }
    }

    const occupiedCount = ports.filter(x => x.occupied).length;
    const hasAssignments = records.some(r => r.splitter_id === spid);

    return { cap, ports, occupiedCount, hasAssignments };
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
            <label class="edit-lbl" for={'edit-' + key}>{key.replace(/_/g,' ')}</label>
            {#if !isEditable(key)}
              <span class="av locked">{displayValue(key, selected.feature.properties[key])}</span>
            {:else if fieldType(key) === 'select'}
              <select id={'edit-' + key} class="edit-sel" bind:value={editProps[key]}>
                {#each enumFor(key) as opt}
                  <option value={opt}>{opt}</option>
                {/each}
              </select>
            {:else if fieldType(key) === 'textarea'}
              <textarea id={'edit-' + key} class="edit-ta" rows="2" bind:value={editProps[key]}></textarea>
            {:else}
              <input id={'edit-' + key} class="edit-inp" type="text" bind:value={editProps[key]} />
            {/if}
          </div>
        {/if}
      {/each}
    {/if}

    <!-- Branch classification (feed_mode) for cables, spans, CBT tails -->
    {#if isClassifiable}
      <div class="cls-section">
        <div class="cls-hdr">Branch Classification</div>
        {#if !editMode}
          <div class="arow">
            <span class="ak">feed mode</span>
            <span class="av">{selected.feature.properties.feed_mode || '— unclassified (inferred)'}</span>
          </div>
          {#if selected.feature.properties.feed_mode === 'SPLITTER_OUTPUT'}
            <div class="arow">
              <span class="ak">splitter id</span>
              <span class="av">{displayValue('splitter_id', selected.feature.properties.splitter_id)}</span>
            </div>
            <div class="arow">
              <span class="ak">splitter port</span>
              <span class="av">{displayValue('splitter_port', selected.feature.properties.splitter_port)}</span>
            </div>
          {/if}
        {:else}
          <div class="arow-edit">
            <label class="edit-lbl" for="a11y-asseteditpanel-3">feed mode</label>
            <select id="a11y-asseteditpanel-3" class="edit-sel" bind:value={editProps.feed_mode} data-testid="edit-feed-mode">
              <option value="">— unclassified —</option>
              <option value="PASS_THROUGH">PASS_THROUGH</option>
              <option value="SPLITTER_OUTPUT">SPLITTER_OUTPUT</option>
            </select>
          </div>
          {#if editProps.feed_mode === 'SPLITTER_OUTPUT'}
            <div class="arow-edit">
              <label class="edit-lbl" for="a11y-asseteditpanel-1">splitter id</label>
              <input id="a11y-asseteditpanel-1" class="edit-inp" type="text" bind:value={editProps.splitter_id} placeholder="e.g. JNT-001-SP" data-testid="edit-splitter-id" />
            </div>
            <div class="arow-edit">
              <label class="edit-lbl" for="a11y-asseteditpanel-2">splitter port</label>
              <input id="a11y-asseteditpanel-2" class="edit-inp" type="number" min="1" bind:value={editProps.splitter_port} data-testid="edit-splitter-port" />
            </div>
          {/if}
        {/if}
      </div>
    {/if}

    <!-- Terminal splitter port grid (CBT or 1:8 UG joint) -->
    {#if !editMode && portGrid}
      <div class="port-section">
        <div class="port-hdr">
          <span class="port-title">Splitter Ports</span>
          <span class="port-cap">1:{portGrid.cap}</span>
          {#if portGrid.total > 0}
            <span class="port-consumers">{portGrid.total}/{portGrid.cap} connected</span>
          {/if}
        </div>
        <!-- Always render the full port grid — 2 columns, half the ports per column, matching v2 -->
        <div class="port-grid-2col">
          {#each portGrid.ports as pt}
            <span class="port-pill">PO{pt.port}</span>
            {#if pt.uprn}
              <span class="port-val active" title={pt.label}>{pt.label}</span>
            {:else if portGrid.total > 0 && !portGrid.anyAssigned}
              <span class="port-val unrun">— run assign —</span>
            {:else}
              <span class="port-val spare">Spare</span>
            {/if}
          {/each}
        </div>
        {#if portGrid.total === 0}
          <div class="port-hint">No premises connected to this splitter yet.</div>
        {:else if !portGrid.anyAssigned}
          <div class="port-hint">{portGrid.total} consumer{portGrid.total === 1 ? '' : 's'} connected — run Auto-Assign Fibres to populate ports.</div>
        {:else if portGrid.unassigned > 0}
          <div class="port-warn">{portGrid.unassigned} consumer{portGrid.unassigned === 1 ? '' : 's'} not yet assigned — re-run Auto-Assign Fibres.</div>
        {/if}
      </div>
    {/if}

    <!-- Feeder port grid (1:4 joint → downstream terminal splitters) -->
    {#if !editMode && feederGrid}
      <div class="port-section">
        <div class="port-hdr">
          <span class="port-title">Feeder Ports</span>
          <span class="port-cap">1:{feederGrid.cap}</span>
          {#if feederGrid.hasAssignments}
            <span class="port-consumers">{feederGrid.occupiedCount}/{feederGrid.cap} used</span>
          {/if}
        </div>
        <div class="port-grid-2col">
          {#each feederGrid.ports as pt}
            <span class="port-pill">PO{pt.port}</span>
            {#if pt.occupied}
              <div class="port-val-feeder">
                <span class="port-val active" title={pt.childId}>{pt.childLabel}</span>
                {#if pt.childRatio}
                  <span class="port-child-ratio">{pt.childRatio}</span>
                {/if}
              </div>
            {:else if !feederGrid.hasAssignments}
              <span class="port-val unrun">— run assign —</span>
            {:else}
              <span class="port-val spare">Spare</span>
            {/if}
          {/each}
        </div>
        {#if !feederGrid.hasAssignments}
          <div class="port-hint">Run Auto-Assign Fibres to populate feeder port allocation.</div>
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
  .port-hdr { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
  .port-title { font-size: 8px; color: #3a5a70; letter-spacing: 0.12em; text-transform: uppercase; flex: 1; }
  .port-cap { font-size: 8px; color: #4dc8ff; background: #00aaff14; border: 1px solid #00aaff33; border-radius: 10px; padding: 1px 8px; letter-spacing: 0.06em; }
  .port-consumers { font-size: 7.5px; color: #6a8fa8; letter-spacing: 0.04em; }

  /* 2-column CSS grid: [pill] [value] [pill] [value] */
  /* Ports fill down the left column first, then the right, matching v2 */
  .port-grid-2col {
    display: grid;
    grid-template-columns: 38px 1fr 38px 1fr;
    grid-auto-rows: auto;
    gap: 4px 6px;
    align-items: center;
  }
  /* Each pill + val pair occupies one cell each; pairs flow col-major via
     CSS grid-auto-flow: column — but CSS grid doesn't natively do col-major.
     We fake it by rendering all even-index items (pills) in cols 1&3 and
     odd-index (vals) in cols 2&4, and using order to route left col first.
     Svelte renders them in DOM order (PO1-pill, PO1-val, PO2-pill, PO2-val …)
     which maps naturally to row-major: row1=[PO1,PO1-val,PO2,PO2-val] …
     That gives us the 2-col layout. */

  .port-pill { flex-shrink: 0; text-align: center; background: #0f1c28; color: #7ab8d4; border: 1px solid #1a2d40; border-radius: 3px; padding: 3px 6px; font-size: 8px; font-weight: 700; letter-spacing: 0.04em; }
  .port-val { display: block; font-size: 8px; padding: 3px 7px; border-radius: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .port-val.active { background: #00aaff0d; border: 1px solid #00aaff2a; color: #a0c4d8; }
  .port-val.spare  { background: #0a1018; border: 1px solid #14202c; color: #3a5a70; font-style: italic; }
  .port-val.unrun  { background: #0a1018; border: 1px solid #14202c; color: #2a4a5e; font-style: italic; }
  .port-hint { font-size: 7.5px; color: #3a5a70; line-height: 1.6; letter-spacing: 0.03em; margin-top: 6px; }
  .port-warn { font-size: 7.5px; color: #ffaa44; line-height: 1.6; margin-top: 6px; letter-spacing: 0.02em; }

  /* Feeder port extras */
  .port-val-feeder { display: flex; align-items: center; gap: 5px; min-width: 0; overflow: hidden; }
  .port-child-ratio { flex-shrink: 0; font-size: 7px; color: #4dc8ff; background: #00aaff0d; border: 1px solid #00aaff22; border-radius: 8px; padding: 1px 5px; letter-spacing: 0.04em; }

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

  .cls-section { margin-top: 10px; padding-top: 8px; border-top: 1px solid #1a2d40; }
  .cls-hdr { font-size: 7.5px; color: #3a5a70; letter-spacing: 0.14em; text-transform: uppercase; margin-bottom: 6px; }
</style>
