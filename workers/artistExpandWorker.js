/**
 * artistExpandWorker.js — Redis-backed artist expansion worker
 *
 * Standalone Node.js process (CommonJS).  Runs independently of the Next.js
 * app server.  Start with:
 *
 *   npm run expand:worker
 *
 * Architecture:
 *   Admin API  →  enqueueArtistExpand()  →  Redis list (demus:artist-expand:queue)
 *                                                   ↓
 *                                      artistExpandWorker (BLPOP consumer)
 *                                                   ↓
 *                              fetchArtistTracks()  (spotify-url-info scrape)
 *                                                   ↓
 *                              enrichTracks()       (iTunes + MusicBrainz)
 *                                                   ↓
 *                              upsertTrack()        (MongoDB fingerprint upsert)
 *                                                   ↓
 *                              enqueueMatchJob()    →  Redis list (demus:ytmatch:queue)
 *                                                   ↓
 *                                          ytMatchWorker consumes
 *
 * Worker isolation (SYNC-01):
 *   This worker consumes ONLY from demus:artist-expand:queue.
 *   It NEVER consumes from demus:ytmatch:queue.
 *   Track YouTube matching is delegated to ytMatchWorker via the ytmatch queue.
 *
 * Safety:
 *   - Every job is wrapped in try/catch — one bad job never crashes the loop.
 *   - On any error the ArtistJob document is transitioned to 'failed' with an
 *     error message (no stuck-running jobs survive a crash).
 *   - BLPOP timeout = 30 seconds (keeps the loop responsive to SIGTERM).
 */

'use strict';

// Note: this file is intentionally CommonJS (no "type": "module" in package.json).
// Dynamic require() lets us share npm packages with the Next.js app without
// going through the Next.js compiler or needing @/ alias resolution.

const fs = require('fs');
const path = require('path');
const Redis = require('ioredis');
const mongoose = require('mongoose');

