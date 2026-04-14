# Genre + Metadata Worker Design (Improved)

## Problem

Track records are populated from multiple ingestion paths, but metadata completeness is inconsistent (especially genre). Current enrichment logic is duplicated across API/import and worker scripts, which makes completeness and reliability harder to improve.

## Decisions approved

1. Track genre model: **`genres: string[]`**.
2. Source strategy: **hybrid** (public sources first, API-key fallback).
3. Priority: **metadata completeness** over raw ingestion speed.
4. Target: **~85% of tracks** should have at least one genre after backfill.
5. Architecture direction: **queue-centric metadata worker**.

## Current-state findings

1. `Track` schema has no `genres` field yet.
2. Enrichment exists in `lib/spotify.js` (`runBackgroundItunesEnrichment` + multi-tier enrichment), but workers also implement similar enrichment paths (`workers/chartsWorker.js`, `workers/artistCrawler.js`), causing duplication.
3. YouTube matching already has queue-worker pattern (`demus:ytmatch:queue` + `workers/ytMatchWorker.js`), which is a good template for metadata enrichment.

## Proposed architecture

### 1) Data model changes (`models/Track.js`)

Add:

```js
genres: [String], // normalized lowercase slugs
primaryGenre: String, // top genre for fast filtering

metadataStatus: 'pending' | 'partial' | 'complete' | 'failed',
metadataUpdatedAt: Date,
metadataSources: {
  genre: String, // 'itunes' | 'deezer' | 'musicbrainz' | 'spotify-api' | 'lastfm' | 'youtube'
  album: String
},

metadataAttempts: Number, // retry counter
genreConfidence: Number, // 0–1 score
metadataFingerprint: String // hash(name + artists)
```

Behavior:
1. New/updated tracks with missing metadata are marked `pending`.
2. `complete` means: `album && albumImage && genres.length > 0`.
3. `partial` means one or more fields still missing.
4. Worker updates missing fields only; never overwrites valid existing values.

### 2) New queue + worker

1. Redis queue: `demus:metadata:queue`
2. Worker: `workers/metadataWorker.js`
3. Worker responsibilities per track:
   - Fill/repair album
   - Fill/repair albumImage
   - Resolve `genres[]`
   - Assign `primaryGenre`
   - Compute `genreConfidence`
   - Update `metadataStatus` / `metadataUpdatedAt`
   - Track `metadataSources`

### 3) Enrichment pipeline (completeness-first)

Tier 1 (public/no-key):
- iTunes
- Deezer
- MusicBrainz
- Cached artist genre mapping

Tier 2 (key-based fallback):
- Spotify API (artist genres)
- Optional Last.fm

Execution strategy:
1. Run Tier 1
2. If confidence >= threshold, stop
3. Else run Tier 2

### 4) Genre normalization (mandatory)

Before persisting:
1. lowercase
2. trim
3. slugify (`Hip Hop` -> `hip-hop`)
4. dedupe
5. cap list length (3-5 genres)

### 5) Genre confidence scoring

| Source | Score |
|---|---|
| Spotify API | 1.0 |
| Last.fm | 0.9 |
| iTunes | 0.8 |
| Deezer | 0.75 |
| YouTube | 0.6 |

Final score: best trusted source score, plus overlap boost when multiple sources agree.

### 6) Persistence rules (critical)

1. Update only missing fields.
2. Never remove valid existing data.
3. Merge values (never blind replace).

Example:

```js
$set: {
  ...(track.genres?.length ? {} : { genres }),
}
```

### 7) Reliability controls

Retry strategy:
1. transient errors -> exponential backoff
2. rate-limit -> provider cooldown
3. no data -> mark partial (avoid infinite loops)

Limits and safety:
1. `metadataAttempts < maxAttempts` (3-5)
2. Dead-letter when max exceeded (`status='failed'`)
3. Failure reason tags: `rate_limited | provider_error | no_genre_found`
4. Idempotency key: `spotifyId + metadataFingerprint`

Re-enqueue policy:
Re-enqueue only when:
1. `metadataStatus !== 'complete'`
2. `metadataAttempts < maxAttempts`
3. `genreConfidence < threshold`

Nightly reconciler target:
`metadataStatus in ('pending', 'partial', 'failed')` with priority ordering:
1. recently imported
2. popular tracks
3. long-tail catalog

### 8) Queue protections

1. Skip enqueue if `metadataStatus === 'complete'`
2. Skip enqueue if `metadataUpdatedAt` is still recent
3. Enforce dedupe key per track metadata job

## API / Ops adjustments

1. Extend `POST /api/repair-enrichment` to include genre enrichment.
2. Add optional `POST /api/repair-genres` for targeted genre-only backfill.
3. Add worker command: `npm run metadata:worker`.
4. Keep `/api/import-playlist` non-blocking by enqueueing metadata jobs asynchronously.

## Observability + acceptance

Metrics:
1. Genre coverage: `% tracks where genres.length > 0`
2. High-confidence coverage: `% tracks where genreConfidence >= 0.8`
3. Queue lag: `job.createdAt -> job.startedAt`
4. Retry count
5. DLQ count
6. Provider error/rate-limit rates
7. Time-to-enrichment: `importedAt -> metadata complete`

Targets:
1. ~85% tracks with at least one genre
2. >= ~70% high-confidence genre coverage
3. Import latency remains close to current async behavior
4. No duplicate-processing storms
5. Queue lag stays within agreed SLO

## Rollout plan

Phase 1 (shadow mode):
1. add schema fields
2. deploy metadata worker
3. collect metrics
4. do not expose genres in UI yet

Phase 2 (enable writes):
1. persist genres in live import/enrichment paths
2. enable repair endpoints
3. monitor coverage and provider health

Phase 3 (backfill + steady state):
1. run historical backfill
2. enable nightly reconciler

## Non-goals (this phase)

1. Genre UI/filter/recommendation features
2. Perfect cross-provider taxonomy unification

## Core principle

`Extract once -> enrich continuously -> reuse forever`
