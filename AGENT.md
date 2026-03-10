# Agent Context — Demus

This file provides authoritative context for AI coding agents working in this repository. Read this **in full** before making any changes.

---

## Project Identity

| Field               | Value                                                                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **App name**        | Demus ("Your Music, Your Way")                                                                                                                                                            |
| **Folder name**     | `Pro-Music-App`                                                                                                                                                                           |
| **Purpose**         | Full-stack music streaming PWA. Authenticated users import public Spotify playlists; tracks are matched to YouTube videos via `yt-search` scraping and played via the YouTube IFrame API. |
| **Framework**       | Next.js 16 — **Pages Router only** (not App Router)                                                                                                                                       |
| **Production port** | `4072` (set in `package.json` start script)                                                                                                                                               |

---

## Critical Architecture Rules

1. **Never use the App Router.** Use `pages/` exclusively. Do not create `app/` or use `"use client"` / `"use server"` directives.
2. **No Spotify API keys.** Spotify data is scraped via `spotify-url-info` from the public embed page. Never add Spotify OAuth or Spotify Web API credentials.
3. **`yt-search` for matching, NOT the YouTube Data API.** We bypass the 10,000-unit quota limit. Do not add `googleapis`.
4. **Global Track Caching.** Always check `youtubeVideoId` before searching. The DB is a global cache shared across all users. Never search for the same track twice.
5. **YouTube IFrame API for playback — no server proxying.** Music streams through a hidden `window.YT.Player`. Never proxy audio bytes. Do not add `ytdl-core`.
6. **MongoDB via Mongoose.** Always call `connectDB()` inside every API handler before DB ops. Never instantiate a Mongoose connection outside a handler.
7. **Rate limiting on write/auth endpoints.** Wrap modifying handlers with `withRateLimit()`. Auth endpoints (login, signup) are also rate-limited.
8. **Authentication is required for all playlist/import operations.** Wrap handlers with `requireAuth()` from `lib/requireAuth.js`. `req.user` is populated by the wrapper.
9. **Fire-and-forget background work.** Long-running tasks (YouTube matching) must respond to the client immediately, then run async. Set Playlist status to `'paused'` on failure; never `await` before responding.
10. **Dual concurrency control for `yt-search`.** Batch playlist matching goes through the **Redis queue** (`demus:ytmatch:queue`) consumed by `ytMatchWorker`. Single-track client-triggered matches go through the **in-process promise chain** (`enqueue(fn)`) in `lib/youtube.js`. Both guarantee max 1 yt-search at a time across their respective paths.

---

## Path Aliases

`jsconfig.json` maps `@/` to the project root. Always use:

```js
import { connectDB } from "@/lib/mongodb";
import Track from "@/models/Track";
```

Never use relative `../../` paths.

---

## Environment Variables

| Variable      | Required | Description                                                                             |
| ------------- | -------- | --------------------------------------------------------------------------------------- |
| `MONGODB_URI` | **Yes**  | MongoDB connection string                                                               |
| `JWT_SECRET`  | **Yes**  | Secret for signing/verifying JWTs (min 32 chars recommended)                            |
| `REDIS_URL`   | **No**   | Redis connection URL — optional performance cache layer (e.g. `redis://localhost:6379`) |

Create `.env.local` in the project root. `lib/mongodb.js` throws at startup if `MONGODB_URI` is missing. `lib/auth.js` throws if `JWT_SECRET` is missing. If `REDIS_URL` is absent or Redis is unreachable, the app continues normally (Redis is an optional performance layer).

> `YOUTUBE_API_KEY` and Spotify developer credentials are **not required** and **not used**.

---

## Redis Usage

Redis is an **optional performance layer only**. MongoDB remains the source of truth for all application data. If Redis is unavailable the application must continue functioning normally.

### Redis is responsible for

- **YouTube Match Queue** — `RPUSH`/`BLPOP` list `demus:ytmatch:queue` used by `ytMatchWorker` process
- Hot track metadata caching for `/api/stream` (key: `stream:track:<trackId>`, TTL 6 h)
- Distributed rate limiting (sliding-window sorted-set, key: `ratelimit:<ip>:<endpoint>`)

