<script>
  import { onMount } from 'svelte';

  // No real auth here — the Netlify Edge Basic Auth function is the
  // actual gate, enforced before any of this app's JS ever loads. This
  // screen is branding + a deliberate "continue" step, not a login.
  let { onContinue } = $props();

  let canvasEl;
  let ctx;
  let W = 0, H = 0;
  let nodes = [];
  let pulses = [];
  let t = 0;
  let animFrame;

  const RGB = '77, 200, 255';
  const NODE_COUNT = 58;
  const MAX_DIST = 190;
  const PULSE_RATE = 0.008;

  function initNodes() {
    nodes = Array.from({ length: NODE_COUNT }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.22,
      vy: (Math.random() - 0.5) * 0.22,
      r: Math.random() > 0.92 ? 4.5 : Math.random() > 0.66 ? 2.5 : 1.4,
      phase: Math.random() * Math.PI * 2,
    }));
    pulses = [];
  }

  function setupCanvas() {
    const dpr = window.devicePixelRatio || 1;
    W = canvasEl.offsetWidth;
    H = canvasEl.offsetHeight;
    canvasEl.width = W * dpr;
    canvasEl.height = H * dpr;
    ctx = canvasEl.getContext('2d');
    ctx.scale(dpr, dpr);
    initNodes();
  }

  function draw() {
    t++;

    ctx.fillStyle = '#060a12';
    ctx.fillRect(0, 0, W, H);

    // Radial centre glow
    const rg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.55);
    rg.addColorStop(0, 'rgba(12, 24, 48, 0.6)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);

    // Subtle coordinate grid
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(${RGB}, 0.038)`;
    for (let x = 0; x < W; x += 66) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += 66) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Move nodes
    for (const n of nodes) {
      n.x += n.vx; n.y += n.vy; n.phase += 0.017;
      if (n.x < -20) n.x = W + 20;
      if (n.x > W + 20) n.x = -20;
      if (n.y < -20) n.y = H + 20;
      if (n.y > H + 20) n.y = -20;
    }

    // Connections + pulse spawning
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < MAX_DIST) {
          const a = Math.pow(1 - d / MAX_DIST, 2) * 0.38;
          ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.strokeStyle = `rgba(${RGB}, ${a})`;
          ctx.lineWidth = 0.65;
          ctx.stroke();

          if (d < MAX_DIST * 0.68 && Math.random() < PULSE_RATE) {
            pulses.push({ i, j, p: 0, spd: 0.0038 + Math.random() * 0.0042 });
          }
        }
      }
    }

    // Pulses
    pulses = pulses.filter(pu => {
      pu.p += pu.spd;
      if (pu.p >= 1) return false;

      const a = nodes[pu.i], b = nodes[pu.j];
      const x = a.x + (b.x - a.x) * pu.p;
      const y = a.y + (b.y - a.y) * pu.p;
      const t0 = Math.max(0, pu.p - 0.11);
      const tx = a.x + (b.x - a.x) * t0;
      const ty = a.y + (b.y - a.y) * t0;

      // Tail gradient
      const lg = ctx.createLinearGradient(tx, ty, x, y);
      lg.addColorStop(0, `rgba(${RGB}, 0)`);
      lg.addColorStop(1, `rgba(${RGB}, 0.78)`);
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(x, y);
      ctx.strokeStyle = lg;
      ctx.lineWidth = 1.6;
      ctx.stroke();

      // Head glow
      const hg = ctx.createRadialGradient(x, y, 0, x, y, 8);
      hg.addColorStop(0, 'rgba(215, 242, 255, 0.96)');
      hg.addColorStop(0.38, `rgba(${RGB}, 0.5)`);
      hg.addColorStop(1, `rgba(${RGB}, 0)`);
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fillStyle = hg;
      ctx.fill();

      return true;
    });

    // Nodes
    for (const n of nodes) {
      const g = 0.55 + 0.45 * Math.sin(n.phase);

      // Outer halo
      const og = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r * 5.5);
      og.addColorStop(0, `rgba(${RGB}, ${0.2 * g})`);
      og.addColorStop(1, `rgba(${RGB}, 0)`);
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r * 5.5, 0, Math.PI * 2);
      ctx.fillStyle = og;
      ctx.fill();

      // Core
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${RGB}, ${0.68 + 0.32 * g})`;
      ctx.fill();
    }

    // Edge vignette
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.8);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(4,6,14,0.7)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    animFrame = requestAnimationFrame(draw);
  }

  onMount(() => {
    setupCanvas();
    const ro = new ResizeObserver(setupCanvas);
    ro.observe(canvasEl);
    animFrame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(animFrame);
      ro.disconnect();
    };
  });
