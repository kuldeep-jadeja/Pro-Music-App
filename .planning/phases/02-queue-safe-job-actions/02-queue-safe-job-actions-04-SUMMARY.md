---
phase: 02-queue-safe-job-actions
plan: "04"
subsystem: worker
tags: [worker, redis, blpop, mongoose, artist-expansion, queue-consumer, job-lifecycle]
dependency_graph:
  requires:
    - models/ArtistJob.js (Plan 01 — ArtistJob model with status enum queued/running/done/failed)
    - lib/artistExpandQueue.js (Plan 01 — demus:artist-expand:queue key constant)
    - workers/artistCrawler.js (fetchArtistTracks, enrichTracks, upsertTrack logic reused inline)
    - workers/ytMatchWorker.js (architecture template — BLPOP loop, loadEnvLocal, Redis connection pattern)
  provides:
    - workers/artistExpandWorker.js (standalone BLPOP consumer for demus:artist-expand:queue)
  affects:
    - pages/api/admin/enqueue-artists.js (Plan 02 — jobs enqueued here are now consumed by this worker)
    - pages/api/admin/retry-jobs.js (Plan 03 — retried jobs re-enter the queue consumed by this worker)
    - pages/admin/artist-jobs.js (Phase 3 — dashboard reads ArtistJob status written by this worker)
tech_stack:
  added: []
  patterns:
    - CommonJS standalone worker process (no ESM — mirrors ytMatchWorker.js exactly)
    - loadEnvLocal IIFE (parses .env.local when MONGODB_URI env var absent)
    - Redis BLPOP 30-second timeout loop (single consumer, zero CPU busy-wait)
    - ArtistJob findOneAndUpdate status: 'queued' guard on pickup (prevents double-processing)
    - try/catch per-job wrapping (one bad job never crashes the loop)
    - Dynamic import for spotify-url-info (ESM package loaded in CommonJS process)
    - Graceful SIGINT/SIGTERM shutdown (running flag + redis.quit + mongoose.disconnect)
    - enqueueMatchJob outbound rpush to demus:ytmatch:queue (queue isolation — never BLPOP on ytmatch)
key_files:
  created:
    - workers/artistExpandWorker.js
  modified:
    - package.json (added expand:worker script)
