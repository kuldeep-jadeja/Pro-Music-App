Agent Context — Demus (spotify_knockoff)
This file provides authoritative context for AI coding agents working in this repository. Read this before making any changes.
Project Identity
App name: Demus ("Your Music, Your Way")
Folder name: spotify_knockoff (legacy; do not rename)
Purpose: Full-stack music streaming app. Users import public Spotify playlists; each track is matched to a YouTube video via server-side scraping (yt-search) and played back via the YouTube IFrame API.
Framework: Next.js 16 — Pages Router (not App Router). All pages live in pages/, all API routes in pages/api/.
Critical Architecture Rules
Never use the App Router. This project uses pages/ directory exclusively. Do not create app/ directory or use "use client" / "use server" directives.
No Spotify API keys. Spotify data is fetched via spotify-url-info which scrapes the public embed page. Never add Spotify OAuth or Spotify Web API credentials.
yt-search for matching, NOT official Data API. We bypass the 10,000 unit YouTube quota by scraping search results using yt-search on the server. Do not use the official YouTube Data API v3 (googleapis).
Global Track Caching (Zero-Quota). Always check if a Track document already has a youtubeVideoId before initiating a search. The database acts as a global cache. Never search for the same track twice globally.
YouTube IFrame API for playback — no server proxying. Music is streamed through a hidden YouTube IFrame player (window.YT.Player). The server never proxies audio bytes. Do not stream audio through the Next.js API. Do not add ytdl-core or similar.
MongoDB via Mongoose. Always use connectDB() from lib/mongodb.js at the top of every API handler before any DB operations. Never instantiate a new Mongoose connection elsewhere.
Rate limiting on write endpoints. Wrap any API handler that modifies data with withRateLimit() from lib/rateLimit.js. Read-only endpoints (GET) do not require rate limiting.
Fire-and-forget background work. Long-running tasks (YouTube matching) must respond to the client immediately, then run async. Use .catch() on background promises to update Playlist status to 'paused' if rate-limited; never await them before responding.
Path Aliases
jsconfig.json configures @/ as root alias. Always use:
import { connectDB } from "@/lib/mongodb";
import Track from "@/models/Track";


Never use relative ../../ paths.
Environment Variables


Variable
Required
Description
MONGODB_URI
Yes
MongoDB connection string

Must be defined in .env.local. lib/mongodb.js throws at startup if MONGODB_URI is missing. (Note: YOUTUBE_API_KEY is no longer required as we use yt-search).
File Map & Responsibilities
lib/
File
Responsibility
Key Exports
mongodb.js
Singleton Mongoose connection with global hot-reload cache
connectDB()
rateLimit.js
In-memory sliding-window rate limiter
rateLimit(), withRateLimit()
spotify.js
Parse Spotify URLs; scrape public embed page for playlist + track data
extractPlaylistId(), getPublicPlaylistData()
youtube.js
Wrapper for yt-search with scoring algorithm; batch matcher
searchYouTubeTrack(), batchMatchTracks()

models/
File
Schema Fields
Track.js
spotifyId (unique), name, artists[], album, duration (ms), albumImage, youtubeVideoId (nullable)
Playlist.js
spotifyPlaylistId (unique), name, tracks[] (ObjectId refs), status (enum: 'matching', 'ready', 'paused', 'error'), importProgress (0-100)

pages/api/
Route
Method
Rate Limited
Description
import-playlist.js
POST
Yes (10/min)
Scrape Spotify → upsert tracks → filter uncached tracks → background yt-search match
playlist/[id].js
GET
No
Return playlist + populated tracks by MongoDB _id
stream/[trackId].js
GET
No
Return youtubeVideoId + embed URL for a track
youtube-match.js
POST
Yes (20/min)
Resume matching for 'paused' playlists or manually retry a track

components/
Component
Props
Notes
ImportForm
onImportSuccess(playlist)
Calls POST /api/import-playlist; manages loading/error state
Player
track, playlist, currentIndex, onTrackChange
Manages window.YT.Player lifecycle; auto-advance on track end
TrackList
tracks[], currentTrackId, onTrackSelect
Pure display; highlights currently playing track
PlaylistCard
playlist, onClick
Sidebar card; shows status badge (matching, ready, paused)
Navbar
none
Static top bar

