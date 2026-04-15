# Phase 02: Queue-Safe Job Actions - Research

**Researched:** 2026-04-14
**Domain:** MongoDB-backed job queue idempotency, per-item bulk operation results, safe retry via existing worker orchestration
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Duplicate-policy semantics**
- Active-job uniqueness is keyed by **Artist Spotify ID only**.
- New enqueue is blocked when an existing job for the same artist is in **queued** or **running**.
- Repeated submissions return per-item **skipped** with reason code `already_active`.
- Items missing artist Spotify ID are rejected per-item as **failed** with reason code `missing_artist_id`.

**Bulk enqueue response contract**
- Mixed-result bulk requests return HTTP **200** with per-item results (not fail-fast).
- Response includes both summary counts and per-item details.
- Per-item results preserve **input order**.
- Standard reason codes for this phase: `queued`, `already_active`, `missing_artist_id`, `retry_queued`.

**Retry behavior**
- Manual retry is allowed for **failed** jobs only.
- Retry action re-enters queue **immediately**.
- No hard manual retry limit in Phase 2.
- Retry requests for jobs already queued/running return per-item **skipped** with `already_active`.

**Conflict handling**
- Duplicate artist entries inside one bulk payload: first occurrence processed, subsequent duplicates skipped.
- Retry reuses/reactivates the existing failed job record (no new record creation for retry).
- Unknown retry job IDs return per-item **failed** with reason code `job_not_found`.
- No running-job preemption/cancel-and-replace behavior in Phase 2.

### Claude's Discretion
- Exact response payload field names and top-level envelope shape, as long as required reason codes and ordering guarantees are preserved.
- Exact naming of API endpoints under `/api/admin/*` that implement these actions.

### Deferred Ideas (OUT OF SCOPE)
- Queue health cards and advanced operational telemetry (Phase 3/4)
- Retry limits/backoff tuning policy beyond immediate manual retry behavior (future hardening phase)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| QUEUE-02 | Bulk enqueue is idempotent — no duplicate active jobs for the same artist | MongoDB atomic `findOneAndUpdate` with compound status-filter guard; unique index on `artistSpotifyId` for fast duplicate check |
| QUEUE-03 | Bulk enqueue returns per-artist outcome (queued/skipped/failed) | Per-item result accumulator pattern; input-order preservation via index-mapped results array |
| QUEUE-04 | Admin can retry failed artist expansion jobs | Atomic status transition from `failed` → `queued` on existing record; same Redis enqueue path used by initial enqueue |
| SYNC-01 | Enqueue and retry flows reuse existing worker orchestration paths and do not bypass queue-based processing | artistCrawler already consumes from `demus:ytmatch:queue` via BLPOP; new admin action must enqueue to the same Redis list using the same payload shape |
</phase_requirements>

---

## Summary

This phase adds MongoDB-backed artist expansion job tracking plus two admin API endpoints (`POST /api/admin/enqueue-artists` and `POST /api/admin/retry-jobs`) that produce idempotent, per-item bulk results. All job orchestration must flow through the existing Redis queue and worker path — no inline execution.

The codebase already contains the full pattern stack needed. `import-playlist.js` demonstrates the atomic guard (`findOneAndUpdate` with conditional filter) that prevents duplicate background tasks. `youtube-match.js` demonstrates resume/retry semantics with the same guard. `metadataQueue.js` demonstrates the `{ total, queued, failed }` batch return shape. The only missing piece is a **persistent ArtistJob model** (MongoDB) that tracks per-artist expansion job state across requests — this is the core new artifact Phase 2 must introduce.

The artistCrawler is a standalone CLI process that does its own Spotify scraping and MongoDB upserts. It does NOT consume from a Redis queue — it writes TO `demus:ytmatch:queue` for tracks it discovers. Admin-triggered expansion needs a different queue for artist-level jobs, OR must call artistCrawler logic through the same code path. The safest SYNC-01-compliant interpretation is: the admin API enqueues artist Spotify IDs into a **new Redis list** (e.g., `demus:artist-expand:queue`) which a worker (reusing artistCrawler logic) processes — matching the existing fire-and-forget + BLPOP architecture exactly.

