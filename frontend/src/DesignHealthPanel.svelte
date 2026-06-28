<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { runDesignHealth } from './designHealth.js';
  import { projectStore } from './projectStore.js';

  const dispatch = createEventDispatcher();

  // If true, kicks off the run immediately on mount (normal UX — user clicked
  // the button to see results, not to see an empty panel).
  export let autoRun = false;

  let result  = null;
  let running = false;
  let ranAt   = null;
  let mounted = true;

  onMount(() => {
    if (autoRun) run();
    return () => { mounted = false; };
  });

  async function run() {
    running = true;
    result  = null;
    // Yield to the browser so the "Running…" spinner paints before the
    // synchronous BFS computation blocks the main thread.
    await new Promise(r => setTimeout(r, 30));
    try {
      const r = runDesignHealth(projectStore.state);
      if (mounted) {
        result = r;
        ranAt  = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      }
    } catch (e) {
      if (mounted) {
        result = {
          verdict: 'NO-GO', headline: `Check failed: ${e.message}`,
          errorCount: 1, warningCount: 0, infoCount: 0,
          routed: 0, partial: 0, unserved: 0, total: 0,
          issues: [{ tier: 'error', category: 'Check failed', message: e.message, assetId: '', layer: '' }],
          ran: { routes: false, integrity: false, structure: false },
        };
      }
    } finally {
      if (mounted) running = false;
    }
  }

  function close() { dispatch('close'); }

  // Sort issues: errors first, then warnings, then info (within each tier keep
  // insertion order, which follows the analysis phase order from the engine).
  const TIER_ORDER = { error: 0, warning: 1, info: 2 };
  $: sortedIssues = result
    ? [...result.issues].sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier])
    : [];

  function tierColor(tier) {
    if (tier === 'error')   return '#ff5555';
    if (tier === 'warning') return '#ffaa44';
    return '#7ab8d4';
  }

  function tierLabel(tier) {
    if (tier === 'error')   return 'ERR';
    if (tier === 'warning') return 'WRN';
    return 'INF';
  }

  $: verdictColor  = !result ? '#3a5a70'
    : result.verdict === 'GO'      ? '#4dc8ff'
    : result.verdict === 'CAUTION' ? '#ffaa44'
    : '#ff5555';

  $: verdictBg     = !result ? '#0a1018'
    : result.verdict === 'GO'      ? '#00aaff0a'
    : result.verdict === 'CAUTION' ? '#ffaa440a'
    : '#ff55550a';

  $: verdictBorder = !result ? '#1a2d40'
    : result.verdict === 'GO'      ? '#00aaff22'
    : result.verdict === 'CAUTION' ? '#ffaa4422'
    : '#ff555522';
</script>

