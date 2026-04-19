# Analysis & Next Steps for Genre Enrichment

Great progress! Let's analyze your results and optimize what you have.

## 📊 Current Results Analysis

```
Total checked:     4,861
Got genres:        1,681 (34.6%)
Still missing:     3,179 (65.4%)
```

This is actually decent for free APIs, but we can improve it.

---

## 🎯 Immediate Actions (No Spotify Needed)

### 1. **Optimize Your Existing Sources**

The 65% miss rate suggests we can tune the queries better:

```javascript
// workers/lib/enrichment.js - Improve query matching

// Problem: Exact title matches often fail
// Solution: Add fuzzy/cleaned title variants

function cleanTrackTitle(title) {
    return title
        .toLowerCase()
        .replace(/\s*\(feat\..*?\)/gi, "") // Remove (feat. X)
        .replace(/\s*\[.*?\]/g, "") // Remove [Remaster], [Live], etc.
        .replace(/\s*-\s*remaster(ed)?/gi, "") // Remove "- Remastered"
        .replace(/\s*-\s*live/gi, "") // Remove "- Live"
        .replace(/\s*-\s*acoustic/gi, "") // Remove "- Acoustic"
        .replace(/['']/g, "'") // Normalize quotes
        .trim();
}

function cleanArtistName(artist) {
    return artist
        .split(/[,&]/)[0] // Take first artist only
        .replace(/\s*feat\.?\s*.*/i, "") // Remove feat. part
        .trim();
}

// Use in your fetchers:
const cleanTitle = cleanTrackTitle(track);
const cleanArtist = cleanArtistName(artist);
```

### 2. **Add Discogs API** (Free, often has what others miss)

```javascript
// Add to your genre sources - good for older/alternative music

async function getDiscogsGenres(artist, track) {
    const userAgent = "YourApp/1.0";

    // Search by artist first (rate limit: 60/min without auth)
    const searchUrl = `https://api.discogs.com/database/search?q=${encodeURIComponent(artist)}&type=artist`;

    const res = await fetch(searchUrl, {
        headers: { "User-Agent": userAgent },
    });

    if (!res.ok) return [];

    const data = await res.json();
    const artistResult = data.results?.[0];

    if (!artistResult) return [];

    // Get artist details for genres
    const artistRes = await fetch(artistResult.resource_url, {
        headers: { "User-Agent": userAgent },
    });

    if (!artistRes.ok) return [];

    const artistData = await artistRes.json();

    // Discogs uses "style" which is more specific than "genre"
    return [...(artistData.genres || []), ...(artistData.styles || [])];
}
```

### 3. **Add Genius API** (Free, good coverage)

```javascript
// Genius has genre/tag info in song metadata

async function getGeniusGenres(artist, track) {
    const GENIUS_TOKEN = process.env.GENIUS_ACCESS_TOKEN; // Free to get

    const searchUrl = `https://api.genius.com/search?q=${encodeURIComponent(`${artist} ${track}`)}`;

    const res = await fetch(searchUrl, {
        headers: { Authorization: `Bearer ${GENIUS_TOKEN}` },
    });

    if (!res.ok) return [];

    const data = await res.json();
    const hit = data.response?.hits?.[0]?.result;

    if (!hit) return [];

    // Get full song data
    const songRes = await fetch(`https://api.genius.com/songs/${hit.id}`, {
        headers: { Authorization: `Bearer ${GENIUS_TOKEN}` },
    });

    const songData = await songRes.json();
    const song = songData.response?.song;

    // Genius stores tags in custom_performances and tags
    const tags = song?.tags?.map((t) => t.name) || [];
    const primaryTag = song?.primary_tag?.name;

    return primaryTag ? [primaryTag, ...tags] : tags;
}
```

**Get free Genius token:** https://genius.com/api-clients

---

### 4. **Artist-Level Genre Propagation** (Quick Win!)

Most songs by an artist share genres. Use this:

```javascript
// scripts/propagateArtistGenres.js

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function propagateGenres() {
    // Find all artists that have at least one song with genres
    const artistsWithGenres = await prisma.$queryRaw`
    SELECT DISTINCT 
      unnest(s.artists) as artist_name,
      array_agg(DISTINCT unnest(s.genres)) as all_genres
    FROM "Song" s
    WHERE array_length(s.genres, 1) > 0
    GROUP BY 1
  `;

    // Build artist -> genres map
    const artistGenreMap = new Map();
    for (const row of artistsWithGenres) {
        artistGenreMap.set(row.artist_name.toLowerCase(), row.all_genres);
    }

    console.log(`Found genres for ${artistGenreMap.size} artists`);

    // Find songs without genres
    const songsWithoutGenres = await prisma.song.findMany({
        where: {
            OR: [{ genres: { isEmpty: true } }, { genres: { equals: null } }],
        },
        select: { id: true, artists: true, name: true },
    });

    console.log(`Songs without genres: ${songsWithoutGenres.length}`);

    let updated = 0;

    for (const song of songsWithoutGenres) {
        // Check if any artist has known genres
        for (const artist of song.artists || []) {
            const genres = artistGenreMap.get(artist.toLowerCase());

            if (genres?.length) {
                await prisma.song.update({
                    where: { id: song.id },
                    data: {
                        genres: genres.slice(0, 5), // Top 5 genres
                        genreSource: "artist_propagation",
                        genreConfidence: 0.7, // Lower confidence for propagated
                    },
                });
                updated++;
                break;
            }
        }
    }

    console.log(`Updated ${updated} songs via artist propagation`);
}

propagateGenres();
```

---

### 5. **Updated Provider Order**

```bash
# .env
GENRE_PROVIDER_ORDER=lastfm,theaudiodb,genius,discogs,musicbrainz,deezer
```

```javascript
// workers/lib/enrichment.js - Add new providers

const providers = {
    lastfm: getLastFmTags,
    theaudiodb: getAudioDBGenres,
    genius: getGeniusGenres, // NEW
    discogs: getDiscogsGenres, // NEW
    musicbrainz: getMusicBrainzGenres,
    deezer: getDeezerGenres,
    // spotify: disabled
};
```

---

## 📋 Action Checklist

```markdown
## Immediate (Today)

- [ ] Add `cleanTrackTitle()` and `cleanArtistName()` helpers
- [ ] Run artist genre propagation script (quick win, no API calls)
- [ ] Get free Genius API token

## This Week

- [ ] Add Genius provider to enrichment pipeline
- [ ] Add Discogs provider (no auth needed)
- [ ] Re-run backfill with new sources

## Expected Results After These Changes

- Current: 34.6% coverage
- After propagation: ~50-55% coverage (estimate)
- After new APIs: ~65-75% coverage (estimate)
```

---

## 🔄 Re-run Backfill After Changes

```bash
# After adding new providers + propagation
node scripts/enrichGenres.js --dry-run

# Then for real:
node scripts/enrichGenres.js
```

---

Would you like me to provide the complete updated `enrichment.js` with all these providers integrated, or help with any specific part first?