**Primary recommendation:** Introduce `models/ArtistJob.js` (MongoDB) as the job-state store, add `lib/artistExpandQueue.js` (Redis enqueue helper mirroring `redisQueue.js`), and add two `requireAdmin`-wrapped API handlers. All field-level MongoDB atomicity comes from `findOneAndUpdate` with status-filter guards, identical to the existing patterns.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| mongoose | ^9.2.3 (in use) | ArtistJob model + atomic status transitions | Already the project ORM; `findOneAndUpdate` with conditional filter is the established idempotency primitive |
| ioredis | ^5.10.0 (in use) | Redis list enqueue (RPUSH) for artist-expand queue | Already used by `redisQueue.js` and `metadataQueue.js`; same helper pattern applies |
| Next.js API routes | 16.1.6 (in use) | Admin action endpoints under `/api/admin/` | Established pattern; all admin APIs are Next.js handlers wrapped with `requireAdmin` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `lib/requireAdmin.js` | (local, Phase 1) | Admin authorization HOF | Wrap every handler in Phase 2 action endpoints |
| `lib/redis.js` `getRedis()` | (local) | Singleton Redis client with graceful null-return | Use for all Redis operations from Next.js API routes |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| MongoDB ArtistJob model for job state | In-memory map or Redis hash | MongoDB survives restarts and is already the source of truth for all persistent state in this project |
| Separate artist-expand Redis queue | Reuse `demus:ytmatch:queue` with job-type discrimination | Separate queue preserves worker isolation; mixing job types in one queue would require the ytMatchWorker to understand artist-expand payloads — breaks SYNC-01's "don't bypass worker orchestration" intent |

**Installation:** No new npm packages required. All libraries are already installed.

---

## Architecture Patterns

### Recommended Project Structure

```
models/
└── ArtistJob.js            # NEW — persistent per-artist job state

lib/
└── artistExpandQueue.js    # NEW — Redis RPUSH helper for artist-expand queue
                            #       mirrors lib/redisQueue.js exactly

pages/api/admin/
├── enqueue-artists.js      # NEW — POST bulk enqueue (requireAdmin wrapped)
├── retry-jobs.js           # NEW — POST bulk retry (requireAdmin wrapped)
├── access-check.js         # Phase 1 — keep as-is
└── [...path].js            # Phase 1 catch-all — keep as-is

workers/
└── artistExpandWorker.js   # NEW (or extend artistCrawler) — BLPOP consumer
                            #     for demus:artist-expand:queue
                            #     Reuses artistCrawler expand logic per artist
```

### Pattern 1: MongoDB Atomic Idempotency Guard

**What:** Use `findOneAndUpdate` with a conditional `status` filter so a job record can only move to a new state if it is in an expected prior state. If the condition is not met, the update returns `null` — meaning another process already claimed or is running the job. This is the exact mechanism in `import-playlist.js` (line 165) and `youtube-match.js` (line 95).

**When to use:** Any enqueue operation that must be safe against concurrent duplicate submissions.

**Adapted for ArtistJob:**
```javascript
// Source: pages/api/import-playlist.js line 165 pattern, adapted for ArtistJob

// Check for an active job (status: queued OR running) for this artist.
// findOneAndUpdate returns the OLD document if found, null if not matched.
const existingActive = await ArtistJob.findOneAndUpdate(
  {
    artistSpotifyId: artist.spotifyId,
    status: { $in: ['queued', 'running'] },
  },
  { $set: { updatedAt: new Date() } }, // no-op touch so it's a real write
  { new: false }
);

if (existingActive) {
  results.push({ artistSpotifyId: artist.spotifyId, status: 'skipped', reason: 'already_active' });
  continue;
}

// Safe to enqueue — create or reactivate job record
await ArtistJob.findOneAndUpdate(
  { artistSpotifyId: artist.spotifyId, status: { $nin: ['queued', 'running'] } },
  {
    $set: {
      status: 'queued',
      queuedAt: new Date(),
      error: null,
    },
    $setOnInsert: {
      artistName: artist.name,
    },
  },
  { upsert: true, new: true }
);

await enqueueArtistExpand({ artistSpotifyId: artist.spotifyId, artistName: artist.name });
results.push({ artistSpotifyId: artist.spotifyId, status: 'queued', reason: 'queued' });
```

