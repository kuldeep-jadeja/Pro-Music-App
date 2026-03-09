/**
 * Redis-backed YouTube match queue.
 *
 * Provides a single queue used by batchMatchTracks to hand off per-track
 * yt-search jobs to the dedicated ytMatchWorker process.  This guarantees
 * max concurrency = 1 for yt-search calls across ALL server instances:
 * the worker holds the single BLPOP consumer and only processes one job
 * at a time.
 *
 * Queue name: demus:ytmatch:queue
 *
 * If Redis is unavailable the function logs a warning and returns false.
 * The caller (batchMatchTracks) treats a false return as a skipped enqueue
 * and may fall back to handling the track inline.
 */

import { getRedis } from '@/lib/redis';

export const QUEUE_KEY = 'demus:ytmatch:queue';

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Push a YouTube-match job onto the Redis queue.
 *
 * @param {{ trackId: string, playlistId: string, name: string, artist: string, duration: number }} job
 * @returns {Promise<boolean>} true if the job was enqueued, false if Redis was unavailable
 */
export async function enqueueYouTubeMatch(job) {
    try {
        const redis = await getRedis();

        if (!redis) {
            if (isDev) {
                console.warn(
                    `[YTQueue] Redis unavailable — skipping enqueue for "${job.name}"`
                );
            }
            return false;
        }

        await redis.rpush(QUEUE_KEY, JSON.stringify(job));

        if (isDev) {
            console.log(
                `[YTQueue] Queued YouTube match: "${job.name}" by ${job.artist} (trackId=${job.trackId})`
            );
        }

        return true;
    } catch (err) {
        console.error(`[YTQueue] Failed to enqueue job for "${job.name}":`, err.message);
        return false;
    }
}
