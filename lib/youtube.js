import ytSearch from 'yt-search';
import Playlist from '@/models/Playlist';
import Track from '@/models/Track';
import { generateFingerprint } from '@/lib/trackFingerprint';
import { enqueueYouTubeMatch } from '@/lib/redisQueue';

// ---------------------------------------------------------------------------
// GLOBAL CONCURRENCY CONTROL — in-process promise chain
// ---------------------------------------------------------------------------
// Retained for the synchronous match-youtube API path (POST /api/match-youtube)
// which needs an immediate YouTube ID in response.  All yt-search calls through
// this chain are serialised: at most ONE is in-flight within a single Node
// process at any time.
//
// For batch playlist matching, enqueue() receives a plain job object and
// delegates to the Redis-backed queue instead.  The ytMatchWorker process
// is the single consumer of that queue, providing server-wide max concurrency = 1.
// ---------------------------------------------------------------------------
let globalQueue = Promise.resolve();

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Polymorphic enqueue:
 *
 *   enqueue(fn)   — fn is a Function
 *     Executes fn through the in-process promise chain.  Returns the fn result.
 *     Used by POST /api/match-youtube for synchronous, client-awaited lookups.
 *
 *   enqueue(job)  — job is a plain Object { trackId, playlistId, name, artist, duration }
 *     Pushes the job onto the Redis queue (demus:ytmatch:queue) for the
 *     ytMatchWorker process to execute.  Returns immediately (fire-and-forget).
 *     Used by batchMatchTracks for async playlist matching.
 *
 * Both paths preserve the single-concurrency guarantee:
 *   • Function path  → in-process promise chain (one active call per Node process)
 *   • Object path    → Redis BLPOP worker (one active call across all servers)
 */
export async function enqueue(fnOrJob) {
    if (typeof fnOrJob === 'function') {
        // ── Synchronous in-process path ──────────────────────────────────
        return new Promise((resolve, reject) => {
            globalQueue = globalQueue.then(async () => {
                try {
                    const result = await fnOrJob();
                    resolve(result);
                } catch (err) {
                    reject(err);
                }
            });
        });
    }

    // ── Redis queue path ─────────────────────────────────────────────────
    await enqueueYouTubeMatch(fnOrJob);
}

/**
 * Return a random jitter value in the range [-maxJitter, +maxJitter] ms.
 * Used to break up deterministic timing patterns that trigger bot detection.
 */
function jitter(maxJitter = 200) {
    return Math.floor(Math.random() * maxJitter * 2) - maxJitter;
}

// ---------------------------------------------------------------------------
// RETRY LOGIC — Transient network error recovery
// ---------------------------------------------------------------------------
// yt-search can fail with transient OS-level network errors that are safe to
// retry.  Non-network errors (bad response, parse failure, etc.) are NOT
// retried — they propagate immediately to batchMatchTracks' error handler
// which pauses the playlist.
// ---------------------------------------------------------------------------
const TRANSIENT_ERROR_CODES = new Set(['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN']);

// Delay in ms before each attempt (index = attempt number, 0-based).
// attempt 0 → immediate, attempt 1 → 500 ms, attempt 2 → 1500 ms
const RETRY_DELAYS_MS = [0, 500, 1500];

/**
 * Calls searchYouTubeTrack with up to 3 attempts.
 * Only retries on transient network errors (ETIMEDOUT, ECONNRESET, EAI_AGAIN).
 * All other errors are rethrown immediately.
 */
async function searchWithRetry(trackName, artistName, durationMs) {
    let lastErr;
    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
        if (RETRY_DELAYS_MS[attempt] > 0) {
            await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
        }
        try {
            return await searchYouTubeTrack(trackName, artistName, durationMs);
        } catch (err) {
            if (TRANSIENT_ERROR_CODES.has(err.code)) {
                lastErr = err;
                const hasMore = attempt < RETRY_DELAYS_MS.length - 1;
                console.warn(
                    `[yt-search] Transient error (${err.code}) on "${trackName}" ` +
                    `attempt ${attempt + 1}/${RETRY_DELAYS_MS.length}.` +
                    (hasMore ? ' Retrying...' : ' All retries exhausted.')
                );
            } else {
                // Non-transient error — fail immediately, do not retry.
                throw err;
            }
        }
    }
    throw lastErr;
}

/**
 * Search YouTube for a track using yt-search (zero-quota scraping)
 * and return the best matching video ID based on a scoring algorithm.
 */
