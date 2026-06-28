<script>
  import { createEventDispatcher } from 'svelte';

  // result shape (from fibreTrace.js traceFibre):
  //   { status, reason, uprn, entry, nodes, edges, hops[], lengthM }
  export let result = null;

  const dispatch = createEventDispatcher();

  const STATUS_META = {
    ROUTED:   { label: 'ROUTED',   cls: 'ok',  glyph: '✔' },
    PARTIAL:  { label: 'PARTIAL',  cls: 'wrn', glyph: '⚠' },
    UNSERVED: { label: 'UNSERVED', cls: 'bad', glyph: '✘' },
  };

  $: meta = result ? (STATUS_META[result.status] || STATUS_META.UNSERVED) : null;

  // Address lookup is best-effort — the engine only carries the uprn.
  $: lengthLabel = result && result.lengthM
    ? (result.lengthM >= 1000 ? (result.lengthM / 1000).toFixed(2) + ' km' : result.lengthM + ' m')
    : '—';

  // Hop glyphs per kind.
  const HOP_GLYPH = {
    bundle: '⌇', adrop: '⌣', edge: '—',
    JOINT: '⬢', CBT: '⊟', POLE: '|', POP: '■', NODE: '○',
  };
  function hopGlyph(h) { return HOP_GLYPH[h.kind] || '·'; }
  function hopIsEdge(h) { return h.kind === 'edge'; }

  function close() { dispatch('close'); }
</script>

