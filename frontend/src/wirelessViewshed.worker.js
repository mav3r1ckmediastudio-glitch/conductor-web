// wirelessViewshed.worker.js — thin Worker wrapper around the pure coverage
// core, so the UI thread stays responsive. All logic lives (and is tested) in
// wirelessViewshedCore.js; this file only moves messages.
import { computeSectorCoverage } from './wirelessViewshedCore.js';

self.onmessage = (e) => {
  const { jobId, params } = e.data;
  try {
    const result = computeSectorCoverage(params);
    self.postMessage({ jobId, ok: true, result }, [result.rxDbm.buffer]);
  } catch (err) {
    self.postMessage({ jobId, ok: false, error: String(err?.message || err) });
  }
};
