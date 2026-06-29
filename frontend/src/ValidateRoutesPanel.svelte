<script>
  // ValidateRoutesPanel.svelte — right panel for rpMode === 'validate-routes'.
  // Runs traceFibre over every address point, shows a result table
  // (status / address / length / optical loss+margin). Click a row to highlight
  // that premise on the map. For PARTIAL rows, flies to the last resolvable node
  // in the BFS path (the break-point asset) rather than the premise coordinate.
  // Emits 'close', 'summary', and 'highlight' events.
  //
  // OPTICAL COLUMNS: traceFibre() now returns result.optical for ROUTED rows.
  //   loss_db   — total path loss in dB
  //   margin_db — budget margin (positive = headroom, negative = fail)
  //   link_pass — bool: margin >= 0
  // These are carried through to each row and displayed as compact badges.

  import { createEventDispatcher } from 'svelte';
  import { projectStore } from './projectStore.js';
  import { traceFibre, STATUS_OK, STATUS_PARTIAL } from './fibreTrace.js';

  const dispatch = createEventDispatcher();

  // State
  let running   = false;
  let progress  = 0;
  let total     = 0;
  let results   = null;   // null = not yet run
  let summary   = null;
  let filter    = 'all';  // 'all'|'routed'|'partial'|'unserved'
  let selected  = null;
  let cancelled = false;

  // Optical filter: 'all' | 'fail' (show only optical budget failures among ROUTED)
  let optFilter = 'all';

  $: rows = filterRows(results, filter, optFilter);

  function filterRows(r, f, of) {
    if (!r) return [];
    let out = f === 'all' ? r : r.filter(x => x.status.toLowerCase() === f);
    if (of === 'fail') out = out.filter(x => x.linkPass === false);
    return out;
  }

  function statusClass(s) {
    if (s === 'ROUTED')   return 'ok';
    if (s === 'PARTIAL')  return 'wrn';
    return 'bad';
  }
  function statusIcon(s) {
    if (s === 'ROUTED')  return '✓';
    if (s === 'PARTIAL') return '⚡';
    return '✕';
  }

  // ── Break-point resolution ──────────────────────────────────────────────────
  // The break-point coordinate for a PARTIAL trace is computed inside
  // traceFibre (returned as result.breakNode = { id, type, coords }). We just
  // carry it through to the row so both this panel and the routes drawer can
  // fly to it. See fibreTrace.js for the deepest-reached-node logic.

  async function onRun() {
    running = true; cancelled = false;
    progress = 0; total = 0; results = null; summary = null; selected = null;
    optFilter = 'all';

    // Yield to let Svelte repaint before the BFS loop blocks the thread.
    await new Promise(r => setTimeout(r, 20));

    const store = projectStore.state;
    total = (store.addressPoints || []).length;

    if (!total) {
      results = [];
      summary = { premises: 0, routed: 0, partial: 0, unserved: 0, optFail: 0 };
      running = false;
      return;
    }

    // Run in chunked async batches so the UI stays responsive on large networks.
    const CHUNK = 50;
    const pts   = store.addressPoints;
    const res   = [];
    const sum   = { premises: total, routed: 0, partial: 0, unserved: 0, optFail: 0 };

    for (let i = 0; i < pts.length; i += CHUNK) {
      if (cancelled) break;
      const batch = pts.slice(i, i + CHUNK);
      for (const ap of batch) {
        const uprn = String(ap.properties?.uprn ?? '');
        const addr = String(ap.properties?.address || ap.properties?.postcode || uprn);
        let r;
        try { r = traceFibre(store, uprn); }
        catch (e) { r = { status: 'PARTIAL', reason: `Error: ${e.message}`, lengthM: 0, breakNode: null, optical: null }; }

        const { status, reason, lengthM, breakNode, optical } = r;
        if      (status === STATUS_OK)      sum.routed++;
        else if (status === STATUS_PARTIAL) sum.partial++;
        else                                sum.unserved++;

        // Optical stats (ROUTED only; null for PARTIAL/UNSERVED)
        const lossDb   = optical?.loss_db   ?? null;
        const marginDb = optical?.margin_db ?? null;
        const linkPass = optical?.link_pass ?? null;
        if (linkPass === false) sum.optFail++;

        // Precompute the fly-to target: break-point asset for PARTIAL (from
        // traceFibre.breakNode), else the premise coordinate. Stored on the row
        // so both this panel and the routes drawer fly to the same place.
        let flyTo = null;
        if (status === 'PARTIAL' && breakNode?.coords) {
          flyTo = breakNode.coords;
        } else if (ap?.geometry?.coordinates) {
          flyTo = ap.geometry.coordinates;
        }

        res.push({
          uprn, address: addr, status, reason,
          lengthM: Math.round(lengthM || 0),
          breakId: breakNode?.id || null,
          flyTo,
          lossDb, marginDb, linkPass,
        });
        progress = i + res.length % CHUNK;
      }
      progress = Math.min(i + CHUNK, total);
      // Yield between chunks
      await new Promise(r => setTimeout(r, 0));
    }

    results = res;
    summary = sum;
    running = false;

    // Notify App to update stats bar and populate routes drawer
    dispatch('summary', summary);
    dispatch('results', res);
  }

  function onCancel() { cancelled = true; }

  function onRowClick(row) {
    selected = row.uprn;
    dispatch('highlight', row); // row.flyTo already set (break-point or premise)
  }

  // Count optical failures in current result set (for filter badge)
  $: optFailCount = results ? results.filter(r => r.linkPass === false).length : 0;
