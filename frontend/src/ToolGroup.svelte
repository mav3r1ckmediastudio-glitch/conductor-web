<script>
  export let label = '';
  export let count = null;
  export let tools = [];
  let open = true;
</script>

<div class="group">
  <button class="group-header" on:click={() => open = !open}>
    <span class="group-label">{label}</span>
    {#if count}<span class="group-count">{count}</span>{/if}
    <span class="chevron">{open ? '▾' : '▸'}</span>
  </button>
  {#if open}
  <div class="tool-list">
    {#each tools as tool}
    <div class="tool-row">
      <span class="tool-icon">{tool.icon}</span>
      <div class="tool-text">
        <span class="tool-label">{tool.label}</span>
        {#if tool.sub}<span class="tool-sub">{tool.sub}</span>{/if}
      </div>
    </div>
    {/each}
  </div>
  {/if}
</div>

<style>
  .group {
    border-bottom: 1px solid #1e2d3d;
  }

  .group-header {
    width: 100%;
    display: flex;
    align-items: center;
    padding: 8px 12px;
    background: transparent;
    border: none;
    color: #5a7a8a;
    font-size: 10px;
    letter-spacing: 2px;
    text-transform: uppercase;
    cursor: pointer;
    gap: 6px;
  }

  .group-header:hover { color: #e0e0e0; }

  .group-label { flex: 1; text-align: left; }

  .group-count {
    background: #1e2d3d;
    color: #00ffcc;
    padding: 1px 5px;
    border-radius: 8px;
    font-size: 9px;
  }

  .chevron { font-size: 10px; }

  .tool-list { padding: 4px 0; }

  .tool-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 7px 12px;
    cursor: pointer;
  }

  .tool-row:hover { background: #131c24; }
  .tool-row:hover .tool-label { color: #00ffcc; }

  .tool-icon {
    font-size: 13px;
    color: #5a7a8a;
    width: 16px;
    text-align: center;
    flex-shrink: 0;
    margin-top: 1px;
  }

  .tool-label {
    font-size: 11px;
    color: #c0c0c0;
    display: block;
  }

  .tool-sub {
    font-size: 9px;
    color: #5a7a8a;
    display: block;
    margin-top: 2px;
  }
</style>