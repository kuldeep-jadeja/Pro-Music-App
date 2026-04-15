---
phase: 04-worker-coexistence-hardening
plan: 01
subsystem: testing
tags: [workers, redis, smoke-tests, cli, coexistence]
requires:
  - phase: 02-queue-safe-job-actions
    provides: queue isolation keys and enqueue/retry semantics
  - phase: 03-admin-expansion-dashboard
    provides: admin enqueue/retry operational flows
provides:
  - Coexistence contract constants for workers, queues, flows, and blocking regressions
  - Smoke CLI checks for queue isolation, user-flow coverage, and regression report validation
  - Before/during/after coexistence matrix runner with machine-readable evidence output
affects: [04-02-PLAN, SYNC-02, UAT]
tech-stack:
  added: []
  patterns: [contract-driven source scanning, operator-run matrix evidence]
key-files:
  created:
    - lib/admin/workerCoexistenceContract.js
    - tests/worker-coexistence.smoke.js
    - tests/worker-coexistence-matrix.contract.test.js
    - scripts/workerCoexistenceMatrix.js
  modified: []
key-decisions:
  - "Keep validation tooling dependency-free (Node built-ins only) for repeatable operator use."
  - "Treat overlap regressions as explicit blocking codes consumed from shared contract constants."
patterns-established:
  - "Coexistence checks are contract-backed CLIs, not ad-hoc log inspection."
  - "Matrix evidence is structured as baseline/overlap/recovery plus regression codes."
requirements-completed: [SYNC-02]
duration: 2min
completed: 2026-04-15
---

# Phase 4 Plan 1: Worker Coexistence Hardening Summary

**Contract-backed smoke checks and a three-stage coexistence matrix runner now produce repeatable SYNC-02 evidence.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-15T10:53:41+05:30
- **Completed:** 2026-04-15T10:55:10+05:30
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added `workerCoexistenceContract` as single source of truth for workers, queue keys, core endpoints, and blocking regression codes.
- Implemented `tests/worker-coexistence.smoke.js` CLI for deterministic `queue-isolation`, `user-flows`, and `overlap-regressions` checks.
- Implemented `scripts/workerCoexistenceMatrix.js` CLI with fixed baseline/overlap/recovery sequencing, dry-run planning, and JSON evidence reporting.

## Task Commits

1. **Task 1: Define coexistence contracts and implement smoke check CLI**
   - `c3cbd57` test(04-01): add failing coexistence smoke CLI checks
   - `19d0a3b` feat(04-01): codify worker coexistence contract constants
2. **Task 2: Build before/during/after coexistence matrix runner with evidence output**
   - `b985f06` test(04-01): add failing coexistence matrix contract test
   - `3ab798d` feat(04-01): add before-during-after coexistence matrix runner

## Files Created/Modified
- `lib/admin/workerCoexistenceContract.js` - Canonical SYNC-02 worker/queue/flow/regression constants.
- `tests/worker-coexistence.smoke.js` - Contract-validation CLI for queue isolation, flow coverage, and report regression gates.
- `tests/worker-coexistence-matrix.contract.test.js` - TDD contract test for matrix script dry-run and endpoint coverage.
- `scripts/workerCoexistenceMatrix.js` - Operator-run coexistence scenario runner with evidence JSON output.

## Decisions Made
- Used CommonJS exports in coexistence contract to support direct `node` CLI `require()` usage from smoke tooling.
- Kept matrix probes tolerant to auth responses (non-5xx treated as reachable) so coexistence checks focus on flow availability and regressions.

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Wave 0 coexistence harness artifacts are in place for downstream overlap regression validation.
- Ready for plan 04-02 to consume matrix report output via `--check overlap-regressions --report <path>`.

## Self-Check: PASSED
- FOUND: .planning/phases/04-worker-coexistence-hardening/04-worker-coexistence-hardening-01-SUMMARY.md
- FOUND: c3cbd57
- FOUND: 19d0a3b
- FOUND: b985f06
- FOUND: 3ab798d