<div class="dh-panel">

  <!-- Header -->
  <div class="dh-hdr">
    <span class="dh-title">Design Health</span>
    {#if ranAt}<span class="dh-time">{ranAt}</span>{/if}
    <button class="dh-run" on:click={run} disabled={running} title="Re-run checks">
      {running ? '…' : '↻ Run'}
    </button>
    <button class="dh-close" on:click={close} title="Close">✕</button>
  </div>

  <!-- Running state -->
  {#if running}
    <div class="dh-running">
      <div class="dh-spin"></div>
      <span>Running health checks…</span>
    </div>

  <!-- Empty / not-yet-run state -->
  {:else if !result}
    <div class="dh-empty">
      <div class="dh-empty-icon">⚡</div>
      <div class="dh-empty-text">
        Check whether this network would work if built today.
        Runs route validation, topology integrity, and design completeness checks.
      </div>
      <button class="dh-run-big" on:click={run}>Run Design Health</button>
    </div>

  <!-- Results -->
  {:else}

    <!-- Verdict banner -->
    <div class="dh-verdict" style="background:{verdictBg};border-color:{verdictBorder};">
      <div class="dh-verdict-badge" style="color:{verdictColor};">{result.verdict}</div>
      <div class="dh-verdict-line" style="color:{verdictColor}cc;">{result.headline}</div>
    </div>

    <!-- Summary counts -->
    <div class="dh-counts">
      <div class="dh-count">
        <div class="dh-cv" style="color:#ff5555;">{result.errorCount}</div>
        <div class="dh-cl">Blocking</div>
      </div>
      <div class="dh-count">
        <div class="dh-cv" style="color:#ffaa44;">{result.warningCount}</div>
        <div class="dh-cl">Cautions</div>
      </div>
      <div class="dh-count">
        <div class="dh-cv" style="color:#7ab8d4;">{result.infoCount}</div>
        <div class="dh-cl">Info</div>
      </div>
      <div class="dh-count">
        <div class="dh-cv" style="color:#4dc8ff;">{result.total > 0 ? result.routed + '/' + result.total : '—'}</div>
        <div class="dh-cl">Routed</div>
      </div>
    </div>

    <!-- Issues list -->
    <div class="dh-issues">
      {#if sortedIssues.length === 0}
        <div class="dh-clear">✓ All checks passed — no issues found.</div>
      {:else}
        {#each sortedIssues as issue}
          <div class="dh-issue" style="border-left-color:{tierColor(issue.tier)};">
            <div class="dh-issue-head">
              <span class="dh-tier"
                style="color:{tierColor(issue.tier)};background:{tierColor(issue.tier)}14;border:1px solid {tierColor(issue.tier)}33;">
                {tierLabel(issue.tier)}
              </span>
              <span class="dh-cat">{issue.category}</span>
              {#if issue.assetId}
                <span class="dh-aid">{issue.assetId}</span>
              {/if}
            </div>
            <div class="dh-msg">{issue.message}</div>
          </div>
        {/each}
      {/if}
    </div>

  {/if}
</div>

<style>
  .dh-panel { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

  /* Header */
  .dh-hdr { height: 44px; background: #0d1520; border-bottom: 1px solid #1a2d40; display: flex; align-items: center; padding: 0 14px; gap: 8px; flex-shrink: 0; }
  .dh-title { font-size: 9px; color: #a0c4d8; letter-spacing: 0.14em; text-transform: uppercase; flex: 1; font-weight: 600; }
  .dh-time { font-size: 8px; color: #3a5a70; }
  .dh-run { background: #0f1c28; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 9px; padding: 3px 9px; border-radius: 4px; cursor: pointer; white-space: nowrap; transition: all 0.12s; }
  .dh-run:hover:not(:disabled) { border-color: #00aaff44; color: #4dc8ff; }
  .dh-run:disabled { opacity: 0.4; cursor: not-allowed; }
  .dh-close { background: #0f1c28; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 11px; width: 24px; height: 24px; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.12s; }
  .dh-close:hover { border-color: #ff555544; color: #ff5555; }

  /* Running state */
  .dh-running { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; flex: 1; color: #3a5a70; font-size: 9px; letter-spacing: 0.08em; }
  .dh-spin { width: 22px; height: 22px; border: 2px solid #1a2d40; border-top-color: #4dc8ff; border-radius: 50%; animation: spin 0.7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Empty state */
  .dh-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; flex: 1; padding: 24px 20px; text-align: center; }
  .dh-empty-icon { font-size: 26px; opacity: 0.25; }
  .dh-empty-text { font-size: 8.5px; color: #3a5a70; letter-spacing: 0.03em; line-height: 1.8; max-width: 220px; }
  .dh-run-big { background: #00aaff14; border: 1px solid #00aaff44; color: #4dc8ff; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; padding: 8px 20px; border-radius: 4px; cursor: pointer; transition: background 0.12s; }
  .dh-run-big:hover { background: #00aaff22; }

  /* Verdict banner */
  .dh-verdict { margin: 10px 12px 0; padding: 10px 12px; border-radius: 5px; border: 1px solid; flex-shrink: 0; }
  .dh-verdict-badge { font-size: 15px; font-weight: 700; letter-spacing: 0.12em; line-height: 1; margin-bottom: 5px; }
  .dh-verdict-line { font-size: 8px; letter-spacing: 0.03em; line-height: 1.65; }

  /* Counts grid */
  .dh-counts { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 5px; padding: 10px 12px 6px; flex-shrink: 0; }
  .dh-count { background: #080e14; border-radius: 5px; padding: 8px 4px; text-align: center; }
  .dh-cv { font-size: 16px; font-weight: 700; line-height: 1; }
  .dh-cl { font-size: 6.5px; color: #3a5a70; letter-spacing: 0.06em; text-transform: uppercase; margin-top: 3px; }

  /* Issues list */
  .dh-issues { flex: 1; overflow-y: auto; padding: 6px 12px 12px; }
  .dh-clear { font-size: 8.5px; color: #4dc8ff; text-align: center; padding: 24px 0; letter-spacing: 0.04em; }
  .dh-issue { border-left: 2px solid; padding: 7px 10px; margin-bottom: 5px; background: #080e14; border-radius: 0 4px 4px 0; }
  .dh-issue-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
  .dh-tier { font-size: 7px; font-weight: 700; letter-spacing: 0.1em; padding: 1px 5px; border-radius: 3px; flex-shrink: 0; }
  .dh-cat { font-size: 8px; color: #a0c4d8; letter-spacing: 0.05em; font-weight: 600; flex: 1; }
  .dh-aid { font-size: 7px; color: #3a5a70; font-family: 'Courier New', monospace; flex-shrink: 0; }
  .dh-msg { font-size: 8px; color: #6a8fa8; line-height: 1.65; letter-spacing: 0.02em; }
</style>
