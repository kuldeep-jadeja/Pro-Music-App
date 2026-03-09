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

// ─── Upsert helper ────────────────────────────────────────────────────────────

/**
 * Upsert a single parsed track into MongoDB.
 * Returns true if a new document was inserted, false if it already existed.
 */
async function upsertTrack(track) {
    const fingerprint = generateFingerprint(track.name, track.artists);
    const existing = await Track.findOneAndUpdate(
        { spotifyId: track.spotifyId },
        {
            $setOnInsert: {
                name: track.name,
                artists: track.artists,
                album: track.album || 'Unknown Album',
                duration: track.duration,
                albumImage: track.albumImage,
                fingerprint,
                importedAt: new Date(),
            },
        },
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