**Why two `findOneAndUpdate` calls:** The first is a read-with-intent (optimistic check). The second is the actual atomic write. Using separate calls avoids complex update pipeline logic. The status `$nin: ['queued', 'running']` on the upsert prevents creating a second record if a concurrent request slipped through between the two calls — the upsert simply finds nothing matchable and inserts, while the concurrent upsert wins and becomes `queued` first, so only one record exists at any time. With a unique index on `artistSpotifyId` (see ArtistJob schema below), a concurrent upsert race throws a duplicate-key error that can be caught and treated as `already_active`.

### Pattern 2: Per-Item Bulk Result Accumulator

**What:** Process each item in the input array independently. Build an ordered results array. Never short-circuit on one item's failure. Return 200 with the full results array regardless of mix.

**When to use:** All bulk action endpoints (enqueue-artists, retry-jobs).

**Example:**
```javascript
// Source: lib/metadataQueue.js enqueueMetadataBatch — adapted for per-item results

export async function bulkEnqueueArtists(artists) {
  // Deduplicate within this payload — first occurrence wins
  const seen = new Set();
  const results = [];

  for (const artist of artists) {
    // Validate required field
    if (!artist.spotifyId) {
      results.push({ ...artist, status: 'failed', reason: 'missing_artist_id' });
      continue;
    }

    // Within-payload dedup
    if (seen.has(artist.spotifyId)) {
      results.push({ artistSpotifyId: artist.spotifyId, status: 'skipped', reason: 'already_active' });
      continue;
    }
    seen.add(artist.spotifyId);

    // ... atomic check + enqueue (Pattern 1 above)
    // push to results with outcome
  }

  const summary = {
    total: results.length,
    queued: results.filter(r => r.status === 'queued').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    failed: results.filter(r => r.status === 'failed').length,
  };

  return { summary, results }; // results preserves input order
}
```

### Pattern 3: Retry via Existing Record Reactivation

**What:** For retry, locate the existing `failed` ArtistJob document by ID, atomically update it to `queued`, and enqueue to Redis. No new document is created. This mirrors how `youtube-match.js` resumes a paused playlist rather than creating a new one.

**When to use:** `POST /api/admin/retry-jobs` handler.

**Example:**
```javascript
// Source: pages/api/youtube-match.js lines 95-98 pattern, adapted for ArtistJob retry

const updated = await ArtistJob.findOneAndUpdate(
  { _id: jobId, status: 'failed' },     // only reactivate failed jobs
  {
    $set: {
      status: 'queued',
      retriedAt: new Date(),
      error: null,
    },
  },
  { new: true }
);

if (!updated) {
  // Job not found OR not in failed status
  const job = await ArtistJob.findById(jobId).lean();
  if (!job) {
    results.push({ jobId, status: 'failed', reason: 'job_not_found' });
  } else {
    // Job exists but is queued or running
    results.push({ jobId, status: 'skipped', reason: 'already_active' });
  }
  continue;
}

await enqueueArtistExpand({ artistSpotifyId: updated.artistSpotifyId, artistName: updated.artistName });
results.push({ jobId, artistSpotifyId: updated.artistSpotifyId, status: 'queued', reason: 'retry_queued' });
```

### Pattern 4: Redis Enqueue Helper (mirrors `lib/redisQueue.js`)

**What:** Wrap `redis.rpush` in a try/catch that returns `false` on Redis unavailability. Never throw from the queue helper — callers mark the item `failed` and continue.

```javascript
// Source: lib/redisQueue.js — direct structural mirror for artist-expand queue

export const ARTIST_EXPAND_QUEUE_KEY = 'demus:artist-expand:queue';

export async function enqueueArtistExpand(job) {
  try {
    const redis = await getRedis();
    if (!redis) {
      console.warn('[ArtistExpandQueue] Redis unavailable — skipping enqueue');
      return false;
    }
    await redis.rpush(ARTIST_EXPAND_QUEUE_KEY, JSON.stringify(job));
    return true;
  } catch (err) {
    console.error('[ArtistExpandQueue] Failed to enqueue:', err.message);
    return false;
  }
}
```

