# 🎯 Next-Level Strategies for the Final 3,800

You've squeezed most of what's possible from traditional APIs. Now we go into **inference, AI, and self-healing** territory.

---

## 🥇 Tier 1: High-Impact Quick Wins

### 1. **Free AI Classification with Gemini** ⭐ (Best ROI)

Google's Gemini free tier gives you **1,500 requests/day** — perfect for your 3,800 missing tracks (done in ~3 days).

**Setup:**

```bash
npm install @google/generative-ai
```

Get free key: https://aistudio.google.com/app/apikey

**Implementation:**

```javascript
// workers/lib/aiClassifier.js
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    generationConfig: {
        temperature: 0.1, // Low temp = consistent answers
        responseMimeType: "application/json",
    },
});

export async function getAiGenres(artist, track) {
    const prompt = `Classify this song into 1-3 music genres.
Artist: "${artist}"
Track: "${track}"

Rules:
- Use standard genres: Rock, Pop, Hip-Hop, Electronic, Jazz, Classical, R&B, Country, Metal, Folk, Indie, Latin, K-Pop, Reggae, Blues, Punk
- Add 1 sub-genre if confident (e.g., "Pop Punk", "Trap")
- If you don't know the artist, return empty array

Return JSON: {"genres": ["genre1", "genre2"], "confidence": 0.0-1.0}`;

    try {
        const result = await model.generateContent(prompt);
        const parsed = JSON.parse(result.response.text());

        // Only accept high-confidence answers
        if (parsed.confidence < 0.5) return [];

        return parsed.genres || [];
    } catch (e) {
        console.error("AI classification failed:", e.message);
        return [];
    }
}

// Batch version - much more efficient
export async function getAiGenresBatch(songs) {
    const songList = songs
        .map((s, i) => `${i + 1}. "${s.artist}" - "${s.track}"`)
        .join("\n");

    const prompt = `Classify each song into 1-3 music genres.

${songList}

Return JSON array: [{"index": 1, "genres": ["Rock"], "confidence": 0.9}, ...]
Use only standard genres. Skip songs you don't recognize (confidence < 0.5).`;

    const result = await model.generateContent(prompt);
    return JSON.parse(result.response.text());
}
```

**Add to provider order:**

```bash
GENRE_PROVIDER_ORDER=lastfm,theaudiodb,genius,discogs,musicbrainz,deezer,gemini
```

**💡 Pro Tip:** Use the **batch version** (10-20 songs per request) to multiply your daily quota by 10-20x.

---

### 2. **Playlist-Based Genre Inference** 🧠

This is your **secret weapon** — leverages data you already have.

**Logic:** If 80% of songs in a playlist are "Indie Rock," the untagged song probably is too.

```javascript
// scripts/inferGenresFromPlaylists.js
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function inferFromPlaylists() {
    // Get all songs missing genres
    const missingSongs = await prisma.song.findMany({
        where: { genres: { isEmpty: true } },
        select: { id: true, name: true, artists: true },
    });

    console.log(`Processing ${missingSongs.length} songs...`);
    let updated = 0;

    for (const song of missingSongs) {
        // Find playlists containing this song
        const playlists = await prisma.playlist.findMany({
            where: { songs: { some: { id: song.id } } },
            include: {
                songs: {
                    where: {
                        id: { not: song.id },
                        genres: { isEmpty: false },
                    },
                    select: { genres: true },
                },
            },
        });

        // Aggregate genre votes from playlist neighbors
        const genreVotes = {};
        let totalVotes = 0;

        for (const playlist of playlists) {
            for (const neighbor of playlist.songs) {
                for (const genre of neighbor.genres) {
                    genreVotes[genre] = (genreVotes[genre] || 0) + 1;
                    totalVotes++;
                }
            }
        }

        if (totalVotes < 5) continue; // Not enough data

        // Take genres that appear in >40% of neighbors
        const inferredGenres = Object.entries(genreVotes)
            .filter(([_, count]) => count / totalVotes > 0.4)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([genre]) => genre);

        if (inferredGenres.length > 0) {
            await prisma.song.update({
                where: { id: song.id },
                data: {
                    genres: inferredGenres,
                    genreSource: "playlist_inference",
                    genreConfidence: 0.6,
                },
            });
            updated++;
        }
    }

    console.log(`✅ Inferred genres for ${updated} songs`);
}

