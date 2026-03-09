/**
 * ytMatchWorker.js — Redis-backed YouTube match worker
 *
 * Standalone Node.js process (CommonJS).  Runs independently of the Next.js
 * app server.  Start with:
 *
 *   npm run ytmatch:worker
 *
 * Architecture:
 *   API server  →  enqueueYouTubeMatch()  →  Redis list (demus:ytmatch:queue)
 *                                                    ↓
 *                                         ytMatchWorker (BLPOP consumer)
 *                                                    ↓
 *                                    searchYouTubeTrack()  (yt-search scrape)
 *                                                    ↓
 *                                    Track.youtubeVideoId  (MongoDB update)
 *
 * Concurrency: BLPOP + single-consumer loop guarantees max 1 yt-search
 * request in-flight across ALL server instances at any time.
 *
 * Safety:
 *   - Every job is wrapped in try/catch — one bad job never crashes the loop.
 *   - On yt-search error the playlist is paused with a 5-minute retryAfter.
 *   - On transient network errors (ETIMEDOUT, ECONNRESET, EAI_AGAIN) the
 *     search is retried up to 3 times before failing.
 */

'use strict';

// Note: this file is intentionally CommonJS (no "type": "module" in package.json).
// Dynamic require() lets us share npm packages with the Next.js app without
// going through the Next.js compiler or needing @/ alias resolution.

const fs = require('fs');
const path = require('path');
const Redis = require('ioredis');
const mongoose = require('mongoose');
const ytSearch = require('yt-search');

// ─── Load .env.local automatically when env vars are missing ─────────────────
// Lets the worker be run as both  `node workers/ytMatchWorker.js`  and
// `npm run ytmatch:worker` (which uses --env-file=.env.local for Node ≥ 20.6).
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
const QUEUE_KEY = 'demus:ytmatch:queue';
const JOB_DELAY_MS = 1000; // pause between consecutive jobs (anti-rate-limit)
const isDev = process.env.NODE_ENV !== 'production';

function devLog(msg) { if (isDev) console.log(`[ytMatchWorker] ${msg}`); }
function logWarn(msg) { console.warn(`[ytMatchWorker] WARN  ${msg}`); }
function logError(msg, e) { console.error(`[ytMatchWorker] ERROR ${msg}`, e ? e.message : ''); }

// ─── Mongoose schemas (worker-local; same MongoDB, separate Node process) ────
//
// Defining schemas here avoids importing from Next.js @/ modules (which
// require the Next.js compiler + jsconfig path aliases).  The worker process
// is entirely standalone.  Mongoose enforces no cross-process model conflicts.

const TrackSchema = new mongoose.Schema(
    {
        name: String,
        artists: [String],
        album: String,
        duration: Number,
        spotifyId: String,
        youtubeVideoId: { type: String, default: null },
        albumImage: String,
        fingerprint: String,
        importedAt: Date,
    },
    { timestamps: true }
);

const PlaylistSchema = new mongoose.Schema(
    {
        user: mongoose.Schema.Types.ObjectId,
        tracks: [{ type: mongoose.Schema.Types.ObjectId }],
        trackCount: Number,
        status: String,
        importProgress: Number,
        errorMessage: String,
        pausedAt: Date,
        retryAfter: Date,
    },
    { timestamps: true }
);

let Track;
let Playlist;

function initModels() {
    Track = mongoose.models.Track || mongoose.model('Track', TrackSchema);
    Playlist = mongoose.models.Playlist || mongoose.model('Playlist', PlaylistSchema);
}

// ─── MongoDB connection ───────────────────────────────────────────────────────
async function connectDB() {
    if (!MONGODB_URI) {
        throw new Error('MONGODB_URI environment variable is required');
    }
    if (mongoose.connection.readyState === 1) return; // already connected
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
    devLog('Connected to MongoDB');
}

// ─── YouTube search — scoring algorithm (mirrors lib/youtube.js exactly) ─────
//
// DO NOT MODIFY the scoring weights or candidate selection logic.
// This must remain identical to searchYouTubeTrack in lib/youtube.js.

const TRANSIENT_CODES = new Set(['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN']);
const RETRY_DELAYS_MS = [0, 500, 1500];

async function searchYouTubeTrack(trackName, artistName, durationMs) {
    const query = `${trackName} - ${artistName} Official Audio`;
    const { videos } = await ytSearch({ query });

    if (!videos || videos.length === 0) return null;

    const candidates = videos.slice(0, 5);
    const durationSec = durationMs ? durationMs / 1000 : null;
    const trackLower = trackName.toLowerCase();

    let bestMatch = null;
    let bestScore = -Infinity;

    for (const video of candidates) {
        const title = (video.title || '').toLowerCase();
        const author = (video.author?.name || '').toLowerCase();
        const ytDurationSec = video.duration?.seconds ?? 0;

        let score = 0;

        // Duration within ±15 seconds
        if (durationSec && Math.abs(ytDurationSec - durationSec) <= 15) score += 10;

        // Prefer official content
        if (title.includes('official audio') || title.includes('official music')) score += 5;
        if (title.includes('official')) score += 2;
        if (author.includes('vevo') || author.includes('official')) score += 3;

        // Penalise bad matches
        if (title.includes('cover')) score -= 5;
        if (title.includes('remix') && !trackLower.includes('remix')) score -= 5;
        if (title.includes('live') && !trackLower.includes('live')) score -= 3;
        if (title.includes('karaoke') || title.includes('instrumental')) score -= 8;

        if (score > bestScore) { bestScore = score; bestMatch = video.videoId; }
    }

    return bestScore > 0 ? bestMatch : candidates[0].videoId;
}

