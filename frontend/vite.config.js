import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  build: {
    // maplibre-gl alone is ~1MB minified; the warning is expected and benign.
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Long-term-cacheable vendor chunks: app code changes every deploy,
          // these don't. three.js is already split automatically by the
          // dynamic import of PoleLayers.js in mapTools.js.
          if (id.includes('node_modules/maplibre-gl')) return 'maplibre';
          if (id.includes('node_modules/proj4')) return 'proj4';
        },
      },
    },
  },
})
