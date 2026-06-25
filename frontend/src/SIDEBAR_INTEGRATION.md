## Conductor Web: Sidebar & RadialWheel Integration Guide

### Components Created

**1. RadialWheel.svelte** — Animated radial tool selector
- 108px hub (always visible, never re-renders)
- 6 spokes with endpoint buttons (animate in/out)
- Emits `tool-selected` event with `{toolId, label}`
- CSS animations: 50ms stagger, cubic-bezier easing
- Colors: `#4dc8ff` base, `#00aaff` glow

**2. Sidebar.svelte** — 140px wide category/asset navigator
- 4 categories: Civil, Fibre, Aerial & Poles, PIA UG
- 3 asset tools: Edit, Delete, Move
- Active state: left border + cyan glow
- Emits `category-selected` and `asset-tool-selected` events

---

## How to integrate into App.svelte

### Step 1: Import components (top of script)
```svelte
<script>
  // ... existing imports
  import RadialWheel from './RadialWheel.svelte';
  import Sidebar from './Sidebar.svelte';

  // Track active tools
  let activeTool = null;
  let activeCategory = null;

  // Listen for tool selections
  const handleToolSelected = (e) => {
    activeTool = e.detail.toolId;
    console.log('Tool selected:', e.detail);
    // Wire to MapLibre draw mode binding here
  };

  const handleCategorySelected = (e) => {
    activeCategory = e.detail.categoryId;
    console.log('Category selected:', e.detail);
  };

  onMount(() => {
    // ... existing MapLibre setup
    
    // Wire custom events
    window.addEventListener('tool-selected', handleToolSelected);
    window.addEventListener('category-selected', handleCategorySelected);

    return () => {
      window.removeEventListener('tool-selected', handleToolSelected);
      window.removeEventListener('category-selected', handleCategorySelected);
    };
  });
</script>
```

### Step 2: Add components to layout

**Option A: Float RadialWheel on map, Sidebar as left panel**
```svelte
<div id="app">
  <nav id="topbar">
    <!-- ... existing topbar -->
  </nav>

  <div id="main">
    <RadialWheel />
    
    <Sidebar />

    <aside id="left-panel">
      <!-- ... existing metrics, tool groups -->
    </aside>

    <div id="center">
      <!-- ... map + bottom panel -->
    </div>

    <aside id="right-panel">
      <!-- ... validation summary -->
    </aside>
  </div>
</div>
```

**Option B: Sidebar integrated into left-panel (recommended)**
```svelte
<aside id="left-panel">
  <Sidebar />
  <div class="left-panel-content">
    <div class="project-header">
      <!-- ... existing -->
    </div>
    <!-- ... rest of left panel -->
  </div>
</aside>
```

### Step 3: Update left-panel CSS (if using Option B)

```css
#left-panel {
  display: flex;
  width: auto; /* Was fixed width before */
  overflow: hidden;
}

#left-panel Sidebar {
  flex-shrink: 0;
}

.left-panel-content {
  width: 300px; /* Adjust as needed */
  overflow-y: auto;
  flex: 1;
}
```

---

## Design Specifications Locked

### RadialWheel
- Hub: IR=44, OR=108, CX=0, CY=OR
- Fans rightward from left edge
- Open animation: top→bottom staggered 50ms, `cubic-bezier(0.34,1.4,0.64,1)`
- Close animation: bottom→top staggered 50ms, `cubic-bezier(0.4,0,0.64,-0.4)`
- Hub shows `‹` when open, `›` when closed
- Colors: `#4dc8ff` base, `#00aaff` glow, NO green/teal elsewhere

### Sidebar
- Width: 140px
- Background: `#0d1117`
- Border: `#1a2d40`
- Active state: `background:#00aaff0a; border-left-color:#4dc8ff; text-shadow:0 0 6px #00aaff33`
- Hover: `background:#0f1c28; color:#a0c4d8; border-left-color:#2a4a5e`
- Font: Courier New monospace

---

## Event Flow

1. User clicks RadialWheel spoke
2. RadialWheel emits `tool-selected` → MapLibre draw mode binding
3. User clicks Sidebar category
4. Sidebar emits `category-selected` → Filter tools shown in main panel
5. User clicks asset tool (Edit/Delete/Move)
6. Sidebar emits `asset-tool-selected` → Enable corresponding asset actions

---

## Next Steps

1. ✅ RadialWheel.svelte created
2. ✅ Sidebar.svelte created
3. → Import both into App.svelte
4. → Wire events to MapLibre draw modes
5. → Replace Unicode icons with SVG icon set (when ready)
6. → Connect FastAPI backend stage gating

All components use CSS variables and follow the navy + cyan color scheme. No breaking changes to existing components.
