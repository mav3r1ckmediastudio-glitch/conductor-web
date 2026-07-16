<script>
  import { onMount, onDestroy } from 'svelte';
  import { onToast } from './toast.js';

  let toasts = [];
  let unsub;
  const timers = new Map();

  onMount(() => {
    unsub = onToast((t) => {
      toasts = [...toasts, t];
      const timer = setTimeout(() => dismiss(t.id), t.duration);
      timers.set(t.id, timer);
    });
  });

  onDestroy(() => {
    if (unsub) unsub();
    timers.forEach(clearTimeout);
  });

  function dismiss(id) {
    toasts = toasts.filter(t => t.id !== id);
    const timer = timers.get(id);
    if (timer) { clearTimeout(timer); timers.delete(id); }
  }
</script>

<div class="toast-stack" role="status" aria-live="polite">
  {#each toasts as t (t.id)}
    <div class="toast toast-{t.type}">
      <span class="toast-msg">{t.message}</span>
      <button class="toast-close" on:click={() => dismiss(t.id)} title="Dismiss" aria-label="Dismiss notification">✕</button>
    </div>
  {/each}
</div>

<style>
  .toast-stack {
    position: fixed;
    top: 56px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 500;
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: none;
    width: min(420px, calc(100% - 32px));
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    background: #0d1520;
    border: 1px solid #00aaff55;
    border-radius: 6px;
    padding: 10px 12px;
    box-shadow: 0 8px 24px #00000088;
    font-family: 'Courier New', monospace;
    font-size: 10.5px;
    line-height: 1.45;
    color: #a0c4d8;
    animation: toastIn 0.18s ease-out;
  }
  .toast-error {
    border-color: #ff6b6b66;
    background: #170d0d;
  }
  .toast-error .toast-msg { color: #ff9b9b; }
  .toast-warning {
    border-color: #e6b45566;
    background: #17130d;
  }
  .toast-warning .toast-msg { color: #e6c98a; }
  .toast-warning .toast-close:hover { color: #e6c98a; }
  .toast-msg { flex: 1; word-break: break-word; }
  .toast-close {
    background: transparent;
    border: none;
    color: #5b7488;
    cursor: pointer;
    font-size: 11px;
    padding: 0 2px;
    line-height: 1.45;
    flex-shrink: 0;
  }
  .toast-close:hover { color: #a0c4d8; }
  .toast-error .toast-close:hover { color: #ff9b9b; }
  @keyframes toastIn {
    from { opacity: 0; transform: translateY(-6px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>
