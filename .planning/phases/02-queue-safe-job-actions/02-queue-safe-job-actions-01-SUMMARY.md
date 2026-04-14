---
phase: 02-queue-safe-job-actions
plan: "01"
subsystem: data-layer
tags: [mongoose, mongodb, redis, job-queue, artist-expansion]
dependency_graph:
  requires: []
  provides:
    - models/ArtistJob.js (ArtistJob Mongoose model — per-artist job state store)
    - lib/artistExpandQueue.js (enqueueArtistExpand helper — Redis RPUSH to demus:artist-expand:queue)
  affects:
    - pages/api/admin/enqueue-artists.js (Plan 02 — imports both artifacts)
    - pages/api/admin/retry-jobs.js (Plan 03 — imports ArtistJob model)
    - workers/artistExpandWorker.js (Plan 04 — consumes from demus:artist-expand:queue)
    - pages/admin/artist-jobs.js (Phase 3 — queries ArtistJob collection)
tech_stack:
  added: []
  patterns:
    - mongoose.models.ArtistJob guard (hot-reload safe model registration)
    - getRedis() singleton null-check pattern (mirrors redisQueue.js and metadataQueue.js)
    - isDev guard on warn-level logs (consistent with all queue helpers in codebase)
key_files:
  created:
    - models/ArtistJob.js
    - lib/artistExpandQueue.js
  modified: []
decisions:
  - ArtistJob uses unique index on artistSpotifyId (DB-level idempotency enforcement — callers must catch E11000 and treat as already_active)
  - Six timestamp fields (queuedAt, startedAt, completedAt, retriedAt + timestamps:true createdAt/updatedAt) to support Phase 3 dashboard queries
  - retriedAt distinct from queuedAt so retry events are distinguishable in the dashboard
  - enqueueArtistExpand uses demus:artist-expand:queue — isolated from ytmatch and metadata queues per SYNC-01 worker isolation requirement
metrics:
  duration_seconds: 226
  completed_date: "2026-04-14"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 0
requirements_satisfied:
  - QUEUE-02
  - QUEUE-03
  - QUEUE-04
  - SYNC-01
---

# Phase 02 Plan 01: ArtistJob Model and Artist Expand Queue — Summary

**One-liner:** Mongoose ArtistJob model with DB-level unique constraint on artistSpotifyId plus Redis RPUSH helper for the isolated `demus:artist-expand:queue`.

## What Was Built

Two foundational artifacts that all Phase 2 action endpoints (Plans 02 and 03) depend on:

1. **`models/ArtistJob.js`** — Mongoose model for tracking per-artist expansion job state across requests. Enforces one document per artist via a unique index on `artistSpotifyId`. Status enum (`queued`, `running`, `done`, `failed`) supports the Phase 3 admin dashboard. Six timestamp fields (plus `timestamps: true` for automatic `createdAt`/`updatedAt`) give the dashboard full operational visibility.

2. **`lib/artistExpandQueue.js`** — Redis RPUSH helper that is a direct structural mirror of `lib/redisQueue.js`. Exports `ARTIST_EXPAND_QUEUE_KEY = 'demus:artist-expand:queue'` (distinct from `demus:ytmatch:queue` and `demus:metadata:queue` for worker isolation per SYNC-01). The `enqueueArtistExpand(job)` function returns a boolean and never throws, matching the null-safe `getRedis()` contract used throughout the codebase.

## Tasks

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Create ArtistJob Mongoose model | `16b8eb1` | models/ArtistJob.js |
| 2 | Create artistExpandQueue Redis helper | `6f00a1b` | lib/artistExpandQueue.js |

## Verification Results

- `grep -n "unique: true" models/ArtistJob.js` — line 34: `unique: true` on `artistSpotifyId`
- `grep -n "enum:" models/ArtistJob.js` — line 47: `['queued', 'running', 'done', 'failed']`
- `grep -n "timestamps: true" models/ArtistJob.js` — line 73: confirmed
- `grep -n "mongoose.models.ArtistJob" models/ArtistJob.js` — line 76: export guard confirmed
- `grep -n "retriedAt" models/ArtistJob.js` — line 71: confirmed
- `grep -n "ARTIST_EXPAND_QUEUE_KEY" lib/artistExpandQueue.js` — line 26: `'demus:artist-expand:queue'`
- `grep -n "demus:ytmatch:queue" lib/artistExpandQueue.js` — no matches (queues isolated)
- `grep -n "return false" lib/artistExpandQueue.js` — lines 44, 59 (null redis + catch)
- `npm run build` — 19 pre-existing errors (missing npm packages in dev environment), identical to baseline before this plan. No new errors introduced. Both new files import only existing dependencies (`mongoose`, `@/lib/redis`).

## Deviations from Plan

None — plan executed exactly as written.

The `npm run build` failure is a pre-existing environment issue (19 module-not-found errors for `bcrypt`, `cookie`, `ioredis`, `yt-search`, etc. that were present before this plan). Verified by stashing changes and confirming the same 19 errors. Neither `models/ArtistJob.js` (imports only `mongoose`) nor `lib/artistExpandQueue.js` (imports only `@/lib/redis`) introduces any new errors.

## Known Stubs

None. These are pure model/helper files with no UI rendering or placeholder data.

## Self-Check: PASSED

- `models/ArtistJob.js` — file exists at expected path
- `lib/artistExpandQueue.js` — file exists at expected path
- Commit `16b8eb1` — confirmed in git log
- Commit `6f00a1b` — confirmed in git log