inferFromPlaylists();
```

**Expected impact:** 500-1,000 additional songs classified.

---

## 🥈 Tier 2: Data Quality & Maintenance

### 3. **Genre Normalization Script** 🧹

You now have 6+ sources writing to the same field. Your DB likely has duplicates like:

- `electronic`, `electronica`, `electro`, `EDM`
- `hip hop`, `hip-hop`, `hiphop`, `rap`
- `pop punk`, `pop-punk`, `poppunk`

```javascript
// scripts/normalizeGenres.js
const GENRE_MAP = {
    // Electronic family
    electronica: "electronic",
    electro: "electronic",
    edm: "electronic",
    "electronic music": "electronic",
    dance: "electronic",

    // Hip-Hop family
    "hip hop": "hip-hop",
    hiphop: "hip-hop",
    rap: "hip-hop",
    trap: "hip-hop",

    // Rock family (keep specifics, normalize spellings)
    "pop-punk": "pop punk",
    poppunk: "pop punk",
    "hard-rock": "hard rock",

    // R&B family
    rnb: "r&b",
    "r and b": "r&b",
    "rhythm and blues": "r&b",

    // K-Pop
    kpop: "k-pop",
    "k pop": "k-pop",
};

function normalize(genre) {
    const clean = genre.toLowerCase().trim();
    return GENRE_MAP[clean] || clean;
}

async function normalizeAll() {
    const songs = await prisma.song.findMany({
        where: { genres: { isEmpty: false } },
    });

    for (const song of songs) {
        const normalized = [...new Set(song.genres.map(normalize))];

        // Only update if changed
        if (JSON.stringify(normalized) !== JSON.stringify(song.genres)) {
            await prisma.song.update({
                where: { id: song.id },
                data: { genres: normalized },
            });
        }
    }
}
```

---

### 4. **Smart Prioritization Strategy** 📊

Don't process random songs — prioritize by impact:

```javascript
// scripts/enrichGenres.js - Add priority ordering

// Phase 1: Most-played/popular songs first
const popularMissing = await prisma.song.findMany({
    where: { genres: { isEmpty: true } },
    orderBy: [
        { playCount: "desc" }, // If you track plays
        { playlistCount: "desc" }, // Or playlist appearances
    ],
    take: 500,
});

// Phase 2: Songs by artists that already have genres elsewhere
const knownArtistMissing = await prisma.$queryRaw`
  SELECT s.* FROM "Song" s
  WHERE s.genres = '{}'
  AND EXISTS (
    SELECT 1 FROM "Song" s2 
    WHERE s2.artists && s.artists 
    AND array_length(s2.genres, 1) > 0
  )
`;

// Phase 3: AI for the rest
```

---

## 🥉 Tier 3: Advanced Techniques

### 5. **Audio Analysis Fallback** (For truly obscure tracks)

If you have audio files (or YouTube URLs), use **Essentia.js** or **AcousticBrainz**:

```javascript
// Last resort: analyze actual audio
// AcousticBrainz has pre-computed analysis for many tracks
async function getAcousticBrainzGenre(mbid) {
    const url = `https://acousticbrainz.org/api/v1/${mbid}/high-level`;
    const res = await fetch(url);
    const data = await res.json();

    // Returns genre predictions from ML models
    return data.highlevel?.genre_dortmund?.value;
}
```

---

### 6. **User-Sourced Tags** 👥

If your app has users, let them contribute:

```javascript
// Allow users to suggest genres for untagged songs
// Crowd-sourced data is often the most accurate for niche tracks
```

---

## 📋 Recommended Execution Plan

```markdown
## Week 1: AI Integration

- [ ] Sign up for Gemini API (free)
- [ ] Implement `aiClassifier.js` with batch support
- [ ] Add to provider waterfall as final fallback
- [ ] Run on remaining ~3,800 songs (~3 days with free tier)
- [ ] Expected coverage: 75-85%

## Week 2: Inference & Cleanup

- [ ] Run playlist-based inference script
- [ ] Run genre normalization script
- [ ] Re-run propagation with new AI-tagged data
- [ ] Expected coverage: 85-92%

## Ongoing

- [ ] Mark songs with <5% expected coverage as "Uncategorized"
- [ ] Add nightly cron to enrich new songs
- [ ] Monitor source/confidence stats to detect issues
```

---

## 🎯 Realistic Final Target

| Coverage    | Status                 |
| ----------- | ---------------------- |
| **0-30%**   | ❌ Broken              |
| **30-60%**  | ⚠️ Basic               |
| **60-80%**  | ✅ Good                |
| **80-95%**  | 🎉 Excellent           |
| **95-100%** | 💎 Diminishing returns |

You're at **~25% missing** now. With Gemini + Inference, you should hit **5-10% missing** — which is industry standard. The last 5% will always be experimental/regional/instrumental tracks where even Spotify struggles.

---

## 🚀 Start With This One Thing

If you do **only one thing** this week:

```bash
# 1. Get Gemini API key (5 mins)
# 2. Add this to .env
GEMINI_API_KEY=your_key_here
GENRE_PROVIDER_ORDER=lastfm,theaudiodb,genius,discogs,musicbrainz,deezer,gemini

