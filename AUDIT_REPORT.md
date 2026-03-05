# Demus — Full-Stack Architecture Audit Report

**Date:** March 5, 2026
**Auditor:** Senior Backend Architecture Review
**Scope:** Complete codebase — `pages/`, `components/`, `context/`, `lib/`, `models/`
**Status:** Analysis only — no code modified

---

## 1. Executive Summary

Demus is a thoughtfully engineered music streaming application built on a zero-quota, zero-egress-cost architecture. The core pipeline — Spotify scraping → MongoDB global cache → YouTube IFrame playback — is sound, and several advanced patterns are correctly implemented: atomic playlist guards, a global concurrency queue, startup recovery for stuck playlists, and a proper fire-and-forget background job pattern.

However, the audit identified **one critical security vulnerability**, **one severe logic duplication**, **three significant documentation/documentation-code mismatches**, and a set of medium-priority reliability and scalability concerns. None of these require architectural rethinking, but several require immediate attention before exposing the application to production traffic.

### Risk Summary

| Severity    | Count | Items                                                                                                                                                                                                              |
| ----------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 🔴 Critical | 1     | `eruda` debug tool shipped to production                                                                                                                                                                           |
| 🟠 High     | 3     | Duplicate YouTube matching logic, process-local concurrency/rate-limit, ObjectId validation gaps                                                                                                                   |
| 🟡 Medium   | 7     | Post-response async ops in serverless, iTunes enrichment blocking response, N+1-ish batch DB pattern, polling hotspot, rate-limit key normalization, `playNext` for-loop confusion, missing `'imported'` status UI |
| 🟢 Low      | 4     | No token refresh/revocation, missing `Track.youtubeVideoId` index, no CSRF tokens, no request body size limits                                                                                                     |
| 📄 Docs     | 5     | Status enum mismatch × 2, undocumented endpoints, wrong API contract in README, stale "Known Limitations" section                                                                                                  |

---

## 2. Architecture Analysis

### 2.1 Playlist Import Pipeline

The pipeline is correctly structured and follows the fire-and-forget contract defined in the architecture rules.

```
POST /api/import-playlist
  │
  ├─ extractPlaylistId()         ✅ defensive, handles URL/URI/raw ID
  ├─ getPublicPlaylistData()     ✅ no API keys, public embed scrape
  ├─ Track.bulkWrite()           ✅ single batch OP, not N individual upserts
  ├─ Track.find({ $in: ... })    ✅ single batch fetch, O(1) map lookup
  ├─ Playlist.findOneAndUpdate() ✅ upsert with proper field split
  ├─ res.status(200).json(...)   ✅ responds before background work
  └─ atomic guard + batchMatchTracks ← ⚠️  See §4.2 post-response async gap
```

**Positive observations:**

- `$set` updates mutable metadata (name, artists, album) on every import; `$setOnInsert` correctly protects `importedAt` and never overwrites `youtubeVideoId`. This is the correct upsert pattern.
- The atomic guard (`findOneAndUpdate` with `status: { $ne: 'matching' }`) correctly prevents duplicate background tasks.
- The defensive re-check inside `batchMatchTracks` (re-reading `youtubeVideoId` before each search) correctly handles the scenario where another playlist's background task has already matched the same track — a cross-playlist cache hit.

### 2.2 Background Matching Architecture

The `batchMatchTracks` function in `lib/youtube.js` correctly implements:

- Sequential processing with jitter delay
- A module-level global queue (`enqueue()`) to serialize all yt-search calls within a process
- Progress updates after each track
- `retryAfter` cooldown on rate-limit pause
- An optional `delayMs` parameter (allowing tests to pass `0`)

**Gap:** The global queue is a module-level `Promise` chain. It only serializes work within a single Node.js process (see §3.2).

### 2.3 Duplicate YouTube Matching Implementations

This is the single most impactful code quality issue in the repository.

There are **two completely separate YouTube matching implementations:**

