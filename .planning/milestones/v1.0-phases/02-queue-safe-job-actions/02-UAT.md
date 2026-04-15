---
status: testing
phase: 02-queue-safe-job-actions
source:
  - .planning/phases/02-queue-safe-job-actions/02-queue-safe-job-actions-01-SUMMARY.md
  - .planning/phases/02-queue-safe-job-actions/02-queue-safe-job-actions-02-SUMMARY.md
  - .planning/phases/02-queue-safe-job-actions/02-queue-safe-job-actions-03-SUMMARY.md
  - .planning/phases/02-queue-safe-job-actions/02-queue-safe-job-actions-04-SUMMARY.md
started: 2026-04-14T11:29:40.664Z
updated: 2026-04-14T11:29:40.664Z
---

## Current Test

number: 1
name: Bulk enqueue returns ordered mixed outcomes
expected: |
  Call POST /api/admin/enqueue-artists as admin with a payload containing:
  1) one valid artist with spotifyId,
  2) the same spotifyId again in the same request,
  3) one item missing spotifyId.
  Expected behavior:
  - HTTP 200 response.
  - response has summary counts and per-item results.
  - per-item results preserve input order.
  - first item -> queued (reason: queued)
  - second item -> skipped (reason: already_active)
  - third item -> failed (reason: missing_artist_id)
awaiting: user response

## Tests

### 1. Bulk enqueue returns ordered mixed outcomes
expected: HTTP 200 with summary + per-item results in input order, with reason codes queued/already_active/missing_artist_id for mixed payload.
result: pending

### 2. Repeated enqueue request is idempotent for active jobs
expected: Submitting the same valid artist again while it is queued or running does not create another active job and returns skipped with reason already_active.
result: pending

### 3. Retry endpoint requeues only failed jobs with per-item reason codes
expected: POST /api/admin/retry-jobs with mixed IDs returns HTTP 200 and per-item results where failed job -> retry_queued, active job -> already_active, unknown ID -> job_not_found.
result: pending

### 4. Worker consumes artist-expand queue and updates job lifecycle
expected: Running the artist expansion worker and queueing a job transitions status queued -> running -> done (or failed with error), showing processing happened through queue-driven worker flow.
result: pending

### 5. Queue-safe actions remain admin-protected
expected: Non-admin/unauthenticated calls to /api/admin/enqueue-artists and /api/admin/retry-jobs are blocked (401/403), while admin can use both endpoints.
result: pending

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0

## Gaps

none yet
