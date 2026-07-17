<script>
  import { createEventDispatcher } from 'svelte';
  import { docsUrl, toolDoc, toolTitle } from './toolDocs.js';

  const dispatch = createEventDispatcher();

  export let activeCat = 'civil';

  // ---- Geometry ----
  const IR = 44;
  const OR = 120;
  const CX = 0;
  const CY = OR;          // hub centre y (left-middle of the wrap)
  const START = -Math.PI / 2;
  const SPAN = Math.PI;
  const VIEW_W = OR + 150;   // 270
  const VIEW_H = OR * 2;     // 240
  const HOVER_REACH = 20;    // radial px past OR that still counts as "in wedge"
                             // — bridges the gap to the HTML label overlay

  const ICON_SCALE = 1.25;

  // ---- Tool categories ----
  const CATEGORIES = {
    civil: {
      label: 'Civil',
      tools: [
        { id: 'civil-edit-cabinet', label: 'Edit Cabinet/POP', iconSvg: `
          <rect x="3" y="2" width="14" height="16" rx="1.5"/>
          <line x1="3" y1="7" x2="17" y2="7"/>
          <line x1="7" y1="12" x2="13" y2="12"/>
          <line x1="7" y1="15" x2="11" y2="15"/>
        ` },
        { id: 'civil-chamber', label: 'Place Chamber', iconSvg: `
          <rect x="3" y="8" width="14" height="9" rx="1"/>
          <ellipse cx="10" cy="8" rx="4" ry="2"/>
          <line x1="7" y1="11" x2="13" y2="11"/>
          <line x1="7" y1="14" x2="13" y2="14"/>
        ` },
        { id: 'civil-duct', label: 'Digitise Duct', iconSvg: `
          <line x1="2" y1="10" x2="14" y2="10" stroke-width="3.5"/>
          <line x1="2" y1="10" x2="14" y2="10" stroke="#0d1520" stroke-width="1.5"/>
          <circle cx="17" cy="10" r="2.5"/>
          <circle cx="17" cy="10" r="1" fill="currentColor" stroke="none"/>
        ` },
        { id: 'civil-drop-duct', label: 'Digitise Drop Duct', iconSvg: `
          <line x1="2" y1="15" x2="10" y2="15" stroke-dasharray="1.5 1.5"/>
          <path d="M10,15 C14,15 14,5 18,5" stroke-dasharray="1.5 1.5"/>
          <circle cx="18" cy="5" r="1.5" fill="currentColor" stroke="none"/>
        ` },
        { id: 'civil-road', label: 'Road Crossing', iconSvg: `
          <line x1="2" y1="6" x2="18" y2="6" stroke-width="2"/>
          <line x1="2" y1="14" x2="18" y2="14" stroke-width="2"/>
          <line x1="7" y1="6" x2="13" y2="6" stroke="#0d1520" stroke-width="2"/>
          <line x1="9" y1="6" x2="11" y2="6" stroke-dasharray="1.5 1.5"/>
          <path d="M10,2 L10,6 M10,14 L10,18" stroke-dasharray="1.5 1.5"/>
        ` },
        { id: 'civil-stream', label: 'Stream Crossing', iconSvg: `
          <path d="M2,6 C6,2 8,10 12,6 C14,4 16,8 18,6"/>
          <path d="M2,14 C6,10 8,18 12,14 C14,12 16,16 18,14"/>
        ` },
      ]
    },
    fibre: {
      label: 'Fibre',
      tools: [
        { id: 'fibre-cable', label: 'Digitise Cable', iconSvg: `
          <circle cx="10" cy="10" r="8"/>
          <circle cx="10" cy="10" r="3"/>
          <circle cx="7" cy="7" r="0.75" fill="currentColor" stroke="none"/>
          <circle cx="13" cy="7" r="0.75" fill="currentColor" stroke="none"/>
          <circle cx="7" cy="13" r="0.75" fill="currentColor" stroke="none"/>
          <circle cx="13" cy="13" r="0.75" fill="currentColor" stroke="none"/>
        ` },
        { id: 'fibre-bundle', label: 'Digitise Bundle', iconSvg: `
          <path d="M2,7 Q10,7 18,7"/>
          <path d="M2,10 Q10,10 18,10"/>
          <path d="M2,13 Q10,13 18,13"/>
          <rect x="8" y="5.5" width="4" height="9" rx="1" stroke-dasharray="1 1"/>
        ` },
        { id: 'fibre-joint', label: 'Place Joint', iconSvg: `
          <rect x="2" y="6" width="16" height="8" rx="4"/>
          <line x1="5" y1="10" x2="15" y2="10"/>
          <circle cx="7" cy="10" r="1.25" fill="currentColor" stroke="none"/>
          <circle cx="13" cy="10" r="1.25" fill="currentColor" stroke="none"/>
        ` },
        { id: 'fibre-assign', label: 'Assign Fibre Roles', iconSvg: `
          <path d="M2,10 L8,10 M8,4 L8,16 M8,4 L18,4 M8,10 L18,10 M8,16 L18,16"/>
          <circle cx="18" cy="4" r="1.25" fill="currentColor" stroke="none"/>
          <circle cx="18" cy="10" r="1.25" fill="currentColor" stroke="none"/>
          <circle cx="18" cy="16" r="1.25" fill="currentColor" stroke="none"/>
        ` },
        { id: 'branch-classify', label: 'Branch Classification', iconSvg: `
          <path d="M4,10 L9,10 M9,10 L15,5 M9,10 L15,15"/>
          <circle cx="4" cy="10" r="1.5" fill="currentColor" stroke="none"/>
          <circle cx="15" cy="5" r="1.5" fill="currentColor" stroke="none"/>
          <circle cx="15" cy="15" r="1.5" fill="currentColor" stroke="none"/>
        ` },
        { id: 'fibre-trace', label: 'Fibre Trace', iconSvg: `
          <path d="M2,15 L8,15 A4,4 0 0,1 12,11 L18,11"/>
          <circle cx="2" cy="15" r="1.5" fill="currentColor" stroke="none"/>
          <circle cx="18" cy="11" r="1.5" fill="currentColor" stroke="none"/>
          <path d="M15,8 L18,11 L15,14"/>
        ` },
        { id: 'fibre-count', label: 'Fibre Count', iconSvg: `
          <line x1="2" y1="5" x2="13" y2="5"/>
          <line x1="2" y1="9" x2="13" y2="9"/>
          <line x1="2" y1="13" x2="13" y2="13"/>
          <line x1="2" y1="17" x2="13" y2="17"/>
          <line x1="15" y1="4" x2="15" y2="18" stroke-width="1"/>
          <line x1="17" y1="4" x2="17" y2="18" stroke-width="1"/>
          <line x1="14" y1="7" x2="18" y2="7" stroke-width="0.8"/>
          <line x1="14" y1="11" x2="18" y2="11" stroke-width="0.8"/>
          <line x1="14" y1="15" x2="18" y2="15" stroke-width="0.8"/>
        ` },
      ]
    },
    aerial: {
      label: 'Aerial & Poles',
      tools: [
        { id: 'aerial-pole', label: 'Place Pole', iconSvg: `
          <line x1="10" y1="2" x2="10" y2="19" stroke-width="2"/>
          <line x1="4" y1="6" x2="16" y2="6"/>
          <line x1="5" y1="11" x2="15" y2="11"/>
        ` },
        { id: 'aerial-cbt', label: 'Place CBT', iconSvg: `
          <line x1="10" y1="2" x2="10" y2="19"/>
          <rect x="5" y="5" width="10" height="10" rx="1"/>
          <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none"/>
          <circle cx="12" cy="8" r="1" fill="currentColor" stroke="none"/>
          <circle cx="8" cy="12" r="1" fill="currentColor" stroke="none"/>
          <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>
        ` },
        { id: 'aerial-cbt-tail', label: 'Draw CBT Tail', iconSvg: `
          <path d="M3,5 L12,5 A4,4 0 0,1 16,9 L16,18"/>
          <circle cx="3" cy="5" r="1.5" fill="currentColor" stroke="none"/>
          <polygon points="14,16 16,19 18,16" fill="currentColor" stroke="none"/>
        ` },
        { id: 'aerial-span', label: 'Digitise Aerial Span', iconSvg: `
          <path d="M2,13 C6,7 14,7 18,13"/>
          <circle cx="2" cy="13" r="1.5" fill="currentColor" stroke="none"/>
          <circle cx="18" cy="13" r="1.5" fill="currentColor" stroke="none"/>
        ` },
        { id: 'aerial-drop', label: 'Digitise Aerial Drop', iconSvg: `
          <path d="M2,4 C6,10 12,14 17,14"/>
          <circle cx="2" cy="4" r="1.5" fill="currentColor" stroke="none"/>
          <rect x="15" y="12" width="3" height="3" rx="0.5"/>
        ` },
      ]
    },
    pia: {
      label: 'PIA Underground',
      tools: [
        { id: 'pia-chamber', label: 'Place PIA UG Chamber', iconSvg: `
          <rect x="2" y="5" width="16" height="11" rx="1.5" stroke-width="1.8"/>
          <rect x="5" y="8" width="10" height="5" rx="0.5"/>
          <line x1="8" y1="5" x2="8" y2="3"/>
          <line x1="12" y1="5" x2="12" y2="3"/>
          <line x1="7" y1="3" x2="13" y2="3"/>
        ` },
        { id: 'pia-duct', label: 'Digitise PIA UG Duct', iconSvg: `
          <rect x="2" y="6" width="16" height="8" rx="1.5" stroke-width="1.5"/>
          <circle cx="7" cy="10" r="2"/>
          <circle cx="13" cy="10" r="2"/>
          <circle cx="7" cy="10" r="0.7" fill="currentColor" stroke="none"/>
          <circle cx="13" cy="10" r="0.7" fill="currentColor" stroke="none"/>
        ` },
        { id: 'pia-drop', label: 'Digitise PIA UG Drop', iconSvg: `
          <rect x="2" y="14" width="16" height="3" rx="0.5"/>
          <path d="M10,2 L10,14" stroke-dasharray="1.5 1.5"/>
          <circle cx="10" cy="2" r="1.5" fill="currentColor" stroke="none"/>
        ` },
      ]
    }
  };

  // ---- State ----
  let wheelOpen   = true;
  let activeTool  = null;
  let helpTool    = null;    // tool object when popup is open
  let wrapEl;                // bound to .wheel-svg-wrap for coordinate maths

  // Hover is driven by TWO independent sources that overlap (no gap):
  //   pointerWedge — set by container mousemove (angle + radius maths)
  //   onOverlay    — set by the HTML label overlay's own mouse events
  // hovered is derived: the overlay locks the wedge it belongs to.
  let pointerWedge = -1;
  let onOverlay    = false;
  let lockedWedge  = -1;

  $: tools = CATEGORIES[activeCat]?.tools ?? [];
  $: n = tools.length;

  // hovered = overlay's locked wedge while on overlay, else the pointer wedge.
  $: hovered = onOverlay ? lockedWedge : pointerWedge;

  // Reset on category change.
  $: if (activeCat) {
    wheelOpen = true;
    pointerWedge = -1;
    onOverlay = false;
    lockedWedge = -1;
    helpTool = null;
  }

  // ---- Container mousemove: which wedge is the cursor in? ----
  function onMove(e) {
    if (!wheelOpen || !wrapEl) { pointerWedge = -1; return; }
    const rect = wrapEl.getBoundingClientRect();
    const mx = e.clientX - rect.left;     // wrap-local == SVG coords (1:1 viewBox)
    const my = e.clientY - rect.top;
    const dx = mx - CX;                   // CX = 0
    const dy = my - CY;                   // CY = 120
    const dist = Math.hypot(dx, dy);
    const ang  = Math.atan2(dy, dx);      // right half maps cleanly to [-π/2, π/2]

    const inBand  = dist >= IR - 1 && dist <= OR + HOVER_REACH + 1;  // ±1px tolerance: float rounding can land a pixel exactly on a boundary
    const inSweep = ang >= START && ang <= START + SPAN;

    if (inBand && inSweep && n > 0) {
      const sl = SPAN / n;
      let i = Math.floor((ang - START) / sl);
      i = Math.max(0, Math.min(n - 1, i));
      pointerWedge = i;
      lockedWedge  = i;     // remember which tool the overlay represents
    } else {
      pointerWedge = -1;
    }
  }

  function onWrapLeave() {
    // Cursor left the whole wrap. If it's not on the overlay, clear.
    pointerWedge = -1;
  }

  // ---- Overlay mouse events (handles the far label region) ----
  function onOverlayEnter() { onOverlay = true; }
  function onOverlayLeave() { onOverlay = false; }

  // ---- Wedge geometry ----
  function spokePath(i, count) {
    const sl = SPAN / count;
    const a1 = START + i * sl + 0.022;
    const a2 = START + (i + 1) * sl - 0.022;
    const ix1 = CX + IR * Math.cos(a1), iy1 = CY + IR * Math.sin(a1);
    const ox1 = CX + OR * Math.cos(a1), oy1 = CY + OR * Math.sin(a1);
    const ox2 = CX + OR * Math.cos(a2), oy2 = CY + OR * Math.sin(a2);
    const ix2 = CX + IR * Math.cos(a2), iy2 = CY + IR * Math.sin(a2);
    return `M${ix1} ${iy1} L${ox1} ${oy1} A${OR} ${OR} 0 0 1 ${ox2} ${oy2} ` +
           `L${ix2} ${iy2} A${IR} ${IR} 0 0 0 ${ix1} ${iy1}Z`;
  }
  function midAngle(i, count) {
    const sl = SPAN / count;
    return START + i * sl + sl / 2;
  }
  function dotPos(i, count) {
    const a = midAngle(i, count);
    const r = (IR + OR) / 2;
    return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
  }
  function labelPos(i, count) {
    const a = midAngle(i, count);
    return { x: CX + (OR + 6) * Math.cos(a) + 4, y: CY + (OR + 6) * Math.sin(a) };
  }

  function toggleHub() {
    wheelOpen = !wheelOpen;
    pointerWedge = -1;
    onOverlay = false;
    helpTool = null;
  }

  // The popup shows full v2-style help. helpTool holds the tool object; we look
  // up its rich doc reactively. Related chips swap the popup in place.
  $: helpDoc = helpTool ? toolDoc(helpTool.id) : null;

  function openHelpFor(toolId) {
    // Find the tool object across all categories (related tool may be in another category)
    for (const cat of Object.values(CATEGORIES)) {
      const t = cat.tools.find(x => x.id === toolId);
      if (t) { helpTool = t; return; }
    }
    // Fallback: synthesise a minimal tool object so the popup still renders
    helpTool = { id: toolId, label: toolTitle(toolId) };
  }

  function selectTool(tool) {
    activeTool = tool.id;
    dispatch('tool-selected', { toolId: tool.id, label: tool.label, category: activeCat });
  }

  function openDelay(i) { return i * 50; }
  function closeDelay(i, count) { return (count - 1 - i) * 50; }