| Aspect                      | `lib/youtube.js::searchYouTubeTrack`  | `lib/youtubeMatcher.js::findYouTubeMatch`  |
| --------------------------- | ------------------------------------- | ------------------------------------------ |
| Used by                     | `batchMatchTracks` (background batch) | `POST /api/match-youtube` (on-demand play) |
| Query format                | `"{name} - {artist} Official Audio"`  | `"{artist} {title} official audio"`        |
| Candidates evaluated        | Top 5                                 | Top 8                                      |
| Duration scoring            | ✅ ±15s = +10 pts                     | ❌ Not implemented                         |
| VEVO channel bonus          | ✅ +3 pts                             | ❌ Not implemented                         |
| "official" bonus            | ✅ +2 pts                             | ✅ +2 pts                                  |
| Artist name in title        | ❌ Not checked                        | ✅ +5 pts                                  |
| Track name in title         | ❌ Not checked                        | ✅ +5 pts                                  |
| Routed through global queue | ✅ Yes                                | ❌ No                                      |
| Fallback on score ≤ 0       | ✅ First result                       | ✅ First result                            |

**Impact:** A track matched during batch import may resolve to a different YouTube video than the same track matched on-demand during playback. The quality difference is material — `searchYouTubeTrack` has duration scoring (the highest-value signal at +10) while `findYouTubeMatch` does not. The two implementations will also diverge further as the codebase evolves, making maintenance increasingly error-prone.

### 2.4 Player Lifecycle and IFrame Integration

The `GlobalPlayer` → `PlayerContext` → `Player` architecture is correctly designed.

**Positive observations:**

- Single `YT.Player` instance created once in `GlobalPlayer`, shared via context, never recreated on navigation.
- The three-case initialization in `GlobalPlayer` (API already loaded / script tag exists but not ready / script tag missing) is robust.
- iOS Safari constraint (1×1px / opacity:0 — never `display:none`) is correctly handled.
- Stale-closure prevention via ref mirroring (`queueRef`, `currentIndexRef`, `volumeRef`, `playNextRef`) is correctly implemented for the `onStateChange` callback.
- The `ENDED` state guard (`getCurrentTime() > 2`) prevents accidental auto-advance on video load failure.

**Gap:** The `playNext` and `playPrevious` functions use a for-loop pattern that always exits on the first iteration (see §5.3).

### 2.5 Data Flow: Frontend ↔ API

The status polling architecture (lightweight `/status` endpoint during matching, full load only on `ready`) is well-designed. The flow is:

```
Import → status: 'imported' → (atomic guard) → 'matching'
         ↓
         Frontend polls /api/playlist/[id]/status every 3s
         ↓
         On 'ready': fetch full /api/playlist/[id]
         On 'paused'/'error': show resume button
```

**Gap:** The `'imported'` status is exposed to the client in the import response and triggers polling, but the frontend status badge only handles `'matching'`, `'paused'`, and `'error'` (see §5.4). A playlist in `'imported'` state (between import response and the atomic guard flip) shows no status indicator.

---

## 3. Scalability Risks

### 3.1 MongoDB Query Patterns

| Query                                                                           | Location         | Index Used                                    | Notes                             |
| ------------------------------------------------------------------------------- | ---------------- | --------------------------------------------- | --------------------------------- |
| `Track.find({ spotifyId: { $in: [...] } })`                                     | import-playlist  | ✅ unique index on `spotifyId`                | Efficient                         |
| `Playlist.find({ user: req.user._id })`                                         | playlists.js     | ✅ index on `user`                            | Efficient                         |
| `Playlist.findOne({ _id, user })`                                               | playlist/[id]    | ✅ PK + user filter                           | Efficient                         |
| `Track.find({ _id: { $in: playlist.tracks }, $or: [youtubeVideoId: null...] })` | youtube-match.js | ⚠️ No index on `youtubeVideoId`               | Full scan of the `$in` result set |
| `Playlist.updateMany({ status: 'matching', updatedAt: { $lt: ... } })`          | recovery sweep   | ⚠️ No compound index on `{status, updatedAt}` | Full collection scan on recovery  |

**Missing indexes:**

1. `Track.youtubeVideoId` — needed by the unmatched-track query in `youtube-match.js`
2. `Playlist.{ status: 1, updatedAt: 1 }` — needed by the startup recovery sweep

### 3.2 Global Concurrency Queue is Process-Local

**This is the most significant scalability gap in the codebase.**

`lib/youtube.js` declares:

```javascript
let globalQueue = Promise.resolve(); // module-level
```

This variable exists in a single Node.js process's memory. In any of the following deployment topologies, it provides **no cross-process protection**:

- `next start` with Node.js Cluster (`pm2 -i 4`)
- Docker with multiple replicas
- Vercel / serverless functions (every invocation is a separate process)
- Any PaaS with auto-scaling

