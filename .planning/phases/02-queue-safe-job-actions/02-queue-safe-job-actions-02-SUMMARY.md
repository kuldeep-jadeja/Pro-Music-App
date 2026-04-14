---
phase: 02-queue-safe-job-actions
plan: "02"
subsystem: api-layer
tags: [next-js, api-route, mongoose, redis, idempotency, bulk-enqueue, admin]
dependency_graph:
  requires:
    - models/ArtistJob.js (Plan 01 — Mongoose model with unique index on artistSpotifyId)
    - lib/artistExpandQueue.js (Plan 01 — Redis RPUSH helper returning boolean)
    - lib/requireAdmin.js (Phase 1 — admin authorization HOF)
    - lib/mongodb.js (existing — connectDB helper)
  provides:
    - pages/api/admin/enqueue-artists.js (POST /api/admin/enqueue-artists — idempotent bulk enqueue)
  affects:
    - pages/admin/artist-jobs.js (Phase 3 — dashboard will display job state written by this endpoint)
    - workers/artistExpandWorker.js (Plan 04 — consumes jobs enqueued to demus:artist-expand:queue)
tech_stack:
  added: []
  patterns:
    - requireAdmin HOF wrapping (consistent with access-check.js)
    - findOneAndUpdate two-step atomic guard (mirrors import-playlist.js idempotency pattern)
    - Sequential for...of loop with Set-based within-payload dedup (input order preservation per QUEUE-03)
    - Redis-first enqueue before DB write (avoids orphaned queued records on Redis unavailability)
    - E11000 duplicate key catch treated as already_active (concurrent upsert race handling)
    - HTTP 200 for all mixed-result bulk responses (per CONTEXT.md)
key_files:
  created:
    - pages/api/admin/enqueue-artists.js
  modified: []
decisions:
  - Redis-first ordering — enqueueArtistExpand called before ArtistJob upsert to prevent orphaned queued records when Redis is down (Pitfall 5 from RESEARCH.md)
  - Done re-enqueue allowed — artists in done status pass the active-job check ($nin queued/running) and are re-activated to queued; consistent with admin explicitly wanting re-expansion
  - E11000 race treated as already_active — concurrent upsert races that slip through the application-level check are caught at DB level and returned as skipped
  - HTTP 200 always — mixed-result bulk responses never use 4xx/5xx; malformed request body returns 400, non-POST returns 405
metrics:
  duration_seconds: 480
  completed_date: "2026-04-14"
  tasks_completed: 1
  tasks_total: 1
  files_created: 1
  files_modified: 0
requirements_satisfied:
  - QUEUE-02
  - QUEUE-03
---

# Phase 02 Plan 02: POST /api/admin/enqueue-artists — Summary

**One-liner:** Idempotent bulk artist enqueue endpoint with sequential per-item processing, two-step MongoDB atomic guard, Redis-first ordering, and HTTP 200 mixed-result response.

## What Was Built

**`pages/api/admin/enqueue-artists.js`** — A `requireAdmin`-wrapped Next.js POST API handler that implements the full idempotent bulk enqueue flow:

1. **Method guard** — 405 for non-POST requests.
2. **Body validation** — 400 if `artists` is absent, not an array, or empty.
3. **Sequential `for...of` loop** — preserves input order per QUEUE-03 (no `Promise.all`).
4. **Step 1: Field validation** — artists without `spotifyId` return `failed/missing_artist_id` immediately.
5. **Step 2: Within-payload dedup** — `Set`-based first-occurrence wins; subsequent same-ID items return `skipped/already_active`.
6. **Step 3: Atomic active-job guard** — `findOneAndUpdate` with `status: { $in: ['queued', 'running'] }` returns existing active job or null; if active job found, returns `skipped/already_active`.
7. **Step 4: Redis enqueue first** — `enqueueArtistExpand` called before any DB write; if Redis returns `false`, returns `failed/redis_unavailable` without persisting queued state.
8. **Step 5: ArtistJob upsert** — `findOneAndUpdate` with `status: { $nin: ['queued', 'running'] }` and `upsert: true`; `$setOnInsert` for `artistName`; `E11000` caught and returned as `skipped/already_active`.
9. **Summary counts** — computed after loop; always returns `{ summary: { total, queued, skipped, failed }, results: [...] }`.
10. **HTTP 200 always** — per CONTEXT.md mixed-result behavior contract.

## Tasks

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Implement POST /api/admin/enqueue-artists with idempotent bulk enqueue | `c112908` | pages/api/admin/enqueue-artists.js |

## Verification Results

- `grep -n "requireAdmin" pages/api/admin/enqueue-artists.js` — lines 1 (import) and 161 (export)
- `grep -n "findOneAndUpdate" pages/api/admin/enqueue-artists.js` — lines 75 and 114 (2 matches: active guard + upsert)
- `grep -n "status.*\$in.*queued.*running"` — line 76: active-job filter confirmed
- `grep -n "11000"` — line 129: E11000 concurrent race catch confirmed
- `grep -n "redis_unavailable"` — lines 27 and 103: reason code confirmed
- `grep -n "missing_artist_id"` — lines 26 and 56: reason code confirmed
- `grep -n "already_active"` — lines 25, 67, 85, 136: at least 3 matches (field validation comment, within-payload dedup, active-job guard, E11000 catch)
- `grep -n "Promise.all"` — no matches (sequential loop confirmed)
- `grep -n "summary"` — line 158: summary in response confirmed
- `npm run build` — 20 errors, all pre-existing module-not-found for absent dev environment packages (bcrypt, cookie, ioredis, yt-search, etc.). Same baseline as Plan 01. enqueue-artists.js introduces no new errors.

## Deviations from Plan

None — plan executed exactly as written. The file was found already committed at `c112908` from a prior partial execution. All acceptance criteria were verified against the committed file. SUMMARY.md, STATE.md, and ROADMAP.md were not yet created, so this execution completes those artifacts.

## Known Stubs

None. The endpoint is fully wired: imports ArtistJob model, imports enqueueArtistExpand, calls connectDB, processes real input, returns real per-item outcomes. No placeholder data flows to any consumer.

## Self-Check: PASSED

- `pages/api/admin/enqueue-artists.js` — file exists at expected path
- Commit `c112908` — confirmed in git log as `feat(02-02): implement POST /api/admin/enqueue-artists idempotent bulk enqueue`
- All acceptance criteria grep checks pass (verified above)
