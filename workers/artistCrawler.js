/**
 * artistCrawler.js — Catalog expansion via artist graph traversal
 *
 * Standalone Node.js process (CommonJS).  Runs independently of the Next.js
 * app server.  Start with:
 *
 *   npm run crawl:artists
 *
 * Architecture:
 *   DB: 20 random tracks  →  extract unique artist names
 *                                        ↓
 *          getData(spotify/track/{id})  →  album.id  →  getData(spotify/album/{id})
 *                                        ↓
 *                         Track.findOneAndUpdate (upsert, $setOnInsert)
 *                                        ↓
 *              tracks missing youtubeVideoId  →  Redis queue (demus:ytmatch:queue)
 *                                        ↓
 *                                  ytMatchWorker consumes
 *
 * Safety limits:
 *   MAX_ARTISTS_PER_RUN = 20
 *   MAX_TRACKS_PER_RUN  = 200
 *   MAX_MATCH_JOBS      = 50
 *
 * Never calls yt-search directly.  All matching is delegated to the queue.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// ─── Load .env.local (mirrors ytMatchWorker pattern) ─────────────────────────
(function loadEnvLocal() {
    if (process.env.MONGODB_URI) return;
    const envPath = path.resolve(__dirname, '..', '.env.local');
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) process.env[key] = val;
    }
}());

// ─── Environment ──────────────────────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const QUEUE_KEY = 'demus:ytmatch:queue';

// ─── Safety limits ────────────────────────────────────────────────────────────
const MAX_ARTISTS_PER_RUN = 20;
const MAX_TRACKS_PER_RUN = 200;
const MAX_MATCH_JOBS = 50;

// ─── Mongoose schema (worker-local; avoids @/ alias resolution) ───────────────
const TrackSchema = new mongoose.Schema(
    {
        name: String,
        artists: [String],
        album: String,
        duration: Number,
        spotifyId: { type: String, unique: true },
        youtubeVideoId: { type: String, default: null },
        albumImage: String,
        fingerprint: String,
        importedAt: Date,
    },
    { timestamps: true }
);

let Track;

function initModels() {
    Track = mongoose.models.Track || mongoose.model('Track', TrackSchema);
}

// ─── MongoDB connection ───────────────────────────────────────────────────────
async function connectDB() {
    if (!MONGODB_URI) throw new Error('[artistCrawler] MONGODB_URI environment variable is required');
    if (mongoose.connection.readyState === 1) return;
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 15_000 });
    console.log('[artistCrawler] Connected to MongoDB');
}

// ─── generateFingerprint (mirrors lib/trackFingerprint.js exactly) ────────────
function generateFingerprint(name, artists) {
    let result = (name || '').toLowerCase();
    result = result.replace(/\([^)]*\)/g, '');
    result = result.replace(/\bfeat(?:uring)?\b/g, '');
    result = result.replace(/\bremaster(?:ed)?\b/g, '');
    result = result.replace(/[^\w\s]/g, '');
    result = result.trim().replace(/\s+/g, ' ');
    const primaryArtist = ((artists && artists[0]) || '')
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .trim();
    return primaryArtist ? `${result} ${primaryArtist}`.trim() : result;
}

// ─── Redis enqueue helper ─────────────────────────────────────────────────────
async function enqueueMatchJob(redis, job) {
    if (!redis) return false;
    try {
        await redis.rpush(QUEUE_KEY, JSON.stringify(job));
        return true;
    } catch (err) {
        console.warn('[artistCrawler] Failed to enqueue match job:', err.message);
        return false;
    }
}

// ─── Track parsers (mirrors lib/spotify.js internal helpers) ─────────────────

function parseArtists(input) {
    if (Array.isArray(input)) {
        return input
            .map(a => (typeof a === 'string' ? a : (a.name || a.title || '')))
            .filter(Boolean);
    }
    if (typeof input === 'string') return input.split(/\s*,\s*/).filter(Boolean);
    return [];
}

function extractImage(data) {
    if (!data) return null;
    if (data.album?.images?.[0]?.url) return data.album.images[0].url;
    if (Array.isArray(data.images) && data.images[0]?.url) return data.images[0].url;
    if (typeof data.image === 'string') return data.image;
    return null;
}

/** Parse a track from the Spotify API-like format (Format B). */
function parseApiTrack(t) {
    if (!t) return null;
    const spotifyId = t.id || t.uri?.split(':').pop() || null;
    if (!spotifyId) return null;
    return {
        spotifyId,
        name: t.name || t.title || 'Unknown',
        artists: parseArtists(t.artists),
        album: t.album?.name || (typeof t.album === 'string' ? t.album : null),
        albumImage: extractImage(t),
        duration: t.duration_ms || t.duration || 0,
    };
}

