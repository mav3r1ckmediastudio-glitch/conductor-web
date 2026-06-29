<script>
  // CabinetCostPanel.svelte — Cabinet Cost Calculator right panel.
  // Delegates entirely to buildBom() via buildCabinetCost() — the BoM is the
  // single source of truth. Equipment fields are included in the BoM "Network
  // Equip" section; this panel shows them in full plus section subtotals for
  // the outside-plant categories. The grand total matches the stats bar exactly.

  import { createEventDispatcher, onMount } from 'svelte';
  import { projectStore } from './projectStore.js';
  import { buildCabinetCost } from './cabinetCost.js';

  const dispatch = createEventDispatcher();

  let result = null;
  let error  = null;

  // Outside-plant sections shown as subtotals only (detail is in BomPanel)
  const SUMMARY_SECTIONS = ['Fibre Cable', 'Drop & Bundle', 'Joints', 'Duct', 'PIA', 'Home Install'];

  onMount(() => {
    try {
      result = buildCabinetCost(projectStore.state);
      if (!result) error = 'No cabinet placed — place a cabinet to calculate costs.';
    } catch (e) {
      error = `Calculation failed: ${e.message}`;
    }
  });

  function fmt(n) {
    return '£' + Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  $: summarySections = result
    ? result.sections.filter(s => SUMMARY_SECTIONS.includes(s.name) && s.subtotal > 0)
    : [];
  $: outsidePlantTotal = summarySections.reduce((s, sec) => s + sec.subtotal, 0);
</script>

<div class="cc-panel">
  <div class="cc-hdr">
    <span class="cc-title">Cabinet Cost Calculator</span>
    <button class="cc-close" on:click={() => dispatch('close')} title="Close">✕</button>
  </div>

  {#if error}
    <div class="cc-error">{error}</div>

  {:else if result}
    <div class="cc-scroll">
      <!-- Cabinet identity -->
      <div class="cc-site">
        <span class="cc-site-name">{result.popName || 'Cabinet'}</span>
        <span class="cc-site-type">{result.popType || '—'}</span>
      </div>

      <!-- Grand total + per-premise -->
      <div class="cc-totals">
        <div class="cc-total-main">
          <div class="cc-total-val">{fmt(result.grandTotal)}</div>
          <div class="cc-total-lbl">Total build cost</div>
        </div>
        <div class="cc-total-sub">
          <div class="cc-total-val sm">{fmt(result.perPremise)}</div>
          <div class="cc-total-lbl">Per premise{result.premises ? ' (' + result.premises + ')' : ''}</div>
        </div>
      </div>

      <!-- Network Equipment — full line items -->
      <div class="cc-section">
        <div class="cc-section-hdr">
          <span class="cc-section-lbl">Network Equipment</span>
          <span class="cc-section-total">{fmt(result.equipSection.subtotal)}</span>
        </div>
        {#if result.equipSection.rows.length === 0}
          <div class="cc-empty-section">
            No equipment configured — edit cabinet to add DUX shelves, GPON cards etc.
          </div>
        {:else}
          {#each result.equipSection.rows as line}
            <div class="cc-line">
              <span class="cc-line-label">{line.description}</span>
              <span class="cc-line-qty">{line.qty} ×</span>
              <span class="cc-line-each">{fmt(line.unit_cost)}</span>
              <span class="cc-line-total">{fmt(line.total)}</span>
            </div>
          {/each}
        {/if}
      </div>

      <!-- Outside plant — section subtotals only (full detail in BoM panel) -->
      {#if summarySections.length > 0}
        <div class="cc-section">
          <div class="cc-section-hdr">
            <span class="cc-section-lbl">Outside Plant</span>
            <span class="cc-section-total">{fmt(outsidePlantTotal)}</span>
          </div>
          <div class="cc-op-note">Full line items available in ↗ Bill of Materials</div>
          {#each summarySections as sec}
            <div class="cc-op-row">
              <span class="cc-op-name">{sec.name}</span>
              <span class="cc-op-val">{fmt(sec.subtotal)}</span>
            </div>
          {/each}
        </div>
      {/if}

      <!-- Grand total breakdown footer -->
      <div class="cc-footer">
        <div class="cc-footer-row">
          <span class="cc-footer-k">Network Equipment</span>
          <span class="cc-footer-v">{fmt(result.equipSection.subtotal)}</span>
        </div>
        <div class="cc-footer-row">
          <span class="cc-footer-k">Outside Plant</span>
          <span class="cc-footer-v">{fmt(outsidePlantTotal)}</span>
        </div>
        <div class="cc-footer-row grand">
          <span class="cc-footer-k">Grand Total (ex. VAT)</span>
          <span class="cc-footer-v">{fmt(result.grandTotal)}</span>
        </div>
      </div>
    </div>

  {:else}
    <div class="cc-loading">Calculating…</div>
  {/if}

  <div class="cc-actions">
    <button class="cc-done" on:click={() => dispatch('close')}>Done</button>
  </div>
</div>

<style>
  .cc-panel { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

  .cc-hdr { height: 44px; background: #0d1520; border-bottom: 1px solid #1a2d40; display: flex; align-items: center; padding: 0 14px; gap: 8px; flex-shrink: 0; }
  .cc-title { font-size: 9px; color: #a0c4d8; letter-spacing: 0.14em; text-transform: uppercase; flex: 1; font-weight: 600; }
  .cc-close { background: #0f1c28; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 11px; width: 24px; height: 24px; border-radius: 4px; cursor: pointer; }
  .cc-close:hover { border-color: #ff555544; color: #ff5555; }

  .cc-error { margin: 16px 14px; font-size: 9px; color: #f87171; line-height: 1.6; }
  .cc-loading { padding: 16px 14px; font-size: 9px; color: #3a5a70; }
  .cc-scroll { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }

  .cc-site { padding: 8px 14px; border-bottom: 1px solid #1a2d4033; display: flex; align-items: baseline; gap: 8px; flex-shrink: 0; }
  .cc-site-name { font-size: 12px; font-weight: 700; color: #4dc8ff; letter-spacing: 0.06em; font-family: 'Courier New', monospace; }
  .cc-site-type { font-size: 8px; color: #3a5a70; letter-spacing: 0.1em; text-transform: uppercase; }

  .cc-totals { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; padding: 10px 12px; border-bottom: 1px solid #1a2d40; flex-shrink: 0; }
  .cc-total-main, .cc-total-sub { background: #080e14; border-radius: 5px; padding: 10px; }
  .cc-total-val { font-size: 16px; font-weight: 700; color: #4dc8ff; line-height: 1; font-variant-numeric: tabular-nums; }
  .cc-total-val.sm { font-size: 13px; }
  .cc-total-lbl { font-size: 7px; color: #3a5a70; letter-spacing: 0.08em; text-transform: uppercase; margin-top: 4px; }

  .cc-section { border-bottom: 1px solid #1a2d4033; flex-shrink: 0; }
  .cc-section-hdr { display: flex; align-items: center; justify-content: space-between; padding: 8px 14px 4px; }
  .cc-section-lbl { font-size: 7.5px; color: #3a5a70; letter-spacing: 0.12em; text-transform: uppercase; }
  .cc-section-total { font-size: 10px; color: #7ab8d4; font-weight: 600; font-variant-numeric: tabular-nums; }
  .cc-empty-section { font-size: 8px; color: #2a4050; padding: 4px 14px 8px; font-style: italic; }

  .cc-line { display: grid; grid-template-columns: 1fr auto auto auto; gap: 4px; align-items: center; padding: 3px 14px; }
  .cc-line-label { font-size: 8.5px; color: #a0c4d8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cc-line-qty  { font-size: 7.5px; color: #3a5a70; text-align: right; white-space: nowrap; }
  .cc-line-each { font-size: 7.5px; color: #6a8fa8; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; min-width: 54px; }
  .cc-line-total { font-size: 8.5px; color: #7ab8d4; font-weight: 600; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; min-width: 60px; }

  /* Outside plant summary */
  .cc-op-note { font-size: 8px; color: #2a4050; padding: 2px 14px 4px; font-style: italic; }
  .cc-op-row { display: flex; justify-content: space-between; align-items: center; padding: 3px 14px; }
  .cc-op-name { font-size: 8.5px; color: #6a8fa8; }
  .cc-op-val  { font-size: 8.5px; color: #7ab8d4; font-weight: 600; font-variant-numeric: tabular-nums; }

  .cc-footer { padding: 8px 14px; border-top: 1px solid #1a2d40; background: #060c12; flex-shrink: 0; }
  .cc-footer-row { display: flex; justify-content: space-between; align-items: center; padding: 3px 0; }
  .cc-footer-row.grand { border-top: 1px solid #1a2d40; margin-top: 4px; padding-top: 7px; }
  .cc-footer-k { font-size: 8px; color: #6a8fa8; text-transform: uppercase; letter-spacing: 0.06em; }
  .cc-footer-v { font-size: 9px; color: #7ab8d4; font-weight: 600; font-variant-numeric: tabular-nums; }
  .cc-footer-row.grand .cc-footer-k { color: #a0c4d8; font-size: 9px; }
  .cc-footer-row.grand .cc-footer-v { color: #4dc8ff; font-size: 12px; }

  .cc-actions { padding: 10px 14px; border-top: 1px solid #1a2d40; flex-shrink: 0; }
  .cc-done { width: 100%; background: #00aaff14; border: 1px solid #00aaff44; color: #4dc8ff; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; padding: 8px; border-radius: 4px; cursor: pointer; }
  .cc-done:hover { background: #00aaff22; }
</style>