### Redis must NOT be used for

- Storing persistent music data
- Replacing MongoDB
- Proxying audio streams
- Auth session storage (JWT cookies handle that)

### Implementation files

| File                    | Responsibility                                                        |
| ----------------------- | --------------------------------------------------------------------- |
| `lib/redis.js`          | ioredis singleton — `getRedis()` returns client or `null`             |
| `lib/redisQueue.js`     | `enqueueYouTubeMatch(job)` — RPUSH to `demus:ytmatch:queue`           |
| `lib/redisRateLimit.js` | Sliding-window rate limiter backed by Redis sorted sets               |
| `workers/ytMatchWorker.js` | Standalone BLPOP consumer — processes one yt-search job at a time |

All Redis calls must be wrapped in `try/catch`. On any error, fall back to the MongoDB / in-memory equivalent.

---

## YouTube Matching Architecture (Two-Path System)

```
Path A — Batch playlist import (fire-and-forget):
  POST /api/import-playlist
    └─ batchMatchTracks()
         └─ enqueue(jobObject)              ← lib/youtube.js
              └─ enqueueYouTubeMatch(job)   ← lib/redisQueue.js
                   └─ redis.rpush(demus:ytmatch:queue, job)
                            ↓
                   ytMatchWorker (long-running Node process)
                        └─ redis.blpop() → processJob()
                             └─ searchYouTubeTrack()
                                  └─ Track.updateOne({ youtubeVideoId })
                                       └─ Playlist.updateOne({ status, progress })

Path B — Client-triggered single track (synchronous):
  POST /api/match-youtube
    └─ enqueue(() => searchYouTubeTrack(...))  ← in-process promise chain
         └─ searchYouTubeTrack()
              └─ Track.updateOne({ youtubeVideoId })
```

**Critical:** `batchMatchTracks` passes a **plain object** to `enqueue()` (routed to Redis worker). The `match-youtube` API passes a **function** to `enqueue()` (routed to in-process chain). Do not mix these paths.

---

## File Map & Responsibilities

### `lib/`

| File                  | Responsibility                                                                           | Key Exports                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `mongodb.js`          | Singleton Mongoose connection with global hot-reload cache                               | `connectDB()`                                                                                                     |
| `redis.js`            | Optional ioredis singleton with automatic fallback to `null`                             | `getRedis()`                                                                                                      |
| `redisQueue.js`       | RPUSH jobs to `demus:ytmatch:queue` for the ytMatchWorker process                        | `enqueueYouTubeMatch(job)`, `QUEUE_KEY`                                                                           |
| `rateLimit.js`        | Sliding-window rate limiter — Redis-backed with in-memory fallback                       | `rateLimit()`, `withRateLimit(handler, max, windowMs)`                                                            |
| `redisRateLimit.js`   | Redis sorted-set sliding-window limiter used by `rateLimit.js`                           | `redisRateLimit(ip, endpoint, max, windowMs)`                                                                     |
| `auth.js`             | JWT sign/verify; extract user from request cookie                                        | `signToken(userId)`, `verifyToken(token)`, `getUserFromRequest(req)`                                              |
| `requireAuth.js`      | HOF that guards API routes — populates `req.user` or returns 401                         | `requireAuth(handler)`                                                                                            |
| `spotify.js`          | Parse Spotify URLs; scrape public embed page; 3-tier iTunes/SpotifyOG/MusicBrainz enrichment | `extractPlaylistId()`, `getPublicPlaylistData()`, `enrichTracksWithMetadata()`, `runBackgroundItunesEnrichment()` |
| `youtube.js`          | Polymorphic `enqueue()`; `yt-search` with scoring + retry; `batchMatchTracks` (enqueues to Redis) | `enqueue(fnOrJob)`, `searchYouTubeTrack()`, `batchMatchTracks()`                                          |
| `youtubeMatcher.js`   | Standalone lightweight YouTube matcher (used by `match-youtube` route)                   | `findYouTubeMatch(artist, title)`                                                                                 |
| `trackFingerprint.js` | Normalize track name + artist into a stable deduplication key                            | `generateFingerprint(name, artists[])`                                                                            |
| `unlockAudio.js`      | iOS Safari audio unlock (one-time play+pause on first user gesture)                      | `registerAudioUnlock(getPlayer)`, `isAudioUnlocked()`                                                             |
| `AppContext.js`       | React context for auth state, playlists, active playlist, active import, track selection | `AppProvider`, `useAppContext()`                                                                                   |