### ArtistJob Model Schema

```javascript
// models/ArtistJob.js — NEW model for Phase 2

import mongoose from 'mongoose';

const ArtistJobSchema = new mongoose.Schema(
  {
    artistSpotifyId: {
      type: String,
      required: true,
      unique: true,   // enforces one active record per artist at DB level
      index: true,
    },
    artistName: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ['queued', 'running', 'done', 'failed'],
      default: 'queued',
      index: true,
    },
    error: {
      type: String,
      default: null,
    },
    queuedAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    retriedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.models.ArtistJob ||
  mongoose.model('ArtistJob', ArtistJobSchema);
```

**Critical:** The `unique: true` on `artistSpotifyId` means only ONE record per artist ever exists. Upsert-based enqueue always updates or inserts into the same document. Retry reactivates the same document. Phase 3 dashboard queries this collection for status display.

### Anti-Patterns to Avoid

- **Creating a new ArtistJob document for each enqueue attempt:** Violates the "retry reuses existing record" decision in CONTEXT.md. Always upsert by `artistSpotifyId`.
- **Checking status then writing in two separate transactions without atomic guard:** Creates a TOCTOU race. Always encode the precondition in the `findOneAndUpdate` filter, not in application code.
- **Returning 4xx on mixed results:** CONTEXT.md specifies HTTP 200 for mixed bulk results. Reserve 4xx for malformed request (no body, wrong method) only.
- **Executing artist expansion inline in the API handler:** Violates SYNC-01. All expansion must be enqueued to Redis and processed by the worker. The API handler returns after enqueue, not after expansion.
- **Using Redis as the job state store:** Redis is ephemeral; job status for dashboard queries must live in MongoDB. Redis is used only for the work queue (FIFO delivery to the worker).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Atomic conditional writes | Custom lock table or in-memory mutex | `findOneAndUpdate` with status-filter guard | MongoDB's atomic document-level writes handle all concurrency without external locking |
| Per-item bulk results | Custom try/catch accumulator from scratch | Adapt the `enqueueMetadataBatch` `{ queued, failed }` shape into per-item array | Pattern already tested; just extend to include per-item reasons |
| Redis client lifecycle | New `new Redis()` call in the API handler | `getRedis()` from `lib/redis.js` | Handles singleton, reconnection, graceful null-return — duplicating this causes connection leaks |
| Admin authorization | Manual JWT decode in the new handlers | `requireAdmin` from `lib/requireAdmin.js` | Phase 1 already provides this HOF; using it ensures catch-all guard + consistent 403 behavior |
| Worker-path bypass | Direct call to `artistCrawler.run()` from API | Enqueue to `demus:artist-expand:queue` and let worker consume | Direct call blocks the HTTP request, bypasses queue ordering, and violates SYNC-01 |

**Key insight:** Every "new" problem in Phase 2 is a composition of patterns already implemented in this codebase. The research finding is that no new primitives are required — only new models and thin handler wiring.

---

## Common Pitfalls

### Pitfall 1: Upsert Race on `artistSpotifyId` Unique Index

**What goes wrong:** Two concurrent enqueue requests for the same `artistSpotifyId` both pass the "active check" simultaneously (both find no active job), then both attempt the upsert. One succeeds; the other throws `MongoServerError: E11000 duplicate key`.

**Why it happens:** The read-then-write sequence has a race window between the `findOne` check and the `findOneAndUpdate` upsert, even with atomic updates. Two requests can both read "no active job" before either writes.

**How to avoid:** Catch `MongoServerError` with `code === 11000` (duplicate key) in the enqueue loop and treat it as `already_active`/skipped. This is the standard Node.js/Mongoose pattern for unique-index-enforced upserts.

```javascript
try {
  await ArtistJob.findOneAndUpdate(/* upsert */);
} catch (err) {
  if (err.code === 11000) {
    results.push({ artistSpotifyId, status: 'skipped', reason: 'already_active' });
    continue;
  }
  throw err; // unexpected error — re-throw
}
```