</script>

<div class="splash">
  <canvas bind:this={canvasEl}></canvas>

  <div class="card">
    <!-- Brand mark -->
    <div class="brand">
      <!-- 1:4 FTTP split schematic — POP → cabinet → 4 premises -->
      <svg class="fiber-icon" viewBox="0 0 60 44" fill="none" aria-hidden="true">
        <circle cx="4"  cy="22" r="3"   fill="#4dc8ff" opacity="0.65"/>
        <line x1="7"  y1="22" x2="20" y2="22" stroke="#4dc8ff" stroke-width="2"/>
        <circle cx="23" cy="22" r="4.5" fill="#4dc8ff"/>
        <line x1="27" y1="22" x2="40" y2="7"  stroke="#4dc8ff" stroke-width="1.5"/>
        <line x1="27" y1="22" x2="40" y2="15" stroke="#4dc8ff" stroke-width="1.5"/>
        <line x1="27" y1="22" x2="40" y2="29" stroke="#4dc8ff" stroke-width="1.5"/>
        <line x1="27" y1="22" x2="40" y2="37" stroke="#4dc8ff" stroke-width="1.5"/>
        <circle cx="43" cy="7"  r="2.5" fill="#4dc8ff" opacity="0.82"/>
        <circle cx="43" cy="15" r="2.5" fill="#4dc8ff" opacity="0.82"/>
        <circle cx="43" cy="29" r="2.5" fill="#4dc8ff" opacity="0.82"/>
        <circle cx="43" cy="37" r="2.5" fill="#4dc8ff" opacity="0.82"/>
        <line x1="46" y1="7"  x2="56" y2="4"  stroke="#4dc8ff" stroke-width="1" opacity="0.42"/>
        <line x1="46" y1="7"  x2="56" y2="10" stroke="#4dc8ff" stroke-width="1" opacity="0.42"/>
        <line x1="46" y1="37" x2="56" y2="34" stroke="#4dc8ff" stroke-width="1" opacity="0.42"/>
        <line x1="46" y1="37" x2="56" y2="40" stroke="#4dc8ff" stroke-width="1" opacity="0.42"/>
      </svg>

      <div class="wordmark">
        <span class="title">CONDUCTOR</span>
        <div class="sub-row">
          <span class="web">WEB</span>
          <span class="badge">v2 · Beta</span>
        </div>
      </div>
    </div>

    <p class="tagline">FTTP Network Design Platform</p>

    <div class="rule"></div>

    <button class="g-btn" onclick={onContinue}>
      <!-- 1:4 FTTP split schematic, mirrored small, as a simple "enter" glyph -->
      <svg class="enter-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="3" cy="12" r="1.6" fill="#4dc8ff" opacity="0.7"/>
        <line x1="4.6" y1="12" x2="10" y2="12" stroke="#4dc8ff" stroke-width="1.4"/>
        <circle cx="11.5" cy="12" r="2.2" fill="#4dc8ff"/>
        <line x1="13.7" y1="12" x2="19" y2="7.2" stroke="#4dc8ff" stroke-width="1.2"/>
        <line x1="13.7" y1="12" x2="19" y2="16.8" stroke="#4dc8ff" stroke-width="1.2"/>
      </svg>
      <span>Continue to Conductor Web</span>
    </button>
  </div>
</div>