### `context/`

| File               | Responsibility                                                            | Key Exports                     |
| ------------------ | ------------------------------------------------------------------------- | ------------------------------- |
| `PlayerContext.js` | Global YouTube IFrame player state: queue, shuffle, repeat, time tracking | `PlayerProvider`, `usePlayer()` |

### `models/`

| File          | Schema Fields                                                                                                                                                                                                      | Notes                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `User.js`     | `email` (unique, lowercase), `passwordHash`, `createdAt`                                                                                                                                                           | `passwordHash` stripped from all `.toJSON()` / `.toObject()` outputs                                                  |
| `Track.js`    | `spotifyId` (unique), `name`, `artists[]`, `album`, `duration` (ms), `albumImage`, `youtubeVideoId` (nullable), `fingerprint`, `importedAt`                                                                        | Text index removed — no `$text` search used. `fingerprint` field used for cross-track deduplication in batchMatchTracks |
| `Playlist.js` | `user` (ObjectId ref User), `spotifyPlaylistId`, `name`, `description`, `coverImage`, `owner`, `tracks[]`, `trackCount`, `status` (enum), `importProgress`, `retryAfter`, `pausedAt`, `errorMessage`, `importedBy` | Compound unique index: `{ spotifyPlaylistId, user }` — same playlist can be imported by different users independently |

#### Playlist Status Enum

| Status       | Meaning                                                              |
| ------------ | -------------------------------------------------------------------- |
| `'imported'` | Tracks saved; background matching not started (atomic CAS gate)      |
| `'matching'` | Jobs pushed to Redis queue; ytMatchWorker is/will process them       |
| `'ready'`    | All tracks matched; fully playable                                   |
| `'paused'`   | Worker failed on a track; `retryAfter` set; user can resume manually |
| `'error'`    | Unrecoverable failure                                                |

### `workers/`

| File                | Responsibility                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `ytMatchWorker.js`  | Standalone Node.js BLPOP consumer. Runs `npm run ytmatch:worker`. Max 1 yt-search at a time. Writes `youtubeVideoId` and playlist progress to MongoDB. Pauses playlist on failure with 5-min `retryAfter`. |
| `chartsWorker.js`   | Populates chart playlists from external sources. Run: `npm run populate:charts`.             |
| `artistCrawler.js`  | Crawls and enriches artist metadata. Run: `npm run crawl:artists`.                           |

### `scripts/`

| Script                    | Command                  | Purpose                                            |
| ------------------------- | ------------------------ | -------------------------------------------------- |
| `repairEmptyArtists.js`   | `npm run repair:artists` | Re-enriches tracks with missing artist data        |
| `repairAlbumImages.js`    | `npm run repair:albums`  | Re-enriches tracks with missing album art          |
| `repairMissingFields.js`  | `npm run repair:all`     | Runs all repair passes                             |
| `dbStatus.js`             | `npm run db:status`      | Prints DB stats: track/playlist counts, unmatched  |

---

## pages/api/ Route Map

