<script>
  // SplicePlanPanel.svelte
  // Right panel for rpMode === 'splice-plan'.
  // Lists all joints + CBTs. Clicking one previews stats and lets you download
  // that joint's splice plan HTML. "Download All" downloads every joint sequentially.
  //
  // Events:
  //   on:close  — user dismissed the panel

  import { createEventDispatcher } from 'svelte';
  import { projectStore } from './projectStore.js';
  import { generateSplicePlan, generateAllSplicePlans, downloadSplicePlan, downloadAllSplicePlans } from './splicePlan.js';

  const dispatch = createEventDispatcher();

  let selected = null;   // { id, label, isCbt }
  let preview  = null;   // { html, stats } for selected joint
  let filter   = 'all';  // 'all' | 'joint' | 'cbt' | 'splitter'
  let downloading = false;

  $: items = buildItems(filter);
  $: if (selected) preview = buildPreview(selected.id);

  function buildItems(f) {
    const out = [];
    for (const j of projectStore.joints || []) {
      const id = j.properties.joint_id;
      if (!id) continue;
      const hasSplit = j.properties.has_splitter === true || j.properties.has_splitter === 1 || j.properties.has_splitter === 'true';
      if (f === 'cbt') continue;
      if (f === 'splitter' && !hasSplit) continue;
      out.push({ id, label: id, isCbt: false, hasSplitter: hasSplit, ratio: j.properties.split_ratio || '' });
    }
    for (const c of projectStore.cbts || []) {
      const id = c.properties.cbt_id;
      if (!id) continue;
      if (f === 'joint') continue;
      if (f === 'splitter') { /* CBTs are always splitters */ }
      out.push({ id, label: id, isCbt: true, hasSplitter: true, ratio: c.properties.split_ratio || '1:8' });
    }
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  }

  function buildPreview(id) {
    const store = projectStore.state;
    const recs  = (store.fibreAssignments || []).filter(r => String(r.joint_id) === String(id));
    const splices   = recs.filter(r => r.fibre_role === 'THROUGH_SPLICE').length;
    const outputs   = recs.filter(r => r.fibre_role === 'SPLITTER_OUTPUT').length;
    const spares    = recs.filter(r => r.fibre_role === 'SPLITTER_OUTPUT_SPARE').length;
    const dark      = recs.filter(r => r.fibre_role === 'DARK_STORAGE').reduce((s, r) => s + (r.dark_count || 1), 0);
    const hasData   = recs.length > 0;
    return { splices, outputs, spares, dark, hasData };
  }

  function onSelect(item) {
    selected = item;
  }

  function onDownload() {
    if (!selected) return;
    const store = projectStore.state;
    const html  = generateSplicePlan(store, selected.id);
    downloadSplicePlan(html, `${selected.id}.html`);
  }

  function onDownloadAll() {
    downloading = true;
    const n = downloadAllSplicePlans(projectStore.state);
    setTimeout(() => { downloading = false; }, n * 200 + 500);
  }
</script>