<div class="ft-panel">
  <div class="ft-hdr">
    <span class="ft-title">Fibre Trace</span>
    <button class="ft-close" on:click={close} title="Exit trace">✕</button>
  </div>

  {#if !result}
    <div class="ft-empty">Click a premise on the map to trace its route back to the cabinet.</div>
  {:else}
    <div class="ft-status {meta.cls}">
      <span class="ft-glyph">{meta.glyph}</span>
      <span class="ft-status-lbl">{meta.label}</span>
    </div>

    <div class="ft-meta">
      <div class="ft-row"><span class="ft-k">UPRN</span><span class="ft-v">{result.uprn ?? '—'}</span></div>
      <div class="ft-row"><span class="ft-k">Hops</span><span class="ft-v">{result.nodes?.length ?? 0}</span></div>
      <div class="ft-row"><span class="ft-k">Length</span><span class="ft-v">{lengthLabel}</span></div>
    </div>

    {#if result.reason}
      <div class="ft-reason {meta.cls}">{result.reason}</div>
    {/if}

    {#if result.hops && result.hops.length}
      <div class="ft-path-lbl">Path</div>
      <div class="ft-path">
        <!-- premise origin -->
        <div class="ft-hop premise">
          <span class="ft-hop-glyph">◎</span>
          <span class="ft-hop-text"><span class="ft-hop-kind">Premise</span><span class="ft-hop-id">{result.uprn}</span></span>
        </div>
        {#each result.hops as h}
          <div class="ft-hop" class:edge={hopIsEdge(h)}>
            <span class="ft-hop-glyph">{hopGlyph(h)}</span>
            <span class="ft-hop-text">
              <span class="ft-hop-kind">{h.label}</span>
              {#if h.id}<span class="ft-hop-id">{h.id}</span>{/if}
            </span>
          </div>
        {/each}
      </div>
    {/if}

    <div class="ft-actions">
      <button class="ft-btn" on:click={close}>Done</button>
    </div>
  {/if}
</div>

<style>
  .ft-panel { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

  .ft-hdr { height: 44px; background: #0d1520; border-bottom: 1px solid #1a2d40; display: flex; align-items: center; padding: 0 14px; gap: 8px; flex-shrink: 0; }
  .ft-title { font-size: 9px; color: #a0c4d8; letter-spacing: 0.14em; text-transform: uppercase; flex: 1; font-weight: 600; }
  .ft-close { background: #0f1c28; border: 1px solid #1a2d40; color: #6a8fa8; font-family: 'Courier New', monospace; font-size: 11px; width: 24px; height: 24px; border-radius: 4px; cursor: pointer; }
  .ft-close:hover { border-color: #ff555544; color: #ff5555; }

  .ft-empty { padding: 16px 14px; font-size: 9px; color: #3a5a70; line-height: 1.7; letter-spacing: 0.04em; }

  .ft-status { display: flex; align-items: center; gap: 10px; margin: 12px 14px; padding: 10px 12px; border-radius: 6px; }
  .ft-status.ok  { background: #00aaff14; border: 1px solid #00aaff44; }
  .ft-status.wrn { background: #ffaa4414; border: 1px solid #ffaa4444; }
  .ft-status.bad { background: #ff555514; border: 1px solid #ff555544; }
  .ft-glyph { font-size: 18px; line-height: 1; }
  .ft-status.ok  .ft-glyph, .ft-status.ok  .ft-status-lbl { color: #4dc8ff; }
  .ft-status.wrn .ft-glyph, .ft-status.wrn .ft-status-lbl { color: #ffaa44; }
  .ft-status.bad .ft-glyph, .ft-status.bad .ft-status-lbl { color: #ff5555; }
  .ft-status-lbl { font-size: 13px; font-weight: 700; letter-spacing: 0.12em; }

  .ft-meta { padding: 0 14px 6px; }
  .ft-row { display: flex; justify-content: space-between; align-items: center; padding: 5px 0; border-bottom: 1px solid #0f1a24; }
  .ft-k { font-size: 8.5px; color: #6a8fa8; text-transform: uppercase; letter-spacing: 0.06em; }
  .ft-v { font-size: 10px; color: #a0c4d8; font-weight: 600; }

  .ft-reason { margin: 8px 14px; padding: 8px 10px; border-radius: 5px; font-size: 8.5px; line-height: 1.6; letter-spacing: 0.02em; }
  .ft-reason.ok  { background: #00aaff0a; color: #6a9ab5; }
  .ft-reason.wrn { background: #ffaa440a; color: #c79552; }
  .ft-reason.bad { background: #ff55550a; color: #c77; }

  .ft-path-lbl { font-size: 7.5px; color: #3a5a70; letter-spacing: 0.12em; text-transform: uppercase; padding: 8px 14px 6px; }
  .ft-path { flex: 1; overflow-y: auto; padding: 0 14px 8px; }

  .ft-hop { display: flex; align-items: center; gap: 9px; padding: 5px 0; position: relative; }
  /* vertical connector line between hops */
  .ft-hop::before { content: ''; position: absolute; left: 6px; top: -6px; bottom: 50%; width: 1px; background: #1a3346; }
  .ft-hop:first-child::before { display: none; }
  .ft-hop-glyph { width: 13px; text-align: center; font-size: 11px; color: #4dc8ff; flex-shrink: 0; z-index: 1; background: #0d1520; }
  .ft-hop.edge .ft-hop-glyph { color: #3a6a80; font-size: 9px; }
  .ft-hop.premise .ft-hop-glyph { color: #ffffff; }
  .ft-hop-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .ft-hop-kind { font-size: 8px; color: #6a8fa8; text-transform: uppercase; letter-spacing: 0.06em; }
  .ft-hop.edge .ft-hop-kind { color: #4a6678; }
  .ft-hop-id { font-size: 9.5px; color: #a0c4d8; letter-spacing: 0.03em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ft-hop.edge .ft-hop-id { color: #6a8fa8; }

  .ft-actions { padding: 10px 14px; border-top: 1px solid #1a2d40; flex-shrink: 0; }
  .ft-btn { width: 100%; background: #00aaff14; border: 1px solid #00aaff44; color: #4dc8ff; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; padding: 8px; border-radius: 4px; cursor: pointer; }
  .ft-btn:hover { background: #00aaff22; }
</style>