| Route                     | Method | Auth    | Rate Limit | Description                                                                          |
| ------------------------- | ------ | ------- | ---------- | ------------------------------------------------------------------------------------ |
| `auth/signup.js`          | POST   | No      | 5/min      | Create account (bcrypt hash 12 rounds, JWT cookie)                                   |
| `auth/login.js`           | POST   | No      | 10/min     | Authenticate user, set HTTP-only JWT cookie (7-day)                                  |
| `auth/logout.js`          | POST   | No      | No         | Clear auth cookie (`maxAge -1`)                                                      |
| `auth/me.js`              | GET    | No      | No         | Return current user from JWT cookie, or 401                                          |
| `import-playlist.js`      | POST   | **Yes** | 10/min     | Full import pipeline — saves tracks, enqueues batch match jobs to Redis              |
| `playlists.js`            | GET    | **Yes** | No         | List all playlists owned by authenticated user                                       |
| `playlist/[id]/index.js`  | GET    | **Yes** | No         | Fetch playlist + populated tracks (user-scoped)                                      |
| `playlist/[id]/status.js` | GET    | **Yes** | No         | Lightweight status + progress polling (no track populate)                            |
| `stream/[trackId].js`     | GET    | No      | No         | Return `youtubeVideoId` + embed URL for a track (Redis-cached 6 h)                   |
| `youtube-match.js`        | POST   | **Yes** | 20/min     | Resume matching for a `paused` playlist; enforces `retryAfter` cooldown              |
| `match-youtube.js`        | POST   | No      | No         | Client-triggered single-track YouTube match via in-process promise chain             |
| `repair-enrichment.js`    | POST   | **Yes** | (wrapped)  | Repair tracks missing album/art via 3-tier enrichment pipeline                       |

---

## components/

### Layout Components (`components/layout/`)

| Component                  | Responsibility                                                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `AppLayout.js`             | Shell: Sidebar + Navbar + Player bar + NowPlayingPanel + MobileTabBar + MobileNowPlayingSheet. Bridges AppContext to PlayerContext. |
| `Sidebar.js`               | Left nav: Home link, playlist list, import link. Scroll-spy on home page. Collapsible on mobile.                                    |
| `Navbar.js`                | Top bar with user display name and logout button.                                                                                   |
| `NowPlayingPanel.js`       | Fixed right panel (>=1280px): album art, track info, upcoming 5-track queue.                                                        |
| `MobileTabBar.js`          | Fixed bottom tab bar on mobile: Home, Library, Import, Now Playing.                                                                 |
| `MobileNowPlayingSheet.js` | Full-screen bottom sheet on mobile: playback controls, progress bar, shuffle/repeat.                                                |

### Feature Components (`components/`)

| Component             | Props                                                    | Notes                                                                                         |
| --------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `GlobalPlayer.js`     | none                                                     | Persistent 1x1px hidden YouTube iframe. Mounted once in `_app.js` — survives page navigation. |
| `Player.js`           | `track, playlist, currentIndex, playlistId, onOpenSheet` | Bottom player bar; reads state from PlayerContext.                                            |
| `ImportForm.js`       | `onImportSuccess(playlist)`                              | Calls `POST /api/import-playlist`; shows loading/error state.                                 |
| `TrackList.js`        | `tracks[], currentTrackId, onTrackSelect`                | Pure display; highlights currently playing track.                                             |
| `PlaylistCard.js`     | `playlist, onClick`                                      | Grid card; shows status badge (matching, ready, paused).                                      |
| `PlaylistGrid.js`     | `playlists[], onPlaylistClick, title, loading`           | Responsive card grid with 6-item skeleton loader.                                             |
| `PlaylistHeader.js`   | `playlist, tracks, loadingTracks, onPlayAll, onShuffle`  | Playlist page header with Play All / Shuffle buttons.                                         |
| `QuickPicks.js`       | `playlist, tracks, currentTrack, onTrackSelect`          | Horizontal shelf of up to 12 playable tracks on the home page.                                |
| `MatchProgressBar.js` | `matched, total, percent, label`                         | Animated progress bar shown during YouTube matching.                                          |
| `Spinner.js`          | none                                                     | Shared loading spinner.                                                                       |

---

## Auth System

Authentication uses **JWT stored in an HTTP-only cookie** named `token`.

### Flow

