# Demus — Production Readiness & Scaling Audit Report

**Date:** March 3, 2026
**Scope:** Full codebase review of the Demus Next.js 16 (Pages Router) application
**Scale Assumptions:** 1,000 concurrent users · 10,000 track imports/day · 100-track avg playlist size

---

## Table of Contents

1. [Critical Issues](#-critical-issues)
2. [High Risk](#-high-risk)
3. [Medium Risk](#-medium-risk)
4. [Low Risk / Future Optimizations](#-low-risk--future-optimizations)
5. [Stress Test Simulation](#stress-test-simulation-10-users--500-track-playlists-simultaneously)
6. [Priority Fix Order](#priority-fix-order)

---

## 🔴 Critical Issues

### 1. No Global Matching Concurrency Control — IP Block Guaranteed at Scale

| Field | Detail |
|---|---|
| **File** | `lib/youtube.js`, `pages/api/import-playlist.js` |
| **Risk** | Multiple concurrent playlist imports each spawn their own independent `batchMatchTracks` background task. The 1000ms inter-request delay only applies *within a single task*. 10 concurrent imports = 10 concurrent `yt-search` calls per second from the same server IP. |
| **Why it happens** | Fire-and-forget in `import-playlist.js` spawns an unbounded number of parallel background loops. There is no global semaphore, queue, or concurrency limiter. |
| **Visible at** | 3–5 simultaneous playlist imports |
| **Failure scenario** | 10 users import playlists within the same minute. Server fires 10 parallel matching loops. YouTube detects automated scraping from a single IP making 10 requests/second. IP gets CAPTCHA-walled or temporarily blocked. *All* playlists pause, and the block may persist for hours. |
| **Severity** | **Critical** |
| **Mitigation** | Add a module-level in-process queue/semaphore in `lib/youtube.js` that ensures only **one** `yt-search` call is in flight at any time across all background tasks. Example: |

```js
// lib/youtube.js — top of file
let queue = Promise.resolve();
function enqueue(fn) {
  queue = queue.then(fn, fn);
  return queue;
}
```

Then wrap each `searchYouTubeTrack` call inside `enqueue()` in `batchMatchTracks`. This serializes all yt-search calls globally with the 1s delay intact.

---

### 2. Orphaned "matching" Status — No Automatic Recovery

| Field | Detail |
|---|---|
| **File** | `lib/youtube.js`, `models/Playlist.js` |
| **Risk** | If the Node.js process restarts (deploy, crash, OOM kill) while `batchMatchTracks` is mid-loop, the Playlist document stays `status: 'matching'` forever. No code ever detects or recovers from this. The client polls indefinitely until the user manually refreshes. |
| **Why it happens** | Background work is in-process only. There's no persistent job record, heartbeat, or startup recovery sweep. |
| **Visible at** | First production deploy while matching is in progress |
| **Failure scenario** | Server deploys at 3am. 15 playlists were mid-match. All 15 are now permanently stuck as "matching". Users see an infinite spinner. Only fix is manual DB update or the user finding/clicking Resume. |
| **Severity** | **Critical** |
| **Mitigation** | Add a startup recovery step. On application boot (or as a lightweight cron-like check), query for playlists stuck in `'matching'` status with `updatedAt` older than 5 minutes and flip them to `'paused'`: |

```js
await Playlist.updateMany(
  { status: 'matching', updatedAt: { $lt: new Date(Date.now() - 5 * 60 * 1000) } },
  { $set: { status: 'paused', errorMessage: 'Server restarted during matching' } }
);
```

---

### 3. Duplicate Background Tasks on Same Playlist — Race Condition

| Field | Detail |
|---|---|
| **File** | `pages/api/import-playlist.js`, `pages/api/youtube-match.js` |
| **Risk** | Two users importing the same Spotify URL simultaneously, or a user clicking Resume while matching is already running, spawns **two independent** `batchMatchTracks` loops for the same `playlistId`. Both update `importProgress` and `status` concurrently, causing incorrect progress values and conflicting terminal state writes. |
| **Why it happens** | `Playlist.findOneAndUpdate` with upsert doesn't check if matching is already in progress before spawning the background task. Resume route doesn't verify current `status !== 'matching'` before spawning another background task. |
| **Visible at** | Any shared playlist URL imported by 2+ users; or user spam-clicking Resume |
| **Failure scenario** | User A imports a 200-track playlist. User B imports the same URL 30 seconds later. The import handler sees the playlist already exists, overwrites status to `'matching'`, and spawns a *second* background task. Task A sets status to `'ready'` at track 200; Task B is still on track 50 and overwrites to `importProgress: 75`. Progress goes backward. |
| **Severity** | **Critical** |
| **Mitigation** | |

1. In `import-playlist.js`: Before spawning background work, check if the playlist is already `'matching'`. If so, skip.
2. In `youtube-match.js`: Add a guard: `if (playlist.status === 'matching') return res.status(409).json({ error: 'Already matching' })`.
3. For stronger protection, use an atomic `findOneAndUpdate` with a condition: `{ _id: playlistId, status: { $ne: 'matching' } }`. If it returns null, matching is already running.

---

## 🟠 High Risk

### 4. N+1 Track Upsert Loop — 500 Sequential DB Calls per Import

| Field | Detail |
|---|---|
| **File** | `pages/api/import-playlist.js` (lines 55–73) |
| **Risk** | The track upsert loop calls `Track.findOneAndUpdate()` sequentially for every track in the playlist. A 500-track playlist = 500 sequential round-trips to MongoDB *before* the client gets a response. |
| **Why it happens** | The `for...of` loop has `await` on each `findOneAndUpdate`. |
| **Visible at** | Playlists > 100 tracks. At 500 tracks with ~5ms per call, that's 2.5 seconds of blocking. |
| **Failure scenario** | User imports a curated 800-track mega-playlist. The API takes 4+ seconds just for the upsert loop. Client-side fetch times out on slower connections. Vercel/serverless may hit the 10-second function timeout on free tiers. |
| **Severity** | **High** |
| **Mitigation** | Replace the sequential loop with `bulkWrite`: |

```js
const bulkOps = rawTracks.map(t => ({
  updateOne: {
    filter: { spotifyId: t.spotifyId },
    update: { $setOnInsert: { name: t.name, artists: t.artists, /* ... */ } },
    upsert: true,
  }
}));
await Track.bulkWrite(bulkOps, { ordered: false });
// Then batch-fetch the upserted docs:
const spotifyIds = rawTracks.map(t => t.spotifyId);
const allTracks = await Track.find({ spotifyId: { $in: spotifyIds } }).lean();
```

Reduces N round trips to 2.

---

### 5. Rate Limiter Memory Leak — Unbounded Map Growth

| Field | Detail |
|---|---|
| **File** | `lib/rateLimit.js` (line 7) |
| **Risk** | The `rateMap` is a plain `Map` that never prunes expired entries. Each unique IP address creates a permanent entry. |
| **Why it happens** | Expired entries are overwritten on next access from the same IP, but IPs that make one request and never return are never cleaned up. There is no periodic sweep. |
| **Visible at** | ~10,000+ unique IPs over the process lifetime |
| **Failure scenario** | The server runs for weeks behind a CDN. Hundreds of thousands of unique IPs accumulate in `rateMap`. Memory grows by ~200 bytes/entry × 500K IPs ≈ 100MB of leaked memory. On a 512MB container, this triggers OOM kill. |
| **Severity** | **High** |
| **Mitigation** | Add a periodic cleanup sweep: |

```js
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateMap) {
    if (now > val.resetAt) rateMap.delete(key);
  }
}, 60000);
```

Or cap the Map size and evict oldest entries.

---

### 6. Polling Full-Populate on Every 3-Second Tick

| Field | Detail |
|---|---|
| **File** | `pages/api/playlist/[id].js` (line 24), `pages/index.js` (polling effect) |
| **Risk** | Every client viewing a `'matching'` playlist polls `GET /api/playlist/[id]` every 3 seconds. This route runs `.populate('tracks')` which joins and deserializes *every* track in the playlist, then serializes the full response to JSON. |
| **Why it happens** | The poll was designed for convenience, not efficiency. It fetches the full playlist + all track data just to check `status` and `importProgress`. |
| **Visible at** | 100 users viewing matching playlists simultaneously = 33 full-populate queries/second. With 200-track playlists, each populate reads ~200 documents. |
| **Failure scenario** | Popular playlist gets imported and shared on social media. 500 users watch the matching progress. Server executes 166 full-populate queries/second. MongoDB connection pool saturates. Response latency spikes. All API routes degrade. |
| **Severity** | **High** |
| **Mitigation** | Create a lightweight polling endpoint (e.g., `GET /api/playlist/[id]/status`) that returns only `{ status, importProgress }` without populate: |

```js
const playlist = await Playlist.findById(id).select('status importProgress').lean();
```

The client only fetches the full playlist (with tracks) when status transitions to `'ready'`.

---

### 7. `spotifyPlaylistId` Missing `unique: true` — Duplicate Playlist Documents Possible

| Field | Detail |
|---|---|
| **File** | `models/Playlist.js` (line 48) |
| **Risk** | `Playlist.js` has an index on `spotifyPlaylistId` but it's **not** declared `unique`. The `findOneAndUpdate` upsert handles dedup in application logic, but under concurrent upserts there is a MongoDB race window where two inserts can both succeed. |
| **Why it happens** | MongoDB `findOneAndUpdate` with `upsert: true` on a non-unique index has a known race condition where two concurrent operations can both determine the document doesn't exist and both insert. |
| **Visible at** | Two users import the same Spotify playlist URL at the exact same instant |
| **Failure scenario** | Duplicate playlist documents are created. Subsequent imports update one but not the other. Track references diverge. Users see inconsistent data depending on which document their ID resolves to. |
| **Severity** | **High** |
| **Mitigation** | Add `unique: true` to the schema: |

```js
spotifyPlaylistId: {
    type: String,
    required: true,
    unique: true,
},
```

---

## 🟡 Medium Risk

### 8. Stale Closure in Player.js `onStateChange` — Playback Skip Breaks

| Field | Detail |
|---|---|
| **File** | `components/Player.js` (lines 49–104) |
| **Risk** | The YouTube `onStateChange` handler created in the `useEffect` captures `handleNext` in its closure. `handleNext` references `currentIndex` and `playlist` from the render scope. But the `YT.Player` instance (and its event handlers) persist across re-renders — the closure is never refreshed. |
| **Why it happens** | The effect only re-runs when `track?.youtubeVideoId` changes. If the user clicks a different track (changing `currentIndex`) without changing the video ID, the `ENDED` handler still references the old `currentIndex`. |
| **Visible at** | Normal usage — user manually jumps to a track, then lets it auto-advance. |
| **Failure scenario** | User is on track 3 (index 2). They click track 10 (index 9). When track 10 ends, `handleNext` still sees `currentIndex === 2` from the stale closure and advances to track 4 instead of track 11. |
| **Severity** | **Medium** |
| **Mitigation** | Move `currentIndex`, `playlist`, and `onTrackChange` into refs that update on every render, and read from refs inside event handlers: |

```js
const currentIndexRef = useRef(currentIndex);
useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
```

---

### 9. No Exponential Backoff on yt-search Failures

| Field | Detail |
|---|---|
| **File** | `lib/youtube.js`, `pages/api/youtube-match.js` |
| **Risk** | When `yt-search` throws (likely a rate-limit/IP-block), `batchMatchTracks` immediately sets `status: 'paused'` and halts. When the user clicks Resume, it immediately retries with the same 1-second delay. If the IP is still blocked, it fails again on the first track. |
| **Why it happens** | No retry logic with backoff. The resume is effectively "try once and pause again." |
| **Visible at** | After any IP block event |
| **Failure scenario** | IP gets blocked for 15 minutes. User clicks Resume 20 times in frustration, each time hitting YouTube once and pausing. Each attempt makes the block worse. YouTube could escalate to a longer block. |
| **Severity** | **Medium** |
| **Mitigation** | Track the time of last pause. On resume, calculate elapsed time. If < 5 minutes, return a 429 with a `retryAfter` value. Alternatively, store a `pausedAt` timestamp on the Playlist and enforce a cooldown. |

---

### 10. `$setOnInsert` Never Updates Existing Track Metadata

| Field | Detail |
|---|---|
| **File** | `pages/api/import-playlist.js` (lines 58–68) |
| **Risk** | The track upsert uses `$setOnInsert` exclusively. If a track's album art, name, or artist list changes on Spotify, re-importing the playlist will not update the stored metadata. |
| **Why it happens** | `$setOnInsert` only applies fields when the document is first created. |
| **Visible at** | Over months as album art URLs expire or track metadata is corrected on Spotify. |
| **Failure scenario** | Spotify updates album art CDN URLs. Old `albumImage` URLs return 404. All track art shows broken images. Re-importing doesn't fix it. |
| **Severity** | **Medium** |
| **Mitigation** | Use a hybrid approach — `$setOnInsert` for immutable fields (`spotifyId`, `importedAt`) and `$set` for mutable fields (`name`, `artists`, `albumImage`, `album`). Protect `youtubeVideoId` from being overwritten: |

```js
{
  $set: { name: t.name, artists: t.artists, album: t.album, albumImage: t.albumImage },
  $setOnInsert: { importedAt: new Date() },
}
```

---

### 11. `populate('tracks')` in Resume Route Loads All Tracks Into Memory

| Field | Detail |
|---|---|
| **File** | `pages/api/youtube-match.js` (line 35) |
| **Risk** | Resume handler calls `.populate('tracks')` on a playlist to filter for unmatched ones. For a 1000-track playlist, this loads all 1000 full Track documents into memory just to filter for the ~50 that are unmatched. |
| **Why it happens** | No projection or query-level filtering on populated documents. |
| **Visible at** | Playlists > 500 tracks |
| **Failure scenario** | A 2000-track playlist resumes matching. All 2000 track documents (each ~500 bytes) are loaded, hydrated as Mongoose documents, then filtered down to 3 unmatched ones. |
| **Severity** | **Medium** |
| **Mitigation** | Instead of populating, query tracks directly: |

```js
const playlist = await Playlist.findById(playlistId).lean();
const unmatchedTracks = await Track.find({
  _id: { $in: playlist.tracks },
  $or: [{ youtubeVideoId: null }, { youtubeVideoId: { $exists: false } }]
}).lean();
```

---

### 12. No Input Validation on `playlistId` in Resume Route

| Field | Detail |
|---|---|
| **File** | `pages/api/youtube-match.js` (line 23) |
| **Risk** | `req.body.playlistId` is passed directly to `Playlist.findById()`. If the value isn't a valid ObjectId, Mongoose throws a `CastError` which hits the generic catch block. |
| **Why it happens** | No input sanitization. |
| **Visible at** | First malicious or buggy client request |
| **Failure scenario** | Attacker sends `{ playlistId: "{ $ne: null }" }` or garbage strings. At best, 500 errors fill logs. At worst, NoSQL injection if the string is object-shaped (mitigated by Mongoose casting, but still unclean). |
| **Severity** | **Medium** |
| **Mitigation** | Validate the ObjectId format before querying: |

```js
if (!mongoose.Types.ObjectId.isValid(playlistId)) {
  return res.status(400).json({ error: 'Invalid playlistId' });
}
```

---

## 🟢 Low Risk / Future Optimizations

### 13. Playlists Not Persisted Client-Side — Lost on Refresh

| Field | Detail |
|---|---|
| **File** | `pages/index.js` (line 12) |
| **Risk** | The `playlists` array is React state with no persistence. Refreshing the page clears the sidebar. |
| **Why it happens** | No `getServerSideProps`, no `localStorage`, no user accounts. |
| **Severity** | **Low** (expected for MVP, but will confuse returning users) |
| **Mitigation** | Persist playlist IDs in `localStorage` and hydrate on mount, or add a `GET /api/playlists` endpoint that returns recently created playlists. |

---

### 14. Text Index on Track Is Over-Provisioned

| Field | Detail |
|---|---|
| **File** | `models/Track.js` (line 34) |
| **Risk** | Track schema declares `{ name: 'text', artists: 'text' }` but no code in the codebase uses MongoDB `$text` search. This index consumes storage and slows writes for zero benefit. |
| **Visible at** | At 1M+ tracks, the text index storage becomes non-trivial. |
| **Severity** | **Low** |
| **Mitigation** | Remove the text index unless a search feature is planned. |

---

### 15. `loadPlaylist` Not Wrapped in `useCallback` — Stale Reference Risk

| Field | Detail |
|---|---|
| **File** | `pages/index.js` |
| **Risk** | `handleImportSuccess` is wrapped in `useCallback([], ...)` with an empty dependency array, but it calls `loadPlaylist` which is a bare function recreated on every render. The `handleImportSuccess` callback will always call the very first version of `loadPlaylist`. |
| **Visible at** | If `loadPlaylist` ever closes over state that changes, this becomes a stale closure bug. |
| **Severity** | **Low** (currently `loadPlaylist` doesn't close over changing state, but it's fragile) |
| **Mitigation** | Move `loadPlaylist` into a `useCallback` or use a ref. |

---

### 16. No Track-Level Deduplication Across Concurrent `batchMatchTracks`

| Field | Detail |
|---|---|
| **File** | `lib/youtube.js` |
| **Risk** | Two playlists sharing 50 common tracks are imported simultaneously. Both pass those 50 tracks as "uncached" and search YouTube for all 50 — twice. The global cache check only works *before* background tasks start. |
| **Why it happens** | The cache check in `import-playlist.js` is point-in-time. Between the check and when `batchMatchTracks` runs, another task may have already matched the same track. |
| **Severity** | **Low** (wasteful but not destructive; the second write produces the same `youtubeVideoId`) |
| **Mitigation** | In `batchMatchTracks`, re-check the track for `youtubeVideoId` before calling `searchYouTubeTrack`. Skip if already cached: |

```js
const freshTrack = await Track.findById(track._id).lean();
if (freshTrack.youtubeVideoId) { matched++; continue; }
```

---

### 17. `connectDB()` Promise Rejection Caching

| Field | Detail |
|---|---|
| **File** | `lib/mongodb.js` (lines 36–39) |
| **Risk** | If the initial connection fails, `cached.promise` is set to `null` — this is correct. However, if the connection *succeeds* but later drops, `cached.conn` still points to the stale connection object. Mongoose handles reconnection internally, but `bufferCommands: false` means operations will throw immediately on a disconnected connection rather than queuing. |
| **Severity** | **Low** (Mongoose reconnect logic handles most cases) |
| **Mitigation** | Monitor Mongoose connection events (`disconnected`, `error`) and clear the cache to force reconnection. |

---

### 18. Playlist `tracks` Array Growth at Data Scale

| Field | Detail |
|---|---|
| **File** | `models/Playlist.js` |
| **Risk** | At 10M track-playlist relationships with 100K playlists, the average playlist contains 100 ObjectId refs. Each ref is 12 bytes. A 1000-track playlist's `tracks` array is 12KB — well within MongoDB's 16MB doc limit. However, updating a 1000-element array triggers a full document rewrite. |
| **Severity** | **Low** (only matters at extreme playlist sizes like 10,000+ tracks) |
| **Mitigation** | No action needed unless supporting playlists with 10K+ tracks. At that point, consider a junction collection. |

---

## Stress Test Simulation: 10 Users × 500-Track Playlists Simultaneously

| Phase | Bottleneck | Impact |
|---|---|---|
| Spotify scrape | 10 concurrent `getData()` calls to Spotify embed | Moderate — Spotify may throttle; not parallelism-limited |
| Track upsert loop | 10 × 500 = 5,000 sequential `findOneAndUpdate` calls | **High** — each request blocks for 2-5s; MongoDB write contention on the `spotifyId` unique index |
| Response to client | Blocked until upsert loop completes | **High** — 2-5 second TTFB per request |
| Background matching | 10 concurrent `batchMatchTracks` loops, each doing 1 req/s | **Critical** — 10 yt-search calls/second from same IP → IP block within minutes |
| MongoDB during matching | 10 × 500 = 5,000 `Track.updateOne` + 5,000 `Playlist.updateOne` over ~500 seconds | Moderate — spread over time, manageable |

**What breaks first:** YouTube IP block (yt-search), caused by uncontrolled background task concurrency.

**What breaks second:** API response time, caused by N+1 upsert loop (Issue #4).

**What breaks third:** Client confusion from concurrent progress updates (Issue #3).

---

## Priority Fix Order

| Priority | Issue # | Description | Effort |
|---|---|---|---|
| 1 | #1 | Global matching queue/semaphore | Small (~20 lines) |
| 2 | #3 | Guard against duplicate background tasks | Small (~5 lines per route) |
| 3 | #2 | Stale "matching" recovery on startup | Small (~10 lines) |
| 4 | #4 | `bulkWrite` for track upserts | Medium (refactor loop) |
| 5 | #7 | `unique: true` on `spotifyPlaylistId` | Trivial (1 line) |
| 6 | #5 | Rate limiter cleanup interval | Trivial (5 lines) |
| 7 | #6 | Lightweight status-only polling endpoint | Small (new route) |
| 8 | #8 | Player stale closure fix | Medium (ref pattern) |

**Fixes 1–3 are ship-blockers** for any deployment beyond personal use. Fix 4 is needed before handling playlists > 200 tracks reliably. The rest can be staged incrementally.

---

*End of audit report.*
