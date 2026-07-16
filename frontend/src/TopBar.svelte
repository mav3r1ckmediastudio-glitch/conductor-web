<script>
  // TopBar.svelte — the full application top bar: logo, live project stats,
  // validation/output shortcut buttons, search box, 2D/3D toggle, the
  // .conductor file controls + save-status indicator, map/CAD export menu,
  // and the New/Open project menu. Extracted from App.svelte (16 Jul 2026
  // refactor).
  //
  // OWNS: its two dropdowns' open/closed state (with its own window click-
  // to-close, matching the old <svelte:window> behaviour), the search input
  // text, and the saved-projects list (read via projectStore.listProjects()
  // on demand when the Open menu is toggled — same lazy refresh as before).
  //
  // DOES NOT OWN: anything that touches the map, the store's contents, file
  // handles, or workflow state — all of that dispatches up to App.svelte
  // under the same handler names as before the extraction.
  import { createEventDispatcher } from 'svelte';
  import { projectStore } from './projectStore.js';
  const dispatch = createEventDispatcher();

  export let project = null;
  export let cheapStats = { premises: 0, fibre_km: null, duct_km: null, materials_cost: 0 };
  export let routeStats = { routed: null, partial: null, unserved: null };
  export let statsStale = false;
  export let stage = 'setup';
  export let is3D = false;
  export let exporting = false;
  export let fsaa = { status: 'no-file', lastSaved: null, fileName: null, supported: false };
  export let fsaaResume = null;
  export let activeProjectId = null;

  let searchQuery = '';
  let showOpen = false;
  let showExport = false;
  let projectList = [];

  function refreshList() { projectList = projectStore.listProjects(); }

  function fmtSaved(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
</script>

<svelte:window on:click={() => { showOpen = false; showExport = false; }} />

<div class="topbar">
  <div class="tb-logo">
    <div class="logo-main">CONDUCTOR</div>
    <div class="logo-sub">FTTP DESIGN</div>
  </div>
  <div class="tb-stats">
    {#if project}
      <div class="stat"><div class="sv neu" style="font-size:11px;">{project.name}</div><div class="sl">{project.areaId}</div></div>
    {:else}
      <div class="stat"><div class="sv neu" style="font-size:11px;">No Project</div><div class="sl">—</div></div>
    {/if}
    <div class="stat"><div class="sv neu">{cheapStats.premises || '—'}</div><div class="sl">Premises</div></div>
    <div class="stat" title={statsStale ? 'Stale — re-run Validate Routes' : ''}>
      <div class="sv ok">{routeStats.routed !== null ? routeStats.routed : '—'}{statsStale ? '*' : ''}</div>
      <div class="sl">Routed</div>
    </div>
    <div class="stat" title={statsStale ? 'Stale — re-run Validate Routes' : ''}>
      <div class="sv wrn">{routeStats.partial !== null ? routeStats.partial : '—'}{statsStale ? '*' : ''}</div>
      <div class="sl">Partial</div>
    </div>
    <div class="stat" title={statsStale ? 'Stale — re-run Validate Routes' : ''}>
      <div class="sv bad">{routeStats.unserved !== null ? routeStats.unserved : '—'}{statsStale ? '*' : ''}</div>
      <div class="sl">Unserved</div>
    </div>
    <div class="stat"><div class="sv neu">{cheapStats.fibre_km != null ? cheapStats.fibre_km + 'km' : '—'}</div><div class="sl">Fibre</div></div>
    <div class="stat"><div class="sv neu">{cheapStats.duct_km != null ? cheapStats.duct_km + 'km' : '—'}</div><div class="sl">Duct</div></div>
    <div class="stat" style="border-right:none;"><div class="sv neu">{cheapStats.materials_cost ? '£' + cheapStats.materials_cost.toLocaleString('en-GB', {maximumFractionDigits:0}) : '—'}</div><div class="sl">Est. Materials</div></div>
  </div>
  <div class="tb-centre">
    <div class="tb-grp-wrap">
      <div class="tb-grp-lbl">Validation</div>
      <div class="tb-grp">
        <button class="tb-btn hi" disabled={stage !== 'design'} on:click={() => dispatch('validateRoutes')}>✓ Validate Routes</button>
        <button class="tb-btn hi" disabled={stage !== 'design'} on:click={() => dispatch('designHealth')}>⚡ Design Health</button>
      </div>
    </div>
    <div class="tb-sep"></div>
    <div class="tb-grp-wrap">
      <div class="tb-grp-lbl">Outputs</div>
      <div class="tb-grp">
        <button class="tb-btn" disabled={stage !== 'design'} on:click={() => dispatch('splicePlan')}>Splice Plan</button>
        <button class="tb-btn" disabled={stage !== 'design'} on:click={() => dispatch('sld')}>SLD</button>
        <button class="tb-btn" disabled={stage !== 'design'} on:click={() => dispatch('bom')}>Bill of Materials</button>
      </div>
    </div>
  </div>
  <div class="tb-right">
    <div style="display:flex;align-items:center;gap:6px;">
      <input class="srch" placeholder="Zoom to postcode or asset..." bind:value={searchQuery} on:keydown={(e) => e.key === 'Enter' && dispatch('search', searchQuery)} />
      <button class="go" on:click={() => dispatch('search', searchQuery)}>GO</button>
    </div>
    <div class="vtog">
      <button class="vt" class:on={is3D} on:click={() => dispatch('setView', true)}>3D</button>
      <button class="vt" class:on={!is3D} on:click={() => dispatch('setView', false)}>2D</button>
    </div>
    {#if fsaa.supported}
      {#if fsaaResume}
        <button class="tb-resume" on:click={() => dispatch('resumeFile')} title="Reconnect to your last project file">↻ Resume {fsaaResume.fileName}</button>
      {/if}
      <div class="fsaa-grp">
        <button class="tb-new" on:click={() => dispatch('saveFile')} title="Save project to a file on disk">⤓ Save File</button>
        <button class="tb-new" on:click={() => dispatch('openFile')}  title="Open a .conductor file from disk">⤢ Open File</button>
        <span class="fsaa-ind"
              class:saved={fsaa.status === 'saved'}
              class:saving={fsaa.status === 'saving'}
              class:unsaved={fsaa.status === 'unsaved'}
              class:error={fsaa.status === 'error'}
              title={fsaa.fileName || ''}>
          {#if fsaa.status === 'saving'}Saving…
          {:else if fsaa.status === 'saved'}Saved {fmtSaved(fsaa.lastSaved)}
          {:else if fsaa.status === 'unsaved'}Unsaved…
          {:else if fsaa.status === 'error'}⚠ Not saved
          {:else}No file{/if}
        </span>
      </div>
    {/if}
    <div class="tb-open-wrap">
      <button class="tb-new" class:tb-disabled={is3D || exporting}
              on:click|stopPropagation={() => { if (!is3D && !exporting) showExport = !showExport; }}
              title={is3D ? 'Switch to 2D view to export the map' : 'Export map sheet (legend, totals, scale)'}>
        {exporting ? '⏳ Exporting…' : '⎙ Export ▾'}
      </button>
      {#if showExport && !is3D}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <div class="tb-open-menu" on:click|stopPropagation>
          <button class="tb-open-item exp-item" on:click={() => { showExport = false; dispatch('export', 'svg'); }}>SVG — vector, editable</button>
          <button class="tb-open-item exp-item" on:click={() => { showExport = false; dispatch('export', 'png'); }}>PNG — image</button>
          <button class="tb-open-item exp-item" on:click={() => { showExport = false; dispatch('cadExport', 'svg'); }}>CAD Sheet (beta) — SVG</button>
          <button class="tb-open-item exp-item" on:click={() => { showExport = false; dispatch('cadExport', 'png'); }}>CAD Sheet (beta) — PNG</button>
        </div>
      {/if}
    </div>
    <button class="tb-new" on:click={() => dispatch('newProject')} title="New Project">+ New</button>
    <div class="tb-open-wrap">
      <button class="tb-new" on:click|stopPropagation={() => { refreshList(); showOpen = !showOpen; }} title="Open Project">Open ▾</button>
      {#if showOpen}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div class="tb-open-menu" on:click|stopPropagation role="menu" tabindex="-1">
          {#if projectList.length === 0}
            <div class="tb-open-empty">No saved projects</div>
          {:else}
            {#each projectList as p}
              <div class="tb-open-row">
                <button class="tb-open-item" class:active={p.id === activeProjectId} on:click={() => { showOpen = false; dispatch('openProject', p.id); }}>
                  <span class="oi-name">{p.name}</span>
                  <span class="oi-area">{p.areaId}</span>
                </button>
                <button class="tb-open-del" title="Delete project" on:click|stopPropagation={() => { dispatch('deleteProject', { id: p.id, name: p.name }); refreshList(); }}>🗑</button>
              </div>
            {/each}
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>


<style>
  .topbar { height: 44px; background: #0d1520; border-bottom: 1px solid #1a2d40; display: flex; align-items: center; padding: 0 12px; gap: 12px; flex-shrink: 0; z-index: 30; }
  .tb-logo { display: flex; flex-direction: column; gap: 1px; }
  .logo-main { font-size: 12px; font-weight: 700; letter-spacing: 0.18em; color: #4dc8ff; text-shadow: 0 0 8px #00aaff66; }
  .logo-sub { font-size: 7px; color: #3a5a70; letter-spacing: 0.14em; }
  .tb-stats { display: flex; gap: 0; border-left: 1px solid #1a2d40; padding-left: 12px; }
  .stat { display: flex; flex-direction: column; align-items: center; padding: 0 7px; border-right: 1px solid #1a2d40; flex-shrink: 1; min-width: 0; }
  .sv { font-size: 12px; font-weight: 700; line-height: 1; white-space: nowrap; }
  .sv.ok { color: #4dc8ff; }
  .sv.bad { color: #ff5555; }
  .sv.wrn { color: #ffaa44; }
  .sv.neu { color: #7ab8d4; }
  .sl { font-size: 7px; color: #3a5a70; letter-spacing: 0.08em; text-transform: uppercase; margin-top: 2px; }
  .tb-centre { display: flex; align-items: center; gap: 8px; flex: 1; justify-content: center; }
  .tb-grp-wrap { display: flex; flex-direction: column; align-items: center; gap: 2px; }
  .tb-grp-lbl { font-size: 7px; color: #3a5a70; letter-spacing: 0.12em; text-transform: uppercase; }
  .tb-grp { display: flex; gap: 4px; }
  .tb-btn { background: #0a1018; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 8.5px; letter-spacing: 0.06em; text-transform: uppercase; padding: 4px 10px; border-radius: 4px; cursor: pointer; white-space: nowrap; transition: all 0.12s; }
  .tb-btn:hover:not(:disabled) { border-color: #00aaff33; color: #4dc8ff; }
  .tb-btn:disabled { opacity: 0.35; cursor: not-allowed; }
  .tb-btn.hi { border-color: #00aaff22; color: #4dc8ff99; }
  .tb-sep { width: 1px; height: 28px; background: #1a2d40; }
  .tb-right { display: flex; align-items: center; gap: 8px; }
  .srch { background: #080e14; border: 1px solid #1a2d40; color: #7ab8d4; font-family: 'Courier New', monospace; font-size: 9px; padding: 4px 10px; border-radius: 4px; width: 200px; outline: none; }
  .srch::placeholder { color: #2a4050; }
  .go { background: #0a1018; border: 1px solid #1a2d40; color: #4dc8ff; font-family: 'Courier New', monospace; font-size: 9px; padding: 4px 10px; border-radius: 4px; cursor: pointer; }
  .vtog { display: flex; border: 1px solid #1a2d40; border-radius: 4px; overflow: hidden; }
  .vt { background: #0a1018; border: none; color: #3a5a70; font-family: 'Courier New', monospace; font-size: 9px; padding: 4px 10px; cursor: pointer; }
  .vt.on { background: #00aaff14; color: #4dc8ff; }
  .tb-new { background: #0a1018; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.06em; padding: 4px 10px; border-radius: 4px; cursor: pointer; white-space: nowrap; }
  .tb-new:hover { border-color: #00aaff33; color: #4dc8ff; }
  .tb-open-wrap { position: relative; }
  .tb-open-menu { position: absolute; top: calc(100% + 4px); right: 0; background: #0d1520; border: 1px solid #1a2d40; border-radius: 5px; min-width: 200px; z-index: 100; box-shadow: 0 8px 24px #00000088; }
  .tb-open-empty { font-size: 9px; color: #3a5a70; padding: 10px 12px; }
  .tb-open-row { display: flex; align-items: stretch; border-bottom: 1px solid #1a2d4033; }
  .tb-open-row:last-child { border-bottom: none; }
  .tb-open-item { display: flex; align-items: center; justify-content: space-between; flex: 1; min-width: 0; box-sizing: border-box; background: transparent; border: none; padding: 8px 12px; cursor: pointer; gap: 12px; }
  .tb-open-item:hover { background: #0f1c28; }
  .tb-open-item.active .oi-name { color: #4dc8ff; }
  .tb-open-item.active::before { content: '●'; color: #4dc8ff; font-size: 6px; margin-right: 6px; }
  .tb-open-del { background: transparent; border: none; padding: 8px 10px; cursor: pointer; font-size: 11px; opacity: 0.5; }
  .tb-open-del:hover { opacity: 1; background: #2a0f0f; }
  .oi-name { font-size: 9px; color: #a0c4d8; font-family: 'Courier New', monospace; letter-spacing: 0.04em; }
  .oi-area { font-size: 8px; color: #3a5a70; font-family: 'Courier New', monospace; }
  .fsaa-grp { display: flex; align-items: center; gap: 6px; padding-left: 6px; margin-left: 2px; border-left: 1px solid #1a2d40; }
  .tb-disabled { opacity: 0.4; cursor: not-allowed; }
  .exp-item { display: block; width: 100%; box-sizing: border-box; border-bottom: 1px solid #1a2d4033; color: #a0c4d8; font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.04em; text-align: left; }
  .exp-item:last-child { border-bottom: none; }
  .exp-item:hover { color: #4dc8ff; }
  .fsaa-ind { font-family: 'Courier New', monospace; font-size: 8.5px; letter-spacing: 0.04em; color: #3a5a70; white-space: nowrap; min-width: 68px; }
  .fsaa-ind.saved   { color: #5dd6a0; }
  .fsaa-ind.saving  { color: #ffc04d; }
  .fsaa-ind.unsaved { color: #ffc04d; }
  .fsaa-ind.error   { color: #ff6b6b; }
  .tb-resume { background: #102030; border: 1px solid #00aaff55; color: #4dc8ff; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.05em; padding: 4px 10px; border-radius: 4px; cursor: pointer; white-space: nowrap; animation: fsaaPulse 2s ease-in-out infinite; }
  .tb-resume:hover { background: #15273a; border-color: #4dc8ff; }
  @keyframes fsaaPulse { 0%,100% { box-shadow: 0 0 0 0 #00aaff00; } 50% { box-shadow: 0 0 8px 0 #00aaff44; } }
</style>