1. `POST /api/auth/signup` — validate email/password, bcrypt hash (12 rounds), `User.create()`, `signToken(userId)`, set cookie.
2. `POST /api/auth/login` — `bcrypt.compare(password, hash)`, same cookie.
3. `GET /api/auth/me` — `getUserFromRequest(req)` parses cookie, `verifyToken()`, `User.findById().select('-passwordHash')`.
4. `POST /api/auth/logout` — `Set-Cookie: token=; Max-Age=-1`.

### requireAuth HOF

```js
export default requireAuth(async function handler(req, res) {
    const user = req.user; // lean User doc, no passwordHash
});
// Compose with rate limiting
export default withRateLimit(requireAuth(handler), 10, 60_000);
```

---

## Playlist Import Pipeline (Step by Step)

```
POST /api/import-playlist { url }
  1. requireAuth — verify JWT cookie, populate req.user
  2. extractPlaylistId(url)
  3. connectDB()
  4. getPublicPlaylistData(playlistId) => { info, tracks[] }
  5. bulkWrite upsert by spotifyId:
       $set   => name, artists, album, duration, albumImage  (always refresh)
       $setOnInsert => importedAt  (immutable, set once)
       youtubeVideoId is NEVER touched here
  6. Track.find({ spotifyId: { $in } }) — single batch fetch
  7. Build trackIds[], uncachedTracks[] (filter: no youtubeVideoId)
  8. Playlist.findOneAndUpdate({ spotifyPlaylistId, user: req.user._id }, upsert)
       status: allCached ? 'ready' : 'imported'
  9. Atomic CAS guard: findOneAndUpdate({ status: 'imported' } => { status: 'matching' })
       On CAS failure: matching already in progress — respond, skip duplicate task
 10. res.status(200).json(playlist)   <- RESPOND BEFORE background work
 11. batchMatchTracks(uncachedTracks, playlistId)  <- fire-and-forget
       For each unmatched track:
         ① Fingerprint cache check — reuse videoId if another track shares the same song
         ② enqueue(jobObject) → Redis RPUSH to demus:ytmatch:queue
       ytMatchWorker (separate process) consumes BLPOP:
         → searchYouTubeTrack() → score → best videoId
         → Track.updateOne({ youtubeVideoId })
         → Playlist.updateOne({ status, importProgress })
       On error: Playlist.status = 'paused', retryAfter = now + 5 min
       On queue drain per playlist: Playlist.status = 'ready', importProgress = 100
 12. runBackgroundItunesEnrichment(trackIds)  <- fire-and-forget
       Fills in missing album art/name via 3-tier pipeline (iTunes → Spotify OG → MusicBrainz)
```

---

## Metadata Enrichment Pipeline (`lib/spotify.js`)

Three-tier free enrichment. Runs in the background after import responds. Mutates track objects in-place, then persists via `bulkWrite`.

| Tier | Source          | Concurrency | Batch Delay | Coverage                         |
| ---- | --------------- | ----------- | ----------- | -------------------------------- |
| 1    | iTunes Search API | 5 parallel | 300 ms      | Fast, great mainstream coverage  |
| 2    | Spotify OG scrape | 3 parallel | 500 ms      | ~100% (every track has spotifyId)|
| 3    | MusicBrainz + CAA | Serial    | 1100 ms     | Last resort, open-source         |

Each tier is skipped if all remaining tracks are already resolved.

---

## YouTube Search & Scoring (`lib/youtube.js` / `workers/ytMatchWorker.js`)

`searchYouTubeTrack(trackName, artistName, durationMs)` — both the lib and worker use **identical scoring**:

| Signal                                       | Score |
| -------------------------------------------- | ----- |
| Duration within ±15 seconds                 | +10   |
| "official audio" / "official music" in title | +5    |
| "official" in title                          | +2    |
| author.name contains "vevo" or "official"    | +3    |
| "cover" in title                             | -5    |
| "remix" in title (not in track name)         | -5    |
| "live" in title (not in track name)          | -3    |
| "karaoke" or "instrumental"                  | -8    |

Falls back to first result if all scores ≤ 0.