decisions:
  - Worker-local schema definitions avoid @/ alias resolution (same pattern as ytMatchWorker.js and artistCrawler.js)
  - BLPOP timeout 30 seconds (matches ytMatchWorker.js — keeps loop responsive to SIGTERM without busy-waiting)
  - Atomic findOneAndUpdate({ status: 'queued' }) on pickup prevents double-processing if two worker instances ever run concurrently
  - ytmatch enqueue capped at 50 per job (mirrors MAX_MATCH_JOBS constant in artistCrawler.js)
  - Queue isolation preserved — BLPOP on artist-expand queue only; ytmatch queue only receives outbound rpush
  - JOB_DELAY_MS = 500ms (shorter than ytMatchWorker's 1000ms — expand jobs are less rate-limited than yt-search)
metrics:
  duration_seconds: 644
  completed_date: "2026-04-14"
  tasks_completed: 1
  tasks_total: 1
  files_created: 1
  files_modified: 1
requirements_satisfied:
  - SYNC-01
---

# Phase 02 Plan 04: artistExpandWorker BLPOP Consumer — Summary

**One-liner:** Standalone CommonJS BLPOP worker consuming `demus:artist-expand:queue`, transitioning ArtistJob through queued → running → done/failed with artistCrawler expansion logic and outbound ytmatch enqueue.

## What Was Built

**`workers/artistExpandWorker.js`** — A CommonJS standalone Node.js process (matching `ytMatchWorker.js` architecture exactly) that closes the SYNC-01 loop: admin-triggered artist expansion jobs enqueued by Plans 02 and 03 are now consumed and processed rather than sitting in Redis indefinitely.

### Architecture

```
Admin API (Plans 02/03)
    ↓ enqueueArtistExpand (RPUSH)
demus:artist-expand:queue (Redis list)
    ↓ BLPOP (30s timeout)
artistExpandWorker.js
    ↓ findOneAndUpdate({ status: 'queued' }) → status: 'running'
    ↓ fetchArtistTracks() — spotify-url-info artist page scrape
    ↓ enrichTracks() — iTunes Tier 1 + MusicBrainz Tier 2
    ↓ upsertTrack() — fingerprint-based MongoDB upsert per track
    ↓ enqueueMatchJob() — RPUSH to demus:ytmatch:queue (max 50)
    ↓ findOneAndUpdate → status: 'done' (or 'failed' on any error)
demus:ytmatch:queue (outbound only — never BLPOP'd by this worker)
    ↓ ytMatchWorker consumes (existing worker, unchanged)
```

### Job Lifecycle (ArtistJob status transitions)

| Event | Transition | Guard |
|-------|-----------|-------|
| Admin enqueues (Plan 02) | → `queued` | upsert with $nin guard |
| Admin retries (Plan 03) | `failed` → `queued` | findOneAndUpdate with status: 'failed' filter |
| Worker picks up job | `queued` → `running` | findOneAndUpdate({ status: 'queued' }) — skips if not queued |
| Expansion completes | `running` → `done` | unconditional update with completedAt |
| Any error in processing | `running` → `failed` | catch block sets error message + completedAt |

### Functions Copied from artistCrawler.js

The worker inlines the per-artist expansion logic to avoid import path issues in the standalone CommonJS process:

- `parseArtists(input)` — normalise Spotify artist shapes to string array
- `extractImage(data)` — extract best album image URL from Spotify response
- `parseApiTrack(t)` — parse Format B (API-like) track shape
- `parseEmbedTrack(t)` — parse Format A (embed trackList) track shape
- `fetchArtistTracks(artistId, getData)` — fetch artist top tracks from Spotify artist page
- `cleanTrackName(name)` — strip feat./version suffixes before iTunes queries
- `fetchFromItunes(track)` — Tier 1 metadata enrichment (5 concurrent, 300ms batches)
- `fetchFromMusicBrainz(track)` — Tier 2 metadata enrichment (serialised, 1100ms apart)
- `enrichTracks(tracks, tag)` — orchestrates Tier 1 + Tier 2 enrichment pipeline
- `generateFingerprint(name, artists)` — deterministic dedup key (mirrors lib/trackFingerprint.js)
- `upsertTrack(track)` — fingerprint-based MongoDB upsert with backfill for existing tracks
- `enqueueMatchJob(redis, job)` — RPUSH outbound helper for demus:ytmatch:queue (returns boolean)

### Queue Isolation (SYNC-01)

- BLPOP: `demus:artist-expand:queue` only — never `demus:ytmatch:queue`
- Outbound RPUSH: `demus:ytmatch:queue` — delegated to `ytMatchWorker.js`
- This worker does not interfere with YouTube matching; it only discovers which tracks need matching

## Tasks

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Create artistExpandWorker.js BLPOP consumer + expand:worker script | `0c8e50b` | workers/artistExpandWorker.js, package.json |

## Verification Results

- `node --check workers/artistExpandWorker.js` — SYNTAX OK
- `grep -n "blpop" workers/artistExpandWorker.js` — line 502: `redis.blpop(ARTIST_EXPAND_QUEUE_KEY, 30)`
- `grep -n "ARTIST_EXPAND_QUEUE_KEY" workers/artistExpandWorker.js` — line 70: `'demus:artist-expand:queue'` (definition), lines 490 and 502 (usage)
- `grep -n "status.*running" workers/artistExpandWorker.js` — line 412: `{ status: 'running', startedAt: new Date() }` in findOneAndUpdate
- `grep -n "status.*done" workers/artistExpandWorker.js` — line 453: `{ status: 'done', completedAt: ... }` on success
- `grep -n "status.*failed" workers/artistExpandWorker.js` — line 459: `{ status: 'failed', error: err.message, completedAt: ... }` in catch block
- `grep -n "blpop.*ytmatch\|ytmatch.*blpop" workers/artistExpandWorker.js` — 0 matches (queue isolation preserved)
- `grep -n "expand:worker" package.json` — line 15: `"expand:worker": "node workers/artistExpandWorker.js"`
- `npm run build` — 20 errors, all pre-existing module-not-found for absent dev environment packages (same baseline as Plans 01-03). artistExpandWorker.js is not compiled by Next.js and introduces no new errors.

## Deviations from Plan

None — plan executed exactly as written. The worker file closely follows the plan's action specification including the exact `processJob` function signature, BLPOP loop structure, graceful shutdown pattern, and `run()` function architecture from `ytMatchWorker.js`.

## Known Stubs

None. The worker is fully functional:
- All Spotify scraping logic is wired via `getData` from `spotify-url-info`
- All MongoDB writes use real `ArtistJob` and `Track` models
- All status transitions are atomic `findOneAndUpdate` calls
- Outbound ytmatch enqueue is wired via real `redis.rpush`

## Self-Check: PASSED

- `workers/artistExpandWorker.js` — file exists at expected path (`C:/Users/kulde/OneDrive/Desktop/PROJECT/Pro-Music-App/workers/artistExpandWorker.js`)
- `package.json` — `expand:worker` script confirmed at line 15
- Commit `0c8e50b` — confirmed via `git log --oneline -1` as `feat(02-04): implement artistExpandWorker BLPOP consumer`
- All acceptance criteria grep checks pass