async function searchWithRetry(trackName, artistName, durationMs) {
    let lastErr;
    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
        if (RETRY_DELAYS_MS[attempt] > 0) {
            await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
        }
        try {
            return await searchYouTubeTrack(trackName, artistName, durationMs);
        } catch (e) {
            if (TRANSIENT_CODES.has(e.code)) {
                lastErr = e;
                const hasMore = attempt < RETRY_DELAYS_MS.length - 1;
                logWarn(
                    `Transient error (${e.code}) on "${trackName}" ` +
                    `attempt ${attempt + 1}/${RETRY_DELAYS_MS.length}.` +
                    (hasMore ? ' Retrying...' : ' All retries exhausted.')
                );
            } else {
                throw e; // non-transient — fail immediately
            }
        }
    }
    throw lastErr;
}

// ─── Process one job ──────────────────────────────────────────────────────────
async function processJob(job) {
    const { trackId, playlistId, name, artist, duration } = job;

    devLog(`Worker processing track: "${name}" by ${artist} (trackId=${trackId})`);

    const videoId = await searchWithRetry(name, artist, duration);

    if (videoId) {
        await Track.updateOne(
            { _id: new mongoose.Types.ObjectId(trackId) },
            { $set: { youtubeVideoId: videoId } }
        );
        devLog(`Match success: "${name}" → ${videoId}`);
    } else {
        logWarn(`Match failure: no YouTube video found for "${name}" by ${artist}`);
    }

    // ── Update playlist progress ──────────────────────────────────────────────
    if (!playlistId) return;

    const playlist = await Playlist.findById(playlistId)
        .select('tracks trackCount')
        .lean();

    if (!playlist) {
        logWarn(`Playlist ${playlistId} not found when updating progress`);
        return;
    }

    const total = playlist.trackCount || playlist.tracks.length;
    const remaining = await Track.countDocuments({
        _id: { $in: playlist.tracks },
        $or: [
            { youtubeVideoId: null },
            { youtubeVideoId: { $exists: false } },
        ],
    });

    const matchedSoFar = total - remaining;
    const progress = remaining === 0
        ? 100
        : Math.round(50 + (matchedSoFar / total) * 50);

    if (remaining === 0) {
        await Playlist.updateOne(
            { _id: playlistId },
            { $set: { status: 'ready', importProgress: 100 } }
        );
        devLog(`All tracks matched for playlist ${playlistId} — status set to 'ready'`);
    } else {
        await Playlist.updateOne(
            { _id: playlistId },
            { $set: { importProgress: progress } }
        );
    }
}

// ─── Main loop ────────────────────────────────────────────────────────────────
async function main() {
    if (!MONGODB_URI) {
        console.error(
            '[ytMatchWorker] FATAL: MONGODB_URI is not set. ' +
            'Add it to .env.local or export it before starting the worker.'
        );
        process.exit(1);
    }

    await connectDB();
    initModels();

    const redis = new Redis(REDIS_URL, {
        retryStrategy(times) {
            if (times >= 10) return null; // give up after 10 attempts
            return Math.min(times * 500, 5000);
        },
        lazyConnect: false,
    });

    redis.on('connect', () => devLog('Connected to Redis'));
    redis.on('error', (e) => logError('Redis error', e));

    devLog(`Watching queue: ${QUEUE_KEY}`);
    devLog('Max concurrency: 1 (single BLPOP consumer)');

    // eslint-disable-next-line no-constant-condition
    while (true) {
        let rawJob = null;
        try {
            // BLPOP with a 5-second timeout keeps the loop responsive to
            // SIGTERM without busywaiting.  Returns null on timeout.
            const result = await redis.blpop(QUEUE_KEY, 5);
            if (!result) continue; // nothing in queue — loop again

            rawJob = result[1];
            const job = JSON.parse(rawJob);
            await processJob(job);

        } catch (e) {
            if (rawJob) {
                const preview = rawJob.slice(0, 120);
                logError(`Failed to process job (${preview})`, e);

                // Attempt to pause the playlist with a cooldown so the user
                // can resume manually after the block window expires.
                try {
                    const job = JSON.parse(rawJob);
                    if (job.playlistId) {
                        const COOLDOWN_MS = 5 * 60 * 1000;
                        const now = new Date();
                        await Playlist.updateOne(
                            { _id: job.playlistId },
                            {
                                $set: {
                                    status: 'paused',
                                    errorMessage: e.message,
                                    pausedAt: now,
                                    retryAfter: new Date(now.getTime() + COOLDOWN_MS),
                                },
                            }
                        );
                        logWarn(`Paused playlist ${job.playlistId} after error on "${job.name}"`);
                    }
                } catch (_) {
                    // Best-effort — never let a secondary error crash the loop
                }
            } else {
                logError('Unexpected error in worker loop', e);
            }
        }

        // Pause between jobs — mirrors the original batchMatchTracks delay.
        // Prevents consecutive yt-search calls from triggering IP blocks.
        await new Promise((r) => setTimeout(r, JOB_DELAY_MS));
    }
}

main().catch((e) => {
    console.error('[ytMatchWorker] Fatal startup error:', e);
    process.exit(1);
});
