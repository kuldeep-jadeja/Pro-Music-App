<div align="center">

![Demus Banner](https://via.placeholder.com/800x300.png?text=Demus+-+Your+Music,+Your+Way)

# Demus

**Your Music, Your Way**

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose-47A248?logo=mongodb)](https://www.mongodb.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

</div>

<br />

## ✨ Features

- **🎵 1-Click Spotify Import:** Seamlessly import any public Spotify playlist just by dropping the link.
- **🔍 Intelligent Audio Matching:** Next-generation algorithm that automatically hunts down the highest-fidelity audio match.
- **🎧 Invisible Background Player:** Enjoy uninterrupted, legally compliant playback through a hidden YouTube IFrame.
- **⚡ Blazing Fast Loading:** Experience instantaneous track switching powered by our robust global caching layer.
- **📱 Responsive & Beautiful:** A sleek, dark-mode first UI crafted with SCSS modules that looks stunning on every device.

<br />

## 🪄 How It Works (The Magic)

Demus orchestrates a brilliant pipeline to bring your music to life without heavy infrastructure:

1.  **🎶 The Spark (Spotify):** You input a public Spotify playlist link into the Demus UI.
2.  **🧠 The Brain (Next.js Backend):** Our resilient backend extracts the precise metadata (Track Name, Artist, Album).
3.  **🕵️‍♂️ The Hunt (`yt-search`):** Demus scrapes YouTube's public DOM, bypassing restrictive API quotas, to find the exact matching audio track.
4.  **💾 The Vault (MongoDB):** The match is instantly saved to our global cache. The next time _anyone_ requests this track, it loads in milliseconds.
5.  **🔊 The Stage (IFrame Player):** The client directly streams the audio via a hidden YouTube IFrame. **Zero server bandwidth is consumed.**

> **Spotify Metadata** ➡️ **Next.js Backend** ➡️ **Scraping Engine** ➡️ **Global Match Cache** ➡️ **Client IFrame Player**

<br />

## 🏗️ Under the Hood: Engineering Feats

Demus is engineered to scale gracefully while keeping operational costs intimately close to **$0**.

- **Zero-Quota Hybrid Architecture:** We completely bypass the strict 10,000 unit YouTube Data API limits. By utilizing server-side HTML scraping (`yt-search`) combined with a bespoke, intelligent exact-match scoring algorithm, we can resolve thousands of tracks without hitting arbitrary API walls.
- **Global Track Caching:** MongoDB acts as a universal brain. If User A spends the CPU cycles to import "Bohemian Rhapsody", User B gets it instantly. Redundant searches are practically eliminated through efficient `BulkWrite` database operations.
- **Masterful Concurrency Control:** Massive 500+ track imports would normally trigger an immediate IP ban. Demus utilizes a custom in-memory global queue and strict semaphore system to throttle, backoff, and batch outbound scraping requests, keeping our backend completely invisible to platform rate limiters.
- **Cost-Free Streaming Architecture:** Our server _never_ proxies a single audio byte. By serving the audio via a client-side hidden YouTube IFrame, our cloud egress and bandwidth costs remain exactly zero, regardless of how many users are streaming concurrently.

<br />

## 🛠️ Tech Stack

| Category               | Technology                    | Purpose                                                                                  |
| :--------------------- | :---------------------------- | :--------------------------------------------------------------------------------------- |
| **Frontend Framework** | **Next.js 16** (Pages Router) | Lightning-fast SSR, API routes, and seamless client-side routing.                        |
| **Styling**            | **SCSS Modules**              | Component-scoped, deeply maintainable, and heavily variable-driven styling architecture. |
| **Database & Cache**   | **MongoDB & Mongoose**        | Persistent global caching layer and playlist relationship management.                    |
| **Data Scraping**      | `yt-search`                   | High-performance Server-side YouTube DOM scraping engine.                                |

<br />

## 🚀 Getting Started

Follow these steps to spin up your own instance of Demus locally.

### Prerequisites

- Node.js (v18+)
- A MongoDB Cluster (MongoDB Atlas or Local Instance)
- Spotify Developer Credentials (Client ID & Secret)

### Installation

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/yourusername/demus.git
    cd demus
    ```

2.  **Install dependencies:**

    ```bash
    npm install
    ```

3.  **Environment Configuration:**
    Create a `.env.local` file in the root directory and populate it with your keys:

    ```env
    # MongoDB Configuration
    MONGODB_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/demus?retryWrites=true&w=majority

    # Spotify API Credentials
    SPOTIFY_CLIENT_ID=your_spotify_client_id_here
    SPOTIFY_CLIENT_SECRET=your_spotify_client_secret_here
    ```

4.  **Fire it up:**
    ```bash
    npm run dev
    ```
    The application will now be running at `http://localhost:3000`.

<br />

## ⚠️ Disclaimer

> **Educational Purposes Only**
>
> Demus is an open-source proof-of-concept demonstrating advanced web scraping, concurrency control, global caching mechanisms, and Next.js architecture. It relies heavily on public DOM scraping which is inherently volatile and subject to break if platforms push major structural updates. Please ensure you review and comply with the Terms of Service of any platform you interact with using this software.

## Data Models

### `Track`

```
spotifyId       String  (unique, required)  — Spotify track ID
name            String  (required)
artists         [String] (required)
album           String
duration        Number  — milliseconds
albumImage      String  — cover art URL
youtubeVideoId  String  — matched YouTube video ID (null until matched)
importedAt      Date
```

Indexed on `{ name: 'text', artists: 'text' }` for full-text search.

### `Playlist`

```
spotifyPlaylistId  String  (required, unique)
name               String  (required)
description        String
coverImage         String
owner              String  — Spotify display name
tracks             [ObjectId]  — refs to Track documents
trackCount         Number
status             Enum: 'importing' | 'matching' | 'ready' | 'error'
importProgress     Number  — 0–100
errorMessage       String
importedBy         String
```

Indexed on `{ spotifyPlaylistId: 1 }`.

---

## API Reference

### `POST /api/import-playlist`

Import a public Spotify playlist.

**Rate limit:** 10 requests / minute per IP.

**Request body:**

```json
{ "url": "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M" }
```

**Response `200`:**

```json
{
    "success": true,
    "playlist": {
        "id": "<mongoId>",
        "name": "Today's Top Hits",
        "trackCount": 50,
        "status": "matching",
        "coverImage": "https://i.scdn.co/...",
        "tracksToMatch": 50
    }
}
```

**Status flow:** `importing` → `matching` (returned immediately) → `ready` (background)

---

### `GET /api/playlist/[id]`

Fetch a playlist by MongoDB ID with all tracks populated.

**Response `200`:**

```json
{
    "id": "...",
    "name": "Today's Top Hits",
    "status": "ready",
    "importProgress": 100,
    "trackCount": 50,
    "tracks": [
        {
            "id": "...",
            "name": "Song Name",
            "artists": ["Artist"],
            "album": "Album Name",
            "duration": 213000,
            "spotifyId": "...",
            "youtubeVideoId": "dQw4w9WgXcQ",
            "albumImage": "https://i.scdn.co/..."
        }
    ]
}
```

---

### `GET /api/stream/[trackId]`

Get streaming data for a single track by MongoDB track ID.

**Response `200`:**

```json
{
    "trackId": "...",
    "name": "Song Name",
    "artists": ["Artist"],
    "youtubeVideoId": "dQw4w9WgXcQ",
    "embedUrl": "https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&enablejsapi=1"
}
```

Cached with `Cache-Control: public, max-age=3600, s-maxage=86400`.

---

### `POST /api/youtube-match`

Manually trigger YouTube matching for a single track. Useful for retrying failed matches.

**Rate limit:** 20 requests / minute per IP.

**Request body:**

```json
{ "trackId": "<mongoId>" }
// or
{ "spotifyId": "<spotifyTrackId>" }
```

**Response `200`:**

```json
{
    "success": true,
    "track": {
        "id": "...",
        "name": "Song Name",
        "artists": ["Artist"],
        "youtubeVideoId": "dQw4w9WgXcQ"
    }
}
```

---

## Key Libraries & Modules

### `lib/spotify.js`

| Export                              | Description                                                         |
| ----------------------------------- | ------------------------------------------------------------------- |
| `extractPlaylistId(input)`          | Parses Spotify URLs, URIs, or raw IDs → returns 22-char playlist ID |
| `getPublicPlaylistData(playlistId)` | Scrapes Spotify embed page; returns `{ info, tracks[] }`            |

Supports three embed data formats from `spotify-url-info`:

- **Format A** — `data.trackList[]` (modern embed)
- **Format B** — `data.tracks.items[]` (API-like)
- **Fallback** — `getTracks()` from `spotify-url-info`

### `lib/youtube.js`

| Export                                         | Description                                                     |
| ---------------------------------------------- | --------------------------------------------------------------- |
| `searchYouTubeTrack(name, artist, durationMs)` | Searches YouTube, scores results, returns best `videoId`        |
| `batchMatchTracks(tracks, delayMs)`            | Sequentially matches an array of tracks with configurable delay |

### `lib/mongodb.js`

| Export        | Description                                                     |
| ------------- | --------------------------------------------------------------- |
| `connectDB()` | Returns cached Mongoose connection; safe for Next.js hot reload |

### `lib/rateLimit.js`

| Export                                  | Description                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------- |
| `rateLimit(key, max, windowMs)`         | Core sliding-window check; returns `{ limited, remaining, resetAt }`        |
| `withRateLimit(handler, max, windowMs)` | HOF wrapper for Next.js API route handlers; injects `X-RateLimit-*` headers |

---

## Environment Variables

Create `.env.local` in the project root:

```env
# Required: MongoDB connection string
MONGODB_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/demus?retryWrites=true&w=majority

# Required: YouTube Data API v3 key
YOUTUBE_API_KEY=AIza...
```

### Getting a YouTube API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. Enable the **YouTube Data API v3**
4. Create an **API Key** under Credentials
5. (Recommended) Restrict the key to `YouTube Data API v3` and your domain

### Getting a MongoDB URI

- **Atlas (free tier):** [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas) → create a free M0 cluster → get connection string
- **Local:** `mongodb://localhost:27017/demus`

---

## Getting Started

### Prerequisites

- Node.js 18+
- MongoDB instance (local or Atlas)
- YouTube Data API v3 key

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd spotify_knockoff

# Install dependencies
npm install

# Create environment file
# Create .env.local and add MONGODB_URI and YOUTUBE_API_KEY
```

### Development

```bash
npm run dev
# App runs at http://localhost:3000
```

### Production Build

```bash
npm run build
npm run start
```

---

## How It Works

### Import Flow

```
User pastes Spotify URL
        │
        ▼
POST /api/import-playlist
        │
        ├─► extractPlaylistId()       — parse URL/URI/raw ID
        ├─► getPublicPlaylistData()   — scrape Spotify embed (no API key)
        ├─► Upsert Tracks in MongoDB  — deduplicates by spotifyId
        ├─► Create/update Playlist    — status: "matching"
        ├─► Respond 200 immediately   ◄── frontend receives response
        └─► batchMatchTracks() async (fire-and-forget)
                    │
                    ▼
            For each unmatched track:
            searchYouTubeTrack() → YouTube Data API v3
            Update Track.youtubeVideoId
                    │
                    ▼
            Playlist.status = "ready"
```

### Playback Flow

```
User clicks a track
        │
        ▼
Player component receives { youtubeVideoId }
        │
        ▼
YouTube IFrame API (hidden 0×0 iframe)
        │
        ├─► loadVideoById() on track change
        ├─► setVolume() / playVideo() / pauseVideo()
        ├─► setInterval() polls getCurrentTime() for progress bar
        └─► onStateChange ENDED → auto-advance to next track
```

---

## YouTube Matching Algorithm

`searchYouTubeTrack()` uses a two-step process:

**Step 1 — Search**

- Query: `"{trackName} - {artistName} Official Audio"`
- Filter: Music category (categoryId: 10), max 5 results

**Step 2 — Score & Rank**

Each candidate video receives a score:

| Condition                                           | Score |
| --------------------------------------------------- | ----- |
| Duration within ±15s of Spotify duration            | +10   |
| Title contains "official audio" or "official music" | +5    |
| Title contains "official"                           | +2    |
| Channel includes "vevo" or "official"               | +3    |
| Title contains "cover"                              | -5    |
| Title contains "remix" (not in track name)          | -5    |
| Title contains "live" (not in track name)           | -3    |
| Title contains "karaoke" or "instrumental"          | -8    |

The highest-scoring video ID is returned. First result is used as fallback if no video exceeds score 0.

**Batch matching** (`batchMatchTracks`) processes tracks sequentially with a configurable delay (default 300ms) to avoid YouTube API quota exhaustion.

---

## Rate Limiting

Rate limiting is implemented in-memory using a sliding window per IP address (`lib/rateLimit.js`).

| Endpoint                    | Limit                    |
| --------------------------- | ------------------------ |
| `POST /api/import-playlist` | 10 requests / 60 seconds |
| `POST /api/youtube-match`   | 20 requests / 60 seconds |

Responses include headers:

- `X-RateLimit-Remaining` — requests left in current window
- `X-RateLimit-Reset` — Unix timestamp when window resets

> **Note:** Being in-memory, limits reset on server restart and are not shared across multiple instances/processes.

---

## Styling

All styles use **SCSS CSS Modules** with a shared `_variables.scss` design token file.

| File                       | Applies to                                      |
| -------------------------- | ----------------------------------------------- |
| `globals.scss`             | CSS reset, body defaults                        |
| `_variables.scss`          | Colors, spacing, border-radius, font sizes      |
| `Home.module.scss`         | App layout, sidebar, main content grid          |
| `Navbar.module.scss`       | Top nav bar                                     |
| `ImportForm.module.scss`   | URL input and submit button                     |
| `PlaylistCard.module.scss` | Sidebar playlist cards                          |
| `TrackList.module.scss`    | Track rows, hover states, now-playing highlight |
| `Player.module.scss`       | Bottom player bar, controls, progress bar       |

---

## Known Limitations

- **YouTube API Quota:** The YouTube Data API v3 free tier allows ~10,000 units/day. Each track match costs ~102 units (1 search + 1 videos lookup). This gives approximately **98 full-track imports** per day on the free tier.
- **In-Memory Rate Limiting:** Rate limits reset on server restart and are not distributed — unsuitable for multi-instance deployments.
- **Spotify Public Playlists Only:** Private or collaborative playlists cannot be scraped.
- **YouTube Match Quality:** Matching is heuristic. Rare tracks, instrumentals, or tracks with unusual titles may match incorrectly.
- **No Authentication:** All playlists are shared globally — no user accounts or session isolation.
- **No Caching Layer:** Every playlist load hits MongoDB directly; no Redis or CDN caching in place.
