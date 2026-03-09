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
9. **Fire-and-forget background work.** Long-running tasks (YouTube matching) must respond to the client immediately, then run async via the global queue. Set Playlist status to `'paused'` on failure; never `await` before responding.
10. **Single global concurrency queue for `yt-search`.** All `yt-search` calls must go through `enqueue()` from `lib/youtube.js`. At most ONE yt-search HTTP request is in-flight at any time.

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

Create `.env.local` in the project root. `lib/mongodb.js` throws at startup if `MONGODB_URI` is missing. `lib/auth.js` throws if `JWT_SECRET` is missing. If `REDIS_URL` is absent or Redis is unreachable, the app continues normally.

> `YOUTUBE_API_KEY` and Spotify developer credentials are **not required** and **not used**.

---

## Redis Usage

Redis is an **optional performance layer only**. MongoDB remains the source of truth for all application data. If Redis is unavailable the application must continue functioning normally.

### Redis is responsible for

- Hot track metadata caching for `/api/stream` (key: `stream:track:<trackId>`, TTL 6 h)
- Distributed rate limiting (sliding-window sorted-set, key: `ratelimit:<ip>:<endpoint>`)
- Worker coordination (future)

### Redis must NOT be used for

- Storing persistent music data
- Replacing MongoDB
- Proxying audio streams
- Bypassing the global `yt-search` queue

### Implementation files

| File                    | Responsibility                                            |
| ----------------------- | --------------------------------------------------------- |
| `lib/redis.js`          | ioredis singleton — `getRedis()` returns client or `null` |
| `lib/redisRateLimit.js` | Sliding-window rate limiter backed by Redis sorted sets   |

All Redis calls must be wrapped in `try/catch`. On any error, fall back to the MongoDB / in-memory equivalent.

---

## File Map & Responsibilities

### `lib/`

| File                  | Responsibility                                                                           | Key Exports                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `mongodb.js`          | Singleton Mongoose connection with global hot-reload cache                               | `connectDB()`                                                                                                     |
| `redis.js`            | Optional ioredis singleton with automatic fallback to `null`                             | `getRedis()`                                                                                                      |
| `rateLimit.js`        | Sliding-window rate limiter — Redis-backed with in-memory fallback                       | `rateLimit()`, `withRateLimit(handler, max, windowMs)`                                                            |
| `redisRateLimit.js`   | Redis sorted-set sliding-window limiter used by `rateLimit.js`                           | `redisRateLimit(ip, endpoint, max, windowMs)`                                                                     |
| `auth.js`             | JWT sign/verify; extract user from request cookie                                        | `signToken(userId)`, `verifyToken(token)`, `getUserFromRequest(req)`                                              |
| `requireAuth.js`      | HOF that guards API routes — populates `req.user` or returns 401                         | `requireAuth(handler)`                                                                                            |
| `spotify.js`          | Parse Spotify URLs; scrape public embed page; iTunes enrichment                          | `extractPlaylistId()`, `getPublicPlaylistData()`, `enrichTracksWithMetadata()`, `runBackgroundItunesEnrichment()` |
| `youtube.js`          | Global concurrency queue; `yt-search` with scoring + retry; batch matcher                | `enqueue(fn)`, `searchYouTubeTrack()`, `batchMatchTracks()`                                                       |
| `youtubeMatcher.js`   | Standalone lightweight YouTube matcher (used by `match-youtube` route)                   | `findYouTubeMatch(artist, title)`                                                                                 |
| `trackFingerprint.js` | Normalize track name + artist into a stable deduplication key                            | `generateFingerprint(name, artists[])`                                                                            |
| `unlockAudio.js`      | iOS Safari audio unlock (one-time play+pause on first user gesture)                      | `registerAudioUnlock(getPlayer)`, `isAudioUnlocked()`                                                             |
| `AppContext.js`       | React context for auth state, playlists, active playlist, active import, track selection | `AppProvider`, `useAppContext()`                                                                                  |

### `context/`

| File               | Responsibility                                                            | Key Exports                     |
| ------------------ | ------------------------------------------------------------------------- | ------------------------------- |
| `PlayerContext.js` | Global YouTube IFrame player state: queue, shuffle, repeat, time tracking | `PlayerProvider`, `usePlayer()` |

