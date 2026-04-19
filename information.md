# Free APIs/Methods to Fetch Song Genres

Here are several free options you can use, ranked by usefulness for your case:

## 1. **Last.fm API** ⭐ (Recommended)

- **Free**, just requires API key registration
- Returns "tags" (which act as genres: rock, pop, indie, etc.)
- Great coverage for popular artists
- Endpoint: `track.getInfo` or `artist.getTopTags`

```javascript
// Example
const url = `https://ws.audioscrobbler.com/2.0/?method=track.getInfo&api_key=${API_KEY}&artist=${artist}&track=${track}&format=json`;
const res = await fetch(url);
const data = await res.json();
const genres = data.track?.toptags?.tag?.map((t) => t.name) || [];
```

🔗 https://www.last.fm/api

---

## 2. **MusicBrainz + AcousticBrainz**

- **Completely free**, no API key needed
- MusicBrainz returns genre tags
- Rate limit: 1 request/second
- More accurate metadata but less mainstream tag coverage

```javascript
const url = `https://musicbrainz.org/ws/2/recording/?query=recording:"${track}" AND artist:"${artist}"&fmt=json`;
```

🔗 https://musicbrainz.org/doc/MusicBrainz_API

---

## 3. **Spotify Web API** (Artist Genres)

- Spotify doesn't provide track-level genres, **but artist endpoint returns genres**
- Since you already have `spotifyId`, you can call:
    - `GET /v1/artists/{id}` → returns `genres: []`
- Free with OAuth (Client Credentials flow)

```javascript
// You already have spotifyId for the track
// Get track → get artist ID → get artist genres
const track = await fetch(`https://api.spotify.com/v1/tracks/${spotifyId}`, {
    headers,
});
const artistId = track.artists[0].id;
const artist = await fetch(`https://api.spotify.com/v1/artists/${artistId}`, {
    headers,
});
const genres = artist.genres; // ["pop punk", "rock", ...]
```

🔗 https://developer.spotify.com/documentation/web-api

---

## 4. **Deezer API**

- **No authentication required** for read endpoints
- Returns genre IDs/names per album/artist

```javascript
const url = `https://api.deezer.com/search?q=artist:"${artist}" track:"${track}"`;
// Then: https://api.deezer.com/album/{album_id} → contains genre_id
```

🔗 https://developers.deezer.com/api

---

## 5. **TheAudioDB**

- Free tier with test API key `2`
- Returns genre, mood, style for artists

```javascript
const url = `https://www.theaudiodb.com/api/v1/json/2/search.php?s=${artist}`;
```

🔗 https://www.theaudiodb.com/api_guide.php

---

## 🎯 Recommended Strategy for Your Use Case

Since you already have **Spotify IDs**, here's the most efficient pipeline:

```javascript
async function enrichGenres(song) {
    // 1. Try Spotify first (you already have spotifyId)
    let genres = await getSpotifyArtistGenres(song.spotifyId);

    // 2. Fallback to Last.fm if empty
    if (!genres?.length) {
        genres = await getLastFmTags(song.artists[0], song.name);
    }

    // 3. Final fallback: MusicBrainz
    if (!genres?.length) {
        genres = await getMusicBrainzGenres(song.artists[0], song.name);
    }

    return genres;
}
```

## ⚡ Tips for Bulk Processing

- **Batch with rate-limiting** (use `p-limit` or `bottleneck` npm packages)
- **Cache by artist** — most genres are artist-level, so don't refetch per song
- **Store raw + normalized** genres (e.g., `"pop punk"` → `"rock"`)
- Use a **queue (BullMQ)** if you have thousands of records
