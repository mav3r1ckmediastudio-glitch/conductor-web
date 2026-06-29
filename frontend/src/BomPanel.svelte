<script>
  // BomPanel.svelte — right panel for rpMode === 'bom'.
  // Shows category subtotals + grand total, with HTML and CSV export.
  import { createEventDispatcher } from 'svelte';
  import { projectStore } from './projectStore.js';
  import { buildBom, generateBomHtml, generateBomCsv, downloadBom } from './bom.js';

  const dispatch = createEventDispatcher();

  let result = null;       // { sections, grandTotal }
  let expanded = {};       // section name -> bool

  $: result = buildBom(projectStore.state);

  function gbp(v) {
    return '£' + Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function toggle(name) { expanded = { ...expanded, [name]: !expanded[name] }; }

  function onExportHtml() {
    const html = generateBomHtml(projectStore.state);
    const area = projectStore.state.project?.areaId || 'conductor';
    downloadBom(html, `BoM-${area}.html`, 'text/html');
  }
  function onExportCsv() {
    const csv = generateBomCsv(projectStore.state);
    const area = projectStore.state.project?.areaId || 'conductor';
    downloadBom(csv, `BoM-${area}.csv`, 'text/csv');
  }
</script>

<div class="bom">
  <div class="bom-hdr">
    <span class="bom-title">Bill of Materials</span>
    <button class="bom-close" on:click={() => dispatch('close')} title="Close">✕</button>
  </div>

  {#if result}
    <div class="bom-grand">
      <span class="bom-grand-lbl">Estimated Total</span>
      <span class="bom-grand-val">{gbp(result.grandTotal)}</span>
      <span class="bom-grand-vat">ex. VAT</span>
    </div>

    <div class="bom-list">
      {#each result.sections as sec}
        {#if sec.rows.length}
          <div class="bom-sec">
            <div class="bom-sec-head" on:click={() => toggle(sec.name)} role="button" tabindex="0"
                 on:keydown={(e) => e.key === 'Enter' && toggle(sec.name)}>
              <span class="bom-caret">{expanded[sec.name] ? '▾' : '▸'}</span>
              <span class="bom-sec-name">{sec.name}</span>
              <span class="bom-sec-count">{sec.rows.length}</span>
              <span class="bom-sec-sub">{gbp(sec.subtotal)}</span>
            </div>
            {#if expanded[sec.name]}
              <div class="bom-rows">
                {#each sec.rows as row}
                  <div class="bom-row">
                    <div class="bom-row-desc">{row.description}</div>
                    <div class="bom-row-meta">
                      <span class="bom-qty">{row.qty}{row.unit}</span>
                      <span class="bom-x">×</span>
                      <span class="bom-uc">{gbp(row.unit_cost)}</span>
                      <span class="bom-total">{gbp(row.total)}</span>
                    </div>
                    {#if row.notes}<div class="bom-row-notes">{row.notes}</div>{/if}
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      {/each}
    </div>

    <div class="bom-actions">
      <button class="bom-exp html" on:click={onExportHtml}>&#8659; HTML</button>
      <button class="bom-exp csv" on:click={onExportCsv}>&#8659; CSV</button>
      <button class="bom-done" on:click={() => dispatch('close')}>Done</button>
    </div>
  {:else}
    <div class="bom-loading">Computing materials…</div>
  {/if}
</div>

<style>
  .bom { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
  .bom-hdr { height: 44px; background: #0d1520; border-bottom: 1px solid #1a2d40; display: flex; align-items: center; padding: 0 14px; gap: 8px; flex-shrink: 0; }
  .bom-title { font-size: 9px; color: #a0c4d8; letter-spacing: 0.14em; text-transform: uppercase; flex: 1; font-weight: 600; }
  .bom-close { background: #0f1c28; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 11px; width: 24px; height: 24px; border-radius: 4px; cursor: pointer; }
  .bom-close:hover { border-color: #ff555544; color: #ff5555; }

  .bom-grand { display: flex; align-items: baseline; gap: 8px; padding: 14px; background: #080e14; border-bottom: 1px solid #1a2d40; flex-shrink: 0; }
  .bom-grand-lbl { font-size: 8px; color: #3a5a70; text-transform: uppercase; letter-spacing: 0.1em; flex: 1; }
  .bom-grand-val { font-size: 22px; font-weight: 700; color: #4dc8ff; text-shadow: 0 0 12px #00aaff44; }
  .bom-grand-vat { font-size: 7.5px; color: #3a5a70; letter-spacing: 0.06em; }

  .bom-list { flex: 1; overflow-y: auto; padding: 4px 8px; }
  .bom-loading { font-size: 8.5px; color: #3a5a70; padding: 20px 14px; }
  .bom-sec { margin-bottom: 2px; }
  .bom-sec-head { display: flex; align-items: center; gap: 7px; padding: 8px 6px; cursor: pointer; border-radius: 3px; }
  .bom-sec-head:hover { background: #0f1c2a; }
  .bom-caret { font-size: 8px; color: #4dc8ff; width: 8px; }
  .bom-sec-name { font-size: 9px; font-weight: 700; color: #a0c4d8; letter-spacing: 0.05em; flex: 1; text-transform: uppercase; }
  .bom-sec-count { font-size: 7.5px; color: #3a5a70; background: #0f1c28; border: 1px solid #1a2d40; border-radius: 8px; padding: 0 6px; }
  .bom-sec-sub { font-size: 10px; font-weight: 700; color: #7ab8d4; }

  .bom-rows { padding: 0 4px 6px 16px; }
  .bom-row { padding: 5px 6px; border-bottom: 1px solid #0c141c; }
  .bom-row-desc { font-size: 8.5px; color: #c4d8e4; font-weight: 600; margin-bottom: 3px; }
  .bom-row-meta { display: flex; align-items: baseline; gap: 6px; }
  .bom-qty { font-size: 8px; color: #7ab8d4; }
  .bom-x { font-size: 7px; color: #2a4a5e; }
  .bom-uc { font-size: 8px; color: #6a8fa8; }
  .bom-total { font-size: 9px; font-weight: 700; color: #4dc8ff; margin-left: auto; }
  .bom-row-notes { font-size: 7px; color: #3a5a70; margin-top: 2px; }

  .bom-actions { padding: 10px 14px; border-top: 1px solid #1a2d40; display: flex; gap: 6px; flex-shrink: 0; }
  .bom-exp { flex: 1; background: #00aaff14; border: 1px solid #00aaff44; color: #4dc8ff; font-family: 'Courier New', monospace; font-size: 8.5px; letter-spacing: 0.06em; text-transform: uppercase; padding: 7px; border-radius: 4px; cursor: pointer; }
  .bom-exp:hover { background: #00aaff22; }
  .bom-done { background: #0a1018; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 8.5px; letter-spacing: 0.06em; text-transform: uppercase; padding: 7px 12px; border-radius: 4px; cursor: pointer; }
  .bom-done:hover { color: #a0c4d8; }
</style>
