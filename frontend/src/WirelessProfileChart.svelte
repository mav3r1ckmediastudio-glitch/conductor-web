<script>
  // WirelessProfileChart.svelte — elevation cross-section of one link: terrain
  // (with earth bulge), line of sight, and the required Fresnel clearance
  // envelope. Presentational; all numbers come from wirelessProfile.js.
  export let profile = null;
  export let clearancePct = 60;
  export let aLabel = 'A';
  export let bLabel = 'B';

  const W = 560, H = 190, PAD = { l: 44, r: 10, t: 10, b: 24 };

  $: samples = profile?.samples || [];
  $: known = samples.filter(s => s.groundM != null);
  $: ok = profile && profile.status !== 'NO_TERRAIN' && known.length > 1;

  $: series = ok ? samples.map(s => s.groundM == null ? null : ({
      d: s.dKm, terr: s.groundM + s.bulgeM, los: s.losM, lower: s.losM - (clearancePct / 100) * s.f1M,
    })) : [];
  $: ys = series.filter(Boolean).flatMap(p => [p.terr, p.los, p.lower]);
  $: yMin = ys.length ? Math.min(...ys) - 5 : 0;
  $: yMax = ys.length ? Math.max(...ys) + 5 : 1;
  $: dMax = profile?.distanceKm || 1;
  const X = (d, dm) => PAD.l + (d / dm) * (W - PAD.l - PAD.r);
  const Y = (v, lo, hi) => PAD.t + (1 - (v - lo) / (hi - lo || 1)) * (H - PAD.t - PAD.b);

  function path(key) {
    let out = '', pen = false;
    for (const p of series) {
      if (!p) { pen = false; continue; }
      out += `${pen ? 'L' : 'M'}${X(p.d, dMax).toFixed(1)},${Y(p[key], yMin, yMax).toFixed(1)} `;
      pen = true;
    }
    return out;
  }
  $: terrainArea = ok ? path('terr') + `L${X(dMax, dMax)},${H - PAD.b} L${X(0, dMax)},${H - PAD.b} Z` : '';
  $: worst = profile?.worst;
</script>

{#if !profile}
  <div class="empty">Run “Analyse links” to see the path profile.</div>
{:else if !ok}
  <div class="empty bad">No terrain data along this path — line of sight cannot be shown or verified.</div>
{:else}
  <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Link elevation profile">
    <path d={terrainArea} fill="#1a3a4e" opacity="0.7" />
    <path d={path('terr')} fill="none" stroke="#4dc8ff" stroke-width="1.5" />
    <path d={path('lower')} fill="none" stroke="#ffb03b" stroke-width="1" stroke-dasharray="4 3" />
    <path d={path('los')} fill="none" stroke="#ffffff" stroke-width="1.5" />
    {#each series as p, i}
      {#if !p}<rect x={X(samples[i].dKm, dMax) - 1.5} y={H - PAD.b - 6} width="3" height="6" fill="#ff5c5c" />{/if}
    {/each}
    {#if worst}
      <circle cx={X(worst.atKm, dMax)} cy={Y(series[samples.findIndex(s => s.dKm === worst.atKm)]?.terr ?? yMin, yMin, yMax)} r="4" fill="none" stroke="#ff5c5c" stroke-width="2" />
    {/if}
    <text x={PAD.l} y={H - 6} class="ax">{aLabel}</text>
    <text x={W - PAD.r} y={H - 6} text-anchor="end" class="ax">{bLabel}</text>
    <text x={W / 2} y={H - 6} text-anchor="middle" class="ax">{profile.distanceKm.toFixed(2)} km</text>
    <text x="4" y={PAD.t + 8} class="ax">{Math.round(yMax)} m</text>
    <text x="4" y={H - PAD.b} class="ax">{Math.round(yMin)} m</text>
  </svg>
  <div class="legend">
    <span><i style="background:#4dc8ff"></i>terrain + earth curvature</span>
    <span><i style="background:#fff"></i>line of sight</span>
    <span><i style="background:#ffb03b"></i>{clearancePct}% Fresnel limit</span>
    {#if profile.status === 'PARTIAL'}<span class="warn"><i style="background:#ff5c5c"></i>{profile.missingSamples} sample(s) without terrain data</span>{/if}
  </div>
{/if}

<style>
  svg { width: 100%; height: auto; background: #0a0f14; border: 1px solid #1a2d40; border-radius: 2px; }
  .ax { font-size: 9px; fill: #6a8fa8; font-family: 'Courier New', monospace; }
  .empty { padding: 14px; font-size: 11px; color: #3a5a70; background: #0a0f14; border: 1px dashed #1a2d40; }
  .empty.bad { color: #ff8a8a; border-color: #5a2a2a; }
  .legend { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 6px; font-size: 10px; color: #6a8fa8; }
  .legend i { display: inline-block; width: 10px; height: 3px; margin-right: 4px; vertical-align: middle; }
  .warn { color: #ff8a8a; }
</style>
