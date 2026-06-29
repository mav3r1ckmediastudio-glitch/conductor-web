<script>
  // SldPanel.svelte — right panel for rpMode === 'sld'.
  // Shows network summary stats + Generate/Download + Open-in-tab.
  import { createEventDispatcher } from 'svelte';
  import { projectStore } from './projectStore.js';
  import { generateSld, downloadSld } from './sld.js';

  const dispatch = createEventDispatcher();

  let stats = null;
  let error = null;

  $: computeStats(projectStore.state);

  function computeStats(store) {
    error = null;
    try {
      if (!store.cabinet) { error = 'No cabinet placed yet.'; stats = null; return; }
      const cables = (store.cables || []).length;
      const spans  = (store.spans || []).length;
      const joints = (store.joints || []).length;
      const cbts   = (store.cbts || []).length;
      const bundles = (store.bundles || []).length;
      const drops  = (store.aerialDrops || []).length;
      const splitters = (store.joints || []).filter(j => {
        const p = j.properties;
        return p.has_splitter === true || p.has_splitter === 1 || p.has_splitter === 'true';
      }).length + cbts;
      stats = { cables, spans, joints, cbts, bundles, drops, splitters, premises: bundles + drops };
    } catch (e) {
      error = e.message; stats = null;
    }
  }

  function onDownload() {
    try {
      const html = generateSld(projectStore.state);
      const area = projectStore.state.project?.areaId || 'conductor';
      downloadSld(html, `SLD-${area}.html`);
    } catch (e) { error = e.message; }
  }

  function onOpenTab() {
    try {
      const html = generateSld(projectStore.state);
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) { error = e.message; }
  }
</script>

<div class="sld">
  <div class="sld-hdr">
    <span class="sld-title">Single Line Diagram</span>
    <button class="sld-close" on:click={() => dispatch('close')} title="Close">✕</button>
  </div>

  {#if error}
    <div class="sld-err">{error}</div>
    <div class="sld-actions"><button class="sld-done" on:click={() => dispatch('close')}>Close</button></div>
  {:else if stats}
    <div class="sld-intro">Full network topology from the cabinet out to every premise — splitters, CBTs, poles, bundles and aerial drops. Exports as a self-contained HTML you can print to PDF.</div>

    <div class="sld-stats">
      <div class="sld-stat"><span class="sld-sv">{stats.cables}</span><span class="sld-sl">Cables</span></div>
      <div class="sld-stat"><span class="sld-sv">{stats.spans}</span><span class="sld-sl">Spans</span></div>
      <div class="sld-stat"><span class="sld-sv">{stats.joints}</span><span class="sld-sl">Joints</span></div>
      <div class="sld-stat"><span class="sld-sv">{stats.cbts}</span><span class="sld-sl">CBTs</span></div>
      <div class="sld-stat"><span class="sld-sv">{stats.splitters}</span><span class="sld-sl">Splitters</span></div>
      <div class="sld-stat"><span class="sld-sv">{stats.premises}</span><span class="sld-sl">Premises</span></div>
    </div>

    <div class="sld-spacer"></div>

    <div class="sld-actions">
      <button class="sld-gen" on:click={onOpenTab}>&#8599; Open in tab</button>
      <button class="sld-dl" on:click={onDownload}>&#8659; Download HTML</button>
      <button class="sld-done" on:click={() => dispatch('close')}>Done</button>
    </div>
  {:else}
    <div class="sld-loading">Reading network…</div>
  {/if}
</div>

<style>
  .sld { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
  .sld-hdr { height: 44px; background: #0d1520; border-bottom: 1px solid #1a2d40; display: flex; align-items: center; padding: 0 14px; gap: 8px; flex-shrink: 0; }
  .sld-title { font-size: 9px; color: #a0c4d8; letter-spacing: 0.14em; text-transform: uppercase; flex: 1; font-weight: 600; }
  .sld-close { background: #0f1c28; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 11px; width: 24px; height: 24px; border-radius: 4px; cursor: pointer; }
  .sld-close:hover { border-color: #ff555544; color: #ff5555; }

  .sld-intro { font-size: 8.5px; color: #6a8fa8; line-height: 1.7; padding: 12px 14px; letter-spacing: 0.02em; flex-shrink: 0; }
  .sld-err { font-size: 9px; color: #ffaa44; padding: 16px 14px; line-height: 1.6; }
  .sld-loading { font-size: 8.5px; color: #3a5a70; padding: 20px 14px; }

  .sld-stats { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; padding: 0 14px; flex-shrink: 0; }
  .sld-stat { background: #080e14; border-radius: 5px; padding: 10px 4px; text-align: center; }
  .sld-sv { display: block; font-size: 19px; font-weight: 700; color: #4dc8ff; line-height: 1; }
  .sld-sl { display: block; font-size: 7px; color: #3a5a70; letter-spacing: 0.06em; text-transform: uppercase; margin-top: 4px; }

  .sld-spacer { flex: 1; }
  .sld-actions { padding: 10px 14px; border-top: 1px solid #1a2d40; display: flex; gap: 6px; flex-shrink: 0; }
  .sld-gen { flex: 1; background: #0a1018; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 8.5px; letter-spacing: 0.06em; text-transform: uppercase; padding: 7px; border-radius: 4px; cursor: pointer; }
  .sld-gen:hover { border-color: #00aaff33; color: #4dc8ff; }
  .sld-dl { flex: 1; background: #00aaff14; border: 1px solid #00aaff44; color: #4dc8ff; font-family: 'Courier New', monospace; font-size: 8.5px; letter-spacing: 0.06em; text-transform: uppercase; padding: 7px; border-radius: 4px; cursor: pointer; }
  .sld-dl:hover { background: #00aaff22; }
  .sld-done { background: #0a1018; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 8.5px; letter-spacing: 0.06em; text-transform: uppercase; padding: 7px 12px; border-radius: 4px; cursor: pointer; }
  .sld-done:hover { color: #a0c4d8; }
</style>
