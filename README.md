<div align="center">

# 🎵 Demus

### *Your Music, Your Way*

**A full-stack music streaming PWA that turns any public Spotify playlist into an offline-capable, ad-free listening experience — powered by YouTube.**

<br/>

[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react)](https://reactjs.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose-47A248?style=for-the-badge&logo=mongodb)](https://www.mongodb.com/)
[![Redis](https://img.shields.io/badge/Redis-ioredis-DC382D?style=for-the-badge&logo=redis)](https://redis.io/)
[![PWA](https://img.shields.io/badge/PWA-Ready-5A0FC8?style=for-the-badge&logo=pwa)](https://web.dev/progressive-web-apps/)

</div>

---

## ✨ What Is Demus?

Demus lets you paste any **public Spotify playlist URL** and instantly stream every track — **completely free, no Spotify Premium required, no API keys**.

- 🎧 **Import** — Paste a Spotify playlist URL. Tracks are scraped without any developer credentials.
- 🔍 **Match** — Each track is automatically matched to its YouTube video using a smart scoring algorithm.
- ▶️ **Stream** — Music plays directly from YouTube's IFrame API. No audio is proxied through our servers.
- 📱 **Install** — Works as a PWA on mobile and desktop. Full offline support via service worker.

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (PWA)                            │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────────────┐  │
│  │ AppContext│  │PlayerContext │  │  GlobalPlayer (YT IFrame) │  │
│  └──────────┘  └──────────────┘  └───────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP / JSON
┌────────────────────────────▼────────────────────────────────────┐
│                    Next.js 16 (Pages Router)                     │
│  /api/import-playlist  /api/auth/*  /api/stream/*  /api/...     │
└───────────┬────────────────────────────────────┬────────────────┘
            │                                    │
  ┌─────────▼──────────┐             ┌──────────▼─────────┐
  │      MongoDB        │             │       Redis         │
  │  (source of truth)  │             │  (queue + cache)   │
  │  Users, Playlists   │             │  demus:ytmatch:     │
  │  Tracks, Progress   │             │  queue (BLPOP)     │
  └─────────────────────┘             └──────────┬─────────┘
                                                 │ BLPOP
                                      ┌──────────▼─────────┐
                                      │   ytMatchWorker     │
                                      │  (standalone Node)  │
                                      │  yt-search scrape   │
                                      │  max 1 in-flight    │
                                      └─────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites

| Tool      | Version  |
| --------- | -------- |
| Node.js   | ≥ 20.6   |
| MongoDB   | ≥ 6      |
| Redis     | ≥ 7 *(optional)* |

### 1. Clone & Install

```bash
git clone <repo-url>
cd Pro-Music-App
npm install
```

### 2. Configure Environment

Create `.env.local` in the project root:

```env
# Required
MONGODB_URI=mongodb://localhost:27017/demus
JWT_SECRET=your-super-secret-min-32-chars-key

# Optional — app works without Redis, but matching performance improves with it
REDIS_URL=redis://localhost:6379
```

> **No Spotify or YouTube API keys needed.** Demus uses public scraping only.

### 3. Start the App

```bash
# Development server (with Turbopack)
npm run dev

# Production
npm run build && npm start       # runs on port 4072
```

### 4. Start the YouTube Match Worker *(recommended)*

The worker is a separate Node process that processes YouTube matching jobs from the Redis queue. Without it, single-track fallback matching still works but batch matching won't complete.

```bash
npm run ytmatch:worker
```

---

## 🔄 How It Works — The Import Pipeline

```
User pastes Spotify URL
        ↓
1. Extract playlist ID (URL, URI, or raw ID)
2. Scrape public Spotify embed page — no API key
3. Upsert tracks to MongoDB (global shared cache)
4. Identify unmatched tracks (no youtubeVideoId)
5. Respond to client immediately ← fast!
        ↓  (fire-and-forget)
6. Enqueue yt-search jobs to Redis
7. ytMatchWorker processes jobs 1-by-1 with jitter delay
8. Scores each YouTube result (duration, official, vevo, etc.)
9. Writes youtubeVideoId to Track document
10. Updates playlist progress (0→100%)
        ↓  (also fire-and-forget)
11. 3-tier metadata enrichment (album art, names):
    • Tier 1: iTunes Search API   (5 concurrent)
    • Tier 2: Spotify OG scrape   (3 concurrent)
    • Tier 3: MusicBrainz + CAA   (serialised, 1 req/s)
```

---

## 📦 Tech Stack

| Layer          | Technology                          | Why                                                      |
| -------------- | ----------------------------------- | -------------------------------------------------------- |
| Framework      | Next.js 16 (Pages Router)           | SSR, API routes, PWA-friendly                            |
| UI             | React 19 + Framer Motion            | Fluid animations, context-driven state                   |
| Styling        | SCSS CSS Modules                    | Scoped styles, design tokens, no Tailwind bloat          |
| Database       | MongoDB + Mongoose                  | Flexible schema for track/playlist data                  |
| Cache & Queue  | Redis (ioredis)                     | Optional — rate limiting + yt-search job queue           |
| Auth           | JWT (HTTP-only cookie)              | Stateless, secure, no session storage in Redis           |
| Music Data     | `spotify-url-info` (scraping)       | Zero API keys — uses Spotify's public embed page         |
| YouTube Search | `yt-search` (scraping)              | Zero quota — bypasses YouTube Data API entirely          |
| Playback       | YouTube IFrame API                  | Browser-native, free, no audio proxying                  |
| Icons          | Lucide React                        | Lightweight, tree-shakeable                              |
| PWA            | Hand-written Service Worker         | Avoids Turbopack/next-pwa conflicts                      |

---

## 📁 Project Structure

```
Pro-Music-App/
├── pages/
│   ├── _app.js              # App shell, SW registration, GlobalPlayer
│   ├── _document.js         # Custom HTML doc (YT IFrame API script load)
│   ├── index.js             # Home page: QuickPicks + playlist grid
│   ├── login.js             # Login page
│   ├── signup.js            # Signup page
│   ├── playlist/[id].js     # Playlist detail with TrackList
│   └── api/
│       ├── auth/            # signup, login, logout, me
│       ├── import-playlist.js
│       ├── playlists.js
│       ├── playlist/[id]/   # index (full), status (polling)
│       ├── stream/[trackId].js
│       ├── youtube-match.js
│       ├── match-youtube.js
│       └── repair-enrichment.js
│
├── components/
│   ├── layout/              # AppLayout, Sidebar, Navbar, NowPlayingPanel,
│   │                        # MobileTabBar, MobileNowPlayingSheet
│   ├── Player.js            # Bottom player bar
│   ├── GlobalPlayer.js      # Persistent hidden YouTube iframe
│   ├── ImportForm.js
│   ├── TrackList.js
│   ├── PlaylistCard.js / PlaylistGrid.js / PlaylistHeader.js
│   ├── QuickPicks.js
│   ├── MatchProgressBar.js
│   └── Spinner.js
│
├── lib/
│   ├── mongodb.js           # Mongoose singleton
│   ├── redis.js             # ioredis singleton (optional)
│   ├── redisQueue.js        # RPUSH to demus:ytmatch:queue
│   ├── auth.js              # JWT sign/verify
│   ├── requireAuth.js       # HOF route guard
│   ├── rateLimit.js         # sliding-window rate limiter
│   ├── redisRateLimit.js    # Redis-backed limiter
│   ├── spotify.js           # Scraping + 3-tier enrichment
│   ├── youtube.js           # enqueue(), searchYouTubeTrack(), batchMatchTracks()
│   ├── youtubeMatcher.js    # Lightweight single-track matcher
│   ├── trackFingerprint.js  # Dedup normalization
│   ├── unlockAudio.js       # iOS Safari audio unlock
│   └── AppContext.js        # Auth, playlists, import tracking
│
├── context/
│   └── PlayerContext.js     # YT player state & controls
│
├── models/
│   ├── User.js              # email, passwordHash
│   ├── Track.js             # spotifyId, youtubeVideoId, fingerprint, ...
│   └── Playlist.js          # user, tracks[], status, importProgress, ...
│
├── workers/
│   ├── ytMatchWorker.js     # Standalone BLPOP consumer (npm run ytmatch:worker)
│   ├── chartsWorker.js      # Chart playlist populator
│   └── artistCrawler.js     # Artist metadata crawler
│
├── scripts/
│   ├── repairEmptyArtists.js
│   ├── repairAlbumImages.js
│   ├── repairMissingFields.js
│   └── dbStatus.js
│
├── styles/
│   ├── _variables.scss      # Design tokens (colors, spacing, etc.)
│   ├── globals.scss         # Global resets
│   └── *.module.scss        # Per-component CSS modules
│
└── public/
    ├── manifest.json        # PWA manifest
    ├── sw.js                # Hand-written service worker
    └── offline.html         # Offline fallback
```

---

## 🔐 API Reference

| Endpoint                          | Method | Auth | Rate Limit | Description                          |
| --------------------------------- | ------ | ---- | ---------- | ------------------------------------ |
| `/api/auth/signup`                | POST   | —    | 5/min      | Register a new account               |
| `/api/auth/login`                 | POST   | —    | 10/min     | Authenticate and receive JWT cookie  |
| `/api/auth/logout`                | POST   | —    | —          | Clear auth cookie                    |
| `/api/auth/me`                    | GET    | —    | —          | Get current user from cookie         |
| `/api/import-playlist`            | POST   | ✅   | 10/min     | Import a Spotify playlist            |
| `/api/playlists`                  | GET    | ✅   | —          | List user's playlists                |
| `/api/playlist/[id]`              | GET    | ✅   | —          | Fetch playlist with populated tracks |
| `/api/playlist/[id]/status`       | GET    | ✅   | —          | Poll matching progress               |
| `/api/stream/[trackId]`           | GET    | —    | —          | Get YouTube video ID for a track     |
| `/api/youtube-match`              | POST   | ✅   | 20/min     | Resume a paused playlist             |
| `/api/match-youtube`              | POST   | —    | —          | Single-track YouTube match           |
| `/api/repair-enrichment`          | POST   | ✅   | wrapped    | Re-run metadata enrichment           |

---

## 🎯 YouTube Matching — Scoring Algorithm

Every YouTube result is scored before selection:

| Signal                                       | Score |
| -------------------------------------------- | :---: |
| Duration within ±15 seconds of Spotify track | **+10** |
| "official audio" or "official music" in title | **+5** |
| "official" in title                          | **+2** |
| VEVO or "official" channel name              | **+3** |
| "cover" in title                             | **−5** |
| "remix" (when track isn't a remix)           | **−5** |
| "live" (when track isn't live)               | **−3** |
| "karaoke" or "instrumental"                  | **−8** |

Falls back to the first result when all scores are ≤ 0.

---

## 🗄️ Database Schema

### User
```
email (unique, lowercase) | passwordHash (never returned in API) | createdAt
```

### Track *(global cache shared across all users)*
```
spotifyId (unique) | name | artists[] | album | albumImage | duration (ms)
youtubeVideoId     | fingerprint       | importedAt
```

### Playlist
```
user (ref) | spotifyPlaylistId | name | description | coverImage | owner
tracks[]   | trackCount        | status | importProgress | retryAfter
pausedAt   | errorMessage
```

**Playlist status lifecycle:**

```
imported ──► matching ──► ready
                │
                └──► paused ──► matching (on resume)
                │
                └──► error
```

---

## 🛠️ Utility Scripts

```bash
npm run ytmatch:worker    # Start YouTube match worker (keep running!)
npm run populate:charts   # Populate chart playlists
npm run crawl:artists     # Crawl & enrich artist metadata

npm run repair:artists    # Fix tracks with empty artist data
npm run repair:albums     # Fix tracks missing album art
npm run repair:all        # Run all repair passes

npm run db:status         # Print DB stats (tracks, playlists, unmatched)
```

---

## 📱 PWA Features

Demus is fully installable as a Progressive Web App:

- **Offline support** — Cached pages and assets served when disconnected.
- **Standalone mode** — Launches without browser chrome, feels native.
- **Service worker strategies:**
  - Static assets → Cache-first
  - HTML pages → Network-first → Cache → Offline fallback
  - `/api/**` → Network-only (never stale)
  - CDN images → Stale-while-revalidate

---

## 🔒 Security Notes

- Passwords are hashed with **bcrypt (12 rounds)**
- JWTs are stored in **HTTP-only cookies** (not localStorage — XSS-safe)
- All sensitive endpoints are **rate-limited** via Redis or in-memory sliding window
- Playlist queries are **scoped to the authenticated user** — no cross-user data leakage
- No Spotify or YouTube API tokens stored anywhere

---

## ⚠️ Important Constraints

| Constraint | Reason |
| ---------- | ------ |
| No `googleapis` | yt-search scraping bypasses the 10,000-unit/day YouTube quota |
| No `ytdl-core` | Audio is not proxied — YouTube IFrame streams directly |
| No Spotify OAuth | All data scraped from Spotify's public embed page |
| Redis is optional | App degrades gracefully — MongoDB remains source of truth |
| Pages Router only | No App Router, no `"use client"`, no `"use server"` |

---

## 🧩 Contributing & Development Notes

- Path alias `@/` maps to project root (configured in `jsconfig.json`)
- **Never** use relative `../../` imports — always use `@/`
- SCSS design tokens live in `styles/_variables.scss` — never hardcode hex values
- Every API handler must call `await connectDB()` at the top
- The YouTube scoring logic in `lib/youtube.js` and `workers/ytMatchWorker.js` **must stay in sync**
- See [`AGENT.md`](AGENT.md) for the full technical reference and architectural constraints

---

<div align="center">

Made with 🎶 by Kuldeep Jadeja

*No API keys. No premium. Just music.*

</div>
