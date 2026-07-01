<script>
  import { onMount } from 'svelte';

  let { clerk } = $props();

  let signingIn = $state(false);
  let errorMsg = $state('');

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

  async function signInWithGoogle() {
    if (signingIn) return;
    signingIn = true;
    errorMsg = '';
    try {
      // transferable: false — by default Clerk silently attempts to
      // transfer a sign-in with no matching account into a sign-up
      // internally. In testing that internal transfer is where new-user
      // sign-ins were dying: it completes the OAuth round-trip with
      // Google, then returns to this app with no callback params and no
      // error, leaving clerk.client.signUp blank. Disabling the silent
      // transfer makes a "no account" outcome throw instead, so we can
      // handle sign-up ourselves below with our own explicit redirect —
      // full control over both hops instead of one opaque one.
      await clerk.client.signIn.authenticateWithRedirect({
        strategy: 'oauth_google',
        redirectUrl: window.location.origin,
        redirectUrlComplete: window.location.origin,
        transferable: false,
      });
      // Page navigates to Google — code below won't run until back
    } catch (e) {
      // TEMP DEBUG — remove once new-user sign-up is confirmed working.
      // Uncertain exactly which error shape Clerk throws here for "no
      // matching account" with transferable:false — logging the full
      // error so this can be corrected if the fallback below doesn't
      // trigger correctly.
      console.error('[clerk-debug] signIn.authenticateWithRedirect threw:', e, JSON.stringify(e?.errors));
      try {
        await clerk.client.signUp.authenticateWithRedirect({
          strategy: 'oauth_google',
          redirectUrl: window.location.origin,
          redirectUrlComplete: window.location.origin,
        });
        // Page navigates to Google again — code below won't run until back
        return;
      } catch (e2) {
        console.error('[clerk-debug] signUp.authenticateWithRedirect ALSO threw:', e2, JSON.stringify(e2?.errors));
        errorMsg = e2.errors?.[0]?.longMessage ?? e2.message ?? 'Sign-up failed. Please try again.';
        signingIn = false;
      }
    }
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

    {#if errorMsg}
      <div class="error">{errorMsg}</div>
    {/if}

    <button class="g-btn" onclick={signInWithGoogle} disabled={signingIn}>
      {#if signingIn}
        <span class="spinner" aria-hidden="true"></span>
        <span>Signing in…</span>
      {:else}
        <!-- Official Google G mark -->
        <svg class="g-logo" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
        </svg>
        <span>Continue with Google</span>
      {/if}
    </button>

    <p class="legal">
      By continuing you agree to our
      <a href="#">Terms of Service</a> and <a href="#">Privacy Policy</a>
    </p>
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

  /* ── Error ── */
  .error {
    background: rgba(255, 60, 60, 0.09);
    border: 1px solid rgba(255, 80, 80, 0.26);
    border-radius: 10px;
    padding: 11px 14px;
    color: #ff9090;
    font-size: 13px;
    text-align: left;
    margin-bottom: 16px;
    line-height: 1.5;
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

  .g-logo {
    width: 20px;
    height: 20px;
    flex-shrink: 0;
  }

  /* ── Spinner ── */
  .spinner {
    display: block;
    width: 18px;
    height: 18px;
    border: 2px solid rgba(77, 200, 255, 0.2);
    border-top-color: #4dc8ff;
    border-radius: 50%;
    animation: spin 0.72s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Legal ── */
  .legal {
    margin: 20px 0 0;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.27);
    line-height: 1.7;
  }

  .legal a {
    color: rgba(77, 200, 255, 0.52);
    text-decoration: none;
    transition: color 0.15s;
  }

  .legal a:hover { color: rgba(77, 200, 255, 0.88); }
</style>