> **Important:** The scoring logic in `lib/youtube.js` and `workers/ytMatchWorker.js` must remain identical. If you change one, change both.

### Retry Logic

Transient errors (`ETIMEDOUT`, `ECONNRESET`, `EAI_AGAIN`) retried up to 3 times with delays [0, 500, 1500] ms. All other errors propagate immediately.

---

## Track Fingerprinting (`lib/trackFingerprint.js`)

`generateFingerprint(name, artists[])` normalizes tracks for deduplication:

1. Lowercase name
2. Strip parenthetical content — `(Remastered)`, `(feat. X)`, etc.
3. Remove bare `feat` / `featuring` / `remaster` / `remastered`
4. Strip punctuation, collapse whitespace
5. Append lowercased primary artist

Example: `"Blinding Lights (Remastered)"` + `["The Weeknd"]` => `"blinding lights the weeknd"`

Used in `batchMatchTracks` to check for a cached `youtubeVideoId` on a same-fingerprint track before issuing a new yt-search request.

---

## PlayerContext API (`context/PlayerContext.js`)

### State

| Name           | Type      | Description               |
| -------------- | --------- | ------------------------- |
| `queue`        | `Track[]` | Current track queue       |
| `currentIndex` | `number`  | Active index (-1 = none)  |
| `currentTrack` | `Track \| null` | Playing track        |
| `isPlaying`    | `boolean` | Playback state            |
| `currentTime`  | `number`  | Seconds (polled at 500ms) |
| `duration`     | `number`  | Seconds                   |
| `volume`       | `number`  | 0-100                     |
| `isReady`      | `boolean` | YT.Player initialized     |
| `isLoading`    | `boolean` | Video buffering           |
| `isShuffleOn`  | `boolean` | Shuffle mode              |
| `repeatMode`   | `'off' \| 'all' \| 'one'` | Repeat mode |

### Actions

`play(videoId)`, `playTrack(track, index, queue?)`, `togglePlay()`, `seek(seconds)`, `setVolume(val)`, `playNext()`, `playPrevious()`, `setQueue(tracks)`, `initPlayer(containerId)`, `toggleShuffle()`, `cycleRepeat()`

**Stale-closure prevention:** Refs (`queueRef`, `currentIndexRef`, `volumeRef`, etc.) sync via `useEffect` so YT callbacks never read stale state.

---

## GlobalPlayer & iOS Safari

`GlobalPlayer` mounts a **1x1px, opacity:0, position:fixed, pointer-events:none** iframe that is never unmounted. iOS Safari blocks audio from `display:none` / `visibility:hidden` elements.

`lib/unlockAudio.js` registers a one-time `click`/`touchstart` listener that calls `player.playVideo()` + `player.pauseVideo()` **synchronously** (no setTimeout). This satisfies iOS's user-gesture requirement without silently pausing intentional playback.

---

## PWA Support

- `public/manifest.json` — name, icons, theme `#7c5cff`, background `#0b0b0f`, `display: standalone`
- `public/sw.js` — hand-written service worker (avoids Turbopack/webpack conflict with `next-pwa`)
- `public/offline.html` — fallback page for offline navigation

### Service Worker Strategy

| Request            | Strategy                               |
| ------------------ | -------------------------------------- |
| `/_next/static/**` | Cache-first                            |
| HTML pages         | Network-first → cache → offline.html  |
| `/api/**`          | Network-only (never cached)            |
| CDN images         | Stale-while-revalidate                 |

Registered manually in `_app.js` (not via `next-pwa` plugin).

---

## Polling Pattern

While matching, the frontend polls `GET /api/playlist/[id]/status` every **1.5 seconds** (in `AppContext`). Uses `.select('status importProgress').lean()` — no track populate. On `'ready'`, `'paused'`, or `'error'`, clears interval and fetches full playlist. Cleanup via `useEffect` return in `AppContext.js`.

---

## Styling Conventions

- **SCSS CSS Modules** — no inline styles, no Tailwind.
- Design tokens in `styles/_variables.scss` — always use variables, never hardcode hex values.
- `import styles from '@/styles/ComponentName.module.scss'`
- Global resets only in `styles/globals.scss`.