<div class="spp">
  <div class="spp-hdr">
    <span class="spp-title">Splice Plans</span>
    <button class="spp-close" on:click={() => dispatch('close')} title="Close">✕</button>
  </div>

  <!-- Filter row -->
  <div class="spp-filters">
    <button class="spf" class:on={filter==='all'}      on:click={() => filter='all'}>All</button>
    <button class="spf" class:on={filter==='joint'}    on:click={() => filter='joint'}>Joints</button>
    <button class="spf" class:on={filter==='cbt'}      on:click={() => filter='cbt'}>CBTs</button>
    <button class="spf" class:on={filter==='splitter'} on:click={() => filter='splitter'}>Splitters</button>
    <span class="spp-count">{items.length}</span>
  </div>

  <!-- Joint list -->
  <div class="spp-list">
    {#if items.length === 0}
      <div class="spp-empty">No joints or CBTs in design.</div>
    {:else}
      {#each items as item}
        <div class="spp-item" class:sel={selected?.id === item.id}
             on:click={() => onSelect(item)} role="button" tabindex="0"
             on:keydown={(e) => e.key==='Enter' && onSelect(item)}>
          <div class="spp-item-top">
            <span class="spp-badge" class:cbt={item.isCbt}>{item.isCbt ? 'CBT' : 'JNT'}</span>
            <span class="spp-id">{item.label}</span>
            {#if item.hasSplitter}
              <span class="spp-ratio">{item.ratio}</span>
            {/if}
          </div>
        </div>
      {/each}
    {/if}
  </div>

  <!-- Preview / download section -->
  {#if selected}
    <div class="spp-preview">
      <div class="spp-prev-hdr">{selected.label}</div>
      {#if preview}
        {#if !preview.hasData}
          <div class="spp-prev-warn">Run Auto-Assign Fibres first to populate splice records.</div>
        {:else}
          <div class="spp-prev-stats">
            <div class="spp-ps"><span class="spp-pv">{preview.splices * 2}</span><span class="spp-pl">Splices</span></div>
            <div class="spp-ps"><span class="spp-pv">{preview.outputs}</span><span class="spp-pl">Active ports</span></div>
            <div class="spp-ps"><span class="spp-pv">{preview.spares}</span><span class="spp-pl">Spare ports</span></div>
            <div class="spp-ps"><span class="spp-pv">{preview.dark}</span><span class="spp-pl">Dark fibres</span></div>
          </div>
        {/if}
      {/if}
      <button class="spp-dl" on:click={onDownload}>
        &#8659; Download {selected.id}.html
      </button>
    </div>
  {/if}

  <!-- Footer actions -->
  <div class="spp-actions">
    <button class="spp-dl-all" on:click={onDownloadAll} disabled={downloading || items.length === 0}>
      {downloading ? 'Downloading…' : `&#8659; Download All (${items.length})`}
    </button>
    <button class="spp-done" on:click={() => dispatch('close')}>Done</button>
  </div>
</div>

<style>
  .spp { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

  .spp-hdr { height: 44px; background: #0d1520; border-bottom: 1px solid #1a2d40; display: flex; align-items: center; padding: 0 14px; gap: 8px; flex-shrink: 0; }
  .spp-title { font-size: 9px; color: #a0c4d8; letter-spacing: 0.14em; text-transform: uppercase; flex: 1; font-weight: 600; }
  .spp-close { background: #0f1c28; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 11px; width: 24px; height: 24px; border-radius: 4px; cursor: pointer; }
  .spp-close:hover { border-color: #ff555544; color: #ff5555; }

  .spp-filters { display: flex; align-items: center; padding: 8px 14px 6px; gap: 4px; border-bottom: 1px solid #1a2d4033; flex-shrink: 0; }
  .spf { background: #0a1018; border: 1px solid #1a2d40; color: #3a5a70; font-family: 'Courier New', monospace; font-size: 7.5px; letter-spacing: 0.06em; text-transform: uppercase; padding: 3px 8px; border-radius: 3px; cursor: pointer; }
  .spf:hover { border-color: #00aaff33; color: #6a8fa8; }
  .spf.on { border-color: #00aaff55; color: #4dc8ff; background: #00aaff0d; }
  .spp-count { margin-left: auto; font-size: 8px; color: #3a5a70; letter-spacing: 0.04em; }

  .spp-list { flex: 1; overflow-y: auto; padding: 4px 10px; }
  .spp-empty { font-size: 8.5px; color: #3a5a70; padding: 14px 4px; letter-spacing: 0.04em; }
  .spp-item { padding: 6px 6px; border-bottom: 1px solid #0c141c; cursor: pointer; border-radius: 3px; transition: background 0.1s; }
  .spp-item:hover { background: #0f1c2a; }
  .spp-item.sel { background: #00aaff0d; border-bottom-color: #00aaff22; }
  .spp-item-top { display: flex; align-items: center; gap: 6px; }
  .spp-badge { font-size: 7px; font-weight: 700; letter-spacing: 0.08em; padding: 1px 5px; border-radius: 2px; background: #0f1c28; color: #3a5a70; border: 1px solid #1a2d40; flex-shrink: 0; }
  .spp-badge.cbt { background: #001a2e; color: #4dc8ff; border-color: #00aaff33; }
  .spp-id { font-size: 9px; font-weight: 700; color: #a0c4d8; letter-spacing: 0.04em; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .spp-ratio { font-size: 7.5px; color: #4dc8ff; background: #00aaff0d; border: 1px solid #00aaff22; border-radius: 8px; padding: 1px 6px; flex-shrink: 0; letter-spacing: 0.04em; }

  .spp-preview { border-top: 1px solid #1a2d40; padding: 10px 14px; flex-shrink: 0; background: #080e14; }
  .spp-prev-hdr { font-size: 9px; font-weight: 700; color: #4dc8ff; letter-spacing: 0.08em; margin-bottom: 8px; }
  .spp-prev-warn { font-size: 8px; color: #ffaa44; line-height: 1.6; margin-bottom: 8px; }
  .spp-prev-stats { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 4px; margin-bottom: 8px; }
  .spp-ps { background: #0d1520; border-radius: 4px; padding: 5px 4px; text-align: center; }
  .spp-pv { display: block; font-size: 14px; font-weight: 700; color: #4dc8ff; line-height: 1; }
  .spp-pl { display: block; font-size: 6.5px; color: #3a5a70; letter-spacing: 0.06em; text-transform: uppercase; margin-top: 2px; }
  .spp-dl { width: 100%; background: #00aaff14; border: 1px solid #00aaff44; color: #4dc8ff; font-family: 'Courier New', monospace; font-size: 8.5px; letter-spacing: 0.06em; text-transform: uppercase; padding: 7px; border-radius: 4px; cursor: pointer; }
  .spp-dl:hover { background: #00aaff22; }

  .spp-actions { padding: 10px 14px; border-top: 1px solid #1a2d40; display: flex; gap: 6px; flex-shrink: 0; }
  .spp-dl-all { flex: 1; background: #0a1018; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 8px; letter-spacing: 0.06em; text-transform: uppercase; padding: 7px; border-radius: 4px; cursor: pointer; }
  .spp-dl-all:hover:not(:disabled) { border-color: #00aaff33; color: #4dc8ff; }
  .spp-dl-all:disabled { opacity: 0.4; cursor: default; }
  .spp-done { background: #0a1018; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 8px; letter-spacing: 0.06em; text-transform: uppercase; padding: 7px 12px; border-radius: 4px; cursor: pointer; }
  .spp-done:hover { color: #a0c4d8; }
</style>