// ─── Load .env.local automatically when env vars are missing ─────────────────
// Lets the worker be run as both  `node workers/artistExpandWorker.js`  and
// `npm run expand:worker` (which uses --env-file=.env.local for Node ≥ 20.6).
// Direct `node` invocation skips --env-file, so we parse the file ourselves.
(function loadEnvLocal() {
    if (process.env.MONGODB_URI) return; // already loaded by --env-file or shell
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

// ─── Environment ─────────────────────────────────────────────────────────────
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const MONGODB_URI = process.env.MONGODB_URI;
const ARTIST_EXPAND_QUEUE_KEY = 'demus:artist-expand:queue';
// MUST be 'demus:artist-expand:queue' — NOT 'demus:ytmatch:queue' (worker isolation per SYNC-01)
const YTMATCH_QUEUE_KEY = 'demus:ytmatch:queue'; // used ONLY for rpush (outbound), never BLPOP
const JOB_DELAY_MS = 500; // brief pause between jobs (ms)
const isDev = process.env.NODE_ENV !== 'production';

// ─── Logging helpers ──────────────────────────────────────────────────────────
function devLog(msg) { if (isDev) console.log(`[artistExpandWorker] ${msg}`); }
function logWarn(msg) { console.warn(`[artistExpandWorker] WARN  ${msg}`); }
function logError(msg, e) { console.error(`[artistExpandWorker] ERROR ${msg}`, e ? e.message : ''); }

// ─── Mongoose schemas (worker-local; avoids @/ alias resolution) ──────────────
//
// Defining schemas here avoids importing from Next.js @/ modules (which
// require the Next.js compiler + jsconfig path aliases). The worker process
// is entirely standalone. Mongoose enforces no cross-process model conflicts.

const ArtistJobSchema = new mongoose.Schema(
    {
        artistSpotifyId: { type: String, required: true, unique: true, index: true },
        artistName: { type: String, default: null },
        status: {
            type: String,
            enum: ['queued', 'running', 'done', 'failed'],
            default: 'queued',
            index: true,
        },
        error: { type: String, default: null },
        queuedAt: { type: Date, default: null },
        startedAt: { type: Date, default: null },
        completedAt: { type: Date, default: null },
        retriedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

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

let ArtistJob;
let Track;

// ─── Model initialiser ────────────────────────────────────────────────────────
function initModels() {
    ArtistJob = mongoose.models.ArtistJob || mongoose.model('ArtistJob', ArtistJobSchema);
    Track = mongoose.models.Track || mongoose.model('Track', TrackSchema);
}

// ─── MongoDB connection ───────────────────────────────────────────────────────
async function connectDB() {
    if (!MONGODB_URI) throw new Error('[artistExpandWorker] MONGODB_URI is required');
    if (mongoose.connection.readyState === 1) return;
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 15_000 });
    devLog('Connected to MongoDB');
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

// ─── Redis enqueue helper for ytmatch (outbound only — NOT this worker's BLPOP) ─
async function enqueueMatchJob(redis, job) {
    if (!redis) return false;
    try {
        await redis.rpush(YTMATCH_QUEUE_KEY, JSON.stringify(job));
        return true;
    } catch (err) {
        logWarn(`Failed to enqueue match job: ${err.message}`);
        return false;
    }
}

// ─── Utility ──────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Track parsers (mirrors artistCrawler.js helpers) ────────────────────────

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

// ─── Spotify artist track fetcher (copied from artistCrawler.js) ───────────────

/**
 * Fetch an artist's top tracks from their Spotify artist page.
 * spotify-url-info v3 returns a trackList (embed format) for artist URLs.
 * Falls back to tracks.items if the API-like format is returned instead.
 *
 * @returns {object[]} Parsed track array
 */
async function fetchArtistTracks(artistId, getData) {
    const url = `https://open.spotify.com/artist/${artistId}`;
    try {
        const data = await getData(url);
        // Format A: modern embed trackList (typical for artist pages)
        if (data.trackList && Array.isArray(data.trackList)) {
            return data.trackList.map(parseEmbedTrack).filter(Boolean);
        }
        // Format B: API-like structure (fallback)
        if (data.tracks?.items && Array.isArray(data.tracks.items)) {
            return data.tracks.items
                .map(item => parseApiTrack(item.track || item))
                .filter(Boolean);
        }
    } catch (err) {
        logWarn(`Failed to fetch artist tracks for ${artistId}: ${err.message}`);
    }
    return [];
}

// ─── 3-tier metadata enrichment (copied from artistCrawler.js) ────────────────

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
                    logWarn('iTunes 403 — rate-limited, skipping iTunes tier');
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
        logWarn(`MusicBrainz error for "${track.name}": ${err.message}`);
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

// ─── Upsert helper (copied from artistCrawler.js) ────────────────────────────

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

    // MongoDB rejects having the same field in both $setOnInsert and $set.
    // Remove backfill keys from $setOnInsert so $set takes precedence.
    const cleanedSetOnInsert = { ...setOnInsert };
    for (const key of Object.keys(backfill)) {
        delete cleanedSetOnInsert[key];
    }

    const updateOp = Object.keys(backfill).length > 0
        ? { $setOnInsert: cleanedSetOnInsert, $set: backfill }
        : { $setOnInsert: setOnInsert };
    const existing = await Track.findOneAndUpdate(
        { spotifyId: track.spotifyId },
        updateOp,
        { upsert: true, new: false }
    );
    return !existing; // null return == newly inserted
}

// ─── Core per-job handler ─────────────────────────────────────────────────────

async function processJob(job, getData, redis) {
    const { artistSpotifyId, artistName } = job;

    // Mark as running (atomic — only if still queued to avoid double-processing)
    const claimed = await ArtistJob.findOneAndUpdate(
        { artistSpotifyId, status: 'queued' },
        { $set: { status: 'running', startedAt: new Date() } },
        { new: true }
    );
    if (!claimed) {
        logWarn(`Job for ${artistSpotifyId} not in queued state — skipping`);
        return;
    }

    try {
        devLog(`Expanding artist: ${artistName || artistSpotifyId}`);
        const tracks = await fetchArtistTracks(artistSpotifyId, getData);
        if (tracks.length === 0) {
            logWarn(`No tracks found for artist ${artistSpotifyId}`);
        } else {
            await enrichTracks(tracks, 'artistExpandWorker');
            let inserted = 0;
            let matchesQueued = 0;
            for (const track of tracks) {
                try {
                    const wasNew = await upsertTrack(track);
                    if (wasNew) inserted++;
                    // Enqueue YouTube match for tracks missing videoId (up to 50 per job)
                    const saved = await Track.findOne({ spotifyId: track.spotifyId }).select('_id youtubeVideoId').lean();
                    if (saved && !saved.youtubeVideoId && matchesQueued < 50) {
                        const q = await enqueueMatchJob(redis, {
                            trackId: saved._id.toString(),
                            name: track.name,
                            artist: track.artists[0] || '',
                            duration: track.duration,
                        });
                        if (q) matchesQueued++;
                    }
                } catch (trackErr) {
                    logError(`Error upserting track "${track.name}":`, trackErr);
                }
            }
            devLog(`Done: ${inserted} inserted, ${matchesQueued} match jobs queued for ${artistName || artistSpotifyId}`);
        }

        await ArtistJob.findOneAndUpdate(
            { artistSpotifyId },
            { $set: { status: 'done', completedAt: new Date(), error: null } }
        );
    } catch (err) {
        logError(`Expansion failed for ${artistSpotifyId}:`, err);
        await ArtistJob.findOneAndUpdate(
            { artistSpotifyId },
            { $set: { status: 'failed', error: err.message, completedAt: new Date() } }
        );
    }
}

// ─── Main loop ────────────────────────────────────────────────────────────────
async function run() {
    console.log('[artistExpandWorker] Starting...');
    if (!MONGODB_URI) {
        console.error('[artistExpandWorker] MONGODB_URI is required');
        process.exit(1);
    }

    await connectDB();
    initModels();

    const redis = new Redis(REDIS_URL, { lazyConnect: true, connectTimeout: 5_000 });
    redis.on('error', (err) => logError('Redis error:', err));
    await redis.connect();
    devLog('Connected to Redis');

    // Load spotify-url-info (ESM package — must use dynamic import in CommonJS)
    let getData;
    try {
        const spotifyUrlInfo = await import('spotify-url-info');
        ({ getData } = spotifyUrlInfo.default(fetch));
    } catch (err) {
        logError('Failed to load spotify-url-info:', err);
        process.exit(1);
    }

    console.log(`[artistExpandWorker] Listening on ${ARTIST_EXPAND_QUEUE_KEY}...`);

    // Graceful shutdown
    let running = true;
    process.on('SIGINT', () => { running = false; });
    process.on('SIGTERM', () => { running = false; });

    // eslint-disable-next-line no-constant-condition
    while (running) {
        try {
            // BLPOP with 30-second timeout — keeps loop responsive to SIGTERM without busy-waiting.
            // Returns null on timeout — matches ytMatchWorker.js pattern.
            const result = await redis.blpop(ARTIST_EXPAND_QUEUE_KEY, 30);
            if (!result) continue; // timeout — loop again

            const [, payload] = result;
            let job;
            try {
                job = JSON.parse(payload);
            } catch (parseErr) {
                logError('Failed to parse job payload:', parseErr);
                continue;
            }

            if (!job.artistSpotifyId) {
                logWarn(`Skipping malformed job payload: ${payload}`);
                continue;
            }

            await processJob(job, getData, redis);
            if (JOB_DELAY_MS > 0) await sleep(JOB_DELAY_MS);
        } catch (err) {
            // Don't crash the loop — log and continue
            logError('Unexpected error in main loop:', err);
            await sleep(1000);
        }
    }

    console.log('[artistExpandWorker] Shutting down...');
    await redis.quit();
    await mongoose.disconnect();
    process.exit(0);
}

run().catch(err => {
    console.error('[artistExpandWorker] Fatal error:', err);
    process.exit(1);
});