In those environments, multiple `batchMatchTracks` goroutines across different processes can issue yt-search requests simultaneously. With 10 concurrent users each importing a playlist, that's potentially 10 simultaneous yt-search HTTP requests with no inter-request delay — exactly the pattern that triggers YouTube IP blocking.

**At ~100–1,000 concurrent active imports, YouTube IP bans become near-certain.**

The README's "Known Limitations" acknowledges the lack of a global semaphore, but the current in-process queue does fully solve the single-process case.

### 3.3 Rate Limiter is Process-Local

Same architectural constraint as §3.2. The `rateMap` in `lib/rateLimit.js` is in-memory and per-process. On a multi-process deployment:

- A user can send N requests to process A and N requests to process B, effectively doubling their allowed throughput.
- Rate limits reset on process restart.

The README correctly acknowledges this in its Known Limitations.

### 3.4 N+1-ish DB Operations in batchMatchTracks

For each track in a batch, `batchMatchTracks` performs up to **3 sequential MongoDB operations**:

1. `Track.findById(track._id).select('youtubeVideoId')` — defensive re-check
2. `Track.updateOne({ _id }, { $set: { youtubeVideoId } })`
3. `Playlist.updateOne({ _id: playlistId }, { $set: { importProgress } })`

For a 500-track playlist: up to **1,500 sequential MongoDB round trips**, all happening during a background job. The per-track progress update to Playlist (operation 3) is the least necessary — it fires after every single track but the polling client only reads it every 3 seconds.

### 3.5 iTunes Enrichment Blocks the Import Response

In `lib/spotify.js`, `enrichTracksWithItunes()` is called **before** the response is sent when tracks arrive via Spotify's embed format (Format A / `trackList`). This format lacks album name and artwork, requiring a fallback to the iTunes API.

For a 100-track playlist needing enrichment, with batches of 5 at 300ms/batch:

```
Batches = ceil(100 / 5) = 20
Time ≈ 20 × 300ms = 6 seconds of added response latency
```

Plus up to 3 retry cycles with exponential backoff per track in the worst case. **The user-facing import endpoint can block for 10+ seconds on large playlists**, which violates the spirit of the fire-and-forget architecture.

### 3.6 Status Poll Endpoint Has No Rate Limit