<style>
  .splash {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #060a12;
    overflow: hidden;
    font-family: 'Inter', ui-sans-serif, system-ui, sans-serif;
  }

  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }

  /* ── Card ── */
  .card {
    position: relative;
    z-index: 10;
    width: 420px;
    padding: 48px 44px 36px;
    background: rgba(4, 8, 20, 0.84);
    border: 1px solid rgba(77, 200, 255, 0.2);
    border-radius: 22px;
    backdrop-filter: blur(30px);
    -webkit-backdrop-filter: blur(30px);
    box-shadow:
      inset 0 1px 0 rgba(77, 200, 255, 0.13),
      0 0 120px rgba(77, 200, 255, 0.07),
      0 48px 96px rgba(0, 0, 0, 0.7);
    text-align: center;
    animation: rise 0.7s cubic-bezier(0.22, 1, 0.36, 1) both;
  }

  /* Top shimmer */
  .card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 14%;
    right: 14%;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(77, 200, 255, 0.6), transparent);
    border-radius: 99px;
  }

  @keyframes rise {
    from { opacity: 0; transform: translateY(18px) scale(0.96); }
    to   { opacity: 1; transform: translateY(0)   scale(1);    }
  }

  /* ── Brand ── */
  .brand {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 18px;
    margin-bottom: 10px;
  }

  .fiber-icon {
    width: 56px;
    height: 41px;
    flex-shrink: 0;
    filter: drop-shadow(0 0 10px rgba(77, 200, 255, 0.65))
            drop-shadow(0 0 24px rgba(77, 200, 255, 0.3));
  }

  .wordmark { text-align: left; }

  .title {
    display: block;
    font-size: 30px;
    font-weight: 800;
    letter-spacing: 0.17em;
    line-height: 1;
    background: linear-gradient(135deg, #5dd2ff 0%, #22aaff 55%, #0077cc 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    filter: drop-shadow(0 0 20px rgba(77, 200, 255, 0.4));
  }

  .sub-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 5px;
  }

  .web {
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.34em;
    color: rgba(77, 200, 255, 0.52);
  }

  .badge {
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.04em;
    color: rgba(77, 200, 255, 0.38);
    background: rgba(77, 200, 255, 0.08);
    border: 1px solid rgba(77, 200, 255, 0.18);
    border-radius: 5px;
    padding: 1px 7px;
  }

  /* ── Tagline ── */
  .tagline {
    margin: 0 0 28px;
    font-size: 11px;
    font-weight: 400;
    letter-spacing: 0.19em;
    color: rgba(77, 200, 255, 0.36);
    text-transform: uppercase;
  }

  .rule {
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(77, 200, 255, 0.18), transparent);
    margin-bottom: 28px;
  }

  /* ── Google button ── */
  .g-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    width: 100%;
    padding: 14px 20px;
    background: rgba(255, 255, 255, 0.055);
    border: 1px solid rgba(255, 255, 255, 0.13);
    border-radius: 12px;
    color: rgba(255, 255, 255, 0.88);
    font-family: inherit;
    font-size: 15px;
    font-weight: 500;
    letter-spacing: 0.01em;
    cursor: pointer;
    transition:
      background 0.18s ease,
      border-color 0.18s ease,
      box-shadow 0.18s ease,
      color 0.15s ease,
      transform 0.1s ease;
    outline: none;
    white-space: nowrap;
  }

  .g-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.092);
    border-color: rgba(77, 200, 255, 0.4);
    box-shadow:
      0 0 28px rgba(77, 200, 255, 0.15),
      0 4px 16px rgba(0, 0, 0, 0.35);
    color: #fff;
  }

  .g-btn:focus-visible {
    outline: 2px solid rgba(77, 200, 255, 0.6);
    outline-offset: 2px;
  }

  .g-btn:active:not(:disabled) {
    transform: scale(0.983);
  }

  .g-btn:disabled {
    opacity: 0.58;
    cursor: default;
  }

  .enter-icon {
    width: 22px;
    height: 22px;
    flex-shrink: 0;
  }
</style>