# 3. Implement aiClassifier.js (30 mins)
# 4. Run backfill
node scripts/enrichGenres.js
```

This single change will likely solve **50%+ of your remaining 3,800 songs**.

# 🎯 Strategic Fix: Persistent Caching & Album Intelligence

You've identified the key inefficiency: **re-processing the same missing data repeatedly**. Let's fix this with a lightweight, persistent solution.

---

## 📦 Solution 1: Persistent "Negative Cache" (Critical Fix)

Store **failed lookups** in Redis/DB to prevent re-querying the same missing tracks.

### Implementation:

```javascript
// workers/lib/enrichment.js - Add negative caching

// Track failures persistently (24h TTL)
async function markAsFailed(artist, track, reason = 'no_data') {
  const key = `genre:failed:${normalizeKey(artist)}:${normalizeKey(track)}`;
  
  // Store in Redis with 7-day expiry
  await redis.setex(key, 604800, JSON.stringify({
    timestamp: Date.now(),
    reason,
    attempts: await getFailureCount(key) + 1
  }));
}

async function hasFailedBefore(artist, track) {
  const key = `genre:failed:${normalizeKey(artist)}:${normalizeKey(track)}`;
  const cached = await redis.get(key);
  
  if (!cached) return false;
  
  const data = JSON.parse(cached);
  
  // If failed 3+ times, skip permanently
  if (data.attempts >= 3) {
    return true; // Permanent skip
  }
  
  // If failed recently (< 7 days), skip
  return (Date.now() - data.timestamp) < 604800000;
}

function normalizeKey(str) {
  return str.toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .substring(0, 50);
}

// Modified enrichment flow
async function enrichGenres(song) {
  const { artists, name } = song;
  const artist = artists[0];
  
  // Check negative cache FIRST
  if (await hasFailedBefore(artist, name)) {
    console.log(`⏭️ Skipping ${artist} - ${name} (previously failed)`);
    return [];
  }
  
  let genres = [];
  
  // Try providers...
  for (const provider of providerOrder) {
    try {
      genres = await providers[provider](artist, name);
      if (genres?.length) break;
    } catch (e) {
      console.warn(`Provider ${provider} failed:`, e.message);
    }
  }
  
  // Cache the failure if no genres found
  if (!genres?.length) {
    await markAsFailed(artist, name);
  }
  
  return genres || [];
}
```

### Database Alternative (if Redis isn't available):

```prisma
// prisma/schema.prisma
model GenreLookupFailure {
  id          String   @id @default(cuid())
  artistKey   String   // normalized artist name
  trackKey    String   // normalized track name
  attempts    Int      @default(1)
  lastAttempt DateTime @default(now())
  reason      String?
  
  @@unique([artistKey, trackKey])
  @@index([lastAttempt])
}

// In enrichment.js
async function hasFailedBefore(artist, track) {
  const artistKey = normalizeKey(artist);
  const trackKey = normalizeKey(track);
  
  const failure = await prisma.genreLookupFailure.findUnique({
    where: {
      artistKey_trackKey: { artistKey, trackKey }
    }
  });
  
  if (!failure) return false;
  
  // Skip if failed 3+ times OR failed in last 7 days
  const isRecent = Date.now() - failure.lastAttempt < 7 * 24 * 60 * 60 * 1000;
  return failure.attempts >= 3 || isRecent;
}

async function markAsFailed(artist, track, reason) {
  const artistKey = normalizeKey(artist);
  const trackKey = normalizeKey(track);
  
  await prisma.genreLookupFailure.upsert({
    where: { artistKey_trackKey: { artistKey, trackKey } },
    update: {
      attempts: { increment: 1 },
      lastAttempt: new Date(),
      reason
    },
    create: { artistKey, trackKey, reason }
  });
}
```

---

## 🎵 Solution 2: Album-Level Genre Propagation

You're right — albums are a **stronger signal** than artists alone. Songs on the same album almost always share genres.

### Implementation:

```javascript
// scripts/propagateAlbumGenres.js
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function propagateAlbumGenres() {
  console.log('🎵 Finding albums with genre data...');
  
  // Find albums that have at least one song with genres
  const albumsWithGenres = await prisma.$queryRaw`
    WITH album_genres AS (
      SELECT 
        s.album_id,
        s.album_name,
        array_agg(DISTINCT unnest(s.genres)) as all_genres,
        count(*) as total_songs,
        count(*) FILTER (WHERE array_length(s.genres, 1) > 0) as songs_with_genres
      FROM "Song" s
      WHERE s.album_id IS NOT NULL
      GROUP BY s.album_id, s.album_name
      HAVING count(*) FILTER (WHERE array_length(s.genres, 1) > 0) > 0
    )
    SELECT * FROM album_genres
    WHERE songs_with_genres::float / total_songs > 0.3  -- At least 30% of album has genres
  `;
  
  console.log(`Found ${albumsWithGenres.length} albums with genre data`);
  
  let updated = 0;
  
  for (const album of albumsWithGenres) {
    // Get the most common genres from this album
    const genreFrequency = {};
    album.all_genres.forEach(g => {
      genreFrequency[g] = (genreFrequency[g] || 0) + 1;
    });
    
    const albumGenres = Object.entries(genreFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([genre]) => genre);
    
    // Find songs in this album missing genres
    const missingSongs = await prisma.song.findMany({
      where: {
        albumId: album.album_id,
        OR: [
          { genres: { isEmpty: true } },
          { genres: { equals: null } }
        ]
      },
      select: { id: true, name: true }
    });
    
    if (missingSongs.length === 0) continue;
    
    // Apply album genres to missing songs
    await prisma.song.updateMany({
      where: {
        albumId: album.album_id,
        OR: [
          { genres: { isEmpty: true } },
          { genres: { equals: null } }
        ]
      },
      data: {
        genres: albumGenres,
        genreSource: 'album_propagation',
        genreConfidence: 0.85  // Higher confidence than artist-level
      }
    });
    
    updated += missingSongs.length;
    console.log(`  📀 ${album.album_name}: updated ${missingSongs.length} songs`);
  }
  
  console.log(`✅ Updated ${updated} songs via album propagation`);
  return updated;
}