**Warning signs:** `MongoServerError E11000` in server logs during concurrent bulk enqueue.

### Pitfall 2: Status Drift When Worker Fails Without Updating Job Record

**What goes wrong:** The worker picks up a job from Redis (BLPOP), transitions it to `running`, then crashes. The ArtistJob document is stuck in `running` forever. Future enqueue attempts see `running` and return `already_active` indefinitely, making the artist unrecoverable without manual DB edit.

**Why it happens:** Redis BLPOP is destructive — once the job payload is popped, it is gone. If the worker dies mid-job, there is no automatic re-queue.

**How to avoid:** The worker must wrap job processing in a try/catch and always update ArtistJob to `failed` with an error message if any unhandled exception occurs. Mirrors the Playlist `paused` handling in `ytMatchWorker.js` (lines 318-337). Phase 4 can add stuck-job detection; for Phase 2 the worker must be disciplined about setting `failed` on any error.

**Warning signs:** ArtistJob documents stuck in `running` status long after expected completion time.

### Pitfall 3: Input Order Not Preserved in Results

**What goes wrong:** A `Promise.all` parallel execution strategy returns results in completion order, not input order. The CONTEXT.md requirement says per-item results must preserve input order.

**Why it happens:** `Promise.all` resolves in the order promises settle, not declaration order. If concurrency is added later, results will shuffle.

**How to avoid:** Use a sequential `for...of` loop (as shown in Pattern 2). If parallel execution is ever needed, use index-mapped accumulation: `const results = new Array(artists.length)` and write `results[i] = ...` inside the loop.

**Warning signs:** Test comparing input order to response `results` array order fails non-deterministically.

### Pitfall 4: Retry Endpoint Creating New ArtistJob Documents

**What goes wrong:** Retry handler uses `create()` or `insertOne()` instead of `findOneAndUpdate`. This creates a second document for the same artist if the unique index is somehow bypassed, or throws a duplicate-key error.

**Why it happens:** Forgetting the CONTEXT.md decision: "Retry reuses/reactivates the existing failed job record (no new record creation for retry)."

**How to avoid:** Retry always uses `findOneAndUpdate({ _id: jobId, status: 'failed' }, ...)`. The jobId comes from the client; if not found or not in `failed`, return the appropriate reason code.

**Warning signs:** Multiple ArtistJob documents for the same `artistSpotifyId` in the collection.

### Pitfall 5: Redis Unavailability Silently Drops Jobs

**What goes wrong:** `enqueueArtistExpand` returns `false` (Redis down). The handler marks the job as `queued` in MongoDB but never pushes to Redis. The worker never picks it up. The job is stuck in `queued` forever.

**Why it happens:** The existing `redisQueue.js` pattern returns `false` on failure and leaves it to the caller to decide. The caller must check the return value.

**How to avoid:** In the enqueue handler: if `enqueueArtistExpand` returns `false`, do NOT persist `queued` status. Roll back the ArtistJob status update (set back to previous state, or `failed` with `reason: 'redis_unavailable'`) and return the item as `failed` in the per-item results. Alternatively: write `queued` to MongoDB first, then attempt Redis enqueue, and if Redis fails, update status to `failed`.

**The recommended approach:** Enqueue to Redis first. If Redis fails, do not create/update the ArtistJob record. Return the item as `failed` with a transient error message. This prevents orphaned `queued` records.

---

## Code Examples

### Verified: Atomic Guard from `import-playlist.js`

```javascript
// Source: pages/api/import-playlist.js lines 164-178
// Pattern: findOneAndUpdate with conditional filter prevents duplicate tasks

const canMatch = await Playlist.findOneAndUpdate(
  { _id: playlist._id, status: { $ne: 'matching' } },
  { $set: { status: 'matching' } }
);

if (canMatch) {
  batchMatchTracks(uncachedTracks, playlist._id, 1000).catch((err) =>
    console.error('Background YouTube matching failed:', err.message)
  );
} else {
  console.log(`Skipping — already matching`);
}
```

