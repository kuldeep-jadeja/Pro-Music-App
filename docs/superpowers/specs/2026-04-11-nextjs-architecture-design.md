# Demus Next.js Architecture Design

## Problem
The project has grown quickly and now mixes multiple patterns (especially around playback). The goal is a clear shared mental model of how pages, APIs, data, auth, import pipeline, and playback actually work today.

## Scope
This document explains current architecture (not a feature roadmap), including key risks that affect maintainability.

## Approaches considered
1. **Request-flow map (recommended):** explain architecture by following real user actions end-to-end.
2. **Layer map:** explain frontend/API/lib/models as separate layers.
3. **State-machine map:** focus on playlist and playback states.

Chosen approach: **Request-flow map first**, with layer and state notes where helpful.

## High-level architecture

### Runtime stack
- **Framework:** Next.js 16 (Pages Router), React 19, SCSS modules.
- **App shell:** `pages/_app.js` wraps pages in `AppProvider` and default `AppLayout`.
- **Data:** MongoDB + Mongoose models (`User`, `Playlist`, `Track`).
- **Auth:** JWT in HttpOnly cookie (`token`), validated via `/api/auth/me`.
- **Background execution model:** asynchronous server tasks are fired from API routes in-process (no separate queue worker service).

### Main bounded areas
- **UI + navigation:** pages and layout components.
- **App state orchestration:** `lib/AppContext.js`.
- **Import/matching pipeline:** `pages/api/import-playlist.js` + `lib/spotify.js` + `lib/youtube.js`.
- **Playback:** `components/Player.js`.
- **Persistence/security:** models + auth middleware (`requireAuth`, `withRateLimit`).

## Component responsibilities

### Frontend
- `pages/index.js`: authenticated home, import UI, playlist grid, active playlist view.
- `pages/playlist/[id].js`: dedicated playlist detail/playback page.
- `components/ImportForm.js`: URL validation + import submit + import phase UI.
- `components/TrackList.js`, `QuickPicks.js`, `PlaylistCard.js`: browsing/selection surfaces.
- `components/layout/AppLayout.js`: shell (sidebar, navbar, player, now-playing panel).

### Client state
- `lib/AppContext.js` owns:
  - session state (`user`, `authChecked`)
  - library state (`playlists`, `activePlaylist`, `tracks`)
  - playback selection state (`currentTrack`, `currentIndex`)
  - import tracking state (`activeImport`) + status polling

### Backend API
- Auth:
  - `POST /api/auth/signup`
  - `POST /api/auth/login`
  - `POST /api/auth/logout`
  - `GET /api/auth/me`
- Playlist import/read:
  - `POST /api/import-playlist`
  - `GET /api/playlists`
  - `GET /api/playlist/[id]`
  - `GET /api/playlist/[id]/status`
- Matching/playback support:
  - `POST /api/match-youtube` (on-demand track match)
  - `POST /api/youtube-match` (resume paused batch)
  - `GET /api/stream/[trackId]` (stream metadata)

### Data model
- **User**: email + password hash.
- **Track**: Spotify identity + metadata + optional `youtubeVideoId`.
- **Playlist**: per-user playlist import with status/progress and track references.

## Data flow

### Session bootstrap
1. App mounts -> `AppContext` calls `GET /api/auth/me`.
2. If authenticated, user stored in context.
3. User library fetched via `GET /api/playlists`.

### Import and enrichment
1. User submits Spotify playlist URL in `ImportForm`.
2. `POST /api/import-playlist`:
   - parse playlist ID
   - scrape playlist metadata/tracks from Spotify
   - bulk-upsert tracks
   - upsert playlist
   - return immediately
3. Background processes:
   - metadata enrichment (`runBackgroundItunesEnrichment`)
   - batch YouTube matching (`batchMatchTracks`) for unmatched tracks.
4. Client polls `GET /api/playlist/[id]/status` until ready.
5. Full playlist fetched once ready.

### Background collection population details
- **Track metadata backfill path:** `runBackgroundItunesEnrichment` runs a 3-tier enrich pipeline (iTunes -> Spotify OG scrape -> MusicBrainz/CoverArtArchive) and bulk-updates `Track.album`/`Track.albumImage`.
- **Repair path for old imports:** `POST /api/repair-enrichment` finds incomplete tracks and re-runs the same 3-tier enrichment pipeline.
- **YouTube match population path:** `batchMatchTracks` fills `Track.youtubeVideoId` and advances `Playlist.importProgress/status`.
- **Concurrency guard:** matching uses a module-level serialized promise queue in `lib/youtube.js`, so one process issues one yt-search call at a time.

### Playback
1. Track selected from UI.
2. If unmatched, client triggers `POST /api/match-youtube`.
3. `components/Player.js` loads/controls YouTube iframe for playback and queue traversal.

### Mobile playback behavior (iOS/Android)
- Active implementation is `components/Player.js` (hidden 1x1 iframe, `playsinline`, manual play/pause control).
- iOS-specific guardrails are implemented in player comments and behavior (non-zero iframe dimensions, gesture-aware flow).
- `lib/unlockAudio.js` exists for first-gesture unlocking, but it is currently wired through `PlayerContext`/`GlobalPlayer` architecture, which is not mounted in `_app.js`.
- No Android-specific branching was found; Android follows the same player code path.

### Pause/resume matching
1. Batch matching may set playlist to `paused` on blocking errors/rate-limit conditions.
2. `POST /api/youtube-match` validates cooldown and resumes matching atomically.

## Error handling and resilience
- Route-level validation and status-code responses for bad input.
- `requireAuth` wrapper for protected routes.
- `withRateLimit` wrapper for endpoint throttling.
- `lib/youtube.js`:
  - global serialized queue for yt-search requests
  - transient retry logic
  - cooldown + paused state on hard failure
- `lib/mongodb.js`:
  - cached connection for hot reload
  - startup recovery sweep for stale `matching` playlists.

## Testing/verification focus (for future plan)
- Auth cookie lifecycle and protected route behavior.
- Import pipeline correctness: ordering, dedupe, status transitions.
- Matching resilience: pause/resume/cooldown behavior.
- Playback behavior: matched vs unmatched track flows, queue transitions.

## Identified risks and mismatches
1. **Dual playback architectures in repository**  
   `context/PlayerContext.js` + `components/GlobalPlayer.js` describe a persistent global player, but active runtime path uses `components/Player.js`. This creates ambiguity.

2. **Duplicate YouTube matching modules**  
   `lib/youtube.js` is active, while `lib/youtubeMatcher.js` appears unused.

3. **Documentation drift**  
   README and code paths are not perfectly aligned in some flow descriptions.

4. **Legacy commented code in active files**  
   `pages/login.js` includes large commented historical blocks.

5. **Single-process assumptions**  
   In-memory rate limiter and queue are process-local, which limits multi-instance consistency.

6. **Fingerprint cache path appears incomplete**  
   `lib/youtube.js` reads `Track.fingerprint` for cache hits, but the current `Track` schema does not define a `fingerprint` field and no write path sets it, so that optimization may not be active.

## Recommended next architecture cleanup (small, high impact)
1. Pick one playback architecture and remove/merge the other.
2. Remove or integrate `lib/youtubeMatcher.js`.
3. Align README with current runtime flow.
4. Remove stale commented code blocks in live pages.
