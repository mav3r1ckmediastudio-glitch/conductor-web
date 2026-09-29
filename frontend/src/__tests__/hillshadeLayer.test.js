import { describe, it, expect, vi } from 'vitest';
import { ensureHillshadeLayer, setHillshadeVisible, HILLSHADE_LAYER_ID } from '../mapLayers.js';

// Minimal MapLibre stand-in: only what the hillshade helpers touch.
function fakeMap({ hasTerrain = true, hasAnchor = true } = {}) {
  const layers = new Map();
  return {
    layers,
    getSource: (id) => (id === 'terrain' && hasTerrain ? {} : undefined),
    getLayer: (id) => layers.get(id) ?? (id === 'addresses-clusters' && hasAnchor ? {} : undefined),
    addLayer: vi.fn((spec, before) => layers.set(spec.id, { spec, before })),
    setLayoutProperty: vi.fn((id, k, v) => { layers.get(id).spec.layout[k] = v; }),
  };
}

describe('hillshade layer', () => {
  it('is added hidden by default, beneath our first custom layer', () => {
    const m = fakeMap();
    ensureHillshadeLayer(m);
    const l = m.layers.get(HILLSHADE_LAYER_ID);
    expect(l.spec.layout.visibility).toBe('none');
    expect(l.spec.source).toBe('terrain');
    expect(l.before).toBe('addresses-clusters');
  });

  it('restores visibility after a basemap-switch rebuild', () => {
    const m = fakeMap();
    ensureHillshadeLayer(m, true);
    expect(m.layers.get(HILLSHADE_LAYER_ID).spec.layout.visibility).toBe('visible');
  });

  it('does nothing without a terrain source (no key / test mode)', () => {
    const m = fakeMap({ hasTerrain: false });
    ensureHillshadeLayer(m, true);
    expect(m.addLayer).not.toHaveBeenCalled();
  });

  it('is idempotent and toggles visibility', () => {
    const m = fakeMap();
    ensureHillshadeLayer(m); ensureHillshadeLayer(m);
    expect(m.addLayer).toHaveBeenCalledTimes(1);
    setHillshadeVisible(m, true);
    expect(m.layers.get(HILLSHADE_LAYER_ID).spec.layout.visibility).toBe('visible');
    setHillshadeVisible(m, false);
    expect(m.layers.get(HILLSHADE_LAYER_ID).spec.layout.visibility).toBe('none');
  });
});
