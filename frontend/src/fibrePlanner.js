// fibrePlanner.js — Two-pass orchestration for the demand-driven physical
// fibre planner (remediation spec §7). Composes the four pure modules:
//   buildFibreNetwork → computeDemand → allocatePhysicalFibres → validatePhysicalPlan
//
// Returns a single result the orchestrator (fibreAssign.js) and tests consume.
// A plan is only 'VALIDATED' when the graph is unambiguous, demand is within
// capacity, allocation succeeded, and every mandatory invariant passed. Any
// failure yields status 'INVALID' (or 'UNVERIFIED' when there is no POP to plan
// from) and the records must NOT be treated as authoritative.

import { buildFibreNetwork } from './fibreNetwork.js';
import { computeDemand, CapacityError } from './fibreDemand.js';
import { allocatePhysicalFibres, PROFILE_COLOUR_PRESERVING } from './fibrePhysicalPlan.js';
import { validatePhysicalPlan } from './fibrePlanValidation.js';

export function planPhysicalFibres(store, opts = {}) {
  const profile = opts.profile || PROFILE_COLOUR_PRESERVING;
  const network = buildFibreNetwork(store);
  if (!network.root) {
    return { ok: false, status: 'UNVERIFIED', records: [], errors: network.errors, reason: 'No POP placed.' };
  }

  let demand;
  try {
    demand = computeDemand(network);
  } catch (e) {
    if (e instanceof CapacityError) {
      // Hard capacity failure — no partial authoritative plan is produced.
      return { ok: false, status: 'INVALID', records: [], capacityError: e,
        errors: [...network.errors, { code: 'CAPACITY', message: e.message, id: e.edgeId }], network };
    }
    throw e;
  }

  const alloc = allocatePhysicalFibres(network, demand, { profile, existingAssignments: opts.existingAssignments });
  const validation = validatePhysicalPlan(network, demand, alloc.records);

  const errors = [...network.errors, ...demand.errors, ...alloc.errors, ...validation.errors];
  const ok = errors.length === 0;
  return {
    ok,
    status: ok ? 'VALIDATED' : 'INVALID',
    profile,
    records: alloc.records,
    errors,
    network, demand, validation,
  };
}