### `models/`

| File          | Schema Fields                                                                                                                                                                                                      | Notes                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `User.js`     | `email` (unique), `passwordHash`, `createdAt`                                                                                                                                                                      | `passwordHash` stripped from all `.toJSON()` / `.toObject()` outputs                                                  |
| `Track.js`    | `spotifyId` (unique), `name`, `artists[]`, `album`, `duration` (ms), `albumImage`, `youtubeVideoId` (nullable), `importedAt`                                                                                       | Text index removed — no `$text` search used                                                                           |
| `Playlist.js` | `user` (ObjectId ref User), `spotifyPlaylistId`, `name`, `description`, `coverImage`, `owner`, `tracks[]`, `trackCount`, `status` (enum), `importProgress`, `retryAfter`, `pausedAt`, `errorMessage`, `importedBy` | Compound unique index: `{ spotifyPlaylistId, user }` — same playlist can be imported by different users independently |

#### Playlist Status Enum

| Status       | Meaning                                                           |
| ------------ | ----------------------------------------------------------------- |
| `'imported'` | Tracks saved; background matching not started (atomic guard gate) |
| `'matching'` | Background YouTube matching actively running                      |
| `'ready'`    | All tracks matched; fully playable                                |
| `'paused'`   | Matching halted due to yt-search rate limit; `retryAfter` is set  |
| `'error'`    | Unrecoverable failure                                             |

---

## pages/api/ Route Map

| Route                     | Method | Auth    | Rate Limit | Description                                                             |
| ------------------------- | ------ | ------- | ---------- | ----------------------------------------------------------------------- |
| `auth/signup.js`          | POST   | No      | 5/min      | Create account (bcrypt hash, JWT cookie)                                |
| `auth/login.js`           | POST   | No      | 10/min     | Authenticate user, set HTTP-only JWT cookie (7-day)                     |
| `auth/logout.js`          | POST   | No      | No         | Clear auth cookie (`maxAge -1`)                                         |
| `auth/me.js`              | GET    | No      | No         | Return current user from JWT cookie, or 401                             |
| `import-playlist.js`      | POST   | **Yes** | 10/min     | Full import pipeline (see below)                                        |
| `playlists.js`            | GET    | **Yes** | No         | List all playlists owned by authenticated user                          |
| `playlist/[id]/index.js`  | GET    | **Yes** | No         | Fetch playlist + populated tracks (user-scoped)                         |
| `playlist/[id]/status.js` | GET    | **Yes** | No         | Lightweight status + progress polling (no track populate)               |
| `stream/[trackId].js`     | GET    | No      | No         | Return `youtubeVideoId` + embed URL for a track                         |
| `youtube-match.js`        | POST   | **Yes** | 20/min     | Resume matching for a `paused` playlist; enforces `retryAfter` cooldown |
| `match-youtube.js`        | POST   | No      | No         | Client-triggered single-track YouTube match via global queue            |
| `repair-enrichment.js`    | POST   | **Yes** | (wrapped)  | Repair tracks missing album/art via 3-tier enrichment pipeline          |

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
 11. batchMatchTracks(uncachedTracks, playlistId) <- fire-and-forget
       For each track: enqueue(() => searchYouTubeTrack(...)) + jitter delay
         yt-search => score video => best videoId
         Track.updateOne({ youtubeVideoId })
       On IP block: Playlist.status = 'paused', retryAfter = now + backoff; halt
       On completion: Playlist.status = 'ready', importProgress = 100
 12. runBackgroundItunesEnrichment(trackIds) <- fire-and-forget
       Fills in missing album art/name via iTunes Search API