Playlist Import Pipeline (Step by Step)
POST /api/import-playlist { url }
  1. extractPlaylistId(url)              → playlistId string
  2. connectDB()
  3. getPublicPlaylistData(playlistId)   → { info, tracks[] }
  4. For each track:
       Track.findOneAndUpdate({ spotifyId }, ..., { upsert: true })
       Collect _id; check if `youtubeVideoId` exists (Global Cache).
  5. Playlist.findOneAndUpdate({ spotifyPlaylistId }, ..., { upsert: true })
     → status: 'matching', importProgress: 50
  6. res.status(200).json(...)           ← respond BEFORE background work
  7. matchTracksInBackground(uncachedTracksOnly, playlist._id)  ← fire & forget
       batchMatchTracks(uncachedTracks, 1000ms delay)
         searchYouTubeTrack(name, artist, durationMs) per track
         Track.updateOne → youtubeVideoId
       If yt-search rate-limits → Playlist.updateOne → status: 'paused', halt.
       If successful → Playlist.updateOne → status: 'ready', importProgress: 100


YouTube Search & Scoring (yt-search)
searchYouTubeTrack(trackName, artistName, durationMs):
Search query: "{trackName} - {artistName} Official Audio" via yt-search.
Extract title, author.name, and duration.seconds from the resulting video array.
Score each video (higher = better match):
Duration ±15s of Spotify duration: +10
"official audio" / "official music" in title: +5
"official" in title: +2
author.name includes "vevo" or "official": +3
"cover" in title: -5
"remix" in title (not in track name): -5
"live" in title (not in track name): -3
"karaoke" or "instrumental": -8
Return highest-score video ID; fall back to first result if all scores ≤ 0
batchMatchTracks(tracks, delayMs = 1000) — sequential search with 1s delay to mimic human browsing and prevent IP bans.
YouTube IFrame Player Lifecycle (Player.js)
window.YT.Player is created once (lazy, inside useEffect) with videoId, height: '0', width: '0'
On track change: playerRef.current.loadVideoById(newVideoId) — reuses the same player instance
onStateChange handler:
PLAYING → start setInterval polling getCurrentTime() for progress bar
PAUSED → stop interval
ENDED → auto-advance: onTrackChange(playlist[currentIndex + 1], currentIndex + 1)
Volume: player.setVolume(0–100) (YouTube scale)
Seek: player.seekTo(seconds, true)
Polling Pattern (index.js)
While activePlaylist.status === 'matching', a setInterval every 3 seconds calls GET /api/playlist/[id]. On status === 'ready', 'paused', or 'error', the interval is cleared. Cleanup via useEffect return function.
Styling Conventions
All styles use SCSS CSS Modules — never inline styles or Tailwind
Design tokens (colors, spacing) live in styles/_variables.scss — always use variables, never hardcode hex values
Each component has its own .module.scss file (e.g., Player.js → Player.module.scss)
Global resets/base styles only in styles/globals.scss
Import pattern: import styles from '@/styles/ComponentName.module.scss'
Mongo Upsert Pattern
Used throughout to avoid duplicates. Example:
await Track.findOneAndUpdate(
  { spotifyId: t.spotifyId },          // filter
  { $setOnInsert: { name, artists, ... } }, // only set on first insert
  { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
);


For playlists, data is always updated (not $setOnInsert) so re-imports refresh metadata.
Rate Limiter Usage
// Wrap the handler at export time
export default withRateLimit(handler, maxRequests, windowMs);
// e.g.:
export default withRateLimit(handler, 10, 60000); // 10/min


The limiter is keyed by x-forwarded-for header or req.socket.remoteAddress. It sets X-RateLimit-Remaining and X-RateLimit-Reset response headers.
Image Domains
Allowed remote image hostnames in next.config.mjs:
i.scdn.co — Spotify album art
mosaic.scdn.co — Spotify mosaic covers
image-cdn-ak.spotifycdn.com — Spotify CDN
img.youtube.com — YouTube thumbnails
If new image hosts are needed, add them to next.config.mjs under images.remotePatterns.
What NOT to Do
Do not use the YouTube Data API v3 (no googleapis package)
Do not proxy audio bytes through the server (no ytdl-core or streams)
Do not add Spotify OAuth or Spotify developer API calls
Do not switch to the Next.js App Router
Do not use relative imports (../../) — always use @/ alias
Do not add Redis, sessions, or auth without a specific feature request
Do not create .md summary files documenting changes — edit source files only
Do not hardcode API keys; always read from process.env
Do not await background tasks before responding to the client
Common Pitfalls
Pitfall
Solution
Mongoose model already registered error
Use `mongoose.models.Model
connectDB called outside handler
Always call await connectDB() inside the route handler, not at module level
yt-search rate limits / IP blocks
Increase batchMatchTracks delay (default 1000ms) and gracefully fail to the 'paused'/resume pipeline
window.YT not defined
YouTube IFrame API loads async; check window.YT && window.YT.Player before calling new player
Spotify scrape fails
getPublicPlaylistData throws with a user-friendly message — let it propagate to the 500 handler