### Verified: Two-Layer Guard from `youtube-match.js`

```javascript
// Source: pages/api/youtube-match.js lines 47-48 + 95-98
// Pattern: optimistic check first (fast path), atomic guard second (race protection)

if (playlist.status === 'matching') {
  return res.status(409).json({ error: 'Matching is already in progress' });
}
// ... (other checks) ...
const canMatch = await Playlist.findOneAndUpdate(
  { _id: playlistId, status: { $ne: 'matching' } },
  { $set: { status: 'matching' } }
);
if (!canMatch) {
  return res.status(409).json({ error: 'Matching is already in progress' });
}
```

### Verified: Batch Return Shape from `metadataQueue.js`

```javascript
// Source: lib/metadataQueue.js lines 82-87
// Pattern: { total, queued, failed } summary — extend per-item for Phase 2

return {
  total: tracks.length,
  queued: tracks.length,
  failed: 0,
};
```

### Verified: Redis RPUSH helper from `redisQueue.js`

```javascript
// Source: lib/redisQueue.js lines 29-55
// Pattern: try/catch wrapper returning boolean — null-safe via getRedis()

export async function enqueueYouTubeMatch(job) {
  try {
    const redis = await getRedis();
    if (!redis) { return false; }
    await redis.rpush(QUEUE_KEY, JSON.stringify(job));
    return true;
  } catch (err) {
    console.error(`[YTQueue] Failed to enqueue:`, err.message);
    return false;
  }
}
```

### Verified: `requireAdmin` HOF from `lib/requireAdmin.js`