</script>

<div class="vrp">
  <!-- Header -->
  <div class="vrp-hdr">
    <span class="vrp-title">Validate Routes</span>
    <button class="vrp-close" on:click={() => dispatch('close')} title="Close">✕</button>
  </div>

  <!-- Summary bar -->
  {#if summary}
    <div class="vrp-summary">
      <div class="vrp-s ok"  on:click={() => { filter='routed';   optFilter='all'; }} class:active={filter==='routed'}   role="button" tabindex="0" on:keydown={(e)=>e.key==='Enter'&&(filter='routed')}>
        <span class="vrp-sv">{summary.routed}</span><span class="vrp-sl">Routed</span>
      </div>
      <div class="vrp-s wrn" on:click={() => { filter='partial';  optFilter='all'; }} class:active={filter==='partial'}  role="button" tabindex="0" on:keydown={(e)=>e.key==='Enter'&&(filter='partial')}>
        <span class="vrp-sv">{summary.partial}</span><span class="vrp-sl">Partial</span>
      </div>
      <div class="vrp-s bad" on:click={() => { filter='unserved'; optFilter='all'; }} class:active={filter==='unserved'} role="button" tabindex="0" on:keydown={(e)=>e.key==='Enter'&&(filter='unserved')}>
        <span class="vrp-sv">{summary.unserved}</span><span class="vrp-sl">Unserved</span>
      </div>
      <div class="vrp-s neu" on:click={() => { filter='all'; optFilter='all'; }} class:active={filter==='all' && optFilter==='all'} role="button" tabindex="0" on:keydown={(e)=>e.key==='Enter'&&(filter='all')}>
        <span class="vrp-sv">{summary.premises}</span><span class="vrp-sl">All</span>
      </div>
    </div>
    <!-- Optical budget filter row (only shown after a run with results) -->
    {#if optFailCount > 0}
      <div class="vrp-opt-bar">
        <span class="vrp-opt-lbl">⚠ {optFailCount} optical budget fail{optFailCount !== 1 ? 's' : ''}</span>
        <button class="vrp-opt-btn" class:active={optFilter==='fail'}
          on:click={() => { filter='all'; optFilter = optFilter === 'fail' ? 'all' : 'fail'; }}>
          {optFilter === 'fail' ? 'Show all' : 'Show fails only'}
        </button>
      </div>
    {/if}
  {/if}

  <!-- Progress -->
  {#if running}
    <div class="vrp-prog-wrap">
      <div class="vrp-prog-bar">
        <div class="vrp-prog-fill" style="width:{total ? Math.round(progress/total*100) : 0}%"></div>
      </div>
      <div class="vrp-prog-lbl">{progress} / {total}</div>
      <button class="vrp-cancel" on:click={onCancel}>Cancel</button>
    </div>
  {/if}

  <!-- Result table -->
  <div class="vrp-list">
    {#if results === null && !running}
      <div class="vrp-intro">
        Traces every premise to the cabinet via bundles/drops → joints → cables.
        Reports ROUTED (with optical power budget), PARTIAL (path breaks), or UNSERVED (not connected yet).
        Click a row to fly to that premise. PARTIAL rows fly to the break-point asset.
      </div>
    {:else if results && results.length === 0}
      <div class="vrp-empty">No address points in the project yet.</div>
    {:else if rows.length === 0}
      <div class="vrp-empty">No {optFilter === 'fail' ? 'optical budget failures' : filter} premises.</div>
    {:else}
      {#each rows as row}
        <div class="vrp-row {statusClass(row.status)}" class:sel={selected===row.uprn}
             on:click={() => onRowClick(row)} role="button" tabindex="0"
             on:keydown={(e)=>e.key==='Enter'&&onRowClick(row)}>
          <div class="vrp-row-top">
            <span class="vrp-icon {statusClass(row.status)}">{statusIcon(row.status)}</span>
            <span class="vrp-addr">{row.address || row.uprn}</span>
            <!-- Optical budget badge (ROUTED rows only) -->
            {#if row.lossDb !== null}
              <span class="vrp-opt-badge" class:pass={row.linkPass} class:fail={!row.linkPass}
                    title="Loss: {row.lossDb.toFixed(2)} dB | Margin: {row.marginDb >= 0 ? '+' : ''}{row.marginDb.toFixed(2)} dB">
                {row.lossDb.toFixed(1)}dB&nbsp;{row.linkPass ? '✓' : '✗'}
              </span>
            {/if}
            {#if row.lengthM}
              <span class="vrp-len">{row.lengthM}m</span>
            {/if}
          </div>
          {#if row.status !== 'ROUTED'}
            <div class="vrp-reason">{row.reason}</div>
          {:else if row.linkPass === false}
            <div class="vrp-reason fail-reason">
              Budget fail — margin {row.marginDb >= 0 ? '+' : ''}{row.marginDb?.toFixed(2)} dB.
              Check splitter count and route length.
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>

  <!-- Actions -->
  <div class="vrp-actions">
    {#if !running}
      <button class="vrp-run" on:click={onRun} disabled={running}>
        ▶ {results ? 'Re-run' : 'Run Validation'}
      </button>
    {:else}
      <button class="vrp-run running" disabled>Running…</button>
    {/if}
    <button class="vrp-done" on:click={() => dispatch('close')}>Done</button>
  </div>
</div>

<style>
  .vrp { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

  .vrp-hdr { height: 44px; background: #0d1520; border-bottom: 1px solid #1a2d40; display: flex; align-items: center; padding: 0 14px; gap: 8px; flex-shrink: 0; }
  .vrp-title { font-size: 9px; color: #a0c4d8; letter-spacing: 0.14em; text-transform: uppercase; flex: 1; font-weight: 600; }
  .vrp-close { background: #0f1c28; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 11px; width: 24px; height: 24px; border-radius: 4px; cursor: pointer; }
  .vrp-close:hover { border-color: #ff555544; color: #ff5555; }

  .vrp-summary { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 5px; padding: 10px 12px 8px; flex-shrink: 0; border-bottom: 1px solid #1a2d4033; }
  .vrp-s { background: #080e14; border-radius: 5px; padding: 8px 4px; text-align: center; cursor: pointer; border: 1px solid transparent; transition: border-color 0.1s; }
  .vrp-s.active { border-color: currentColor; }
  .vrp-s.ok  { color: #34d399; }
  .vrp-s.wrn { color: #fbbf24; }
  .vrp-s.bad { color: #f87171; }
  .vrp-s.neu { color: #7ab8d4; }
  .vrp-sv { display: block; font-size: 18px; font-weight: 700; line-height: 1; }
  .vrp-sl { display: block; font-size: 6.5px; letter-spacing: 0.08em; text-transform: uppercase; margin-top: 3px; opacity: 0.7; }

  /* Optical filter bar */
  .vrp-opt-bar { display: flex; align-items: center; justify-content: space-between; padding: 5px 12px; background: #06080c; border-bottom: 1px solid #1a2d4033; flex-shrink: 0; }
  .vrp-opt-lbl { font-size: 8px; color: #f87171; letter-spacing: 0.04em; }
  .vrp-opt-btn { font-size: 7.5px; color: #6a8fa8; background: #0a1018; border: 1px solid #1a2d40; border-radius: 3px; padding: 3px 8px; cursor: pointer; font-family: 'Courier New', monospace; letter-spacing: 0.04em; }
  .vrp-opt-btn:hover { color: #a0c4d8; border-color: #2a4a60; }
  .vrp-opt-btn.active { color: #f87171; border-color: #f8717144; }

  .vrp-prog-wrap { padding: 8px 12px; display: flex; align-items: center; gap: 8px; flex-shrink: 0; border-bottom: 1px solid #1a2d4033; }
  .vrp-prog-bar { flex: 1; height: 6px; background: #0d1824; border-radius: 3px; overflow: hidden; }
  .vrp-prog-fill { height: 6px; background: #4dc8ff; border-radius: 3px; transition: width 0.2s; }
  .vrp-prog-lbl { font-size: 8px; color: #6a8fa8; letter-spacing: 0.04em; white-space: nowrap; }
  .vrp-cancel { background: transparent; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 7.5px; padding: 2px 8px; border-radius: 3px; cursor: pointer; }
  .vrp-cancel:hover { border-color: #ff555544; color: #ff5555; }

  .vrp-list { flex: 1; overflow-y: auto; padding: 4px 8px; }
  .vrp-intro { font-size: 8.5px; color: #6a8fa8; line-height: 1.7; padding: 12px 6px; letter-spacing: 0.02em; }
  .vrp-empty { font-size: 8.5px; color: #3a5a70; padding: 14px 6px; letter-spacing: 0.04em; }

  .vrp-row { padding: 7px 6px; border-bottom: 1px solid #0c141c; cursor: pointer; border-radius: 3px; transition: background 0.1s; }
  .vrp-row:hover { background: #0f1c2a; }
  .vrp-row.sel { background: #00aaff0d; }
  .vrp-row-top { display: flex; align-items: baseline; gap: 6px; }
  .vrp-icon { font-size: 9px; font-weight: 700; flex-shrink: 0; width: 14px; text-align: center; }
  .vrp-icon.ok  { color: #34d399; }
  .vrp-icon.wrn { color: #fbbf24; }
  .vrp-icon.bad { color: #f87171; }
  .vrp-addr { font-size: 8.5px; color: #a0c4d8; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* Optical badge: compact loss dB + PASS/FAIL tick */
  .vrp-opt-badge { font-size: 7.5px; font-weight: 600; flex-shrink: 0; padding: 1px 5px; border-radius: 3px; font-variant-numeric: tabular-nums; letter-spacing: 0.02em; }
  .vrp-opt-badge.pass { color: #34d399; background: #34d39914; }
  .vrp-opt-badge.fail { color: #f87171; background: #f8717114; }

  .vrp-len { font-size: 7.5px; color: #3a5a70; flex-shrink: 0; }
  .vrp-reason { font-size: 7.5px; color: #6a8fa8; line-height: 1.5; margin-top: 3px; padding-left: 20px; }
  .vrp-reason.fail-reason { color: #f8717188; }

  .vrp-actions { padding: 10px 14px; border-top: 1px solid #1a2d40; display: flex; gap: 6px; flex-shrink: 0; }
  .vrp-run { flex: 1; background: #00aaff14; border: 1px solid #00aaff44; color: #4dc8ff; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; padding: 8px; border-radius: 4px; cursor: pointer; }
  .vrp-run:hover:not(:disabled) { background: #00aaff22; }
  .vrp-run:disabled { opacity: 0.5; cursor: default; }
  .vrp-run.running { background: #0a1018; border-color: #1a2d40; color: #3a5a70; }
  .vrp-done { background: #0a1018; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; padding: 8px 12px; border-radius: 4px; cursor: pointer; }
  .vrp-done:hover { color: #a0c4d8; }
</style>
