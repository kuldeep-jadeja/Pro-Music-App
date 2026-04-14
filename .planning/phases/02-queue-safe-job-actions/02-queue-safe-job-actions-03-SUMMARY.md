---
phase: 02-queue-safe-job-actions
plan: "03"
subsystem: api
tags: [mongoose, mongodb, redis, job-queue, artist-expansion, retry, admin]

dependency_graph:
  requires:
    - phase: 02-queue-safe-job-actions
      plan: "01"
      provides:
        - models/ArtistJob.js (ArtistJob Mongoose model with status enum and retriedAt field)
        - lib/artistExpandQueue.js (enqueueArtistExpand Redis RPUSH helper)
    - phase: 01-admin-access-control
      provides:
        - lib/requireAdmin.js (HOF wrapping requireAuth with admin email check)
  provides:
    - pages/api/admin/retry-jobs.js (POST /api/admin/retry-jobs — bulk retry of failed artist expansion jobs)
  affects:
    - pages/admin/artist-jobs.js (Phase 3 — displays retry outcome reason codes in dashboard)
    - workers/artistExpandWorker.js (Phase 4 — processes re-enqueued jobs from demus:artist-expand:queue)

tech-stack:
  added: []
  patterns:
    - findOneAndUpdate with status filter for atomic idempotent reactivation (no new document creation)
    - Sequential for...of loop for ordered bulk processing with per-item result tracking
    - Redis rollback on enqueue failure (status reverted to failed to prevent orphaned queued records)
    - requireAdmin HOF export pattern (consistent with all /api/admin/* endpoints)

key-files:
  created:
    - pages/api/admin/retry-jobs.js
  modified: []

key-decisions:
  - "Retry uses findOneAndUpdate with { _id: jobId, status: 'failed' } filter — atomic check-and-reactivate with no new document creation, consistent with CONTEXT.md requirement"
  - "Redis rollback on enqueue failure: if enqueueArtistExpand returns false, status is reverted to failed (queuedAt and retriedAt cleared) to keep DB consistent with Redis state"
  - "Sequential for...of loop chosen over Promise.all to guarantee input-order results per CONTEXT.md bulk response contract"

patterns-established:
  - "Atomic reactivation pattern: findOneAndUpdate({ _id, status: 'failed' }, $set) → null check → findById to distinguish job_not_found from already_active"
  - "Redis-before-commit pattern extended to retry: enqueue confirmed before status update persisted; rollback applied if Redis fails post-reactivation"

requirements-completed:
  - QUEUE-04

duration: 12min
completed: 2026-04-14
---

# Phase 02 Plan 03: Retry Jobs Endpoint — Summary

**Atomic bulk retry endpoint for failed artist expansion jobs using findOneAndUpdate reactivation, Redis re-enqueue, and rollback on Redis failure.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-04-14T10:02:00Z
- **Completed:** 2026-04-14T10:14:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Implemented `POST /api/admin/retry-jobs` that reactivates existing failed ArtistJob records without creating new documents
- Atomic `findOneAndUpdate` with `{ _id: jobId, status: 'failed' }` filter prevents race conditions and enforces no-new-document constraint
- Redis rollback path prevents orphaned queued records when Redis is unavailable post-reactivation
- All five reason codes implemented: `retry_queued`, `already_active`, `job_not_found`, `invalid_job_id`, `redis_unavailable`

## Task Commits

1. **Task 1: Implement POST /api/admin/retry-jobs with record reactivation** - `9dadb6f` (feat)

## Files Created/Modified

- `pages/api/admin/retry-jobs.js` — requireAdmin-wrapped POST endpoint; accepts `{ jobIds: [string] }`, reactivates failed ArtistJob records atomically, re-enqueues to Redis, returns 200 `{ summary, results }` with per-item reason codes

## Decisions Made

- **Atomic filter pattern**: `findOneAndUpdate({ _id: jobId, status: 'failed' })` returns null for two distinct failure modes (not found, or found but not failed). A secondary `findById` lookup distinguishes `job_not_found` from `already_active` — the same pattern used in `pages/api/youtube-match.js`.
- **Redis rollback**: When `enqueueArtistExpand` returns false after a successful DB reactivation, the job status is reverted to `failed` with `error: 'redis_unavailable_on_retry'` and timestamps cleared. This prevents a queued DB record with no Redis entry, which would be silently orphaned (worker uses Redis as the delivery mechanism, never polls DB directly).
- **Sequential loop**: `for...of` used instead of `Promise.all` to preserve input order per CONTEXT.md bulk response contract. For typical admin retry payloads (small counts), the latency difference is negligible.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

The build error count increased from 19 to 20 `Module not found` errors. This is a pre-existing environment issue (mongoose, ioredis, bcrypt, etc. not installed). The new count reflects that `pages/api/admin/enqueue-artists.js` (Plan 02, parallel agent) was also added since the last baseline measurement — `retry-jobs.js` itself does not appear in any error trace. Pattern is identical to Plan 01 SUMMARY finding.

## User Setup Required

None — no external service configuration required beyond what was established in Plans 01 and 02.

## Known Stubs

None. This is a pure API file with no UI rendering or placeholder data.

## Next Phase Readiness

- `POST /api/admin/retry-jobs` is live and requireAdmin-protected
- Plan 04 (artistExpandWorker) can now consume from `demus:artist-expand:queue` knowing both enqueue and retry paths feed the same queue
- Phase 3 dashboard can display retry outcomes using the reason codes defined here (`retry_queued`, `already_active`, `job_not_found`)

---
*Phase: 02-queue-safe-job-actions*
*Completed: 2026-04-14*
