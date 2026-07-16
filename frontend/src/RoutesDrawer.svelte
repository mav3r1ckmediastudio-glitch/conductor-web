<script>
  // RoutesDrawer.svelte — the collapsible route-results table docked to the
  // bottom of the map. Extracted from App.svelte (16 Jul 2026 refactor).
  //
  // Owns everything drawer-local that App.svelte previously carried for it:
  // open/closed state, the status filter, the search box, the sorted/
  // filtered row derivation, and CSV export (a DOM-download side effect on
  // its own rows). App.svelte keeps ownership of the DATA (validateResults,
  // fed by ValidateRoutesPanel) and of the camera, so a row click is
  // dispatched up rather than easing the map from in here.
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();

  export let results = [];        // ValidateRoutesPanel rows: { uprn, address, status, reason, lengthM, flyTo? }
  export let selectedRoute = null; // uprn of the currently-highlighted row

  let drawerOpen = false;
  let filter = 'all';
  let search = '';

  // Routed → Partial → Unserved, always — same ordering fix as Validate
  // Routes (15 Jul 2026), just without the accordion: this list is short
  // enough on-screen that a stable sort is all it needs. Applies whether
  // "All Routes" or a single-status filter is selected — a no-op for the
  // single-status case (already homogeneous), so one sort covers both.
  const DRAWER_STATUS_ORDER = { ROUTED: 0, PARTIAL: 1, UNSERVED: 2 };
  $: drawerRows = results
    .filter(r => {
      if (filter !== 'all' && r.status.toLowerCase() !== filter) return false;
      if (search) {
        const q = search.toLowerCase();
        return r.uprn.toLowerCase().includes(q) || r.address.toLowerCase().includes(q);
      }
      return true;
    })
    .slice()
    .sort((a, b) => (DRAWER_STATUS_ORDER[a.status] ?? 3) - (DRAWER_STATUS_ORDER[b.status] ?? 3));

  function routeStatusClass(s) { return s === 'ROUTED' ? 'routed' : s === 'PARTIAL' ? 'partial' : 'unserved'; }

  function exportRoutesCsv() {
    if (!results.length) return;
    const hdr = 'UPRN,Address,Status,Reason,Length(m)';
    const rows = results.map(r => `"${r.uprn}","${r.address.replace(/"/g,'""')}","${r.status}","${(r.reason||'').replace(/"/g,'""')}","${r.lengthM}"`);
    const blob = new Blob([hdr + '\n' + rows.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'validate_routes.csv'; a.click();
  }
</script>

<div class="routes-drawer" style="height:{drawerOpen ? '220px' : '36px'};">
  <div class="routes-handle" on:click={() => drawerOpen = !drawerOpen}
       on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); drawerOpen = !drawerOpen; } }}
       role="button" tabindex="0" aria-expanded={drawerOpen} aria-label="Toggle routes drawer">
    <span class="handle-title">Routes</span>
    <span class="handle-count">{drawerRows.length}</span>
    <select class="handle-filter" bind:value={filter} on:click|stopPropagation>
      <option value="all">All Routes</option>
      <option value="routed">Routed</option>
      <option value="partial">Partial</option>
      <option value="unserved">Unserved</option>
    </select>
    <input class="handle-search" placeholder="Search routes..." bind:value={search} on:click|stopPropagation />
    <button class="handle-csv" on:click|stopPropagation={exportRoutesCsv}>↓ CSV</button>
    <button class="handle-toggle">{drawerOpen ? '▼' : '▲'}</button>
  </div>
  {#if drawerOpen}
  <div class="routes-table-wrap">
    {#if results.length === 0}
      <div style="padding:14px 16px;font-size:8.5px;color:#3a5a70;letter-spacing:0.04em;">Run ✓ Validate Routes to populate this table.</div>
    {:else}
    <table class="routes-table">
      <thead><tr>
        <th>Status</th><th>UPRN</th><th>Address</th><th>Length</th><th>Reason</th>
      </tr></thead>
      <tbody>
        {#each drawerRows as r}
          <tr class:sel={selectedRoute === r.uprn} on:click={() => dispatch('rowClick', r)}>
            <td><span class="status-pill {routeStatusClass(r.status)}">{r.status}</span></td>
            <td style="color:#4dc8ff;font-weight:600;">{r.uprn}</td>
            <td>{r.address}</td>
            <td>{r.lengthM ? r.lengthM + 'm' : '—'}</td>
            <td style="color:#6a8fa8;">{r.reason || '—'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    {/if}
  </div>
  {/if}
</div>

<style>
  .routes-drawer { position: absolute; bottom: 0; left: 0; right: 0; z-index: 20; display: flex; flex-direction: column; transition: height 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
  .routes-handle { height: 36px; background: #0d1520; border-top: 1px solid #1a2d40; display: flex; align-items: center; padding: 0 16px; gap: 12px; cursor: pointer; flex-shrink: 0; user-select: none; }
  .routes-handle:hover { background: #111c28; }
  .handle-title { font-size: 9px; color: #6a8fa8; letter-spacing: 0.12em; text-transform: uppercase; }
  .handle-count { background: #1a2d40; border-radius: 10px; padding: 2px 8px; font-size: 8px; color: #7ab8d4; letter-spacing: 0.06em; }
  .handle-search { background: #080e14; border: 1px solid #1a2d40; color: #7ab8d4; font-family: 'Courier New', monospace; font-size: 9px; padding: 4px 10px; border-radius: 4px; width: 160px; outline: none; margin-left: auto; }
  .handle-search::placeholder { color: #2a4050; }
  .handle-filter { background: #080e14; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 9px; padding: 4px 8px; border-radius: 4px; outline: none; margin-left: 6px; }
  .handle-csv { background: transparent; border: 1px solid #1a2d40; color: #3a5a70; font-family: 'Courier New', monospace; font-size: 8px; letter-spacing: 0.06em; text-transform: uppercase; padding: 3px 8px; border-radius: 4px; cursor: pointer; margin-left: 6px; }
  .handle-csv:hover { border-color: #00aaff44; color: #4dc8ff; }
  .handle-toggle { background: transparent; border: none; color: #3a5a70; font-size: 12px; cursor: pointer; padding: 0 0 0 8px; line-height: 1; }
  .handle-toggle:hover { color: #4dc8ff; }
  .routes-table-wrap { background: #0d1520; border-top: 1px solid #1a2d4044; overflow: auto; flex: 1; }
  .routes-table { width: 100%; border-collapse: collapse; }
  .routes-table th { background: #0a1018; color: #3a5a70; font-size: 8px; letter-spacing: 0.1em; text-transform: uppercase; padding: 7px 12px; text-align: left; border-bottom: 1px solid #1a2d40; border-right: 1px solid #1a2d4033; font-weight: 600; white-space: nowrap; position: sticky; top: 0; }
  .routes-table td { font-size: 9px; color: #7ab8d4; padding: 6px 12px; border-bottom: 1px solid #0f1a24; border-right: 1px solid #0f1a2466; white-space: nowrap; }
  .routes-table tr { cursor: pointer; }
  .routes-table tr:hover td { background: #0f1c2a; color: #a0c4d8; }
  .routes-table tr.sel td { background: #0d2038; }
  .status-pill { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 8px; font-weight: 700; letter-spacing: 0.06em; }
  .status-pill.routed { background: #00aaff14; color: #4dc8ff; border: 1px solid #00aaff33; }
  .status-pill.partial { background: #ffaa4414; color: #ffaa44; border: 1px solid #ffaa4433; }
  .status-pill.unserved { background: #ff555514; color: #ff5555; border: 1px solid #ff555533; }
</style>
