import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// Stamped into saved project files (see projectSchema.js's stampVersion()) as
// `appVersion`, and available to any component that wants to display it (e.g. an
// About screen). package.json is the single source of truth for the semver.
const projectDir = fileURLToPath(new URL('.', import.meta.url))
const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
)

// SemVer build metadata (the part after '+'). Only [0-9A-Za-z.-] is legal there,
// so everything is passed through cleanId().
function cleanId(value) {
  return String(value).trim().replace(/[^0-9A-Za-z.-]/g, '').slice(0, 20)
}

// Build identifier, in priority order:
//   1. An explicit ID from the deployment pipeline (CONDUCTOR_BUILD_ID), with
//      Netlify's COMMIT_REF and GitHub's GITHUB_SHA accepted as secondary CI
//      sources. Official builds MUST come from here so the stamp is trustworthy.
//   2. Local git — a *developer convenience only*. execFileSync (no shell) and
//      scoped to projectDir. NB: git still searches upward, so a folder built
//      inside an unrelated parent repo would report that repo's commit — which
//      is exactly why pipeline builds set CONDUCTOR_BUILD_ID and never rely on
//      this branch.
//   3. Timestamp fallback with UTC time (not date-only), so two builds on the
//      same day are still distinguishable. Prefixed `local.` to make its origin
//      obvious and to signal it is not a release identifier.
function buildId() {
  const supplied =
    process.env.CONDUCTOR_BUILD_ID ||
    process.env.COMMIT_REF ||
    process.env.GITHUB_SHA
  if (supplied) {
    const cleaned = cleanId(supplied)
    // A supplied id made only of illegal chars sanitises to '' — do NOT emit an
    // empty build id (it would leave a trailing '+' in APP_VERSION). Fall through
    // to git/timestamp so the identifier is always present and valid.
    if (cleaned) return cleaned
  }
  try {
    const sha = execFileSync(
      'git',
      ['rev-parse', '--short=12', 'HEAD'],
      { cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    )
    const cleaned = cleanId(sha)
    if (cleaned) return cleaned
  } catch {
    // fall through to the timestamp fallback below
  }
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
  return `local.${stamp}`
}
const APP_VERSION = `${pkg.version}+${buildId()}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  test: {
    // vitest's default include glob (**/*.{test,spec}.*) would otherwise
    // also pick up tests/e2e/*.spec.js and try to run Playwright specs
    // through vitest's own runner — they import from @playwright/test, not
    // vitest, and crash a worker rather than failing cleanly. Keep the two
    // test runners' file sets disjoint: vitest owns src/__tests__/, npx
    // playwright test owns tests/e2e/.
    exclude: ['**/node_modules/**', 'tests/e2e/**'],
  },
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