/** Parse a track from the Spotify embed trackList format (Format A). */
function parseEmbedTrack(t) {
    if (!t) return null;
    const spotifyId = t.uri?.split(':').pop() || null;
    if (!spotifyId) return null;
    return {
        spotifyId,
        name: t.title || t.name || 'Unknown',
        artists: parseArtists(t.subtitle || t.artists),
        album: null,
        albumImage: null,
        duration: t.duration || t.duration_ms || 0,
    };
}

// ─── Spotify data fetchers ────────────────────────────────────────────────────

/**
 * Fetch album.id (and optionally artist IDs) for a given track spotifyId.
 * Uses getData on https://open.spotify.com/track/{id}.
 *
 * @returns {{ albumId: string|null, artistSpotifyIds: string[] }}
 */
async function getTrackExpansionData(spotifyId, getData) {
    try {
        const data = await getData(`https://open.spotify.com/track/${spotifyId}`);
        const albumId = data.album?.id || null;
        const artistSpotifyIds = (data.artists || [])
            .map(a => a.id)
            .filter(Boolean);
        return { albumId, artistSpotifyIds };
    } catch (err) {
        console.warn(`[artistCrawler] Failed to fetch track data for ${spotifyId}:`, err.message);
        return { albumId: null, artistSpotifyIds: [] };
    }
}

/**
 * Fetch all tracks from a Spotify album page.
 * Uses getData on https://open.spotify.com/album/{id}.
 *
 * @returns {object[]} Parsed track array
 */
async function fetchAlbumTracks(albumId, getData) {
    const url = `https://open.spotify.com/album/${albumId}`;
    let tracks = [];

    try {
        const data = await getData(url);

        // Format B: tracks.items (API-like)
        if (data.tracks?.items && Array.isArray(data.tracks.items)) {
            tracks = data.tracks.items
                .map(item => parseApiTrack(item.track || item))
                .filter(Boolean);
        }
        // Format A: trackList (embed)
        else if (data.trackList && Array.isArray(data.trackList)) {
            tracks = data.trackList.map(parseEmbedTrack).filter(Boolean);
        }
    } catch (err) {
        console.warn(`[artistCrawler] Failed to fetch album ${albumId}:`, err.message);
    }

    return tracks;
}

// ─── 3-tier metadata enrichment (mirrors lib/spotify.js) ───────────────────────
//
// Runs BEFORE upsert so new tracks are saved with full album + art data.
// Tier 1 — iTunes Search API   (fast, concurrent, great mainstream coverage)
//           Tries cleaned name first (strips feat./version), falls back to full name.
// Tier 2 — MusicBrainz + CAA   (serialised at 1 req/s, last resort)
//
// NOTE: Spotify OG scrape was Tier 2 but Spotify moved to a full SPA so the
//       HTML response no longer contains OG meta tags.  Removed.

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Strip featured-artist suffixes and version tags that confuse search engines. */
function cleanTrackName(name) {
    return name
        .replace(/\s*[\(\[](feat|ft|with|prod)[^\)\]]*[\)\]]/gi, '')
        .replace(/\s*-\s*(radio|acoustic|live|demo|remix|remaster(?:ed)?|version|edit|extended|alt(?:ernate)?).*$/gi, '')
        .replace(/\s*\([^)]*\)\s*$/, '') // trailing parenthetical
        .trim();
}

async function fetchFromItunes(track) {
    const MAX_RETRIES = 3;
    const artist = track.artists?.[0] || '';
    const cleanName = cleanTrackName(track.name);
    const queries = cleanName !== track.name
        ? [`${artist} ${cleanName}`, `${artist} ${track.name}`]
        : [`${artist} ${track.name}`];

    for (const queryStr of queries) {
        const url = `https://itunes.apple.com/search?term=${encodeURIComponent(queryStr)}&media=music&entity=song&limit=1&country=US`;
        let attempt = 0;
        while (attempt < MAX_RETRIES) {
            try {
                const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
                if (res.status === 403) {
                    console.warn('[artistCrawler] iTunes 403 — rate-limited, skipping iTunes tier');
                    return false;
                }
                if (res.status === 429 || res.status >= 500) {
                    await sleep(500 * Math.pow(2, attempt));
                    attempt++;
                    continue;
                }
                if (!res.ok) break;
                const body = await res.text();
                if (!body) break;
                const json = JSON.parse(body);
                const result = json.results?.[0];
                if (!result) break;
                if (!track.album || track.album === 'Unknown Album')
                    track.album = result.collectionName || track.album;
                if (!track.albumImage && result.artworkUrl100)
                    track.albumImage = result.artworkUrl100.replace('100x100bb', '600x600bb');
                return !!(track.album && track.albumImage);
            } catch (err) {
                if (attempt < MAX_RETRIES - 1) await sleep(500 * Math.pow(2, attempt));
                attempt++;
            }
        }
    }
    return false;
}