export async function searchYouTubeTrack(trackName, artistName, durationMs) {
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
        if (durationSec && Math.abs(ytDurationSec - durationSec) <= 15) {
            score += 10;
        }

        // Prefer official content
        if (title.includes('official audio') || title.includes('official music')) {
            score += 5;
        }
        if (title.includes('official')) score += 2;
        if (author.includes('vevo') || author.includes('official')) score += 3;

        // Penalize bad matches
        if (title.includes('cover')) score -= 5;
        if (title.includes('remix') && !trackLower.includes('remix')) score -= 5;
        if (title.includes('live') && !trackLower.includes('live')) score -= 3;
        if (title.includes('karaoke') || title.includes('instrumental')) score -= 8;

        if (score > bestScore) {
            bestScore = score;
            bestMatch = video.videoId;
        }
    }

    // Fallback to first result if all scores are non-positive
    return bestScore > 0 ? bestMatch : candidates[0].videoId;
}

/**
 * Match tracks sequentially with a delay between each search.
 * Updates Playlist.importProgress as tracks are matched.
 * If yt-search throws (rate-limit / IP block), sets status to 'paused' and halts.
 *
 * All yt-search calls are routed through the module-level global queue so that
 * concurrent batchMatchTracks invocations (from different playlist imports)
 * never issue more than one yt-search request at a time.
 *
 * @param {Array} tracksToMatch - Track documents (must have _id, name, artists, duration, spotifyId)
 * @param {string} playlistId  - Mongoose ObjectId of the Playlist document
 * @param {number} delayMs     - Base milliseconds to wait between searches (default 1000)
 */
export async function batchMatchTracks(tracksToMatch, playlistId, delayMs = 1000) {
    const total = tracksToMatch.length;
    let matched = 0;

    // index tracks loop iterations so progress writes can be throttled.
    let index = 0;

    for (const track of tracksToMatch) {
        try {
            // Defensive re-check: another concurrent batchMatchTracks task
            // (for a different playlist sharing this track) may have already
            // matched it.  Skip the yt-search call if so — saves a request.
            const freshTrack = await Track.findById(track._id).select('youtubeVideoId').lean();
            if (freshTrack?.youtubeVideoId) {
                matched++;
                // Throttle: only write progress every 5 tracks
                if ((index + 1) % 5 === 0) {
                    const progress = Math.round(50 + (matched / total) * 50);
                    await Playlist.updateOne(
                        { _id: playlistId },
                        { $set: { importProgress: progress } }
                    );
                }
                index++;
                continue;
            }

            // ── Fingerprint cache lookup ──────────────────────────────────
            // Before issuing a yt-search request, check whether any other
            // track in the global cache shares the same canonical fingerprint
            // (same song + primary artist, normalised).  A different playlist
            // may already have matched the same song under a slightly different
            // title (e.g. a remastered edition).  Reusing that videoId saves a
            // yt-search call and its associated delay/rate-limit risk.
            const fingerprint = generateFingerprint(track.name, track.artists);
            if (fingerprint) {
                const cachedByFingerprint = await Track.findOne({
                    fingerprint,
                    youtubeVideoId: { $ne: null },
                })
                    .select('youtubeVideoId')
                    .lean();

                if (cachedByFingerprint?.youtubeVideoId) {
                    await Track.updateOne(
                        { _id: track._id },
                        { $set: { youtubeVideoId: cachedByFingerprint.youtubeVideoId } }
                    );
                    await Playlist.updateOne(
                        { _id: playlistId },
                        { $inc: { matchedCount: 1 } }
                    );
                    matched++;
                    if ((index + 1) % 5 === 0) {
                        const progress = Math.round(50 + (matched / total) * 50);
                        await Playlist.updateOne(
                            { _id: playlistId },
                            { $set: { importProgress: progress } }
                        );
                    }
                    index++;
                    continue;
                }
            }

            // Push a job onto the Redis queue.  The ytMatchWorker process is
            // the single consumer: it calls searchYouTubeTrack, writes the
            // result to Track.youtubeVideoId, and updates playlist progress.
            // Max concurrency = 1 is enforced by the worker's sequential
            // BLPOP loop with a 1 s inter-job delay.
            await enqueue({
                trackId: track._id.toString(),
                playlistId: playlistId.toString(),
                name: track.name,
                artist: track.artists[0] || 'Unknown',
                duration: track.duration,
            });

            if (isDev) {
                console.log(`[YTQueue] Queued YouTube match for: "${track.name}"`);
            }

            // Track.youtubeVideoId update and playlist progress are handled
            // by the ytMatchWorker process after searchYouTubeTrack completes.
            matched++;

        } catch (err) {
            // Enqueue failure (e.g. Redis write error) — log and continue.
            // The track will remain unmatched until the playlist is resumed.
            console.error(
                `[batchMatchTracks] Failed to enqueue track "${track.name}": ${err.message}`
            );
        }

        index++;
    }

    // Tracks that were resolved via fingerprint cache are reflected immediately.
    // Tracks pushed to Redis will be processed by the worker, which is responsible
    // for writing importProgress and flipping status to 'ready' when the queue drains.
    if (isDev) {
        console.log(
            `[batchMatchTracks] Enqueued ${matched} tracks for playlist ${playlistId} (${total} total)`
        );
    }
}
