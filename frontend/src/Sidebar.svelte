<script>
  let activeCategory = null;
  let selectedAssetTool = null;

  const categories = [
    { id: 'civil', icon: '◆', label: 'Civil', color: '#4dc8ff' },
    { id: 'fibre', icon: '⚡', label: 'Fibre', color: '#00ffcc' },
    { id: 'aerial', icon: '▲', label: 'Aerial & Poles', color: '#00aaff' },
    { id: 'pia', icon: '⬇', label: 'PIA UG', color: '#0088ff' }
  ];

  const assetTools = [
    { id: 'edit', icon: '✎', label: 'Edit', action: 'edit' },
    { id: 'delete', icon: '✕', label: 'Delete', action: 'delete' },
    { id: 'move', icon: '⇄', label: 'Move', action: 'move' }
  ];

  const selectCategory = (category) => {
    activeCategory = activeCategory === category.id ? null : category.id;
    window.dispatchEvent(new CustomEvent('category-selected', {
      detail: { categoryId: category.id, label: category.label }
    }));
  };

  const selectAssetTool = (tool) => {
    selectedAssetTool = selectedAssetTool === tool.id ? null : tool.id;
    window.dispatchEvent(new CustomEvent('asset-tool-selected', {
      detail: { toolId: tool.id, action: tool.action, label: tool.label }
    }));
  };
</script>

<div class="sidebar">
  <div class="sidebar-section">
    <div class="section-title">CATEGORIES</div>
    
    <div class="category-list">
      {#each categories as category (category.id)}
        <button
          class="category-btn {activeCategory === category.id ? 'active' : ''}"
          on:click={() => selectCategory(category)}
          title={category.label}
          style="--color: {category.color}"
        >
          <span class="cat-icon">{category.icon}</span>
          <span class="cat-label">{category.label}</span>
        </button>
      {/each}
    </div>
  </div>

  <div class="sidebar-divider"></div>

  <div class="sidebar-section">
    <div class="section-title">ASSET TOOLS</div>
    
    <div class="asset-tool-list">
      {#each assetTools as tool (tool.id)}
        <button
          class="asset-tool-btn {selectedAssetTool === tool.id ? 'active' : ''}"
          on:click={() => selectAssetTool(tool)}
          title={tool.label}
        >
          <span class="tool-icon">{tool.icon}</span>
        </button>
      {/each}
    </div>
  </div>
</div>

<style>
  .sidebar {
    width: 140px;
    height: 100%;
    background: #0d1117;
    border-right: 1px solid #1a2d40;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    flex-shrink: 0;
  }

  .sidebar-section {
    padding: 12px 0;
    border-bottom: 1px solid #1a2d40;
  }

  .sidebar-section:last-child {
    border-bottom: none;
  }

  .section-title {
    font-size: 8px;
    color: #3a5a70;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 8px 10px 4px;
    font-weight: 700;
  }

  .category-list {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .category-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    background: transparent;
    border: 1px solid transparent;
    border-left: 3px solid transparent;
    color: #a0c4d8;
    font-size: 11px;
    cursor: pointer;
    text-align: left;
    transition: all 0.2s ease;
    font-family: 'Courier New', monospace;
  }

  .category-btn:hover {
    background: #0f1c28;
    color: #d0e0f0;
    border-left-color: #2a4a5e;
  }

  .category-btn.active {
    background: #00aaff0a;
    color: #4dc8ff;
    border-left-color: var(--color, #4dc8ff);
    text-shadow: 0 0 6px rgba(0, 170, 255, 0.3);
  }

  .cat-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    flex-shrink: 0;
    font-size: 12px;
    opacity: 0.8;
  }

  .cat-label {
    flex: 1;
    font-size: 10px;
    letter-spacing: 0.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sidebar-divider {
    height: 1px;
    background: #1a2d40;
    margin: 4px 0;
    opacity: 0.5;
  }

  .asset-tool-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px 10px;
  }

  .asset-tool-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    aspect-ratio: 1 / 1;
    padding: 6px;
    background: transparent;
    border: 1px solid #1a2d40;
    color: #5a7a8a;
    font-size: 14px;
    cursor: pointer;
    border-radius: 3px;
    transition: all 0.2s ease;
  }

  .asset-tool-btn:hover {
    background: #0f1c28;
    color: #a0c4d8;
    border-color: #2a4a5e;
  }

  .asset-tool-btn.active {
    background: #00aaff1a;
    color: #4dc8ff;
    border-color: #4dc8ff;
    box-shadow: 0 0 6px rgba(77, 200, 255, 0.2);
  }

  .tool-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
  }
</style>