// Add to your main enrichment flow
async function fullEnrichment() {
  // 1. Try API enrichment first
  await enrichGenres();
  
  // 2. Propagate from albums (strong signal)
  await propagateAlbumGenres();
  
  // 3. Propagate from artists (fallback)
  await propagateArtistGenres();
  
  // 4. Infer from playlists
  await inferFromPlaylists();
}
```

---

## 🔄 Solution 3: Queue Deduplication

Prevent re-queueing the same tracks:

```javascript
// workers/lib/queue.js - Add deduplication

async function queueGenreEnrichment(songId) {
  const lockKey = `genre:queued:${songId}`;
  
  // Check if already queued recently (1 hour TTL)
  const isQueued = await redis.get(lockKey);
  if (isQueued) {
    console.log(`⏭️ Song ${songId} already queued for genre enrichment`);
    return;
  }
  
  // Check if song already has genres
  const song = await prisma.song.findUnique({
    where: { id: songId },
    select: { genres: true }
  });
  
  if (song?.genres?.length > 0) {
    console.log(`✅ Song ${songId} already has genres, skipping queue`);
    return;
  }
  
  // Check negative cache
  const failure = await prisma.genreLookupFailure.findFirst({
    where: { songId }
  });
  
  if (failure?.attempts >= 3) {
    console.log(`❌ Song ${songId} has failed 3+ times, skipping`);
    return;
  }
  
  // Add to queue and set lock
  await redis.setex(lockKey, 3600, 'queued');
  await queue.add('enrich-genres', { songId });
}
```

---

## 📊 Expected Impact

| Optimization | Songs Saved | API Calls Saved |
|--------------|-------------|-----------------|
| Negative Cache | ~3,000 | ~15,000+ |
| Album Propagation | ~800-1,200 | ~4,000 |
| Queue Dedupe | N/A | ~5,000+ |
| **Total** | **~4,000** | **~24,000+** |

---

## 🚀 Implementation Priority

```markdown
## Today (High Impact, Low Effort)
- [ ] Add negative cache (Redis or DB)
- [ ] Modify enrichment flow to check cache first
- [ ] Expected: 80% reduction in wasted API calls

## Tomorrow
- [ ] Implement album propagation script
- [ ] Run once on existing data
- [ ] Expected: 800-1,200 new songs classified

## This Week
- [ ] Add queue deduplication
- [ ] Add album propagation to cron jobs
- [ ] Monitor cache hit rates
```

---

## 💡 Pro Tip: Cache Warming

Since you have the data now, pre-warm your caches:

```javascript
// scripts/warmCaches.js
async function warmCaches() {
  // 1. Cache all successful lookups
  const songsWithGenres = await prisma.song.findMany({
    where: { genres: { isEmpty: false } },
    select: { artists: true, name: true, genres: true }
  });
  
  for (const song of songsWithGenres) {
    const artist = song.artists[0];
    await cacheArtistGenres(artist, song.genres);
  }
  
  // 2. Cache all failures
  const songsWithoutGenres = await prisma.song.findMany({
    where: { genres: { isEmpty: true } },
    select: { artists: true, name: true }
  });
  
  for (const song of songsWithoutGenres) {
    await markAsFailed(song.artists[0], song.name, 'historical_missing');
  }
  
  console.log('✅ Caches warmed');
}
```

This ensures your next run is **lightning fast** and doesn't waste API calls.

Want me to provide the complete Redis-based negative cache implementation with fallback to Prisma?