<script>
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher();

  // activeCat is controlled by the parent (sidebar pills).
  // wheelOpen toggled internally by the hub.
  export let activeCat = 'civil';

  // ---- Geometry (finalised spec) ----
  const IR = 44;          // hub semicircle radius
  const OR = 108;         // outer spoke radius
  const CX = 0;           // pivot anchored to left edge
  const CY = OR;          // vertical centre
  const START = -Math.PI / 2;   // top
  const SPAN = Math.PI;         // 180deg sweep, fanning right
  const VIEW_W = OR + 150;      // svg width incl. label room
  const VIEW_H = OR * 2;        // full semicircle height

  // ---- Tool categories (from plugin source audit) ----
  const CATEGORIES = {
    civil: {
      label: 'Civil',
      tools: [
        { id: 'civil-edit-cabinet', icon: '✎', label: 'Edit Cabinet/POP' },
        { id: 'civil-chamber',      icon: '⬡', label: 'Place Chamber' },
        { id: 'civil-duct',         icon: '—', label: 'Digitise Duct' },
        { id: 'civil-drop-duct',    icon: '╌', label: 'Digitise Drop Duct' },
        { id: 'civil-road',         icon: '╳', label: 'Road Crossing' },
        { id: 'civil-stream',       icon: '≈', label: 'Stream Crossing' },
      ]
    },
    fibre: {
      label: 'Fibre',
      tools: [
        { id: 'fibre-cable',   icon: '⌁', label: 'Digitise Cable' },
        { id: 'fibre-bundle',  icon: '⌇', label: 'Digitise Bundle' },
        { id: 'fibre-joint',   icon: '⬢', label: 'Place Joint' },
        { id: 'fibre-assign',  icon: '⊞', label: 'Assign Fibre Roles' },
        { id: 'fibre-trace',   icon: '◎', label: 'Fibre Trace' },
        { id: 'fibre-count',   icon: '#', label: 'Fibre Count' },
      ]
    },
    aerial: {
      label: 'Aerial & Poles',
      tools: [
        { id: 'aerial-pole',     icon: '|', label: 'Place Pole' },
        { id: 'aerial-cbt',      icon: '⊟', label: 'Place CBT' },
        { id: 'aerial-cbt-tail', icon: '⌐', label: 'Draw CBT Tail' },
        { id: 'aerial-span',     icon: '⌒', label: 'Digitise Aerial Span' },
        { id: 'aerial-drop',     icon: '⌣', label: 'Digitise Aerial Drop' },
      ]
    },
    pia: {
      label: 'PIA Underground',
      tools: [
        { id: 'pia-chamber', icon: '⬛', label: 'Place PIA UG Chamber' },
        { id: 'pia-duct',    icon: '▭', label: 'Digitise PIA UG Duct' },
        { id: 'pia-drop',    icon: '▢', label: 'Digitise PIA UG Drop' },
      ]
    }
  };

  // ---- State ----
  let wheelOpen = true;
  let hovered = -1;
  let activeTool = null;

  $: tools = CATEGORIES[activeCat]?.tools ?? [];
  $: n = tools.length;

  // When the parent changes category, re-open the wheel so the new
  // tool set is visible.
  $: if (activeCat) { wheelOpen = true; hovered = -1; }

  // ---- Wedge geometry ----
  // Build a filled pie-wedge segment for spoke i of n, between IR and OR.
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

  // Mid-angle helpers for placing the dot + label of each wedge.
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
    // Radial: the hovered label sits just beyond the outer arc on the
    // segment's own mid-angle, so it points out from that wedge.
    const a = midAngle(i, count);
    return { x: CX + (OR + 12) * Math.cos(a) + 4, y: CY + (OR + 12) * Math.sin(a) };
  }
  function clip(label) {
    return label.length > 17 ? label.slice(0, 16) + '…' : label;
  }

  function toggleHub() {
    wheelOpen = !wheelOpen;
    hovered = -1;
  }

  function selectTool(tool) {
    activeTool = tool.id;
    dispatch('tool-selected', { toolId: tool.id, label: tool.label, category: activeCat });
  }

  // Stagger: open fans top→bottom, close folds bottom→top.
  function openDelay(i) { return i * 50; }
  function closeDelay(i, count) { return (count - 1 - i) * 50; }
</script>

<div class="wheel-component">
  <div class="wheel-svg-wrap" style="width:{VIEW_W}px;height:{VIEW_H}px;">

    <!-- SPOKES LAYER — the only thing that animates -->
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
        {@const lbl = labelPos(i, n)}
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
          on:mouseenter={() => hovered = i}
          on:mouseleave={() => hovered = -1}
          on:click={() => selectTool(tool)}
        >
          <!-- filled wedge segment -->
          <path
            d={spokePath(i, n)}
            fill={isHover || isActive ? '#0d2038' : '#0d1520'}
            stroke={isHover || isActive ? '#4dc8ff' : '#1a2d40'}
            stroke-width={isHover || isActive ? 1.8 : 0.75}
            filter={isHover || isActive ? 'url(#spokeGlow)' : 'none'}
          />
          <!-- ICON in segment centre — ALWAYS visible, the primary hint -->
          <text
            x={dot.x} y={dot.y}
            text-anchor="middle" dominant-baseline="middle"
            fill={isHover || isActive ? '#4dc8ff' : '#6a9ab5'}
            font-size="13"
            font-family="'Courier New', monospace"
            opacity={isHover || isActive ? 1 : 0.85}
            style="pointer-events:none;"
            filter={isHover || isActive ? 'url(#spokeGlow)' : 'none'}
          >{tool.icon}</text>

          <!-- LABEL outside the arc — ONLY on hover -->
          {#if isHover}
            <text
              x={lbl.x} y={lbl.y}
              text-anchor="start" dominant-baseline="middle"
              fill="#4dc8ff"
              font-size="10.5"
              font-family="'Courier New', monospace"
              letter-spacing="0.05em"
              style="pointer-events:none; text-transform:uppercase;"
              filter="url(#spokeGlow)"
            >{tool.label}</text>
          {/if}
        </g>
      {/each}
    </svg>

    <!-- HUB LAYER — permanent, always on top, never folds away -->
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

      <!-- Hub semicircle (right half) — brighter when closed -->
      <path
        d="M {CX} {CY - IR} A {IR} {IR} 0 0 1 {CX} {CY + IR}"
        fill="#0d1520"
        stroke="#4dc8ff"
        stroke-width={wheelOpen ? 1.2 : 2}
        filter={wheelOpen ? 'none' : 'url(#hubGlow)'}
        on:click={toggleHub}
        style="cursor:pointer;"
      />

      <!-- Chevron toggle -->
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

      <!-- Category abbreviation inside hub when open -->
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
  </div>
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

  /* Hub sits above the spokes so it never disappears. */
  .hub-layer { z-index: 2; pointer-events: none; }
  .hub-layer path,
  .hub-layer text { pointer-events: auto; }
  .spokes-layer { z-index: 1; }

  /* Spokes scale + fade from the hub origin. */
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
</style>