async function fetchFromMusicBrainz(track) {
    const artist = track.artists?.[0] || '';
    const query = encodeURIComponent(`recording:"${track.name}" AND artist:"${artist}"`);
    const headers = { 'User-Agent': 'ProMusicApp/1.0 (https://github.com/pro-music-app)' };
    try {
        const res = await fetch(
            `https://musicbrainz.org/ws/2/recording/?query=${query}&fmt=json&limit=10&inc=releases+release-groups`,
            { signal: AbortSignal.timeout(12000), headers }
        );
        if (!res.ok) return false;
        const json = await res.json();
        let bestRelease = null;
        for (const recording of json.recordings?.slice(0, 5) ?? []) {
            const releases = recording.releases ?? [];
            const candidate =
                releases.find(r => r.status === 'Official' && r['release-group']?.['primary-type'] === 'Album' && !(r['release-group']?.['secondary-types'] ?? []).some(s => ['Live', 'Compilation', 'Soundtrack', 'Remix'].includes(s))) ||
                releases.find(r => r.status === 'Official' && r['release-group']?.['primary-type'] === 'Album') ||
                releases.find(r => r.status === 'Official') ||
                releases[0];
            if (candidate && candidate.status !== 'Bootleg') { bestRelease = candidate; break; }
        }
        if (!bestRelease) return false;
        if (!track.album || track.album === 'Unknown Album') track.album = bestRelease.title || track.album;
        if (!track.albumImage && bestRelease.id) {
            try {
                const caaRes = await fetch(`https://coverartarchive.org/release/${bestRelease.id}`, { signal: AbortSignal.timeout(8000), headers });
                if (caaRes.ok) {
                    const caaJson = await caaRes.json();
                    const img = caaJson.images?.find(i => i.front) || caaJson.images?.[0];
                    if (img) track.albumImage = img.thumbnails?.['500'] || img.thumbnails?.large || img.image || null;
                }
            } catch (_) { /* non-fatal */ }
        }
        return !!(track.album && track.albumImage);
    } catch (err) {
        console.warn(`[artistCrawler] MusicBrainz error for "${track.name}":`, err.message);
        return false;
    }
}

async function enrichTracks(tracks, tag) {
    const needsWork = tracks.filter(t => !t.albumImage || !t.album || t.album === 'Unknown Album');
    if (needsWork.length === 0) return;
    console.log(`[${tag}] Enriching ${needsWork.length} track(s) missing album/image...`);

    // Tier 1: iTunes (5 concurrent, 300 ms between batches)
    for (let i = 0; i < needsWork.length; i += 5) {
        await Promise.all(needsWork.slice(i, i + 5).map(fetchFromItunes));
        if (i + 5 < needsWork.length) await sleep(300);
    }

    const afterItunes = needsWork.filter(t => !t.albumImage || !t.album || t.album === 'Unknown Album');
    if (afterItunes.length === 0) { console.log(`[${tag}] iTunes resolved all.`); return; }
    console.log(`[${tag}] iTunes missed ${afterItunes.length} — trying MusicBrainz...`);

    // Tier 2: MusicBrainz (serialised, 1100 ms apart)
    for (let i = 0; i < afterItunes.length; i++) {
        await fetchFromMusicBrainz(afterItunes[i]);
        if (i < afterItunes.length - 1) await sleep(1100);
    }
}

// ─── Upsert helper ────────────────────────────────────────────────────────────

/**
 * Upsert a single parsed track into MongoDB.
 * Returns true if a new document was inserted, false if it already existed.
 */
