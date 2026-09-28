<script>
  // WirelessPanel.svelte — the wireless workspace: plan status, analysis and
  // coverage actions, issues, per-link verdicts with a path profile, asset
  // lists, engineering thresholds and BoM export. Presentational: App.svelte
  // owns state and side effects; every action is dispatched up.
  import { createEventDispatcher } from 'svelte';
  import WirelessProfileChart from './WirelessProfileChart.svelte';
  import { COVERAGE_STOPS } from './wirelessLayers.js';

  const dispatch = createEventDispatcher();

  export let sites = [];
  export let links = [];
  export let sectors = [];
  export let settings;                 // resolved settings
  export let analysis = null;          // stored analysis (may be stale)
  export let planState = 'NONE';       // NONE | UNVERIFIED | STALE | INVALID | VALIDATED
  export let profiles = new Map();     // link_id -> profile (session only)
  export let coverage = null;          // last coverage result (session only)
  export let coverageStale = false;
  export let busy = '';                // '' | 'analysis' | 'coverage'
  export let warning = '';
  export let selectedLinkId = '';

  const MESSAGES = {
    NONE:       'No wireless assets yet. Add a site to begin.',
    UNVERIFIED: 'Not analysed yet. Run “Analyse links” to check every link against the thresholds below.',
    STALE:      'Inputs have changed since the last analysis. Old results are hidden — re-run “Analyse links”.',
    INVALID:    'The analysis found problems (see below). Nothing here is approved.',
    VALIDATED:  'Automated checks passed. This is NOT engineering approval — a qualified wireless engineer must review the design before it is built.',
  };
  const BADGE = { NONE: '—', UNVERIFIED: 'UNVERIFIED', STALE: 'STALE', INVALID: 'INVALID', VALIDATED: 'VALIDATED' };

  $: fresh = planState === 'VALIDATED' || planState === 'INVALID';
  $: results = new Map(fresh && analysis ? analysis.links.map(l => [l.link_id, l]) : []);
  $: issues = fresh && analysis ? analysis.issues : [];
  $: errors = issues.filter(i => i.severity === 'error');
  $: notes = issues.filter(i => i.severity !== 'error');
  $: selected = links.find(l => l.properties.link_id === selectedLinkId) || null;
  $: selResult = selected ? results.get(selected.properties.link_id) : null;
  $: selProfile = selected && fresh ? profiles.get(selected.properties.link_id) : null;

  let showSettings = false;
  let draft = {};
  $: draft = { ...settings };
  const SETTING_FIELDS = [
    ['kFactor', 'Effective earth radius factor (k)', 'Standard atmosphere ≈ 1.33'],
    ['minFresnelClearancePct', 'Required 1st Fresnel clearance (%)', '60 is a common rule of thumb'],
    ['minFadeMarginDb', 'Required fade margin (dB)', 'Per direction'],
    ['coverageMarginDb', 'Coverage margin above CPE minimum (dB)', 'A premises counts as covered at or above this'],
    ['profileStepM', 'Terrain sample spacing (m)', 'Finer is slower and no more accurate than the data'],
    ['terrainZoom', 'Terrain tile zoom', '12 ≈ 21 m/px at this latitude; source data is ~30 m'],
  ];
  // Plausibility limits for entered radio values (typical UK fixed wireless).
  // They catch typos and unit mistakes; they are not Ofcom/regulatory limits.
  const LIMIT_FIELDS = [
    ['freqMinGhz', 'Lowest frequency (GHz)', ''],
    ['freqMaxGhz', 'Highest frequency (GHz)', '90 covers E-band (71–86 GHz)'],
    ['txPowerMinDbm', 'Lowest Tx power (dBm)', ''],
    ['txPowerMaxDbm', 'Highest Tx power (dBm)', ''],
    ['gainMinDbi', 'Lowest antenna gain (dBi)', ''],
    ['gainMaxDbi', 'Highest antenna gain (dBi)', 'Large PtP dishes are about 40–45 dBi'],
    ['rxSensMinDbm', 'Best (lowest) Rx sensitivity (dBm)', ''],
    ['rxSensMaxDbm', 'Worst (highest) Rx sensitivity (dBm)', ''],
    ['maxLossDb', 'Largest cable or extra loss (dB)', 'Losses can never be negative'],
    ['gasModel', 'Apply atmospheric gas absorption (1 = yes, 0 = no)', 'ITU-R P.676 oxygen + water vapour at each link\'s own frequency.'],
    ['gasTemperatureC', 'Air temperature for gas absorption (°C)', 'Standard atmosphere is 15'],
    ['gasWaterVapourGm3', 'Water vapour density (g/m³)', 'Standard atmosphere is 7.5; humid Scottish air is close to it'],
    ['absorptionAboveGhz', 'With the gas model off, require an extra-loss allowance above (GHz)', ''],
    ['rainAssessAboveGhz', 'Judge links on rain availability from (GHz)', 'Below this, the flat fade margin above is used instead'],
    ['rainRate001Mmh', 'Rain rate exceeded 0.01% of the time (mm/h)', 'ITU-R P.837-7 gives 27-30 for the three Loch Tay sites. Change it for anywhere else.'],
    ['minAvailabilityPct', 'Required availability against rain (%)', 'A design target. 99.9 is about 9 hours of rain outage a year'],
    ['minClearSkyMarginDb', 'Required clear-sky margin for rain-assessed links (dB)', 'Allowance for alignment, ageing and mount sway'],
  ];
  function commitSetting(key, raw) {
    const v = Number(raw);
    if (raw === '' || !Number.isFinite(v)) { draft[key] = settings[key]; return; }
    dispatch('settings', { [key]: v });
  }

  const fmt = (v, d = 1) => (v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(d));
  $: served = coverage?.premises;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  function remove(kind, id, label) {
    if (window.confirm(`Delete ${label}?${kind === 'site' ? ' Its sectors and every link that ends on it will also be deleted.' : ''}`)) dispatch('remove', { kind, id });
  }
