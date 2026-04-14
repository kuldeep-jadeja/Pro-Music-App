# Features Research: Admin Artist Expansion Controls

**Date:** 2026-04-14

## Table Stakes

- Admin-only access guard on page and API
- Artist expansion job list with filters (`queued`, `running`, `done`, `failed`)
- Multi-select with bulk enqueue action
- Idempotent enqueue / dedupe
- Retry failed jobs with visible error context

## Differentiators

- Bulk action progress summary (queued/skipped/failed)
- Queue health cards (depth, lag, worker heartbeat)
- Saved filter presets

## Anti-Features

- “Expand all artists” one-click global action
- Direct worker execution from UI/API request lifecycle
- Unbounded bulk submission without limits

## Dependency Notes

- Admin auth guard must land before any admin write endpoint.
- Job state model must exist before dashboard filtering is meaningful.
- Dedupe logic must exist before bulk enqueue goes live.
