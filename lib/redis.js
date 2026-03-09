/**
 * Redis singleton client using ioredis.
 * Redis is an optional performance layer — the app functions normally without it.
 *
 * Usage:
 *   import { getRedis } from '@/lib/redis';
 *   const redis = await getRedis();
 *   if (redis) { ... }
 */

import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const isDev = process.env.NODE_ENV !== 'production';

function log(msg) {
    if (isDev) console.log(`[Redis] ${msg}`);
}

/**
 * Returns a connected ioredis client, or null if Redis is unavailable.
 * Uses a global singleton to survive Next.js hot-reloads in development.
 *
 * @returns {Promise<import('ioredis').Redis | null>}
 */
export async function getRedis() {
    if (global.redisClient) {
        const status = global.redisClient.status;

        // Healthy — return immediately
        if (status === 'ready') return global.redisClient;

        // ioredis permanently gave up — clear the reference and fall through
        // to the redisFailed guard so we don't keep checking a dead client.
        if (status === 'end') {
            global.redisClient = null;
            global.redisFailed = true;
            return null;
        }

        // 'connecting' | 'reconnecting' | 'close' — ioredis is mid-reconnect.
        // Return null so this request falls back to MongoDB, but do NOT create
        // a second client: that would leak connections while ioredis retries.
        return null;
    }

    // If a previous connection attempt failed permanently, don't retry on every
    // request; only reset when the server process restarts.
    if (global.redisFailed) {
        return null;
    }

    try {
        const client = new Redis(REDIS_URL, {
            retryStrategy(times) {
                // Retry up to 3 times with exponential back-off, then give up.
                if (times >= 3) {
                    return null; // stop retrying; ioredis transitions to 'end'
                }
                return Math.min(times * 200, 1000);
            },
            enableOfflineQueue: false,
            lazyConnect: true,
            connectTimeout: 3000,
        });

        // Attach listeners BEFORE connecting so we never miss an early event.
        client.on('connect', () => log('Redis connected'));
        client.on('error', (err) => {
            if (isDev) console.error('[Redis] error:', err.message);
        });

        await client.connect();

        global.redisClient = client;
        global.redisFailed = false;
        return client;
    } catch (err) {
        if (isDev) console.error('[Redis] Failed to connect:', err.message);
        // Mark as permanently failed. The 'end' status check above will also
        // catch cases where ioredis exhausts retries after a successful connect.
        global.redisFailed = true;
        global.redisClient = null;
        return null;
    }
}
