<script>
  // BranchClassificationPanel.svelte — right panel for rpMode === 'branch-classify'.
  //
  // The paid-beta gate (release-audit §3 / handoff §4): let a user resolve every
  // PASS_THROUGH vs SPLITTER_OUTPUT decision entirely in the app, reach a
  // VALIDATED physical plan, and watch splice export open — then close again the
  // moment a planning input changes — with no JSON editing.
  //
  // The list is sourced live from the fibre network: buildFibreNetwork tags each
  // edge with feedModeInferred (a guessed classification) and knows edge.from
  // (upstream node) and edge.to (downstream node). An edge leaving a splitter
  // with an inferred feed_mode is exactly what the validator rejects with
  // INFERRED_CLASSIFICATION, so resolving these is what unblocks VALIDATED.
  //
  // Writing feed_mode / splitter_id / splitter_port onto a segment is an ordinary
  // projectStore asset update — it changes hashPhysicalPlanInputs, so the export
  // gate re-arms for free after any later edit.
  import { createEventDispatcher } from 'svelte';
  import { projectStore } from './projectStore.js';
  import { buildFibreNetwork } from './fibreNetwork.js';
  import { physicalPlanReady } from './splicePlan.js';

  const dispatch = createEventDispatcher();

  // Bumped by the parent whenever the store mutates, so the list and the export
  // state recompute after every resolve / re-plan.
  export let storeVersion = 0;
  // Physical plan status from the last Auto-Assign run (VALIDATED / INVALID / …).
  export let planStatus = null;

  // ── Derive the branch list from the live network ────────────────────────────
  $: net = (storeVersion, buildFibreNetwork(projectStore.state));
  $: exportReady = (storeVersion, physicalPlanReady(projectStore.state));

  // Per-row chosen optical port (only used when resolving as SPLITTER_OUTPUT).
  let selectedPort = {};

  // Ports already committed to a splitter's output legs, so the panel can show
  // occupied vs available and never let a one-click resolve reuse a port.
  function occupiedPorts(network, splitterId) {
    const used = new Set();
    for (const e of network.edges || []) {
      if (e.feedMode !== 'SPLITTER_OUTPUT') continue;
      if (e.feedModeInferred) continue;                  // not yet committed
      if (e.splitterId !== splitterId) continue;
      if (Number.isInteger(e.splitterPort)) used.add(e.splitterPort);
    }
    return used;
  }

  // Unresolved = an edge whose feed_mode was not set explicitly (inferred). We
  // surface these, upstream splitter first (those block VALIDATED), then any
  // other inferred branch for completeness.
  $: rows = buildRows(net);

  function buildRows(network) {
    if (!network || !network.root) return [];
    const out = [];
    for (const e of network.edges || []) {
      if (!e.feedModeInferred) continue;                 // explicitly classified → done
      const up = network.nodes.get(e.from);
      const upIsSplitter = !!(up && up.hasSplitter);     // == validator INFERRED_CLASSIFICATION
      const splitterId = upIsSplitter ? `${e.from}-SP` : null;
      const cap = upIsSplitter && Number.isFinite(up.cap) ? up.cap : 0;
      const occupied = upIsSplitter ? occupiedPorts(network, splitterId) : new Set();
      const available = [];
      for (let p = 1; p <= cap; p++) if (!occupied.has(p)) available.push(p);
      out.push({
        id: e.id,
        collection: e.collection,
        from: e.from,
        to: e.to,
        // An optical output leg can ONLY leave an actual splitter. Off a POP or an
        // ordinary joint/pole, SPLITTER_OUTPUT is not offered — pass-through only.
        upIsSplitter,
        upstreamSplitter: upIsSplitter ? `${e.from} (${up.ratio || '1:?'})` : null,
        splitterId,
        cap,
        occupied: [...occupied].sort((a, b) => a - b),
        available,
        proposed: e.feedMode,                            // the network's current guess
        blocksValidation: upIsSplitter,
      });
    }
    // splitter branches first
    out.sort((a, b) => (b.blocksValidation - a.blocksValidation) || (a.id < b.id ? -1 : 1));
    return out;
  }

  // ── Resolve a single branch ─────────────────────────────────────────────────
  function findIndex(collection, id) {
    const arr = projectStore.state[collection] || [];
    return arr.findIndex(f => {
      const p = f.properties || {};
      if (collection === 'cables') return String(p.cable_id) === id;
      if (collection === 'spans')  return String(p.span_id) === id;
      if (collection === 'cbtTails') {
        const tid = String(p.tail_id ?? p.cbttail_id ?? (p.from_cbt ? `TAIL-${p.from_cbt}` : ''));
        return tid === id;
      }
      return false;
    });
  }

  // A splitter-output resolve is only allowed with COMPLETE metadata: a real
  // upstream splitter and a chosen, currently-available port. Anything short of
  // that is refused (the button is also disabled) so the panel can never write a
  // splitter_id with no/duplicate port and slip past the validator.
  function canResolveSplit(row) {
    if (!row.upIsSplitter) return false;
    const p = Number(selectedPort[row.id]);
    return Number.isInteger(p) && row.available.includes(p);
  }

  function resolve(row, mode) {
    const idx = findIndex(row.collection, row.id);
    if (idx < 0) return;
    let props;
    if (mode === 'SPLITTER_OUTPUT') {
      if (!canResolveSplit(row)) return;                 // incomplete → refuse
      props = { feed_mode: 'SPLITTER_OUTPUT', splitter_id: row.splitterId, splitter_port: Number(selectedPort[row.id]) };
    } else {
      // Switching to pass-through clears any stale optical metadata.
      props = { feed_mode: 'PASS_THROUGH', splitter_id: null, splitter_port: null };
    }
    projectStore.updateAsset(row.collection, idx, props);
    delete selectedPort[row.id]; selectedPort = selectedPort;
    dispatch('changed'); // parent bumps storeVersion + syncToMap
  }

  function replan() { dispatch('replan'); }
  function close() { dispatch('close'); }

  $: remaining = rows.length;
  $: blocking = rows.filter(r => r.blocksValidation).length;
