<script>
  // FibreCountPanel.svelte
  // Right-panel for rpMode === 'fibre-count'.
  // Shows a global utilisation summary + a scrollable segment list.
  // Clicking a segment row emits 'highlight' so App.svelte can flash it on the map.
  // Close emits 'close'.

  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();

  export let result = null;   // return value from countFibres()

  let filter = 'all';         // 'all' | 'cables' | 'spans' | 'over'
  let sortBy = 'pct-desc';    // 'pct-desc' | 'pct-asc' | 'id'

  $: rows = buildRows(result, filter, sortBy);

  function buildRows(r, f, s) {
    if (!r || !r.segments) return [];
    let segs = [...r.segments];
    if (f === 'cables') segs = segs.filter(x => x.collection === 'cables');
    else if (f === 'spans') segs = segs.filter(x => x.collection === 'spans');
    else if (f === 'over') segs = segs.filter(x => x.used > x.fibre_count && x.fibre_count > 0);
    if (s === 'pct-desc') segs.sort((a, b) => b.pct - a.pct || a.id.localeCompare(b.id));
    else if (s === 'pct-asc') segs.sort((a, b) => a.pct - b.pct || a.id.localeCompare(b.id));
    else segs.sort((a, b) => a.id.localeCompare(b.id));
    return segs;
  }

  function pctClass(pct, cap) {
    if (cap === 0) return 'neu';
    if (pct >= 100) return 'bad';
    if (pct >= 75)  return 'wrn';
    return 'ok';
  }

  function pctBar(pct) {
    return Math.min(100, pct);
  }

  function barColor(pct) {
    if (pct >= 100) return '#ff5555';
    if (pct >= 75)  return '#ffaa44';
    return '#4dc8ff';
  }
</script>