```

---

## YouTube Search & Scoring (`lib/youtube.js`)

`searchYouTubeTrack(trackName, artistName, durationMs)` scoring:

| Signal                                       | Score |
| -------------------------------------------- | ----- |
| Duration within +-15 seconds                 | +10   |
| "official audio" / "official music" in title | +5    |
| "official" in title                          | +2    |
| author.name contains "vevo" or "official"    | +3    |
| "cover" in title                             | -5    |
| "remix" in title (not in track name)         | -5    |
| "live" in title (not in track name)          | -3    |
| "karaoke" or "instrumental"                  | -8    |

Falls back to first result if all scores <= 0.

### Global Concurrency Queue

```js
// Always route through enqueue()
const videoId = await enqueue(() => searchYouTubeTrack(name, artist, duration));
```

At most one yt-search HTTP request runs at a time. Self-healing on errors.

### Retry Logic

Transient errors (`ETIMEDOUT`, `ECONNRESET`, `EAI_AGAIN`) retried up to 3 times with delays [0, 500, 1500] ms. All other errors propagate immediately.

### `batchMatchTracks(tracks, delayMs = 1000)`

Sequential with 1s delay + random +-200ms jitter per track to prevent bot detection.

---

## Track Fingerprinting (`lib/trackFingerprint.js`)

`generateFingerprint(name, artists[])` normalizes tracks for deduplication:

1. Lowercase name
2. Strip parenthetical content — `(Remastered)`, `(feat. X)`, etc.
3. Remove bare `feat` / `featuring` / `remaster` / `remastered`
4. Strip punctuation, collapse whitespace
5. Append lowercased primary artist

Example: `"Blinding Lights (Remastered)"` + `["The Weeknd"]` => `"blinding lights the weeknd"`

---

## PlayerContext API (`context/PlayerContext.js`)

### State

| Name           | Type      | Description               |
| -------------- | --------- | ------------------------- | ------------- | ----------- |
| `queue`        | `Track[]` | Current track queue       |
| `currentIndex` | `number`  | Active index (-1 = none)  |
| `currentTrack` | `Track    | null`                     | Playing track |
| `isPlaying`    | `boolean` | Playback state            |
| `currentTime`  | `number`  | Seconds (polled at 500ms) |
| `duration`     | `number`  | Seconds                   |
| `volume`       | `number`  | 0-100                     |
| `isReady`      | `boolean` | YT.Player initialized     |
| `isLoading`    | `boolean` | Video buffering           |
| `isShuffleOn`  | `boolean` | Shuffle mode              |
| `repeatMode`   | `'off'    | 'all'                     | 'one'`        | Repeat mode |

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
| HTML pages         | Network-first -> cache -> offline.html |
| `/api/**`          | Network-only (never cached)            |
| CDN images         | Stale-while-revalidate                 |

Registered manually in `_app.js` (not via `next-pwa` plugin).

---

## Polling Pattern

While matching, the frontend polls `GET /api/playlist/[id]/status` every 3 seconds. Uses `.select('status importProgress').lean()` — no track populate. On `'ready'`, `'paused'`, or `'error'`, clears interval and fetches full playlist. Cleanup via `useEffect` return in AppContext.

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
- Do **not** store persistent music data in Redis — Redis is only a performance cache layer
- Do **not** use Redis for auth sessions — JWT HTTP-only cookies handle auth
- Do **not** create `.md` change-summary files — edit source files only
- Do **not** hardcode secrets — use `process.env`
- Do **not** `await` background tasks before responding
- Do **not** call `yt-search` directly — route through `enqueue()`
- Do **not** query playlists without scoping to `req.user._id`

---

## Common Pitfalls

| Pitfall                           | Solution                                                                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --- | ----------------------------------------------------- |
| Mongoose model already registered | `mongoose.models.Model                                                                                                     |     | mongoose.model('Model', Schema)` (done in all models) |
| `connectDB` at module level       | Always call `await connectDB()` inside the handler                                                                         |
| yt-search IP blocks               | Calls go through `enqueue()` + 1s delay + jitter. Fail => `'paused'` + `retryAfter`. Resume via `POST /api/youtube-match`. |
| `window.YT` not defined           | `GlobalPlayer` guards with `typeof window === 'undefined'` and `window.YT?.Player`                                         |
| iOS tap-twice-to-play bug         | `unlockAudio.js` pause is synchronous — never add a `setTimeout` delay                                                     |
| Cross-user data access            | Include `user: req.user._id` in all Playlist queries                                                                       |
| Duplicate batchMatchTracks task   | Atomic CAS guard (`status: 'imported' => 'matching'`) prevents duplicates                                                  |
| Spotify scrape fails              | `getPublicPlaylistData` throws a user-friendly message — propagate to 500 handler                                          |
| Login page not rendering          | `pages/login.js` is fully commented out — un-comment and add `getLayout` export                                            |