</script>

<div class="wp">
  <div class="head">
    <span class="title">Wireless</span>
    <span class="badge {planState}" data-testid="wp-state">{BADGE[planState]}</span>
    <button class="x" aria-label="Close wireless panel" on:click={() => dispatch('close')}>✕</button>
  </div>

  <div class="body">
    <div class="msg {planState}">{MESSAGES[planState]}</div>
    {#if warning}<div class="warning" data-testid="wp-warning">{warning}</div>{/if}

    <div class="actions">
      <button class="primary" data-testid="wp-analyse" disabled={busy !== '' || !links.length} on:click={() => dispatch('analyse')}>
        {busy === 'analysis' ? 'Analysing…' : 'Analyse links'}
      </button>
      <button class="primary" data-testid="wp-coverage" disabled={busy !== '' || !sectors.length} on:click={() => dispatch('coverage')}>
        {busy === 'coverage' ? 'Computing…' : 'Coverage estimate'}
      </button>
    </div>

    {#if errors.length}
      <div class="sec">
        <div class="sec-t">Problems ({errors.length})</div>
        {#each errors as i}
          <button class="issue err" data-testid="wp-issue" data-code={i.code} on:click={() => dispatch('zoom', { kind: i.scope, id: i.id })}><code>{i.code}</code> {i.message}</button>
        {/each}
      </div>
    {/if}
    {#if notes.length}
      <div class="sec">
        <div class="sec-t">Notes ({notes.length})</div>
        {#each notes as i}<div class="issue note" data-testid="wp-note" data-code={i.code}><code>{i.code}</code> {i.message}</div>{/each}
      </div>
    {/if}

    <div class="sec">
      <div class="sec-t">Links ({links.length})</div>
      {#each links as l}
        {@const id = l.properties.link_id}
        {@const r = results.get(id)}
        <div class="row" class:sel={selectedLinkId === id} data-testid="wp-link-row">
          <button class="rowmain" on:click={() => dispatch('selectLink', id)}>
            <span class="rid">{id}</span>
            <span class="rsub">{l.properties.site_a} ↔ {l.properties.site_b}</span>
            {#if r}
              <span class="chip {r.verdict}" data-testid="wp-verdict">{r.verdict}</span>
              <span class="rsub">{fmt(r.distanceKm, 2)} km · margin {fmt(r.fadeMarginDb)} dB · F1 {fmt(r.fresnelWorstPct, 0)}%</span>
            {:else}<span class="chip NONE">not current</span>{/if}
          </button>
          <span class="acts">
            <button title="Zoom to link" on:click={() => dispatch('zoom', { kind: 'link', id })}>⌖</button>
            <button title="Edit link" data-testid="wp-edit-link" on:click={() => dispatch('edit', { kind: 'link', id })}>✎</button>
            <button title="Delete link" on:click={() => remove('link', id, id)}>✕</button>
          </span>
        </div>
      {/each}
      {#if !links.length}<div class="hint">Use the “Draw Link” tool: click one site, then another.</div>{/if}
    </div>

    {#if selected}
      <div class="sec" data-testid="wp-profile">
        <div class="sec-t">Path profile — {selectedLinkId}</div>
        <WirelessProfileChart profile={selProfile} clearancePct={settings.minFresnelClearancePct}
          aLabel={selected.properties.site_a} bLabel={selected.properties.site_b} />
        {#if selResult}
          <table class="kv"><tbody>
            <tr><td>Rx A→B</td><td>{fmt(selResult.rxAtoBDbm)} dBm</td><td>fade margin</td><td>{fmt(selResult.fadeAtoBDb)} dB</td></tr>
            <tr><td>Rx B→A</td><td>{fmt(selResult.rxBtoADbm)} dBm</td><td>fade margin</td><td>{fmt(selResult.fadeBtoADb)} dB</td></tr>
            <tr><td>Free-space loss</td><td>{fmt(selResult.fsplDb)} dB</td><td>terrain</td><td>{selResult.terrainStatus}</td></tr>
            <tr><td>Atmospheric loss</td><td>{fmt(selResult.atmosLossDb)} dB</td><td></td><td></td></tr>
            {#if selResult.rain}
              <tr data-testid="wp-rain"><td>Rain fade (0.01%)</td><td>{fmt(selResult.rain.a001Db)} dB</td><td>at</td><td>{selResult.rain.r001Mmh} mm/h</td></tr>
              <tr data-testid="wp-rain-avail"><td>Rain availability</td><td>{selResult.rain.availabilityBound === 'below' ? '< 99' : selResult.rain.availabilityBound === 'above' ? '> 99.999' : selResult.rain.availabilityPct.toFixed(selResult.rain.availabilityPct >= 99.9 ? 2 : 1)} %</td><td>target</td><td>{selResult.rain.targetPct} %</td></tr>
            {/if}
            <tr><td>Worst clearance</td><td>{fmt(selResult.clearanceWorstM)} m ({fmt(selResult.fresnelWorstPct, 0)}% F1)</td><td>at</td><td>{fmt(selResult.worstAtKm, 2)} km</td></tr>
          </tbody></table>
          {#if selResult.surveyed}<div class="hint warn">Line of sight recorded as surveyed — modelled clearance is waived for this link.</div>{/if}
        {/if}
      </div>
    {/if}

    <div class="sec">
      <div class="sec-t">Sites ({sites.length})</div>
      {#each sites as s}
        {@const id = s.properties.site_id}
        <div class="row">
          <span class="rowmain static"><span class="rid">{id}</span><span class="rsub">{s.properties.name || ''} · {s.properties.mast_height_m ?? '?'} m</span></span>
          <span class="acts">
            <button title="Zoom" on:click={() => dispatch('zoom', { kind: 'site', id })}>⌖</button>
            <button title="Edit" data-testid="wp-edit-site" on:click={() => dispatch('edit', { kind: 'site', id })}>✎</button>
            <button title="Delete" on:click={() => remove('site', id, id)}>✕</button>
          </span>
        </div>
      {/each}
      <div class="sec-t sub">Sectors ({sectors.length})</div>
      {#each sectors as s}
        {@const id = s.properties.sector_id}
        <div class="row">
          <span class="rowmain static"><span class="rid">{id}</span><span class="rsub">{s.properties.site_id} · az {s.properties.azimuth_deg ?? '?'}° · {s.properties.beamwidth_deg ?? '?'}°</span></span>
          <span class="acts">
            <button title="Zoom" on:click={() => dispatch('zoom', { kind: 'sector', id })}>⌖</button>
            <button title="Edit" data-testid="wp-edit-sector" on:click={() => dispatch('edit', { kind: 'sector', id })}>✎</button>
            <button title="Delete" on:click={() => remove('sector', id, id)}>✕</button>
          </span>
        </div>
      {/each}
    </div>

    {#if coverage}
      <div class="sec">
        <div class="sec-t">Coverage estimate {#if coverageStale}<span class="chip STALE" data-testid="wp-coverage-stale">STALE — hidden</span>{/if}</div>
        {#if coverageStale}
          <div class="hint warn">Inputs changed since this was computed, so the overlay has been removed. Re-run “Coverage estimate”.</div>
        {:else}
          <table class="kv"><tbody>
            <tr data-testid="wp-coverage-summary"><td>Premises served</td><td colspan="3"><b>{served.served}</b> of {served.total} ({pct(served.served, served.total)}%) at ≥ {settings.coverageMarginDb} dB above CPE minimum</td></tr>
            <tr><td>Not served</td><td>{served.unserved}</td><td>no data</td><td>{served.noData}</td></tr>
          </tbody></table>
          <div class="ramp">
            {#each COVERAGE_STOPS as [dbm, c]}<span style="background: rgb({c.join(',')})"></span>{/each}
          </div>
          <div class="ramp-l"><span>{settings.coverageMarginDb} dB</span><span>margin above CPE minimum Rx</span><span>{settings.coverageMarginDb + 50} dB</span></div>
          <div class="hint">
            ESTIMATE ONLY. Terrain source: {coverage.terrainInfo.id} (~{fmt(coverage.terrainInfo.resolutionM, 0)} m, terrain-vs-surface model not documented by the provider). No buildings or trees are modelled.
            Horizontal antenna pattern only; single knife-edge diffraction; no rain or foliage loss. “No data” premises are outside the analysed area or on missing terrain and are never counted as served.
            {#if coverage.skipped?.length}<br />Skipped sectors: {coverage.skipped.map(s => s.sector_id).join(', ')} (incomplete or no terrain at site).{/if}
          </div>
          <button class="ghost" on:click={() => dispatch('clearCoverage')}>Remove overlay</button>
        {/if}
      </div>
    {/if}

    <div class="sec">
      <button class="fold" on:click={() => (showSettings = !showSettings)}>{showSettings ? '▾' : '▸'} Engineering thresholds</button>
      {#if showSettings}
        <div class="hint warn">These are DEFAULTS, not authoritative engineering rules. Have a qualified wireless engineer confirm them before relying on a result. Changing any value makes the current analysis stale.</div>
        {#each SETTING_FIELDS as [key, label, help]}
          <div class="setg">
            <label for={'ws-' + key}>{label}</label>
            <input id={'ws-' + key} type="text" inputmode="decimal" bind:value={draft[key]} on:change={(e) => commitSetting(key, e.currentTarget.value)} />
            <div class="help">{help}</div>
          </div>
        {/each}
        <div class="sec-t sub">Radio input limits</div>
        <div class="hint">Typical UK fixed-wireless values. An entry outside these fails the link or sector so a typo can never produce an impossible budget. They are not Ofcom or licence limits.</div>
        {#each LIMIT_FIELDS as [key, label, help]}
          <div class="setg">
            <label for={'ws-' + key}>{label}</label>
            <input id={'ws-' + key} data-testid={'ws-' + key} type="text" inputmode="decimal" bind:value={draft[key]} on:change={(e) => commitSetting(key, e.currentTarget.value)} />
            {#if help}<div class="help">{help}</div>{/if}
          </div>
        {/each}
      {/if}
    </div>

    <div class="sec">
      <div class="sec-t">Bill of quantities</div>
      <div class="actions">
        <button class="ghost" disabled={!sites.length && !links.length && !sectors.length} on:click={() => dispatch('bom', 'csv')}>Export CSV</button>
        <button class="ghost" disabled={!sites.length && !links.length && !sectors.length} on:click={() => dispatch('bom', 'html')}>Export HTML</button>
      </div>
      <div class="hint">Quantities only — no prices are assumed. Every export is stamped with the plan state ({BADGE[planState]}).</div>
    </div>
  </div>
</div>

<style>
  .wp { display: flex; flex-direction: column; height: 100%; background: #0d1520; color: #6a8fa8; font-size: 12px; }
  .head { display: flex; align-items: center; gap: 10px; padding: 12px 16px; background: #0a0f14; border-bottom: 1px solid #1a2d40; }
  .title { font-size: 13px; font-weight: bold; color: #7ab8d4; }
  .x { margin-left: auto; background: none; border: none; color: #3a5a70; cursor: pointer; font-size: 14px; }
  .x:hover { color: #a0c4d8; }
  .badge, .chip { font-size: 9px; letter-spacing: 0.08em; padding: 2px 6px; border-radius: 2px; border: 1px solid #2a4a5e; color: #6a8fa8; font-family: 'Courier New', monospace; }
  .badge.VALIDATED, .chip.PASS { color: #3ddc97; border-color: #3ddc97; }
  .badge.INVALID, .chip.FAIL { color: #ff5c5c; border-color: #ff5c5c; }
  .badge.STALE, .chip.STALE { color: #ffb03b; border-color: #ffb03b; }
  .badge.UNVERIFIED { color: #4dc8ff; border-color: #4dc8ff; }
  .body { overflow-y: auto; flex: 1; padding-bottom: 24px; }
  .msg { padding: 10px 16px; font-size: 11px; line-height: 1.5; border-bottom: 1px solid #1a2d40; }
  .msg.VALIDATED { color: #9adfc0; } .msg.INVALID { color: #ff9a9a; } .msg.STALE { color: #ffcf80; }
  .warning { padding: 8px 16px; color: #ffcf80; background: #2a2210; font-size: 11px; border-bottom: 1px solid #1a2d40; }
  .actions { display: flex; gap: 8px; padding: 10px 16px; }
  button.primary { flex: 1; padding: 8px; background: #4dc8ff; color: #0a0f14; border: none; border-radius: 2px; font-weight: bold; font-size: 11px; cursor: pointer; }
  button.primary:disabled { background: #1a2d40; color: #3a5a70; cursor: not-allowed; }
  button.ghost { padding: 6px 10px; background: #1a2d40; color: #7ab8d4; border: none; border-radius: 2px; font-size: 11px; cursor: pointer; margin: 4px 0; }
  button.ghost:hover:not(:disabled) { background: #2a4a5e; } button.ghost:disabled { color: #3a5a70; cursor: not-allowed; }
  .sec { padding: 10px 16px; border-bottom: 1px solid #1a2d40; }
  .sec-t { font-size: 11px; font-weight: bold; color: #4dc8ff; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
  .sec-t.sub { margin-top: 12px; }
  .issue { display: block; width: 100%; text-align: left; font-size: 11px; line-height: 1.45; padding: 6px 8px; margin-bottom: 4px; border-radius: 2px; background: #1a1418; color: #e8b0b0; border: 1px solid #3a2226; cursor: pointer; }
  .issue.note { background: #1a1a10; color: #d8cc90; border-color: #3a3820; cursor: default; }
  .issue code { color: #ff8a8a; font-size: 10px; } .issue.note code { color: #ffcf80; }
  .row { display: flex; align-items: stretch; margin-bottom: 4px; border: 1px solid #1a2d40; border-radius: 2px; }
  .row.sel { border-color: #4dc8ff; }
  .rowmain { flex: 1; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; padding: 6px 8px; background: none; border: none; color: inherit; text-align: left; cursor: pointer; }
  .rowmain.static { cursor: default; }
  .rid { font-family: 'Courier New', monospace; color: #a0c4d8; } .rsub { color: #3a5a70; font-size: 10px; }
  .acts { display: flex; } .acts button { background: none; border: none; color: #3a5a70; cursor: pointer; padding: 0 7px; } .acts button:hover { color: #4dc8ff; }
  .kv { width: 100%; margin-top: 8px; border-collapse: collapse; font-size: 11px; } .kv td { padding: 2px 4px; color: #6a8fa8; } .kv td:nth-child(odd) { color: #3a5a70; }
  .hint { font-size: 10px; color: #3a5a70; line-height: 1.5; margin-top: 6px; } .hint.warn { color: #cfa860; }
  .ramp { display: flex; height: 8px; margin-top: 8px; } .ramp span { flex: 1; }
  .ramp-l { display: flex; justify-content: space-between; font-size: 9px; color: #3a5a70; margin-top: 2px; }
  .fold { background: none; border: none; color: #4dc8ff; font-size: 11px; font-weight: bold; cursor: pointer; text-transform: uppercase; letter-spacing: 0.5px; padding: 0; }
  .setg { display: flex; flex-direction: column; gap: 3px; margin: 8px 0; } .setg label { font-size: 11px; color: #3a5a70; }
  .setg input { padding: 5px 8px; background: #1a2d40; border: 1px solid #2a4a5e; color: #7ab8d4; font-size: 12px; border-radius: 2px; }
  .setg input:focus { outline: none; border-color: #4dc8ff; }
  .help { font-size: 10px; color: #2f5068; }
</style>