<div class="fc-panel">
  <!-- Header -->
  <div class="fc-hdr">
    <span class="fc-title">Fibre Count</span>
    <button class="fc-close" on:click={() => dispatch('close')} title="Dismiss">✕</button>
  </div>

  {#if result}
    <!-- Summary stats -->
    <div class="fc-stats">
      <div class="fc-stat">
        <div class="fc-sv {result.totals.max_pct >= 100 ? 'bad' : result.totals.max_pct >= 75 ? 'wrn' : 'ok'}">{result.totals.max_pct}%</div>
        <div class="fc-sl">Peak</div>
      </div>
      <div class="fc-stat">
        <div class="fc-sv">{result.totals.avg_pct}%</div>
        <div class="fc-sl">Avg</div>
      </div>
      <div class="fc-stat">
        <div class="fc-sv {result.totals.overloaded ? 'bad' : 'ok'}">{result.totals.overloaded}</div>
        <div class="fc-sl">Over-cap</div>
      </div>
      <div class="fc-stat">
        <div class="fc-sv">{result.totals.total_fibre_km}</div>
        <div class="fc-sl">km fibre</div>
      </div>
    </div>
    <div class="fc-sub">{result.totals.cables} cable · {result.totals.spans} span · {result.segments?.length ?? 0} segments total</div>

    {#if result.totals.overloaded}
      <div class="fc-warn">
        <span class="fc-warn-icon">⚠</span>
        {result.totals.overloaded} segment{result.totals.overloaded === 1 ? '' : 's'} over capacity — reduce consumer count or increase cable fibre_count.
      </div>
    {/if}

    <!-- Filters + sort -->
    <div class="fc-controls">
      <div class="fc-filters">
        <button class="fc-f" class:on={filter==='all'}    on:click={() => filter='all'}>All</button>
        <button class="fc-f" class:on={filter==='cables'} on:click={() => filter='cables'}>Cables</button>
        <button class="fc-f" class:on={filter==='spans'}  on:click={() => filter='spans'}>Spans</button>
        {#if result.totals.overloaded}
          <button class="fc-f bad" class:on={filter==='over'} on:click={() => filter='over'}>Over</button>
        {/if}
      </div>
      <select class="fc-sort" bind:value={sortBy}>
        <option value="pct-desc">↓ Utilisation</option>
        <option value="pct-asc">↑ Utilisation</option>
        <option value="id">ID</option>
      </select>
    </div>

    <!-- Segment list -->
    <div class="fc-list">
      {#if rows.length === 0}
        <div class="fc-empty">No segments match this filter.</div>
      {:else}
        {#each rows as seg}
          <div class="fc-row" on:click={() => dispatch('highlight', seg)} role="button" tabindex="0"
               on:keydown={(e) => e.key === 'Enter' && dispatch('highlight', seg)}>
            <div class="fc-row-top">
              <span class="fc-seg-id">{seg.id}</span>
              <span class="fc-seg-type">{seg.collection === 'cables' ? 'CABLE' : 'SPAN'}</span>
              <span class="fc-seg-pct {pctClass(seg.pct, seg.fibre_count)}">{seg.pct}%</span>
            </div>
            <div class="fc-row-bar">
              <div class="fc-bar-bg">
                <div class="fc-bar-fill" style="width:{pctBar(seg.pct)}%;background:{barColor(seg.pct)};"></div>
              </div>
            </div>
            <div class="fc-row-detail">
              <span class="fc-detail">{seg.used} used · {seg.spare} spare · {seg.fibre_count}f cap</span>
              {#if seg.length_m}
                <span class="fc-detail-r">{seg.length_m} m</span>
              {/if}
            </div>
          </div>
        {/each}
      {/if}
    </div>

    {#if result.log && result.log.length}
      <div class="fc-log-lbl">Log</div>
      <div class="fc-log">
        {#each result.log as line}
          <div class="fc-log-line">{line}</div>
        {/each}
      </div>
    {/if}
  {:else}
    <div class="fc-loading">Computing fibre utilisation…</div>
  {/if}

  <div class="fc-actions">
    <button class="fc-done" on:click={() => dispatch('close')}>Done</button>
  </div>
</div>

<style>
  .fc-panel { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

  .fc-hdr { height: 44px; background: #0d1520; border-bottom: 1px solid #1a2d40; display: flex; align-items: center; padding: 0 14px; gap: 8px; flex-shrink: 0; }
  .fc-title { font-size: 9px; color: #a0c4d8; letter-spacing: 0.14em; text-transform: uppercase; flex: 1; font-weight: 600; }
  .fc-close { background: #0f1c28; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 11px; width: 24px; height: 24px; border-radius: 4px; cursor: pointer; }
  .fc-close:hover { border-color: #ff555544; color: #ff5555; }

  .fc-stats { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 5px; padding: 12px 14px 4px; flex-shrink: 0; }
  .fc-stat { background: #080e14; border-radius: 5px; padding: 8px 4px; text-align: center; }
  .fc-sv { font-size: 17px; font-weight: 700; line-height: 1; color: #7ab8d4; }
  .fc-sv.ok { color: #4dc8ff; }
  .fc-sv.wrn { color: #ffaa44; }
  .fc-sv.bad { color: #ff5555; }
  .fc-sv.neu { color: #7ab8d4; }
  .fc-sl { font-size: 6.5px; color: #3a5a70; letter-spacing: 0.06em; text-transform: uppercase; margin-top: 3px; }
  .fc-sub { font-size: 8px; color: #6a8fa8; letter-spacing: 0.04em; padding: 0 14px 6px; flex-shrink: 0; }

  .fc-warn { margin: 0 14px 6px; padding: 7px 10px; background: #ff55550a; border: 1px solid #ff555533; border-radius: 4px; font-size: 8px; color: #c76060; line-height: 1.5; flex-shrink: 0; }
  .fc-warn-icon { margin-right: 4px; color: #ff5555; }

  .fc-controls { display: flex; align-items: center; padding: 0 14px 6px; gap: 6px; flex-shrink: 0; border-bottom: 1px solid #1a2d4033; }
  .fc-filters { display: flex; gap: 3px; flex: 1; }
  .fc-f { background: #0a1018; border: 1px solid #1a2d40; color: #3a5a70; font-family: 'Courier New', monospace; font-size: 7.5px; letter-spacing: 0.06em; text-transform: uppercase; padding: 3px 8px; border-radius: 3px; cursor: pointer; transition: all 0.1s; }
  .fc-f:hover { border-color: #00aaff33; color: #6a8fa8; }
  .fc-f.on { border-color: #00aaff55; color: #4dc8ff; background: #00aaff0d; }
  .fc-f.bad.on { border-color: #ff555555; color: #ff5555; background: #ff55550d; }
  .fc-sort { background: #080e14; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 7.5px; padding: 3px 6px; border-radius: 3px; outline: none; }
  .fc-sort option { background: #0d1520; }

  .fc-list { flex: 1; overflow-y: auto; padding: 6px 10px 0; }
  .fc-empty { font-size: 8.5px; color: #3a5a70; padding: 12px 4px; letter-spacing: 0.04em; }
  .fc-loading { font-size: 8.5px; color: #3a5a70; padding: 20px 14px; letter-spacing: 0.04em; }

  .fc-row { padding: 7px 4px; border-bottom: 1px solid #0c141c; cursor: pointer; transition: background 0.1s; border-radius: 3px; }
  .fc-row:hover { background: #0f1c2a; }
  .fc-row-top { display: flex; align-items: baseline; gap: 6px; margin-bottom: 4px; }
  .fc-seg-id { font-size: 9px; font-weight: 700; color: #4dc8ff; letter-spacing: 0.05em; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fc-seg-type { font-size: 7px; color: #3a5a70; letter-spacing: 0.08em; text-transform: uppercase; flex-shrink: 0; }
  .fc-seg-pct { font-size: 10px; font-weight: 700; flex-shrink: 0; }
  .fc-seg-pct.ok  { color: #4dc8ff; }
  .fc-seg-pct.wrn { color: #ffaa44; }
  .fc-seg-pct.bad { color: #ff5555; }
  .fc-seg-pct.neu { color: #7ab8d4; }
  .fc-row-bar { margin-bottom: 4px; }
  .fc-bar-bg { height: 3px; background: #0d1824; border-radius: 2px; overflow: hidden; }
  .fc-bar-fill { height: 3px; border-radius: 2px; transition: width 0.3s; }
  .fc-row-detail { display: flex; justify-content: space-between; }
  .fc-detail { font-size: 7.5px; color: #6a8fa8; letter-spacing: 0.03em; }
  .fc-detail-r { font-size: 7.5px; color: #3a5a70; letter-spacing: 0.03em; }

  .fc-log-lbl { font-size: 7.5px; color: #3a5a70; letter-spacing: 0.12em; text-transform: uppercase; padding: 6px 14px 2px; flex-shrink: 0; }
  .fc-log { max-height: 64px; overflow-y: auto; padding: 0 14px 6px; flex-shrink: 0; }
  .fc-log-line { font-size: 7.5px; color: #6a8fa8; line-height: 1.6; padding: 1px 0; border-bottom: 1px solid #0c141c; }

  .fc-actions { padding: 10px 14px; border-top: 1px solid #1a2d40; flex-shrink: 0; }
  .fc-done { width: 100%; background: #00aaff14; border: 1px solid #00aaff44; color: #4dc8ff; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; padding: 8px; border-radius: 4px; cursor: pointer; }
  .fc-done:hover { background: #00aaff22; }
</style>