</script>

<div class="wheel-component">
  <!-- mousemove + leave on the wrap drive wedge hover via coordinate maths. -->
  <div
    class="wheel-svg-wrap"
    style="width:{VIEW_W}px;height:{VIEW_H}px;"
    bind:this={wrapEl}
    on:mousemove={onMove}
    on:mouseleave={onWrapLeave}
    role="presentation"
  >

    <!-- SPOKES LAYER -->
    <svg
      class="spokes-layer"
      viewBox="0 0 {VIEW_W} {VIEW_H}"
      width={VIEW_W} height={VIEW_H}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="spokeGlow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.5" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {#each tools as tool, i}
        {@const isHover = hovered === i}
        {@const isActive = activeTool === tool.id}
        {@const dot = dotPos(i, n)}
        {@const iconColor = isHover || isActive ? '#4dc8ff' : '#6a9ab5'}
        <g
          class="spoke"
          class:open={wheelOpen}
          style="
            transform-origin: {CX}px {CY}px;
            transition-delay: {wheelOpen ? openDelay(i) : closeDelay(i, n)}ms;
            transition-timing-function: {wheelOpen
              ? 'cubic-bezier(0.34,1.4,0.64,1)'
              : 'cubic-bezier(0.4,0,0.64,-0.4)'};
          "
          on:click={() => selectTool(tool)}
          on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectTool(tool); } }}
          role="button"
          tabindex="0"
          aria-label={tool.label}
        >
          <path
            d={spokePath(i, n)}
            fill={isHover || isActive ? '#0d2038' : '#0d1520'}
            stroke={isHover || isActive ? '#4dc8ff' : '#1a2d40'}
            stroke-width={isHover || isActive ? 1.8 : 0.75}
            filter={isHover || isActive ? 'url(#spokeGlow)' : 'none'}
          />
          <g
            transform="translate({dot.x}, {dot.y}) scale({ICON_SCALE}) translate(-10, -10)"
            stroke={iconColor}
            fill="none"
            stroke-width="1.4"
            stroke-linecap="round"
            stroke-linejoin="round"
            style="color: {iconColor}; pointer-events: none;"
            filter={isHover || isActive ? 'url(#spokeGlow)' : 'none'}
          >
            {@html tool.iconSvg}
          </g>
        </g>
      {/each}
    </svg>

    <!-- HUB LAYER -->
    <svg
      class="hub-layer"
      viewBox="0 0 {VIEW_W} {VIEW_H}"
      width={VIEW_W} height={VIEW_H}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="hubGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="5" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <path
        d="M {CX} {CY - IR} A {IR} {IR} 0 0 1 {CX} {CY + IR}"
        fill="#0d1520"
        stroke="#4dc8ff"
        stroke-width={wheelOpen ? 1.2 : 2}
        filter={wheelOpen ? 'none' : 'url(#hubGlow)'}
        on:click={toggleHub}
        on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleHub(); } }}
        role="button"
        tabindex="0"
        aria-label="Toggle tool wheel"
        style="cursor:pointer;"
      />
      <text
        x={CX + IR * 0.38} y={CY}
        text-anchor="middle" dominant-baseline="middle"
        fill="#4dc8ff"
        font-size={wheelOpen ? 14 : 18}
        font-family="'Courier New', monospace"
        opacity={wheelOpen ? 0.65 : 1}
        filter={wheelOpen ? 'none' : 'url(#hubGlow)'}
        style="pointer-events:none; user-select:none;"
      >{wheelOpen ? '‹' : '›'}</text>
      {#if wheelOpen}
        <text
          x={CX + 9} y={CY - 12}
          text-anchor="middle"
          fill="#4dc8ff" font-size="7"
          font-family="'Courier New', monospace"
          letter-spacing="0.1em" opacity="0.7"
          style="pointer-events:none;"
        >{activeCat.toUpperCase().slice(0, 5)}</text>
      {/if}
    </svg>

    <!-- HTML LABEL OVERLAY — its own mouse events hold hover on the far label,
         where angle-testing can't (the label runs horizontally, not radially).
         The angle band (to OR+20) and this overlay overlap, so the handoff
         between them has no gap. -->
    {#if hovered !== -1 && wheelOpen}
      {@const tool = tools[hovered]}
      {@const lbl  = labelPos(hovered, n)}
      <div
        class="spoke-overlay"
        style="left:{lbl.x}px; top:{lbl.y}px;"
        on:mouseenter={onOverlayEnter}
        on:mouseleave={onOverlayLeave}
        role="tooltip"
      >
        <button
          class="so-label"
          on:click|stopPropagation={() => selectTool(tool)}
        >{tool.label}</button>
        <button
          class="so-info"
          title="Tool help"
          on:click|stopPropagation={() => helpTool = tool}
        >&#9432;</button>
      </div>
    {/if}
  </div>

  <!-- HELP POPUP — full v2-style content: Purpose / How To / Common Mistakes,
       scrollable body, related-tool chips that swap the popup in place. -->
  {#if helpTool && helpDoc}
    <div class="help-popup" role="dialog" aria-modal="false">
      <div class="hp-header">
        <span class="hp-title">{helpDoc.title}</span>
        <button class="hp-close" on:click={() => helpTool = null} title="Close">&#10005;</button>
      </div>

      <div class="hp-body">
        {#if helpDoc.purpose}
          <div class="hp-section">
            <div class="hp-h">Purpose</div>
            <p class="hp-p">{helpDoc.purpose}</p>
          </div>
        {/if}
        {#if helpDoc.howTo}
          <div class="hp-section">
            <div class="hp-h">How To Use</div>
            <p class="hp-p hp-pre">{helpDoc.howTo}</p>
          </div>
        {/if}
        {#if helpDoc.mistakes}
          <div class="hp-section">
            <div class="hp-h">Common Mistakes</div>
            <p class="hp-p">{helpDoc.mistakes}</p>
          </div>
        {/if}
      </div>

      {#if helpDoc.related && helpDoc.related.length}
        <div class="hp-related">
          <span class="hp-rel-lbl">Related</span>
          {#each helpDoc.related as rid}
            <button class="hp-chip" on:click={() => openHelpFor(rid)}>{toolTitle(rid)}</button>
          {/each}
        </div>
      {/if}

      <div class="hp-footer">
        <a
          href={docsUrl(helpTool.id)}
          target="_blank"
          rel="noopener"
          class="hp-link"
        >&#128214;&nbsp; Open Manual</a>
        <button class="hp-close-btn" on:click={() => helpTool = null}>Close</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .wheel-component {
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    z-index: 15;
  }

  .wheel-svg-wrap {
    position: relative;
  }

  .hub-layer,
  .spokes-layer {
    position: absolute;
    left: 0;
    top: 0;
    overflow: visible;
  }

  .hub-layer { z-index: 2; pointer-events: none; }
  .hub-layer path,
  .hub-layer text { pointer-events: auto; }
  .spokes-layer { z-index: 1; }

  .spoke {
    cursor: pointer;
    opacity: 0;
    transform: scale(0.08);
    transform-box: fill-box;
    transition-property: transform, opacity;
    transition-duration: 0.22s;
  }
  .spoke.open {
    opacity: 1;
    transform: scale(1);
  }

  /* Chrome draws a rectangular native focus ring around an SVG <g> after a
     mouse click. Remove that box, but retain a deliberate wedge-shaped focus
     indicator for people navigating the wheel with the keyboard. */
  .spoke:focus,
  .hub-layer path:focus {
    outline: none;
  }
  .spoke:focus-visible > path {
    stroke: #ffffff;
    stroke-width: 2.2;
  }
  .hub-layer path:focus-visible {
    stroke: #ffffff;
    stroke-width: 2;
  }

  /* ── HTML label overlay ──
     Left padding extends the hit area back toward the wedge, overlapping the
     angle-test band so the handoff has no dead zone. */
  .spoke-overlay {
    position: absolute;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    gap: 6px;
    z-index: 20;
    pointer-events: auto;
    padding: 8px 8px 8px 14px;
    margin-left: -14px;     /* pull the padded hit area over the wedge edge */
  }

  .so-label {
    background: transparent;
    border: none;
    font-family: 'Courier New', monospace;
    font-size: 10.5px;
    color: #4dc8ff;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    white-space: nowrap;
    cursor: pointer;
    padding: 0;
    text-shadow: 0 0 8px #00aaff55;
  }
  .so-label:hover { color: #ffffff; }

  .so-info {
    background: transparent;
    border: 1px solid #4dc8ff55;
    border-radius: 50%;
    color: #4dc8ff;
    font-family: 'Courier New', monospace;
    font-size: 10px;
    width: 17px;
    height: 17px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
    line-height: 1;
    transition: all 0.12s;
  }
  .so-info:hover {
    border-color: #4dc8ff;
    background: #00aaff22;
    box-shadow: 0 0 8px #00aaff66;
  }

  /* ── Help popup (v2-style) ── */
  .help-popup {
    position: absolute;
    left: calc(100% + 12px);
    top: 50%;
    transform: translateY(-50%);
    width: 300px;
    max-height: 440px;
    background: #0d1520;
    border: 1px solid #4dc8ff44;
    border-radius: 8px;
    box-shadow: 0 12px 40px #000000aa;
    z-index: 30;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .hp-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 11px 14px;
    border-bottom: 1px solid #1a2d40;
    background: #0a1018;
    flex-shrink: 0;
  }
  .hp-title {
    font-family: 'Courier New', monospace;
    font-size: 12px;
    font-weight: 700;
    color: #4dc8ff;
    letter-spacing: 0.04em;
  }
  .hp-close {
    background: transparent;
    border: none;
    color: #3a5a70;
    font-size: 12px;
    cursor: pointer;
    padding: 0 0 0 8px;
    line-height: 1;
    transition: color 0.12s;
  }
  .hp-close:hover { color: #ff5555; }

  /* Scrollable body */
  .hp-body {
    padding: 12px 14px;
    overflow-y: auto;
    flex: 1;
    scrollbar-width: thin;
    scrollbar-color: #1a2d40 transparent;
  }
  .hp-body::-webkit-scrollbar { width: 6px; }
  .hp-body::-webkit-scrollbar-track { background: transparent; }
  .hp-body::-webkit-scrollbar-thumb { background: #1a2d40; border-radius: 3px; }

  .hp-section { margin-bottom: 13px; }
  .hp-section:last-child { margin-bottom: 0; }
  .hp-h {
    font-family: 'Courier New', monospace;
    font-size: 9px;
    font-weight: 700;
    color: #4dc8ff;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    margin-bottom: 5px;
  }
  .hp-p {
    font-family: 'Courier New', monospace;
    font-size: 10.5px;
    color: #a0c4d8;
    line-height: 1.65;
    letter-spacing: 0.01em;
    margin: 0;
  }
  .hp-pre { white-space: pre-line; }

  /* Related chips */
  .hp-related {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 10px 14px;
    border-top: 1px solid #1a2d40;
    flex-shrink: 0;
  }
  .hp-rel-lbl {
    font-family: 'Courier New', monospace;
    font-size: 8px;
    color: #3a5a70;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    margin-right: 2px;
  }
  .hp-chip {
    background: transparent;
    border: 1px solid #4dc8ff44;
    border-radius: 4px;
    color: #4dc8ff;
    font-family: 'Courier New', monospace;
    font-size: 9px;
    letter-spacing: 0.03em;
    padding: 3px 8px;
    cursor: pointer;
    transition: all 0.12s;
  }
  .hp-chip:hover {
    background: #4dc8ff;
    color: #0d1520;
    border-color: #4dc8ff;
  }

  /* Footer */
  .hp-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-top: 1px solid #1a2d40;
    background: #0a1018;
    flex-shrink: 0;
  }
  .hp-link {
    font-family: 'Courier New', monospace;
    font-size: 10px;
    color: #4dc8ff;
    letter-spacing: 0.04em;
    text-decoration: none;
    border: 1px solid #4dc8ff;
    border-radius: 4px;
    padding: 5px 12px;
    transition: all 0.12s;
  }
  .hp-link:hover {
    background: #4dc8ff;
    color: #0d1520;
  }
  .hp-close-btn {
    font-family: 'Courier New', monospace;
    font-size: 10px;
    color: #6a8fa8;
    background: #1a2332;
    border: 1px solid #2d3f52;
    border-radius: 4px;
    padding: 5px 14px;
    cursor: pointer;
    transition: all 0.12s;
  }
  .hp-close-btn:hover {
    border-color: #4dc8ff;
    color: #4dc8ff;
  }
</style>
