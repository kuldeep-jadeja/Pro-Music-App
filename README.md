<div align="center">

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
- **Sequential Concurrency Control:** `batchMatchTracks` processes tracks one at a time with a 1-second delay between each `yt-search` call, mimicking human browsing to avoid IP-level rate limits. (A global semaphore for multi-user concurrency is recommended in `AUDIT_REPORT.md`.)
- **Cost-Free Streaming Architecture:** Our server _never_ proxies a single audio byte. By serving the audio via a client-side hidden YouTube IFrame, our cloud egress and bandwidth costs remain exactly zero, regardless of how many users are streaming concurrently.

<br />

## 🛠️ Tech Stack

| Category               | Technology                    | Purpose                                                                    |
| :--------------------- | :---------------------------- | :------------------------------------------------------------------------- |
| **Frontend Framework** | **Next.js 16** (Pages Router) | SSR, API routes, and seamless client-side routing.                         |
| **Styling**            | **SCSS Modules**              | Component-scoped styles with a shared `_variables.scss` design-token file. |
| **Database & Cache**   | **MongoDB & Mongoose**        | Persistent global track cache and playlist/user storage.                   |
| **YouTube Matching**   | `yt-search`                   | Server-side YouTube search scraping — no API key required.                 |
| **Spotify Parsing**    | `spotify-url-info`            | Scrapes the Spotify public embed page for metadata — no Spotify API key.   |
| **Authentication**     | `jsonwebtoken` + `bcrypt`     | JWT-signed sessions and bcrypt password hashing.                           |
| **HTTP Cookies**       | `cookie`                      | Cookie serialization/parsing for HTTP-only JWT storage.                    |

<br />

## 🚀 Getting Started

Follow these steps to spin up your own instance of Demus locally.

### Prerequisites

- Node.js (v18+)
- A MongoDB instance (MongoDB Atlas free tier or local)

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
    Create a `.env.local` file in the root directory:

    ```env
    # Required: MongoDB connection string
    MONGODB_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/demus?retryWrites=true&w=majority

    # Required: Secret used to sign JWTs (any long random string)
    JWT_SECRET=your_super_secret_key_here
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

### `User`

```
email          String  (unique, required, lowercased)
passwordHash   String  (required — bcrypt hash, never returned in responses)
createdAt      Date
```

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

### Authentication

#### `POST /api/auth/signup`

Create a new account.

**Request body:** `{ "email": "user@example.com", "password": "yourpassword" }`

**Response `201`:** `{ "user": { "id": "...", "email": "user@example.com" } }`

Sets an HTTP-only `token` cookie (7-day JWT).

---

#### `POST /api/auth/login`

Authenticate with email and password.

**Request body:** `{ "email": "user@example.com", "password": "yourpassword" }`

**Response `200`:** `{ "user": { "id": "...", "email": "user@example.com" } }`

Sets an HTTP-only `token` cookie (7-day JWT).

---

#### `POST /api/auth/logout`

Clears the `token` cookie.

**Response `200`:** `{ "success": true }`

---

#### `GET /api/auth/me`

Returns the currently authenticated user, or `401` if not logged in. Used by the frontend to restore session state on page load.

**Response `200`:** `{ "user": { "id": "...", "email": "user@example.com" } }`

---

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

### `lib/auth.js`

| Export                    | Description                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `signToken(userId)`       | Signs a 7-day JWT with `JWT_SECRET`                                                         |
| `verifyToken(token)`      | Verifies and decodes a JWT; returns payload or `null`                                       |
| `getUserFromRequest(req)` | Reads the `token` cookie, verifies the JWT, and returns a lean User doc (no `passwordHash`) |

### `lib/requireAuth.js`

| Export                 | Description                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| `requireAuth(handler)` | HOF — returns `401` if no valid session cookie; otherwise sets `req.user` and calls the inner handler |

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

# Required: Secret used to sign JWTs (any long random string)
JWT_SECRET=your_super_secret_key_here
```

| Variable      | Required | Description                 |
| ------------- | -------- | --------------------------- |
| `MONGODB_URI` | Yes      | MongoDB connection string   |
| `JWT_SECRET`  | Yes      | Secret key for signing JWTs |

### Getting a MongoDB URI

- **Atlas (free tier):** [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas) → create a free M0 cluster → get connection string
- **Local:** `mongodb://localhost:27017/demus`

---

## Getting Started

### Prerequisites

- Node.js 18+
- MongoDB instance (local or Atlas)

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd demus

# Install dependencies
npm install

# Create .env.local with MONGODB_URI and JWT_SECRET (see Environment Variables above)
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
            searchYouTubeTrack() → yt-search (no API key)
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

- Query: `"{trackName} - {artistName} Official Audio"` via `yt-search`
- Up to 5 results are evaluated

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

**Batch matching** (`batchMatchTracks`) processes tracks sequentially with a configurable delay (default 1000ms) to avoid triggering IP-level rate limiting from YouTube.

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

- **In-Memory Rate Limiting:** Rate limits reset on server restart and are not distributed — unsuitable for multi-instance deployments.
- **Spotify Public Playlists Only:** Private or collaborative playlists cannot be scraped via the public embed.
- **YouTube Match Quality:** Matching is heuristic. Rare tracks, instrumentals, or tracks with unusual titles may match incorrectly.
- **No Concurrency Guard (at scale):** Multiple simultaneous playlist imports each run their own `batchMatchTracks` loop. At high concurrency this can trigger IP-level rate limiting from YouTube. See `AUDIT_REPORT.md` for the recommended global semaphore fix.
- **No Startup Recovery:** If the server restarts while a playlist is `'matching'`, the status is never automatically recovered. Affected playlists remain stuck until manually retried. See `AUDIT_REPORT.md` for the recommended startup sweep.
- **No Redis / CDN Caching Layer:** Every playlist load hits MongoDB directly.