```javascript
// Source: lib/requireAdmin.js lines 25-32
// Usage pattern for all Phase 2 admin endpoints:

export default requireAdmin(async function handler(req, res) {
  // req.user is populated; req.user.email is the verified admin email
  // ...
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-request Redis `new Redis()` | Singleton `getRedis()` with global ref | Established in `lib/redis.js` | Use `getRedis()` everywhere; never instantiate Redis directly in API handlers |
| Polling for job completion | BLPOP long-poll in worker | Established in `ytMatchWorker.js` | Workers do not busy-wait; zero CPU overhead when queue is empty |
| Status stored only in Redis | Status stored in MongoDB, Redis is delivery-only | Established pattern in this codebase | Job state is queryable, survives Redis restarts, accessible to dashboard (Phase 3) |

---

## Open Questions

1. **Does Phase 2 need a `workers/artistExpandWorker.js` or does `npm run crawl:artists` fulfill SYNC-01?**
   - What we know: The existing `artistCrawler.js` is a one-shot CLI process (not a BLPOP loop). It samples 20 random DB tracks and expands them. It does NOT consume from a queue.
   - What's unclear: SYNC-01 says "reuse existing worker orchestration paths." The existing path IS the artistCrawler CLI invoked manually (or via cron), not a queue consumer.
   - Recommendation: For Phase 2, enqueue to `demus:artist-expand:queue` via Redis and create a minimal `artistExpandWorker.js` as a BLPOP consumer that calls the shared artistCrawler expansion logic per-artist. This genuinely reuses the orchestration pattern (BLPOP + MongoDB update) established by `ytMatchWorker.js` — which IS the "existing worker orchestration path" in this codebase. The alternative (calling `artistCrawler.run()` directly) would block the HTTP request and violate fire-and-forget semantics. **Planner decision needed:** confirm that a new worker is in scope for Phase 2 or defer to Phase 4.

2. **Should the admin enqueue endpoint re-expand an artist whose job is in `done` status?**
   - What we know: CONTEXT.md only specifies blocking on `queued` or `running`. A `done` artist would pass the active check and get re-queued.
   - What's unclear: Whether re-expanding a `done` artist is intended or should be blocked.
   - Recommendation: Allow re-enqueue of `done` artists (update their record to `queued`). This is consistent with "admin triggering expansion explicitly means they want it done." Document in handler comments.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| MongoDB (mongoose) | ArtistJob model, atomic updates | ✓ | mongoose ^9.2.3 | None (required) |
| Redis (ioredis) | artist-expand queue RPUSH | ✓ (optional) | ioredis ^5.10.0 | Per-item `failed` with reason, job not stuck in `queued` |
| Node.js | Worker process | ✓ | (project runtime) | — |
| `lib/requireAdmin.js` | All admin endpoints | ✓ | Phase 1 (in place) | — |

**Missing dependencies with no fallback:** None that block Phase 2 implementation.

**Missing dependencies with fallback:**
- Redis unavailable: `enqueueArtistExpand` returns `false`; handler returns item as `failed` with transient error reason (does not mark job as `queued` in MongoDB without successful Redis enqueue).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None detected — `npm run test` runs `next build` (build-only gate) |
| Config file | None (no jest.config.*, no vitest.config.*) |
| Quick run command | `npm run build` |
| Full suite command | `npm run build` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| QUEUE-02 | Duplicate active job not created | manual-only | — | ❌ no unit test infra |
| QUEUE-03 | Per-item results in input order | manual-only | — | ❌ no unit test infra |
| QUEUE-04 | Retry updates existing record, not new | manual-only | — | ❌ no unit test infra |
| SYNC-01 | No inline execution; Redis enqueue verified | build smoke | `npm run build` | ✅ build gate exists |

**Justification for manual-only:** The project has no test runner (no Jest, Vitest, or similar). The existing "test" script is `next build`. All behavioral verification must be done via manual API calls (curl or admin UI) against a running dev server with a live MongoDB and Redis connection. The planner should include a manual verification checklist in each task's verification step.

### Sampling Rate

- **Per task commit:** `npm run build` (confirms no compile errors or import failures)
- **Per wave merge:** `npm run build`
- **Phase gate:** Build green + manual API smoke test (curl enqueue → check MongoDB ArtistJob → curl retry → check status transition)

### Wave 0 Gaps

- [ ] No unit test infrastructure exists — no framework install needed for Phase 2 (build-only gate is the project standard)
- [ ] Manual smoke test checklist should be included in each plan's verification section as a substitute for automated tests

---

## Sources

### Primary (HIGH confidence)
- Direct codebase read: `lib/redisQueue.js` — enqueue pattern (RPUSH + null-safe `getRedis()`)
- Direct codebase read: `lib/metadataQueue.js` — batch enqueue return shape `{ total, queued, failed }`
- Direct codebase read: `pages/api/import-playlist.js` lines 164-178 — atomic guard `findOneAndUpdate` with `$ne` status filter
- Direct codebase read: `pages/api/youtube-match.js` lines 47-48, 95-98 — two-layer guard, retry/resume semantics
- Direct codebase read: `workers/ytMatchWorker.js` — BLPOP single-consumer model, failure state transitions
- Direct codebase read: `workers/artistCrawler.js` — per-artist expansion logic, Redis enqueue of ytmatch jobs
- Direct codebase read: `models/Playlist.js` — status lifecycle, retry metadata fields
- Direct codebase read: `lib/requireAdmin.js` — Phase 1 HOF to apply to all Phase 2 endpoints
- Direct codebase read: `lib/redis.js` — singleton client contract (`getRedis()` returns null on unavailability)

### Secondary (MEDIUM confidence)
- MongoDB documentation pattern: `findOneAndUpdate` with conditional filter as atomic idempotency primitive — well-established Node.js/Mongoose pattern confirmed by codebase usage
- MongoDB `E11000` duplicate key error code for unique index violations — standard across all MongoDB versions

### Tertiary (LOW confidence)
- None — all findings verified directly from codebase source code or established MongoDB/ioredis documented behavior.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in use; no new dependencies required
- Architecture patterns: HIGH — all patterns are direct structural mirrors of existing codebase implementations
- Pitfalls: HIGH — pitfalls derived from actual code paths in the codebase (race conditions visible in existing atomic guard implementations, Redis null-return visible in `redisQueue.js`)
- ArtistJob schema: HIGH — derived from Playlist model conventions + context decisions; status enum matches CONTEXT.md exactly

**Research date:** 2026-04-14
**Valid until:** 2026-05-14 (stable stack — no fast-moving dependencies)