---

## MongoDB Patterns

### BulkWrite Upsert

```js
const bulkOps = tracks.map((t) => ({
    updateOne: {
        filter: { spotifyId: t.spotifyId },
        update: {
            $set: { name, artists, album, duration, albumImage },
            $setOnInsert: { importedAt: new Date() },
        },
        upsert: true,
    },
}));
await Track.bulkWrite(bulkOps, { ordered: false });
```

### Playlist Owner Scoping

Always scope playlist queries to the authenticated user:

```js
Playlist.findOne({ _id: id, user: req.user._id });
```

---

## Rate Limiter Usage

```js
export default withRateLimit(handler, 10, 60_000);
export default withRateLimit(requireAuth(handler), 10, 60_000);
```

Keyed by `x-forwarded-for` or `req.socket.remoteAddress`. Sets `X-RateLimit-Remaining` and `X-RateLimit-Reset` headers.

---

## Image Domains (`next.config.mjs`)

| Hostname                      | Source                |
| ----------------------------- | --------------------- |
| `i.scdn.co`                   | Spotify album art     |
| `mosaic.scdn.co`              | Spotify mosaic covers |
| `image-cdn-ak.spotifycdn.com` | Spotify CDN           |
| `img.youtube.com`             | YouTube thumbnails    |

---

## What NOT To Do

- Do **not** use the YouTube Data API v3 (no `googleapis`)
- Do **not** proxy audio bytes (no `ytdl-core`)
- Do **not** add Spotify OAuth or developer API calls
- Do **not** switch to the Next.js App Router
- Do **not** use relative imports (`../../`) — use `@/` alias
- Do **not** store persistent music data in Redis — Redis is only a performance cache and queue layer
- Do **not** use Redis for auth sessions — JWT HTTP-only cookies handle auth
- Do **not** create `.md` change-summary files — edit source files only
- Do **not** hardcode secrets — use `process.env`
- Do **not** `await` background tasks before responding
- Do **not** pass a function to `enqueue()` for batch playlist matching — pass a job object
- Do **not** call `yt-search` directly from API routes — route through `enqueue(fn)` (single track) or `enqueue(jobObj)` (batch via worker)
- Do **not** query playlists without scoping to `req.user._id`
- Do **not** modify the YouTube scoring algorithm in one place without updating the other (`lib/youtube.js` and `workers/ytMatchWorker.js` must match)

---

## Common Pitfalls

| Pitfall                           | Solution                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Mongoose model already registered | `mongoose.models.Model \| mongoose.model('Model', Schema)` (done in all models)                                                      |
| `connectDB` at module level       | Always call `await connectDB()` inside the handler                                                                                    |
| yt-search IP blocks               | Batch calls go through Redis queue → ytMatchWorker (1s delay + worker pauses playlist). Single calls go through in-process queue.    |
| `window.YT` not defined           | `GlobalPlayer` guards with `typeof window === 'undefined'` and `window.YT?.Player`                                                    |
| iOS tap-twice-to-play bug         | `unlockAudio.js` pause is synchronous — never add a `setTimeout` delay                                                                |
| Cross-user data access            | Include `user: req.user._id` in all Playlist queries                                                                                  |
| Duplicate batchMatchTracks task   | Atomic CAS guard (`status: 'imported' => 'matching'`) prevents duplicates                                                             |
| Spotify scrape fails              | `getPublicPlaylistData` throws a user-friendly message — propagate to 500 handler                                                     |
| ytMatchWorker not processing      | Worker is a **separate Node process** — must be started with `npm run ytmatch:worker`. It is not part of the Next.js server.          |
| Fingerprint field missing on Track| Worker's local TrackSchema includes `fingerprint` field; ensure any schema changes in `models/Track.js` are mirrored in the worker.  |
| Polling too fast after import     | `AppContext` polls every 1500ms — do not change this; faster polling risks overwhelming the API under load.                           |