`GET /api/playlist/[id]/status` is a read-only endpoint, deliberately unprotected per the architecture rules (read-only endpoints don't require rate limiting). However, at scale:

- 10,000 users × 1 active import × 1 poll/3s = **~3,333 requests/sec** to this single endpoint
- No HTTP caching headers are set on the response (it would be incorrect to cache it, but short-lived CDN caching of ~2s could absorb the load)

This endpoint is a future hotspot. Its lightweight design (select + lean, no populate) is correct, but it will be the first endpoint to bottleneck under load.

---

## 4. Reliability Issues

### 4.1 Startup Recovery Sweep

`lib/mongodb.js::recoverStuckPlaylists()` correctly handles playlists stuck in `'matching'` after a process crash. Observations:

- The 5-minute threshold is reasonable. However, playlists can remain stuck for the full 5 minutes before recovery on process restart.
- The recovery runs only once per process lifetime (`global.__matchingRecoveryRan`). If MongoDB disconnects and reconnects without a full process restart, the sweep does not re-run. This is acceptable — the main crash scenario is covered.
- The dynamic import (`await import('@/models/Playlist')`) correctly avoids circular dependency at load time.
- **The sweep uses `updatedAt` to identify stuck playlists, but `updatedAt` is a Mongoose `timestamps` auto-field.** It will be updated by the sweep itself when it sets `status: 'paused'` — this is fine for the subsequent run, but means the `updatedAt: { $lt: fiveMinutesAgo }` condition is technically checking "last modified greater than 5 minutes ago" rather than "started matching more than 5 minutes ago." A dedicated `matchingStartedAt` field would be more precise.

### 4.2 Post-Response Async Operations

In `import-playlist.js`, after `res.status(200).json(...)` is called, the following **awaited** operations still execute:

```javascript
res.status(200).json({ ... }); // response sent here

// ↓ This runs AFTER the response — could be killed in serverless
if (uncachedTracks.length > 0) {
    const canMatch = await Playlist.findOneAndUpdate(  // async DB op
        { _id: playlist._id, status: { $ne: 'matching' } },
        { $set: { status: 'matching' } }
    );

    if (canMatch) {
        batchMatchTracks(...).catch(...); // fire-and-forget
    }
}
```

On a persistent Node.js server this works correctly. On serverless platforms (Vercel, AWS Lambda, Netlify), **the function execution environment may be frozen or recycled immediately after the response is sent**, before the `await Playlist.findOneAndUpdate(...)` completes. The playlist status would remain `'imported'` permanently, and `batchMatchTracks` would never start.

**Mitigation:** Vercel-specific: `res.end()` is not equivalent to process termination in Vercel Edge Functions, but in Vercel Serverless Functions the Node.js process is frozen. This is a deployment-environment concern, but it needs to be addressed before any serverless deployment.

### 4.3 No Retry Logic for Transient Errors

`batchMatchTracks` halts the entire batch on the **first yt-search error**, regardless of whether the error is transient (network timeout, DNS hiccup) or persistent (IP block). All unmatched tracks for the playlist remain unmatched, and the playlist is moved to `'paused'`.

**Impact:** A single 500ms DNS timeout during a 500-track batch causes all remaining 499 tracks to require manual resume. The correct pattern is to retry transient errors 2–3 times before treating the error as persistent.

### 4.4 No Retry Logic for Individual Track Match Failures

If `searchYouTubeTrack` returns `null` (no results found — not an exception), `batchMatchTracks` skips the `Track.updateOne` call and moves on. The track permanently has `youtubeVideoId: null`. There is no mechanism to retry zero-result tracks.

**Impact:** Obscure or newly released tracks may silently fail to match and the user never knows. The playlist shows `status: 'ready'` even if 10% of tracks have no YouTube match.

---

## 5. Security Concerns

### 5.1 🔴 CRITICAL: Eruda Debug Tool Shipped to Production

In `pages/_app.js`:

```javascript
useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/eruda"; // loaded in ALL environments
    script.onload = () => window.eruda.init();
    document.body.appendChild(script);
}, []);
```

**Eruda is a mobile browser DevTools panel.** When loaded, it injects a floating button that opens a full debugging interface exposing:

- All console logs (including error stack traces with internal paths)
- All network requests and their response payloads (JWT cookies in Set-Cookie headers, full API responses)
- DOM inspection
- JavaScript execution console

**This runs unconditionally in production for every user on every page load.** It also introduces an uncontrolled third-party CDN dependency: a compromised jsdelivr CDN delivering malicious JavaScript would execute with full page privileges.

**This must be removed or gated behind `process.env.NODE_ENV === 'development'` before any production deployment.**

### 5.2 Missing ObjectId Validation

Two API routes accept user-supplied ObjectId parameters but do not validate their format before the DB query:

**`GET /api/stream/[trackId]`:**

```javascript
const { trackId } = req.query;
if (!trackId) { ... }  // only checks for missing — no format validation
const track = await Track.findById(trackId).lean();  // throws CastError on invalid format
```

**`GET /api/playlist/[id]` (index.js):**

```javascript
const { id } = req.query;
if (!id) { ... }  // only checks for missing
const playlist = await Playlist.findOne({ _id: id, ... })  // throws CastError
```

The generic `catch` block returns a 500 error for invalid ObjectId strings instead of a 400. While not directly exploitable, it leaks the error type to the client and inflates error monitoring noise. The pattern used in `status.js` and `youtube-match.js` (`mongoose.Types.ObjectId.isValid(id)`) should be applied uniformly.

### 5.3 Rate Limit Key Not Normalized for Proxy Chains

`lib/rateLimit.js`:

```javascript
const ip =
    req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
```

When deployed behind a load balancer or CDN, `x-forwarded-for` is a comma-separated list of IPs representing the full proxy chain:

```
x-forwarded-for: 1.2.3.4, 10.0.0.1, 10.0.0.2
```

The entire string is used as the rate-limit key. This means:

- `"1.2.3.4, 10.0.0.1"` and `"1.2.3.4, 10.0.0.2"` are treated as **different clients** — the same browser behind two paths gets double the rate limit.
- `"1.2.3.4"` (direct connection) and `"1.2.3.4, proxy"` (same IP through proxy) are **different keys**.

The fix is to always take the **leftmost** IP: `ip.split(',')[0].trim()`.

### 5.4 Authentication: JWT Weaknesses

The JWT/cookie implementation is correct in its fundamentals (httpOnly, secure in prod, sameSite: lax). Two gaps:

1. **No token revocation mechanism.** Once issued, a JWT is valid for 7 days regardless of logout, password change, or account deletion. `logout.js` clears the cookie client-side, but a stolen token (e.g., via XSS, network interception in dev) remains valid.

2. **No token refresh.** When a session expires in 7 days, the user is silently logged out. There is no seamless refresh flow.

_These are acceptable tradeoffs for a prototype but should be revisited for production._

### 5.5 No CSRF Protection

The application relies on `sameSite: 'lax'` cookies, which provides protection against cross-site form submissions but not against same-site requests. A full CSRF token implementation would add defense-in-depth, particularly if the application is ever served on a shared domain.

_Low severity given `sameSite: 'lax'` mitigation._

---

## 6. Code Quality Observations

### 6.1 Duplicate YouTube Matching Logic (Expanded)

Restated from §2.3 as a code quality issue. The two implementations (`lib/youtube.js` and `lib/youtubeMatcher.js`) create:

1. **Inconsistent match quality:** Batch-matched tracks and on-demand-matched tracks use different algorithms, so re-playing a track that hits the on-demand path gets a different (potentially worse) result.
2. **Maintenance burden:** Tuning the scoring algorithm requires two edits in two files.
3. **Testing surface doubled:** Any change must be verified against both code paths.

### 6.2 `playNext` / `playPrevious` For-Loop Anti-Pattern

`context/PlayerContext.js`:

```javascript
const playNext = useCallback(() => {
    const q = queueRef.current;
    const idx = currentIndexRef.current;
    if (!q || idx >= q.length - 1) return;

    for (let i = idx + 1; i < q.length; i++) {
        playTrack(q[i], i);
        return; // always exits on first iteration
    }
}, [playTrack]);
```

The `for` loop always executes exactly one iteration. The original design intent was likely to **skip tracks without a `youtubeVideoId`** (advancing to the next playable track), but the current code does not check `q[i].youtubeVideoId`. The loop is therefore misleading — it behaves identically to `playTrack(q[idx + 1], idx + 1)` and should be simplified accordingly, or the skip logic should be implemented.

### 6.3 `'imported'` Status Has No UI Representation

`pages/index.js` starts polling whenever `activePlaylist.status` is not `'ready'`, `'paused'`, or `'error'`. This correctly covers the `'imported'` and `'matching'` intermediate states.

However, the status badge in the playlist header only renders text for `'matching'`, `'paused'`, and `'error'`:

```javascript
{
    activePlaylist.status === "matching" ? " — Finding YouTube matches..."
    : activePlaylist.status === "paused" ? " — Paused (rate limited)"
    : activePlaylist.status === "error" ? " — Error"
    : "";
} // 'imported' falls here — shows nothing
```

During the brief window when status is `'imported'` (between import confirmation and the atomic guard flip), the UI shows no status indicator, which may confuse users who see no activity after clicking Import.

### 6.4 Eruda in `_app.js` (Code Quality Angle)

Beyond the security concern (§5.1), eruda is a development-only debugging utility that has no business being in `_app.js` without an environment guard. It should be removed from `_app.js` entirely and used only through browser developer tools or via a dedicated dev-only component.

### 6.5 Error Handling Consistency

The codebase is mostly consistent in its error handling patterns, with one exception: `GET /api/stream/[trackId]` and `GET /api/playlist/[id]` (without ObjectId validation) will return a 500 for invalid IDs instead of the correct 400, creating a subtle but observable inconsistency in the error contract.

Additionally, `batchMatchTracks` catches all errors uniformly and treats them as rate-limit/IP-block events, pausing the playlist. A network timeout (ETIMEDOUT) and an actual 429 response from YouTube are handled identically. Differentiating error types would allow smarter retry behavior.

### 6.6 `lib/match-youtube.js` Not Listed in AGENT.md Route Table

The `POST /api/match-youtube` endpoint (for on-demand track matching during playback) is not listed in the AGENT.md API route table. Agents working on the codebase without reading the file directly will be unaware of this endpoint's existence and responsibilities.

---

## 7. Documentation Inconsistencies

This section compares AGENT.md, README.md, and the actual codebase.

### 7.1 Playlist Status Enum — Three-Way Mismatch

| Source                              | Status Values                                                                                                   |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Actual `models/Playlist.js`**     | `'imported'`, `'matching'`, `'ready'`, `'paused'`, `'error'`                                                    |
| **AGENT.md (File Map section)**     | `'matching'`, `'ready'`, `'paused'`, `'error'` — **missing `'imported'`**                                       |
| **README.md (Data Models section)** | `'importing'`, `'matching'`, `'ready'`, `'error'` — **wrong: `'importing'` ≠ `'imported'`; missing `'paused'`** |

Both documentation files are incorrect. AGENT.md's import pipeline notes do describe `'imported'` in prose, but the model field enum description does not include it. README.md uses the non-existent value `'importing'`.

### 7.2 README.md: Auth Endpoints Not Rate-Limited

AGENT.md route table says auth/signup.js and auth/login.js are "Rate Limited: No." The actual code:

```javascript
// signup.js
export default withRateLimit(handler, 5, 60_000); // ← IS rate limited

// login.js
export default withRateLimit(handler, 10, 60_000); // ← IS rate limited
```

Both endpoints ARE rate limited in the implementation. The AGENT.md table is incorrect.

### 7.3 README.md: Wrong API Contract for `POST /api/youtube-match`

README.md documents this endpoint as:

> **Request body:** `{ "trackId": "<mongoId>" }` or `{ "spotifyId": "<spotifyTrackId>" }`
> **Response:** `{ "success": true, "track": { "id": "...", "name": "...", "youtubeVideoId": "..." } }`

**Actual implementation (`pages/api/youtube-match.js`):**

- **Request body:** `{ "playlistId": "<mongoId>" }` — resumes matching for a **paused playlist**, not a single track
- **Response:** `{ "success": true, "message": "Resumed matching", "remaining": 5 }`

The README describes a completely different endpoint. The actual on-demand single-track matching is handled by `POST /api/match-youtube` (note: different filename, not documented in README at all).

### 7.4 README.md: `POST /api/import-playlist` Response Field Mismatch

README documents the response as:

```json
{ "tracksToMatch": 50 }
```

Actual response field:

```javascript
{ "uncachedTracks": uncachedTracks.length }
```

The field name `tracksToMatch` does not exist in the implementation; it is `uncachedTracks`.

README also states the status flow as `importing → matching` but the actual flow is `imported → matching`.

### 7.5 README.md "Known Limitations" Are Stale

The README lists two limitations that have since been implemented and are no longer accurate:

| README Claim                                                                                                               | Actual State                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| "No Startup Recovery: If the server restarts while a playlist is 'matching', the status is never automatically recovered." | ❌ **Incorrect.** `lib/mongodb.js::recoverStuckPlaylists()` handles exactly this scenario.                                           |
| "No Concurrency Guard (at scale): Multiple simultaneous playlist imports each run their own batchMatchTracks loop."        | ❌ **Incorrect** (for single-process deployments). `lib/youtube.js::enqueue()` provides a global concurrency queue within a process. |

These should be updated to reflect the current state of the implementation. The multi-process limitation should be noted instead.

### 7.6 `GET /api/playlist/[id]/status` Not Documented

The lightweight status polling endpoint is not listed in AGENT.md's route table or README's API Reference. Since the frontend relies on it for polling during matching, it should be documented.

---

## 8. Recommended Improvements

Each recommendation includes the issue, its impact, the proposed solution, and implementation difficulty.

---

### R1 — Remove Eruda from `_app.js`

**Issue:** `eruda` is loaded unconditionally on every page load, including in production.
**Impact:** Exposes application internals to all end users; introduces third-party CDN dependency; wastes bandwidth.
**Proposed solution:** Remove the `useEffect` block from `_app.js` entirely.
**Difficulty:** 🟢 Low (delete 6 lines)

---

### R2 — Unify YouTube Matching into a Single Implementation

**Issue:** `lib/youtube.js::searchYouTubeTrack` and `lib/youtubeMatcher.js::findYouTubeMatch` are two diverged implementations with different algorithms and query formats.
**Impact:** Inconsistent match quality between batch-import and on-demand playback paths; doubled maintenance burden for any algorithm tuning.
**Proposed solution:** Delete `lib/youtubeMatcher.js`. Update `POST /api/match-youtube` (the on-demand playback endpoint) to use `searchYouTubeTrack` from `lib/youtube.js`. The `findYouTubeMatch` function is not routed through the global queue — this migration would also fix that gap.
**Difficulty:** 🟢 Low (swap one import, delete one file)

---

### R3 — Gate Post-Response Async Operations

**Issue:** The atomic guard and `batchMatchTracks` invocation happen after `res.json()` is sent in `import-playlist.js`, risking silent failure in serverless environments.
**Impact:** Playlists could silently get stuck in `'imported'` status forever if the process terminates before the post-response code executes.
**Proposed solution:** Move the atomic guard and `batchMatchTracks` call to a dedicated internal function. On serverless deployments, use the platform's "background task" API (`waitUntil` in Vercel/Cloudflare) to keep the process alive. On traditional Node.js deployments, the current pattern works correctly and only needs documentation clarification.
**Difficulty:** 🟡 Medium (deployment-topology-dependent; refactoring is straightforward, testing requires a serverless environment)

---

### R4 — Add ObjectId Validation to All Dynamic Routes

**Issue:** `GET /api/stream/[trackId]` and `GET /api/playlist/[id]` don't validate the ID format, returning a 500 for invalid strings.
**Impact:** Inconsistent error contract (400 vs 500 for client errors); inflates error monitoring noise; potential information leak in stack traces.
**Proposed solution:** Add `if (!mongoose.Types.ObjectId.isValid(id))` guard at the top of both handlers, returning `res.status(400).json({ error: 'Invalid ID format' })`. The pattern already exists in `status.js` and `youtube-match.js` — standardize it across all routes.
**Difficulty:** 🟢 Low (2 files, ~3 lines each)

---

### R5 — Normalize `x-forwarded-for` Rate Limit Key

**Issue:** The full `x-forwarded-for` header string is used as the rate-limit key, causing bypass scenarios in proxy chains.
**Impact:** A single client can exhaust double (or more) their rate limit by arriving through different proxy paths.
**Proposed solution:**

```javascript
const rawIp =
    req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
const ip = rawIp.split(",")[0].trim(); // always use the leftmost (client) IP
```

**Difficulty:** 🟢 Low (1 line change in `rateLimit.js`)

---

### R6 — Move iTunes Enrichment to Post-Response Background Work

**Issue:** `enrichTracksWithItunes()` blocks the import response for playlists using the embed trackList format, adding up to 10+ seconds of latency before the user receives their import confirmation.
**Impact:** Severely degrades user experience for large playlists; violates the fire-and-forget architecture principle.
**Proposed solution:** Return the response with tracks having `album: 'Unknown Album'` and `albumImage: null`. Run enrichment as a second background step, stored back to MongoDB. The frontend already handles null album art with a placeholder image. Enriched data will appear on the next playlist load.
**Difficulty:** 🟡 Medium (requires refactoring enrichment to run after `res.json()`, storage back to DB)

---

### R7 — Reduce Per-Track DB Operations in `batchMatchTracks`

**Issue:** Up to 3 sequential DB operations per track (re-check, update, progress update) for a potential 1,500 operations on a 500-track playlist.
**Impact:** MongoDB write amplification; sequential DB round trips add significant wall-clock time to the background task.
**Proposed solutions:**

1. **Progress batching:** Only update `importProgress` every N tracks (e.g., every 5 or every 10%) instead of after each one. The polling client reads it every 3 seconds — sub-track granularity is invisible to the UI.
2. **Bulk track updates:** Collect matched `{ _id, videoId }` pairs and write them with a single `Track.bulkWrite()` every batch of 10, rather than individual `updateOne` calls. The defensive re-check can be done with a single `Track.find({ _id: { $in: batchIds }, youtubeVideoId: null })` before the batch search.
   **Difficulty:** 🟡 Medium (careful ordering to preserve correctness)

---

### R8 — Add Missing Database Indexes

**Issue:** Two queries lack appropriate supporting indexes.
**Impact:** Collection scans on the Track and Playlist collections become increasingly expensive as data grows.
**Proposed solution:** Add to models:

```javascript
// Track.js
TrackSchema.index({ youtubeVideoId: 1 });

// Playlist.js
PlaylistSchema.index({ status: 1, updatedAt: 1 });
```

**Difficulty:** 🟢 Low (2 lines, no code changes required)

---

### R9 — Add Retry Logic for Transient yt-search Errors

**Issue:** A single transient network error halts the entire batch and pauses the playlist.
**Impact:** Users must manually resume playlists for errors that would have resolved on a retry.
**Proposed solution:** Wrap `enqueue()` call with a small retry loop (max 2–3 retries with exponential backoff for `ECONNRESET`, `ETIMEDOUT`, `EAI_AGAIN`). Only pause the playlist for persistent errors (e.g., consistent 5xx responses, or after exhausting retries).
**Difficulty:** 🟡 Medium (error classification logic required)

---

### R10 — Add UI Badge for `'imported'` Status

**Issue:** The status badge in the playlist header has no case for `'imported'`, leaving a blank indicator during the brief transition period.
**Impact:** Minor UX confusion — users may think nothing is happening after clicking Import.
**Proposed solution:** Add a `'imported'` case to the status badge ternary:

```javascript
activePlaylist.status === 'imported' ? ' — Preparing...' : ...
```

**Difficulty:** 🟢 Low (1 line)

---

### R11 — Add a `matchedCount` Field to Playlist

**Issue:** When a playlist reaches `status: 'ready'`, there is no record of how many tracks were actually matched successfully vs. how many have `youtubeVideoId: null` (silent no-match failures).
**Impact:** Users cannot identify unmatched tracks. The system cannot surface "10/50 tracks matched" feedback.
**Proposed solution:** Add `matchedCount: { type: Number, default: 0 }` to the Playlist schema. Increment it in `batchMatchTracks` when a match is found. Expose it from `GET /api/playlist/[id]`.
**Difficulty:** 🟢 Low

---

### R12 — Simplify `playNext` / `playPrevious` or Implement Skip Logic

**Issue:** The for-loop in these functions always exits on the first iteration and is misleading.
**Impact:** Code readability; if the intent was to skip unmatched tracks, the feature is unimplemented.
**Proposed solution:**

- **Option A (simplify):** Replace the loop with a direct index increment: `playTrack(q[idx + 1], idx + 1)`.
- **Option B (add skip logic):** Implement actual skip-unmatched behavior: iterate forward, skip tracks where `!q[i].youtubeVideoId`, play the first available one.
  **Difficulty:** 🟢 Low

---

### R13 — Fix Documentation Inconsistencies

**Issue:** Multiple mismatches between AGENT.md, README.md, and implementation (documented in §7).
**Impact:** AI agents and contributors working from documentation will have incorrect assumptions about the system.
**Proposed solution:** Update AGENT.md and README.md to reflect:

1. Correct status enum: `'imported'`, `'matching'`, `'ready'`, `'paused'`, `'error'`
2. Auth endpoints ARE rate-limited (signup: 5/min, login: 10/min)
3. `POST /api/youtube-match` correct contract (takes `{ playlistId }`, resumes paused playlist)
4. `POST /api/match-youtube` added to route table (on-demand single-track matching)
5. `GET /api/playlist/[id]/status` added to route table
6. Response field `uncachedTracks` (not `tracksToMatch`)
7. "Known Limitations" updated: startup recovery and per-process concurrency queue both exist; document the multi-process gap instead
   **Difficulty:** 🟢 Low (documentation only)

---

## Summary Table

| #   | Issue                             | Severity    | Difficulty |
| --- | --------------------------------- | ----------- | ---------- |
| R1  | Eruda in production               | 🔴 Critical | 🟢 Low     |
| R2  | Duplicate YouTube matching        | 🟠 High     | 🟢 Low     |
| R3  | Post-response async in serverless | 🟠 High     | 🟡 Medium  |
| R4  | Missing ObjectId validation       | 🟠 High     | 🟢 Low     |
| R5  | Rate limit key not normalized     | 🟡 Medium   | 🟢 Low     |
| R6  | iTunes enrichment blocks response | 🟡 Medium   | 🟡 Medium  |
| R7  | 3 DB ops per track in batch       | 🟡 Medium   | 🟡 Medium  |
| R8  | Missing DB indexes                | 🟡 Medium   | 🟢 Low     |
| R9  | No retry for transient errors     | 🟡 Medium   | 🟡 Medium  |
| R10 | Missing 'imported' status badge   | 🟡 Medium   | 🟢 Low     |
| R11 | No `matchedCount` tracking        | 🟢 Low      | 🟢 Low     |
| R12 | playNext for-loop confusion       | 🟢 Low      | 🟢 Low     |
| R13 | Documentation inconsistencies     | 📄 Docs     | 🟢 Low     |

---

_This report is analysis-only. No code has been modified. Proceed to implementation once the findings have been reviewed and priorities confirmed._
