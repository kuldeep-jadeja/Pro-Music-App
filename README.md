# Demus — Your Music, Your Way

A full-stack music streaming Progressive Web App (PWA) built with Next.js. Users create an account, import their public Spotify playlists by URL, and play every track through the YouTube IFrame API — no Spotify subscription needed, no YouTube API quota consumed.

---

## Features

- **Account system** — email/password auth with JWT (HTTP-only cookies)
- **Spotify playlist import** — paste any public Spotify playlist URL
- **Zero-quota YouTube matching** — tracks matched to YouTube via `yt-search` scraping
- **Persistent audio player** — hidden 1×1px YouTube IFrame survives page navigation
- **Shuffle & Repeat** — off / all / one modes
- **Now Playing panel** — upcoming 5-track queue (desktop)
- **Mobile-first** — bottom tab bar + full-screen now playing sheet
- **Background matching** — responds immediately; matching runs async with a global concurrency queue
- **Resume paused matching** — rate-limited matches pause with `retryAfter`; resume on demand
- **PWA** — installable, offline-capable via hand-written service worker
- **Track deduplication** — global DB cache; identical tracks never re-matched

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (Pages Router) |
| Styling | SCSS CSS Modules |
| Animations | Framer Motion |
| Icons | Lucide React |
| Database | MongoDB + Mongoose 9 |
| Auth | bcrypt 6 + jsonwebtoken 9 (HTTP-only cookie) |
| Spotify data | `spotify-url-info` (public embed scraping — no API key) |
| YouTube matching | `yt-search` (scraping — no API key / no quota) |
| YouTube playback | YouTube IFrame API |
| HTTP client | Axios |
| PWA | Hand-written service worker (`public/sw.js`) |

---

## Prerequisites

- **Node.js 18+**
- **MongoDB** (local or Atlas)
- **No external API keys required**

---

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/your-user/pro-music-app.git
cd pro-music-app
npm install

# 2. Configure environment variables
cp .env.example .env.local
# Edit .env.local — see Environment Variables section below

# 3. Run in development
npm run dev

# 4. Open
http://localhost:3000
```

---

## Environment Variables

Create a `.env.local` file in the project root:

```env
# MongoDB connection string (required)
MONGODB_URI=mongodb://localhost:27017/pro-music-app

# JWT secret — use a long random string (required)
JWT_SECRET=your-super-secret-jwt-key-at-least-32-chars
```

> **That's it.** Spotify scraping and yt-search require no API keys.

---

## Architecture Overview

```
User browser
  │
  ├── Next.js Pages (pages/)
  │     ├── / — Home (quick picks, playlist grid, import form)
  │     ├── /signup — Registration
  │     └── /playlist/[id] — Playlist detail with track list
  │
  ├── API Routes (pages/api/)
  │     ├── auth/signup, login, logout, me  ← JWT cookie auth
  │     ├── import-playlist                 ← Full import pipeline
  │     ├── playlists                       ← User's playlist list
  │     ├── playlist/[id]                   ← Playlist + tracks
  │     ├── playlist/[id]/status            ← Lightweight polling
  │     ├── youtube-match                   ← Resume paused matching
  │     ├── match-youtube                   ← Single-track match
  │     ├── repair-enrichment               ← Album art repair
  │     └── stream/[trackId]               ← Return YouTube video ID
  │
  └── External Services
        ├── spotify-url-info  (Spotify embed scrape — no auth)
        ├── iTunes Search API (album art enrichment — no auth)
        └── yt-search         (YouTube scrape — no auth)
