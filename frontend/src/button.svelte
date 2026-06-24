<script>
  export let label = 'Button';
  export let active = false;
  export let icon = null;
</script>

<button class:active on:click>
  {#if icon}<span class="icon">{icon}</span>{/if}
  <span class="label">{label}</span>
</button>

<style>
  button {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 18px;
    border-radius: 999px;
    cursor: pointer;
    font-size: 11px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    font-family: 'Inter', monospace;
    color: rgba(200, 220, 220, 0.9);
    width: 100%;
    position: relative;
    transition: all 0.1s ease;

    background: linear-gradient(
      145deg,
      #2a2a2a 0%,
      #1a1a1a 50%,
      #111111 100%
    );

    border: none;

    box-shadow:
      4px 4px 8px rgba(0,0,0,0.8),
      -2px -2px 6px rgba(255,255,255,0.04),
      inset 0 1px 0 rgba(255,255,255,0.08),
      inset 0 -1px 0 rgba(0,0,0,0.8);
  }

  button:hover {
    color: #00ffcc;
    background: linear-gradient(
      145deg,
      #2e2e2e 0%,
      #1e1e1e 50%,
      #141414 100%
    );
    box-shadow:
      4px 4px 10px rgba(0,0,0,0.9),
      -2px -2px 6px rgba(255,255,255,0.05),
      inset 0 1px 0 rgba(255,255,255,0.1),
      inset 0 -1px 0 rgba(0,0,0,0.8),
      0 0 12px rgba(0,255,204,0.08);
  }

  button:active {
    transform: translateY(2px);
    box-shadow:
      1px 1px 3px rgba(0,0,0,0.8),
      inset 0 2px 4px rgba(0,0,0,0.8),
      inset 0 1px 0 rgba(0,0,0,0.9);
    background: linear-gradient(
      145deg,
      #111111 0%,
      #1a1a1a 100%
    );
  }

  button.active {
    color: #00ffcc;
    background: linear-gradient(
      145deg,
      #0d1f1c 0%,
      #0a1a17 50%,
      #071210 100%
    );
    box-shadow:
      4px 4px 8px rgba(0,0,0,0.8),
      -2px -2px 6px rgba(0,255,204,0.03),
      inset 0 1px 0 rgba(0,255,204,0.1),
      inset 0 -1px 0 rgba(0,0,0,0.8),
      0 0 16px rgba(0,255,204,0.12);
  }

  .icon {
    font-size: 13px;
    opacity: 0.7;
  }

  .label {
    flex: 1;
  }
</style>