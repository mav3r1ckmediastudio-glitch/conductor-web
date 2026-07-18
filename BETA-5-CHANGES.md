# Conductor Web v0.1.0-beta.5

## Personal-plan access-gate hotfix

- Replaced the unsupported Netlify custom `Basic-Auth` header with a
  fail-closed Edge Function that protects every deployed path on Netlify
  Personal.
- Reuses `NETLIFY_BASIC_AUTH_CREDENTIALS` from Netlify's secret store; no
  credentials are committed or bundled into the browser app.
- Added automated coverage for missing, malformed, wrong, and valid
  credentials, including multiple configured users and cache prevention.

## Radial-wheel focus-ring hotfix

- Removed Chrome's rectangular native SVG focus outline after a tool wedge is
  clicked.
- Preserved keyboard accessibility with a deliberate focus highlight that
  follows the wedge or hub instead of drawing a white bounding box.

## Splitter-output port consistency fix

An explicitly selected `SPLITTER_OUTPUT` port is now the canonical input to the
logical Stage-1 cascade allocator. The same port is carried through all three
representations:

1. segment `splitter_port`;
2. logical `SPLITTER_OUTPUT` assignment `port`;
3. downstream splitter/CBT `feeder_port` after assignment write-back.

The allocator follows each classified optical branch to its first downstream
splitter/CBT, so it cannot associate an output with a more distant splitter
through another splitter.

New fail-closed checks reject:

- an output branch that reaches no downstream splitter/CBT;
- an output branch that reaches multiple next splitters;
- multiple optical outputs claiming the same downstream splitter;
- any disagreement between the classified segment port and logical allocation;
- a selected port that conflicts with an `INSTALLED` or `LIVE` child's stored
  `feeder_port` (the frozen asset is never moved silently).

For a `PROPOSED` child with an old `feeder_port`, the explicitly classified
segment port wins and is written back on successful assignment.

## Verification

- `npm test`: 337 passing tests across 24 test files.
- Production build: 347 modules transformed successfully.
- Exact regression: selecting port 3 produces segment port 3, logical output
  port 3, child feeder port 3, and a `VALIDATED` physical plan.
- The build still reports the two pre-existing unused CSS selector warnings in
  `PIADropForm.svelte`; these are unrelated to planning correctness.