```

---

## How It Works

### 1. Authentication

Users register with email + password. Passwords are bcrypt-hashed (12 rounds). On login, a 7-day JWT is set as an HTTP-only cookie. All playlist/import API routes require a valid JWT.

### 2. Playlist Import

1. User pastes a public Spotify playlist URL
2. `spotify-url-info` scrapes the public embed page — no Spotify API key required
3. Tracks are bulk-upserted into MongoDB (by `spotifyId`) — existing track metadata refreshed, `youtubeVideoId` never overwritten
4. API responds immediately with playlist data
5. Background task matches unmatched tracks through `yt-search` via a **global concurrency queue** — at most one search in-flight at a time, with 1s delay + jitter between calls

### 3. YouTube Matching

Each track is scored against yt-search results:

| Signal | Score |
|---|---|
| Duration within ±15 seconds | +10 |
| "official audio" / "official music" | +5 |
| "official" in title | +2 |
| Author contains vevo/official | +3 |
| "cover" in title | −5 |
| "remix" (not in track name) | −5 |
| "live" (not in track name) | −3 |
| "karaoke" or "instrumental" | −8 |

If yt-search returns a rate-limit error, the playlist is paused with a `retryAfter` timestamp. The user can resume matching via the playlist detail page.

### 4. Playback

A persistent 1×1px hidden YouTube IFrame is mounted once in `_app.js` and never unmounted. Navigation does not interrupt audio. `PlayerContext` manages the queue, shuffle, repeat, and time state. iOS Safari audio is unlocked on the first user gesture.

### 5. Progress Polling

While matching, the frontend polls `GET /api/playlist/[id]/status` every 3 seconds (lightweight — no track populate). When status reaches `'ready'`, the full playlist is fetched.

---

## Project Structure

```
├── pages/
│   ├── _app.js              # Providers, GlobalPlayer, SW registration
│   ├── _document.js         # HTML shell
│   ├── index.js             # Home page
│   ├── signup.js            # Registration page
│   ├── playlist/[id].js     # Playlist detail
│   └── api/                 # API routes (see route map above)
│
├── components/
│   ├── layout/
│   │   ├── AppLayout.js     # Full shell (sidebar, navbar, player, panels)
│   │   ├── Sidebar.js
│   │   ├── Navbar.js
│   │   ├── NowPlayingPanel.js
│   │   ├── MobileTabBar.js
│   │   └── MobileNowPlayingSheet.js
│   ├── GlobalPlayer.js      # Hidden persistent YouTube iframe
│   ├── Player.js            # Bottom player bar
│   ├── ImportForm.js
│   ├── TrackList.js
│   ├── PlaylistCard.js
│   ├── PlaylistGrid.js
│   ├── PlaylistHeader.js
│   ├── QuickPicks.js
│   ├── MatchProgressBar.js
│   └── Spinner.js
│
├── lib/
│   ├── mongodb.js           # Mongoose singleton
│   ├── auth.js              # JWT sign/verify
│   ├── requireAuth.js       # Auth guard HOF
│   ├── rateLimit.js         # In-memory rate limiter
│   ├── spotify.js           # Spotify scraping + iTunes enrichment
│   ├── youtube.js           # yt-search + global concurrency queue
│   ├── youtubeMatcher.js    # Standalone single-track matcher
│   ├── trackFingerprint.js  # Track deduplication normalization
│   ├── unlockAudio.js       # iOS Safari audio unlock
│   └── AppContext.js        # Auth + playlist React context
│
├── context/
│   └── PlayerContext.js     # YouTube player state
│
├── models/
│   ├── User.js
│   ├── Track.js
│   └── Playlist.js
│
├── styles/                  # SCSS CSS Modules + variables
└── public/
    ├── sw.js                # Service worker
    ├── manifest.json        # PWA manifest
    └── offline.html         # Offline fallback
```

---

## Data Models

### User

| Field | Type | Notes |
|---|---|---|
| `email` | String | Unique, lowercase, indexed |
| `passwordHash` | String | bcrypt — excluded from all JSON responses |
| `createdAt` | Date | Auto-set |

### Track (Global Cache)

| Field | Type | Notes |
|---|---|---|
| `spotifyId` | String | Unique index |
| `name` | String | |
| `artists` | String[] | |
| `album` | String | |
| `duration` | Number | Milliseconds |
| `albumImage` | String | URL |
| `youtubeVideoId` | String | Null until matched |
| `importedAt` | Date | Set once on insert |

### Playlist

| Field | Type | Notes |
|---|---|---|
| `user` | ObjectId | Ref User — required; scopes ownership |
| `spotifyPlaylistId` | String | Compound unique key with `user` |
| `name`, `description`, `coverImage`, `owner` | String | Spotify metadata |
| `tracks` | ObjectId[] | Refs to Track |
| `trackCount` | Number | Total tracks in playlist |
| `status` | String | `'imported' | 'matching' | 'ready' | 'paused' | 'error'` |
| `importProgress` | Number | 0–100 |
| `retryAfter` | Date | Set when paused due to rate limiting |
| `pausedAt` | Date | Timestamp when matching was paused |
| `errorMessage` | String | Human-readable error |

---

## API Reference

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/api/auth/signup` | POST | — | Create account |
| `/api/auth/login` | POST | — | Login, sets JWT cookie |
| `/api/auth/logout` | POST | — | Clear auth cookie |
| `/api/auth/me` | GET | — | Return current user (or 401) |
| `/api/import-playlist` | POST | JWT | Import playlist by Spotify URL |
| `/api/playlists` | GET | JWT | List user's playlists |
| `/api/playlist/[id]` | GET | JWT | Playlist + populated tracks |
| `/api/playlist/[id]/status` | GET | JWT | Lightweight status polling |
| `/api/stream/[trackId]` | GET | — | Get YouTube video ID for a track |
| `/api/youtube-match` | POST | JWT | Resume paused matching |
| `/api/match-youtube` | POST | — | Single-track match (client-triggered) |
| `/api/repair-enrichment` | POST | JWT | Repair tracks missing album art |

---

## PWA

The app is installable as a standalone PWA on desktop and mobile.

- **Manifest**: `public/manifest.json` — name, icons, theme `#7c5cff`, background `#0b0b0f`
- **Service worker**: `public/sw.js` — hand-written to avoid Next.js build conflicts
- **Offline fallback**: `public/offline.html`

Caching strategy:
- `/_next/static/**` — cache-first
- HTML pages — network-first → cached → offline.html
- `/api/**` — network-only
- CDN images — stale-while-revalidate

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Development server on port 3000 |
| `npm run build` | Production build |
| `npm start` | Production server on port **4072** |
| `npm run lint` | ESLint |

---

## License

MIT