async function upsertTrack(track) {
    const fingerprint = generateFingerprint(track.name, track.artists);
    const setOnInsert = {
        name: track.name,
        artists: track.artists,
        album: track.album || 'Unknown Album',
        duration: track.duration,
        albumImage: track.albumImage,
        fingerprint,
        importedAt: new Date(),
    };
    // Backfill album/albumImage on existing tracks that were inserted with
    // Format A (embed trackList), which returns no album or image data.
    const backfill = {};
    if (track.album) backfill.album = track.album;
    if (track.albumImage) backfill.albumImage = track.albumImage;
    const updateOp = Object.keys(backfill).length > 0
        ? { $setOnInsert: setOnInsert, $set: backfill }
        : { $setOnInsert: setOnInsert };
    const existing = await Track.findOneAndUpdate(
        { spotifyId: track.spotifyId },
        updateOp,
        { upsert: true, new: false }
    );
    return !existing; // null return == newly inserted
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function run() {
    console.log('[artistCrawler] Artist crawler started');

    await connectDB();
    initModels();

    // ── Redis (optional) ──────────────────────────────────────────────────────
    let redis = null;
    try {
        const Redis = require('ioredis');
        redis = new Redis(REDIS_URL, { lazyConnect: true, connectTimeout: 5_000 });
        await redis.connect();
        console.log('[artistCrawler] Connected to Redis');
    } catch (err) {
        console.warn('[artistCrawler] Redis unavailable — match jobs will not be queued:', err.message);
        redis = null;
    }

    // ── Load spotify-url-info (ESM package — must use dynamic import) ─────────
    let getData;
    try {
        const spotifyUrlInfo = await import('spotify-url-info');
        ({ getData } = spotifyUrlInfo.default(fetch));
    } catch (err) {
        console.error('[artistCrawler] Failed to load spotify-url-info:', err.message);
        await mongoose.disconnect();
        process.exit(1);
    }

    // ── Step 1: Sample random tracks from the DB ──────────────────────────────
    let sampledTracks;
    try {
        sampledTracks = await Track.aggregate([{ $sample: { size: 20 } }]);
    } catch (err) {
        console.error('[artistCrawler] Failed to sample tracks:', err.message);
        await mongoose.disconnect();
        process.exit(1);
    }

    if (sampledTracks.length === 0) {
        console.log('[artistCrawler] No tracks in DB yet — run populate:charts first');
        await mongoose.disconnect();
        process.exit(0);
    }

    // ── Step 2 & 3: Extract and deduplicate artist names ─────────────────────
    const artistSet = new Set();
    const artistToSeedTrack = {};

    for (const track of sampledTracks) {
        for (const artistName of (track.artists || [])) {
            if (!artistName) continue;
            if (!artistSet.has(artistName)) {
                artistSet.add(artistName);
                // Keep one seed track per artist (needs a spotifyId for expansion)
                if (track.spotifyId) {
                    artistToSeedTrack[artistName] = track;
                }
            }
        }
    }

    const artists = [...artistSet].slice(0, MAX_ARTISTS_PER_RUN);
    console.log(`[artistCrawler] Artists discovered: ${artists.length} — ${artists.join(', ')}`);

    let totalInserted = 0;
    let totalMatchesQueued = 0;
    let trackCount = 0;

    // ── Steps 4–7: Expand each artist via seed track → album → all tracks ─────
    for (const artistName of artists) {
        if (trackCount >= MAX_TRACKS_PER_RUN) {
            console.log('[artistCrawler] MAX_TRACKS_PER_RUN reached — stopping early');
            break;
        }

        const seedTrack = artistToSeedTrack[artistName];
        if (!seedTrack?.spotifyId) {
            console.warn(`[artistCrawler] No seed track with spotifyId for artist "${artistName}" — skipping`);
            continue;
        }

        console.log(`[artistCrawler] Expanding artist: "${artistName}" via seed "${seedTrack.name}"`);

        // Fetch album ID from the seed track's Spotify page
        const { albumId } = await getTrackExpansionData(seedTrack.spotifyId, getData);

        if (!albumId) {
            console.warn(`[artistCrawler] Could not resolve album for "${artistName}" — skipping`);
            continue;
        }

        // Fetch all tracks from that album
        const albumTracks = await fetchAlbumTracks(albumId, getData);
        console.log(`[artistCrawler] Album (${albumId}): ${albumTracks.length} tracks found for "${artistName}"`);

        // Enrich tracks missing album/albumImage before saving
        await enrichTracks(albumTracks, 'artistCrawler');

        for (const track of albumTracks) {
            if (trackCount >= MAX_TRACKS_PER_RUN) break;

            try {
                const wasInserted = await upsertTrack(track);
                if (wasInserted) {
                    totalInserted++;
                    console.log(`[artistCrawler] Inserted: "${track.name}" by ${track.artists.join(', ')}`);
                }

                // Enqueue YouTube match for tracks still missing a videoId
                if (totalMatchesQueued < MAX_MATCH_JOBS) {
                    const savedTrack = await Track
                        .findOne({ spotifyId: track.spotifyId })
                        .select('_id youtubeVideoId')
                        .lean();

                    if (savedTrack && !savedTrack.youtubeVideoId) {
                        const queued = await enqueueMatchJob(redis, {
                            trackId: savedTrack._id.toString(),
                            name: track.name,
                            artist: track.artists[0] || '',
                            duration: track.duration,
                        });
                        if (queued) totalMatchesQueued++;
                    }
                }

                trackCount++;
            } catch (err) {
                console.error(`[artistCrawler] Error upserting "${track.name}":`, err.message);
            }
        }
    }

    console.log(
        `[artistCrawler] Done. Tracks inserted: ${totalInserted}, Matches queued: ${totalMatchesQueued}`
    );

    if (redis) {
        try { await redis.quit(); } catch (_) { /* ignore */ }
    }
    await mongoose.disconnect();
    process.exit(0);
}

run().catch(err => {
    console.error('[artistCrawler] Fatal error:', err);
    process.exit(1);
});
