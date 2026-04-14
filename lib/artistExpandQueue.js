/**
 * Redis-backed artist expansion queue.
 *
 * Provides a single queue for handing off per-artist expansion jobs to the
 * dedicated artistExpandWorker process (workers/artistExpandWorker.js, Plan 04).
 * This keeps artist expansion jobs isolated from the YouTube match queue and
 * the metadata queue, preserving the single-consumer-per-queue architecture
 * of this codebase.
 *
 * Queue name: demus:artist-expand:queue
 * Consumer:   workers/artistExpandWorker.js — NOT ytMatchWorker (worker isolation per SYNC-01)
 *
 * Contract (mirrors lib/redisQueue.js exactly):
 *   - Returns true  if the job was pushed onto the Redis list successfully.
 *   - Returns false if Redis is unavailable or if rpush throws.
 *   - NEVER throws — callers in enqueue-artists.js check the boolean and
 *     mark the per-item result as failed when false is returned.
 *
 * If Redis is unavailable the function logs a warning and returns false.
 * The caller MUST NOT persist the ArtistJob as "queued" if this returns false,
 * because the worker will never pick it up (Redis is the delivery mechanism).
 */

import { getRedis } from '@/lib/redis';

export const ARTIST_EXPAND_QUEUE_KEY = 'demus:artist-expand:queue';

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Push an artist expansion job onto the Redis queue.
 *
 * @param {{ artistSpotifyId: string, artistName: string | null }} job
 * @returns {Promise<boolean>} true if enqueued, false if Redis unavailable or rpush throws
 */
export async function enqueueArtistExpand(job) {
    try {
        const redis = await getRedis();

        if (!redis) {
            if (isDev) {
                console.warn('[ArtistExpandQueue] Redis unavailable — skipping enqueue');
            }
            return false;
        }

        await redis.rpush(ARTIST_EXPAND_QUEUE_KEY, JSON.stringify(job));

        if (isDev) {
            console.log(
                `[ArtistExpandQueue] Queued artist expand: ` +
                `"${job.artistName ?? 'unknown'}" (artistSpotifyId=${job.artistSpotifyId})`
            );
        }

        return true;
    } catch (err) {
        console.error('[ArtistExpandQueue] Failed to enqueue:', err.message);
        return false;
    }
}
