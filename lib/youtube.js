import ytSearch from 'yt-search';
import Playlist from '@/models/Playlist';
import Track from '@/models/Track';
import { generateFingerprint } from '@/lib/trackFingerprint';

// ---------------------------------------------------------------------------
// GLOBAL CONCURRENCY CONTROL — Critical fix for IP-block prevention
// ---------------------------------------------------------------------------
// All yt-search calls across every concurrent batchMatchTracks invocation
// are funneled through this single promise chain.  This guarantees that at
// most ONE yt-search HTTP request is in-flight at any time from this Node
// process, regardless of how many playlists are being matched in parallel.
//
// The chain is self-healing: if a queued function throws, the error is
// captured and re-thrown to the original caller without breaking the chain
// for subsequent callers.
// ---------------------------------------------------------------------------
let globalQueue = Promise.resolve();

/**
 * Enqueue an async function so it executes only after every previously
 * enqueued function has settled (resolved or rejected).  Returns a promise
 * that resolves/rejects with the enqueued function's result.
 */
export function enqueue(fn) {
    return new Promise((resolve, reject) => {
        globalQueue = globalQueue.then(async () => {
            try {
                const result = await fn();
                resolve(result);
            } catch (err) {
                reject(err);
            }
        });
    });
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

            // Enqueue the yt-search call AND the post-search delay through
            // the global queue so that:
            //   1. Only one yt-search HTTP request is in-flight at a time.
            //   2. The cooldown delay occupies the queue slot, guaranteeing a
            //      minimum gap between consecutive searches globally — even
            //      when multiple concurrent batchMatchTracks workers (from
            //      different playlists) are all enqueuing at the same time.
            //      Without this, N parallel workers could each enqueue their
            //      next item the moment their local delay expired, causing
            //      N back-to-back searches with no inter-request gap.
            const videoId = await enqueue(async () => {
                // searchWithRetry retries up to 3 times on transient network
                // errors before propagating the error to the catch block.
                const result = await searchWithRetry(
                    track.name,
                    track.artists[0] || 'Unknown',
                    track.duration
                );
                // Delay inside the queue — blocks the chain until it expires.
                if (delayMs > 0) {
                    const effectiveDelay = Math.max(200, delayMs + jitter(200));
                    await new Promise((r) => setTimeout(r, effectiveDelay));
                }
                return result;
            });

            if (videoId) {
                await Track.updateOne(
                    { _id: track._id },
                    { $set: { youtubeVideoId: videoId } }
                );
                // Increment matchedCount only when a new match is written.
                await Playlist.updateOne(
                    { _id: playlistId },
                    { $inc: { matchedCount: 1 } }
                );
            }

            matched++;

            // Throttle: only write progress every 5 tracks to reduce DB writes.
            // importProgress is set to 100 unconditionally after the loop.
            if ((index + 1) % 5 === 0) {
                const progress = Math.round(50 + (matched / total) * 50);
                await Playlist.updateOne(
                    { _id: playlistId },
                    { $set: { importProgress: progress } }
                );
            }
        } catch (err) {
            // yt-search threw (and all retries exhausted for transient errors)
            // — likely rate-limited or IP-blocked.
            console.error(
                `yt-search error on track "${track.name}": ${err.message}. Pausing playlist ${playlistId}.`
            );

            // Enforce a 5-minute cooldown before resume is allowed.
            // This prevents users from spam-clicking Resume into a
            // still-active YouTube IP block, which would extend the ban.
            const COOLDOWN_MS = 5 * 60 * 1000;
            const now = new Date();

            await Playlist.updateOne(
                { _id: playlistId },
                {
                    $set: {
                        status: 'paused',
                        errorMessage: err.message,
                        pausedAt: now,
                        retryAfter: new Date(now.getTime() + COOLDOWN_MS),
                    },
                }
            );

            // Halt processing immediately — remaining tracks stay unmatched.
            return;
        }

        index++;
    }

    // All tracks processed — write final progress unconditionally so the client
    // always sees 100% regardless of whether the last batch hit the mod-5 threshold.
    await Playlist.updateOne(
        { _id: playlistId },
        { $set: { status: 'ready', importProgress: 100 } }
    );

    console.log(
        `YouTube matching complete for playlist ${playlistId}: ${matched}/${total} processed`
    );
}