</script>

<div class="bcp">
  <div class="bcp-hdr">
    <div class="bcp-title">Branch Classification</div>
    <button class="bcp-close" on:click={close} title="Dismiss">✕</button>
  </div>

  <div class="bcp-sub">
    Resolve every PASS_THROUGH vs SPLITTER_OUTPUT decision, then re-run planning.
    No JSON editing required.
  </div>

  <div class="bcp-body">
    {#if !net || !net.root}
      <div class="bcp-empty">No POP placed yet — build the network first.</div>
    {:else if remaining === 0}
      <div class="bcp-clear" data-testid="bcp-all-clear">
        ✓ Every branch is explicitly classified.
      </div>
    {:else}
      <div class="bcp-count" data-testid="bcp-count">
        {remaining} unclassified branch{remaining === 1 ? '' : 'es'}
        {#if blocking > 0}<span class="bcp-block"> · {blocking} at a splitter (blocks validation)</span>{/if}
      </div>

      {#each rows as row (row.id)}
        <div class="bcp-row" data-testid="bcp-row" class:blocking={row.blocksValidation}>
          <div class="bcp-row-top">
            <span class="bcp-seg">{row.id}</span>
            <span class="bcp-flow">{row.from} → {row.to}</span>
          </div>
          <div class="bcp-meta">
            {#if row.upstreamSplitter}
              <span class="bcp-tag splitter">splitter {row.upstreamSplitter}</span>
            {:else}
              <span class="bcp-tag nonsplit">upstream {row.from} — not a splitter</span>
            {/if}
            <span class="bcp-tag proposed">proposed: {row.proposed}</span>
          </div>

          {#if row.upIsSplitter}
            <div class="bcp-port">
              <label class="bcp-port-lbl" for={'bcp-port-' + row.id}>Optical port</label>
              <select id={'bcp-port-' + row.id} class="bcp-port-sel"
                      data-testid="bcp-port-select" bind:value={selectedPort[row.id]}>
                <option value={undefined}>— choose port —</option>
                {#each row.available as p}
                  <option value={p}>PO{p}</option>
                {/each}
              </select>
              {#if row.occupied.length}
                <span class="bcp-port-used" data-testid="bcp-port-occupied">in use: {row.occupied.map(p => 'PO' + p).join(', ')}</span>
              {/if}
              {#if row.available.length === 0}
                <span class="bcp-port-full">splitter full — no free ports</span>
              {/if}
            </div>
          {/if}

          <div class="bcp-actions">
            <button class="bcp-btn pass" data-testid="bcp-resolve-pass"
                    on:click={() => resolve(row, 'PASS_THROUGH')}>Pass-through</button>
            {#if row.upIsSplitter}
              <button class="bcp-btn split" data-testid="bcp-resolve-split"
                      disabled={!canResolveSplit(row)}
                      title={canResolveSplit(row) ? '' : 'Choose an available port first'}
                      on:click={() => resolve(row, 'SPLITTER_OUTPUT')}>Splitter output</button>
            {:else}
              <button class="bcp-btn split" data-testid="bcp-resolve-split" disabled
                      title="Only available when the upstream node is a splitter">Splitter output</button>
            {/if}
          </div>
        </div>
      {/each}
    {/if}
  </div>

  <div class="bcp-foot">
    <div class="bcp-status">
      {#if exportReady}
        <span class="ok" data-testid="bcp-export-ready">● Splice export available</span>
      {:else if planStatus === 'VALIDATED'}
        <span class="warn" data-testid="bcp-export-stale">● Validated, but export gated (re-plan after edits)</span>
      {:else if remaining === 0}
        <span class="warn" data-testid="bcp-ready-to-plan">● Classified — re-run planning</span>
      {:else}
        <span class="off" data-testid="bcp-export-blocked">● Export blocked — {remaining} to classify</span>
      {/if}
    </div>
    <button class="bcp-replan" data-testid="bcp-replan" on:click={replan}>Re-run planning</button>
  </div>
</div>

<style>
  .bcp { display: flex; flex-direction: column; height: 100%; background: #0d1520; }
  .bcp-hdr { padding: 12px 14px 6px; display: flex; justify-content: space-between; align-items: baseline; flex-shrink: 0; }
  .bcp-title { font-size: 9px; color: #a0c4d8; letter-spacing: 0.14em; text-transform: uppercase; font-weight: 600; }
  .bcp-close { background: none; border: none; color: #3a5a70; font-size: 12px; cursor: pointer; }
  .bcp-close:hover { color: #a0c4d8; }
  .bcp-sub { padding: 0 14px 8px; font-size: 8px; color: #3a5a70; letter-spacing: 0.04em; border-bottom: 1px solid #1a2d40; flex-shrink: 0; }
  .bcp-body { flex: 1; overflow-y: auto; padding: 10px 14px; display: flex; flex-direction: column; gap: 8px; }
  .bcp-empty, .bcp-clear { font-size: 9px; color: #6a8fa8; padding: 12px 4px; }
  .bcp-clear { color: #4dffa2; }
  .bcp-count { font-size: 8px; color: #6a8fa8; letter-spacing: 0.06em; text-transform: uppercase; }
  .bcp-block { color: #ffb04d; }
  .bcp-row { border: 1px solid #1a2d40; border-radius: 4px; padding: 8px; display: flex; flex-direction: column; gap: 5px; background: #080e14; }
  .bcp-row.blocking { border-color: #ffb04d44; }
  .bcp-row-top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .bcp-seg { font-family: 'Courier New', monospace; font-size: 10px; color: #4dc8ff; font-weight: 700; }
  .bcp-flow { font-family: 'Courier New', monospace; font-size: 8px; color: #3a5a70; }
  .bcp-meta { display: flex; flex-wrap: wrap; gap: 4px; }
  .bcp-tag { font-size: 7.5px; padding: 2px 5px; border-radius: 3px; letter-spacing: 0.04em; text-transform: uppercase; }
  .bcp-tag.splitter { background: #ffb04d14; color: #ffb04d; border: 1px solid #ffb04d33; }
  .bcp-tag.nonsplit { background: #6a4a4a14; color: #b08a8a; border: 1px solid #6a4a4a44; }
  .bcp-tag.proposed { background: #00aaff14; color: #4dc8ff; border: 1px solid #00aaff33; }
  .bcp-port { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .bcp-port-lbl { font-size: 7.5px; color: #6a8fa8; letter-spacing: 0.06em; text-transform: uppercase; }
  .bcp-port-sel { background: #080e14; border: 1px solid #1a2d40; color: #a0c4d8; font-family: 'Courier New', monospace; font-size: 8.5px; padding: 3px 6px; border-radius: 4px; outline: none; }
  .bcp-port-sel:focus { border-color: #00aaff44; color: #4dc8ff; }
  .bcp-port-used { font-size: 7px; color: #6a8fa8; letter-spacing: 0.04em; }
  .bcp-port-full { font-size: 7px; color: #ffb04d; letter-spacing: 0.04em; }
  .bcp-actions { display: flex; gap: 6px; }
  .bcp-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .bcp-btn:disabled:hover { border-color: #1a2d40; color: #6a8fa8; }
  .bcp-btn { flex: 1; font-family: 'Courier New', monospace; font-size: 8.5px; letter-spacing: 0.04em; text-transform: uppercase; padding: 6px; border-radius: 4px; cursor: pointer; border: 1px solid #1a2d40; background: #0a1018; color: #6a8fa8; }
  .bcp-btn.pass:hover { border-color: #4dffa244; color: #4dffa2; }
  .bcp-btn.split:hover { border-color: #ffb04d44; color: #ffb04d; }
  .bcp-foot { border-top: 1px solid #1a2d40; padding: 10px 14px; display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; }
  .bcp-status { font-size: 8px; letter-spacing: 0.04em; }
  .bcp-status .ok { color: #4dffa2; }
  .bcp-status .warn { color: #ffb04d; }
  .bcp-status .off { color: #6a4a4a; }
  .bcp-replan { background: #00aaff14; border: 1px solid #00aaff44; color: #4dc8ff; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; padding: 8px; border-radius: 4px; cursor: pointer; }
  .bcp-replan:hover { background: #00aaff22; }
</style>
